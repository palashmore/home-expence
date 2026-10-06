// Audit Trail API & Interactive UI Route (/api/audit)
// Provides queryable history and a rich, luxury dashboard for all system edits
const { authenticateRequest, sessionCan } = require('./auth');
const { PERMISSIONS: P } = require('./_permissions');
const storage = require('./_storage');
const { getAuditLogs } = require('./_cloud_sync');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return escapeHtml(isoStr);

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffHours < 24) return diffHours + 'h ago';
  return diffDays + 'd ago';
}

function formatFullTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return escapeHtml(isoStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function getActionBadge(action) {
  switch (action) {
    case 'UPDATE_EXPENSE':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"><svg class="ic mr-1" aria-hidden="true"><use href="#i-square-pen"></use></svg> UPDATE EXPENSE</span>';
    case 'CREATE_EXPENSE':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><svg class="ic mr-1" aria-hidden="true"><use href="#i-plus"></use></svg> NEW EXPENSE</span>';
    case 'DELETE_EXPENSE':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30"><svg class="ic mr-1" aria-hidden="true"><use href="#i-trash-2"></use></svg> DELETE EXPENSE</span>';
    case 'UPDATE_CONFIG':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30"><svg class="ic mr-1" aria-hidden="true"><use href="#i-sliders-horizontal"></use></svg> MASTER CONFIG</span>';
    default:
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-slate-800 text-slate-300 border border-slate-700">' + escapeHtml(action) + '</span>';
  }
}

function renderDiffBox(diff) {
  if (!diff || typeof diff !== 'object' || Object.keys(diff).length === 0) {
    return '<div class="text-[11px] text-slate-500 italic">No specific field changes recorded.</div>';
  }

  let rows = '';
  for (const [key, val] of Object.entries(diff)) {
    if (!val || typeof val !== 'object') continue;
    const oldVal = val.old !== undefined ? val.old : null;
    const newVal = val.new !== undefined ? val.new : (val.updated ? (val.summary || 'Updated') : null);

    let formattedOld = oldVal !== null ? (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal)) : '';
    let formattedNew = newVal !== null ? (typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal)) : '';

    let deltaBadge = '';
    if (key === 'amount' && oldVal !== null && newVal !== null && !isNaN(Number(oldVal)) && !isNaN(Number(newVal))) {
      const numOld = Number(oldVal);
      const numNew = Number(newVal);
      const diffAmount = numNew - numOld;
      const pct = numOld !== 0 ? Math.abs((diffAmount / numOld) * 100).toFixed(1) : 0;
      if (diffAmount > 0) {
        deltaBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">+₹' + diffAmount.toLocaleString('en-IN') + ' (+' + pct + '%)</span>';
      } else if (diffAmount < 0) {
        deltaBadge = '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-950/80 text-rose-300 border border-rose-700/60">-₹' + Math.abs(diffAmount).toLocaleString('en-IN') + ' (-' + pct + '%)</span>';
      }
    }

    if (key === 'amount') {
      if (oldVal !== null) formattedOld = '₹' + Number(oldVal).toLocaleString('en-IN');
      if (newVal !== null) formattedNew = '₹' + Number(newVal).toLocaleString('en-IN');
    }

    const fieldLabel = escapeHtml(key.replace(/([A-Z])/g, ' $1'));
    rows += '<div class="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-slate-800/60 last:border-0 text-xs gap-1.5">' +
      '<span class="font-bold text-slate-400 capitalize w-36 shrink-0">' + fieldLabel + ':</span>' +
      '<div class="flex flex-wrap items-center gap-2 flex-1 font-mono text-[11px] overflow-x-auto">' +
      (formattedOld ? '<span class="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60 line-through">' + escapeHtml(formattedOld) + '</span>' : '') +
      (formattedOld && formattedNew ? '<svg class="ic text-slate-500 text-[10px]" aria-hidden="true"><use href="#i-arrow-right"></use></svg>' : '') +
      (formattedNew ? '<span class="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-semibold">' + escapeHtml(formattedNew) + '</span>' : '') +
      deltaBadge +
      '</div></div>';
  }

  return '<div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 space-y-1">' + rows + '</div>';
}

function renderMetadataPills(meta) {
  if (!meta || typeof meta !== 'object' || Object.keys(meta).length === 0) return '';
  let pills = '';
  if (meta.amount) {
    pills += '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">Amount: ₹' + Number(meta.amount).toLocaleString('en-IN') + '</span>';
  }
  if (meta.category) {
    pills += '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">Category: ' + escapeHtml(meta.category) + '</span>';
  }
  if (meta.paidBy) {
    pills += '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">Paid By: ' + escapeHtml(meta.paidBy) + '</span>';
  }
  if (meta.splitBetween) {
    pills += '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">Split: ' + escapeHtml(meta.splitBetween) + '</span>';
  }
  if (meta.date) {
    pills += '<span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-bold">Date: ' + escapeHtml(meta.date) + '</span>';
  }
  if (meta.modifiedSections && Array.isArray(meta.modifiedSections)) {
    pills += '<span class="px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800 text-[10px] font-bold">Modified: ' + escapeHtml(meta.modifiedSections.join(', ')) + '</span>';
  }
  return pills ? '<div class="flex flex-wrap items-center gap-1.5 pt-1">' + pills + '</div>' : '';
}

function formatTableChanges(item) {
  if (item.action === 'CREATE_EXPENSE') {
    const meta = item.metadata || {};
    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 font-semibold text-xs">' +
      '<svg class="ic text-emerald-400" aria-hidden="true"><use href="#i-circle-check"></use></svg> New Receipt Created (₹' + Number(meta.amount || 0).toLocaleString('en-IN') + ')</span>';
  }
  if (item.action === 'DELETE_EXPENSE') {
    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/70 text-rose-300 border border-rose-800/60 font-semibold text-xs">' +
      '<svg class="ic text-rose-400" aria-hidden="true"><use href="#i-trash-2"></use></svg> Transaction Removed from Ledger</span>';
  }
  if (item.action === 'UPDATE_CONFIG') {
    const meta = item.metadata || {};
    const sects = meta.modifiedSections && Array.isArray(meta.modifiedSections) ? meta.modifiedSections.join(', ') : 'Settings & Rules';
    return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-950/70 text-purple-300 border border-purple-800/60 font-semibold text-xs">' +
      '<svg class="ic text-purple-400" aria-hidden="true"><use href="#i-sliders-horizontal"></use></svg> Master Policy Updated (' + escapeHtml(sects) + ')</span>';
  }

  // Diff formatting
  if (!item.diff || typeof item.diff !== 'object' || Object.keys(item.diff).length === 0) {
    return '<span class="text-slate-500 italic text-xs">No explicit field diff</span>';
  }

  let pills = '';
  for (const [key, val] of Object.entries(item.diff)) {
    if (!val || typeof val !== 'object') continue;
    let oldVal = val.old !== undefined ? val.old : null;
    let newVal = val.new !== undefined ? val.new : (val.updated ? (val.summary || 'Updated') : null);

    let deltaBadge = '';
    if (key === 'amount' && oldVal !== null && newVal !== null && !isNaN(Number(oldVal)) && !isNaN(Number(newVal))) {
      const numOld = Number(oldVal);
      const numNew = Number(newVal);
      const diffAmount = numNew - numOld;
      const pct = numOld !== 0 ? Math.abs((diffAmount / numOld) * 100).toFixed(1) : 0;
      if (diffAmount > 0) {
        deltaBadge = '<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">+₹' + diffAmount.toLocaleString('en-IN') + ' (+' + pct + '%)</span>';
      } else if (diffAmount < 0) {
        deltaBadge = '<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-950/80 text-rose-300 border border-rose-700/60">-₹' + Math.abs(diffAmount).toLocaleString('en-IN') + ' (-' + pct + '%)</span>';
      }
    }

    if (key === 'amount') {
      if (oldVal !== null) oldVal = '₹' + Number(oldVal).toLocaleString('en-IN');
      if (newVal !== null) newVal = '₹' + Number(newVal).toLocaleString('en-IN');
    }

    const fieldLabel = escapeHtml(key.replace(/([A-Z])/g, ' $1'));
    pills += '<div class="inline-flex flex-wrap items-center gap-1.5 bg-slate-950/90 border border-slate-800/90 rounded-lg px-2.5 py-1 text-xs m-0.5">' +
      '<span class="font-bold text-slate-400 capitalize">' + fieldLabel + ':</span>' +
      (oldVal !== null ? '<span class="px-1.5 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-800/60 line-through font-mono text-[11px]">' + escapeHtml(oldVal) + '</span>' : '') +
      (oldVal !== null && newVal !== null ? '<svg class="ic text-slate-500 text-[10px]" aria-hidden="true"><use href="#i-arrow-right"></use></svg>' : '') +
      (newVal !== null ? '<span class="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-800/60 font-bold font-mono text-[11px]">' + escapeHtml(newVal) + '</span>' : '') +
      deltaBadge +
      '</div>';
  }
  return pills || '<span class="text-slate-500 italic text-xs">State modified</span>';
}

function renderAuditHtml(logs) {
  const updateCount = logs.filter(l => l.action === 'UPDATE_EXPENSE').length;
  const configCount = logs.filter(l => l.action === 'UPDATE_CONFIG').length;
  const mutateCount = logs.filter(l => l.action === 'CREATE_EXPENSE' || l.action === 'DELETE_EXPENSE').length;

  let tableRowsHtml = '';
  if (logs.length === 0) {
    tableRowsHtml = '<tr><td colspan="7" class="p-12 text-center text-slate-500 font-bold">No audit events recorded yet</td></tr>';
  } else {
    tableRowsHtml = logs.map((item, idx) => {
      const relTime = formatRelativeTime(item.timestamp);
      const fullTime = formatFullTime(item.timestamp);
      const actionBadge = getActionBadge(item.action);
      const changeSummary = formatTableChanges(item);
      const meta = item.metadata || {};
      const searchBlob = escapeHtml((item.recordId + ' ' + item.action + ' ' + JSON.stringify(meta) + ' ' + JSON.stringify(item.diff || {})).toLowerCase());

      const actorName = item.actor || item.user || meta.paidBy || 'System';
      let actorHtml = '<span class="inline-flex items-center gap-1 text-slate-300 font-bold"><svg class="ic text-amber-400 text-[10px]" aria-hidden="true"><use href="#i-zap"></use></svg> ' + escapeHtml(actorName) + '</span>';
      if (actorName.toLowerCase().includes('palash')) {
        actorHtml = '<span class="inline-flex items-center gap-1 text-indigo-300 font-bold"><svg class="ic text-[10px]" aria-hidden="true"><use href="#i-shield-user"></use></svg> Palash</span>';
      } else if (actorName.toLowerCase().includes('pallavi')) {
        actorHtml = '<span class="inline-flex items-center gap-1 text-pink-300 font-bold"><svg class="ic text-[10px]" aria-hidden="true"><use href="#i-user-check"></use></svg> Pallavi</span>';
      }

      let contextHtml = '<span class="text-slate-500 text-xs">—</span>';
      if (meta.amount || meta.category) {
        contextHtml = '<div class="font-extrabold text-white text-xs">' + (meta.amount ? '₹' + Number(meta.amount).toLocaleString('en-IN') : '') + ' <span class="text-slate-400 font-normal">(' + escapeHtml(meta.category || 'General') + ')</span></div>' +
          '<div class="text-[10px] text-slate-400">Paid: <strong class="text-slate-300">' + escapeHtml(meta.paidBy || '—') + '</strong>' + (meta.splitBetween ? ' • <span class="text-purple-300">' + escapeHtml(meta.splitBetween) + '</span>' : '') + '</div>';
      } else if (item.action === 'UPDATE_CONFIG') {
        contextHtml = '<div class="font-bold text-purple-300 text-xs">Master Settings</div><div class="text-[10px] text-slate-400">Policies & Rules</div>';
      }

      const jsonStr = escapeHtml(JSON.stringify(item, null, 2));

      return '<tr class="audit-row border-b border-slate-800/70 hover:bg-slate-800/40 transition" data-action="' + escapeHtml(item.action) + '" data-search="' + searchBlob + '">' +
        '<td class="py-3 px-4 whitespace-nowrap">' +
        '  <div class="font-extrabold text-white text-xs">' + fullTime + '</div>' +
        '  <div class="text-[10px] text-indigo-400 font-bold">' + relTime + '</div>' +
        '</td>' +
        '<td class="py-3 px-3 whitespace-nowrap">' + actionBadge + '</td>' +
        '<td class="py-3 px-3 whitespace-nowrap">' +
        '  <span class="px-2 py-0.5 rounded bg-slate-800 font-mono text-xs font-bold text-slate-300 border border-slate-700">' + escapeHtml(item.recordId || 'N/A') + '</span>' +
        '</td>' +
        '<td class="py-3 px-3 whitespace-nowrap">' + actorHtml + '</td>' +
        '<td class="py-3 px-3 min-w-[160px]">' + contextHtml + '</td>' +
        '<td class="py-3 px-4">' + changeSummary + '</td>' +
        '<td class="py-3 px-3 text-center whitespace-nowrap">' +
        '  <button onclick="toggleRowDetail(\'detail_' + idx + '\')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 border border-slate-700 transition" title="Inspect Raw Payload">' +
        '    <svg class="ic text-xs" aria-hidden="true"><use href="#i-code"></use></svg>' +
        '  </button>' +
        '</td>' +
        '</tr>' +
        '<tr id="detail_' + idx + '" class="hidden bg-slate-950/95 border-b border-slate-800">' +
        '<td colspan="7" class="p-4">' +
        '  <div class="font-mono text-[11px] text-slate-300 bg-slate-900/90 p-3 rounded-xl border border-slate-800 overflow-x-auto leading-relaxed">' +
        '    <pre><code>' + jsonStr + '</code></pre>' +
        '  </div>' +
        '</td>' +
        '</tr>';
    }).join('');
  }

  const rawJsonLogs = JSON.stringify(logs);

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>System Audit Ledger · HomeExpenses</title>' +
'  <link rel="icon" type="image/svg+xml" href="/icon.svg">' +
'  <script src="https://cdn.tailwindcss.com"></script>' +
'  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">' +
'  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
'  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>' +
'  <style>body { font-family: "Plus Jakarta Sans", sans-serif; }</style>' +
'</head>' +
'<body class="bg-slate-950 text-slate-100 min-h-screen selection:bg-indigo-500 selection:text-white">' +
'  <header class="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-30 backdrop-blur-md">' +
'    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">' +
'      <div class="flex items-center space-x-3">' +
'        <a href="/" class="flex items-center space-x-2.5 group">' +
'          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition">' +
'            <span class="text-white font-extrabold text-base">₹</span>' +
'          </div>' +
'          <div>' +
'            <div class="text-sm font-black text-white tracking-tight flex items-center space-x-1.5">' +
'              <span>HomeExpenses</span>' +
'              <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">AUDIT LEDGER</span>' +
'            </div>' +
'            <div class="text-[10px] text-slate-400 font-medium">Real-Time Ledger Change & Action Trail</div>' +
'          </div>' +
'        </a>' +
'      </div>' +
'      <div class="flex items-center space-x-3">' +
'        <span class="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">' +
'          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2"></span> Live Cloud Sync' +
'        </span>' +
'        <button onclick="exportExcel()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 transition flex items-center space-x-1.5">' +
'          <svg class="ic" aria-hidden="true"><use href="#i-file-spreadsheet"></use></svg>' +
'          <span>Export Excel</span>' +
'        </button>' +
'        <button onclick="window.location.reload()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5">' +
'          <svg class="ic text-indigo-400" aria-hidden="true"><use href="#i-refresh-cw"></use></svg>' +
'          <span>Refresh</span>' +
'        </button>' +
'        <a href="/" class="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition flex items-center space-x-1.5">' +
'          <svg class="ic" aria-hidden="true"><use href="#i-arrow-left"></use></svg>' +
'          <span>Back to App</span>' +
'        </a>' +
'      </div>' +
'    </div>' +
'  </header>' +
'  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">' +
'    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">' +
'      <div>' +
'        <h1 class="text-2xl font-black text-white flex items-center gap-2.5">' +
'          <svg class="ic text-indigo-400" aria-hidden="true"><use href="#i-table"></use></svg>' +
'          <span>System Audit & Change Ledger</span>' +
'        </h1>' +
'        <p class="text-xs text-slate-400 mt-1">' +
'          Complete chronological tabular record of all transactions, member split re-allocations, staff payroll entries, and master configurations.' +
'        </p>' +
'      </div>' +
'      <div class="flex items-center gap-2">' +
'        <a href="/api/audit?format=json" target="_blank" class="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition flex items-center gap-1.5">' +
'          <svg class="ic text-emerald-400" aria-hidden="true"><use href="#i-code"></use></svg>' +
'          <span>Raw JSON Feed</span>' +
'        </a>' +
'      </div>' +
'    </div>' +
'    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">' +
'      <div class="bg-slate-900/70 border border-slate-800 p-4 rounded-xl">' +
'        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Recorded Events</div>' +
'        <div class="text-2xl font-black text-white mt-1">' + logs.length + '</div>' +
'        <div class="text-[10px] text-emerald-400 mt-0.5">● 100% cloud persisted</div>' +
'      </div>' +
'      <div class="bg-slate-900/70 border border-slate-800 p-4 rounded-xl">' +
'        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Expense Updates</div>' +
'        <div class="text-2xl font-black text-indigo-400 mt-1">' + updateCount + '</div>' +
'        <div class="text-[10px] text-slate-400 mt-0.5">Amounts, splits, notes</div>' +
'      </div>' +
'      <div class="bg-slate-900/70 border border-slate-800 p-4 rounded-xl">' +
'        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Admin Configurations</div>' +
'        <div class="text-2xl font-black text-purple-400 mt-1">' + configCount + '</div>' +
'        <div class="text-[10px] text-slate-400 mt-0.5">Staff, categories, bills</div>' +
'      </div>' +
'      <div class="bg-slate-900/70 border border-slate-800 p-4 rounded-xl">' +
'        <div class="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Inserts & Deletes</div>' +
'        <div class="text-2xl font-black text-emerald-400 mt-1">' + mutateCount + '</div>' +
'        <div class="text-[10px] text-slate-400 mt-0.5">Ledger mutations</div>' +
'      </div>' +
'    </div>' +
'    <div class="bg-slate-900/90 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-md">' +
'      <div class="flex items-center space-x-2 flex-1">' +
'        <div class="relative w-full max-w-md">' +
'          <svg class="ic absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" aria-hidden="true"><use href="#i-search"></use></svg>' +
'          <input type="text" id="searchInput" placeholder="Search by Record ID (e.g. exp-001), category, person..." oninput="filterCards()" class="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-medium text-white focus:outline-none focus:border-indigo-500">' +
'        </div>' +
'      </div>' +
'      <div class="flex flex-wrap items-center gap-1.5 text-xs font-bold">' +
'        <span class="text-[11px] text-slate-400 uppercase mr-1">Filter:</span>' +
'        <button onclick="setFilterAction(\'ALL\')" id="btn-ALL" class="filter-btn active px-3 py-1.5 rounded-lg bg-indigo-600 text-white transition">All (' + logs.length + ')</button>' +
'        <button onclick="setFilterAction(\'UPDATE_EXPENSE\')" id="btn-UPDATE_EXPENSE" class="filter-btn px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Edits</button>' +
'        <button onclick="setFilterAction(\'UPDATE_CONFIG\')" id="btn-UPDATE_CONFIG" class="filter-btn px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Admin Config</button>' +
'        <button onclick="setFilterAction(\'CREATE_EXPENSE\')" id="btn-CREATE_EXPENSE" class="filter-btn px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition">New</button>' +
'        <button onclick="setFilterAction(\'DELETE_EXPENSE\')" id="btn-DELETE_EXPENSE" class="filter-btn px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition">Deletes</button>' +
'      </div>' +
'    </div>' +
'    <div class="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/90 shadow-2xl">' +
'      <div class="overflow-x-auto">' +
'        <table class="w-full text-left border-collapse text-xs">' +
'          <thead>' +
'            <tr class="bg-slate-950 text-slate-400 font-black uppercase tracking-wider text-[11px] border-b border-slate-800">' +
'              <th class="py-3.5 px-4 w-44">Date & Time</th>' +
'              <th class="py-3.5 px-3 w-36">Event</th>' +
'              <th class="py-3.5 px-3 w-28">Record ID</th>' +
'              <th class="py-3.5 px-3 w-32">Actor</th>' +
'              <th class="py-3.5 px-3 w-48">Item Context</th>' +
'              <th class="py-3.5 px-4 min-w-[280px]">Changes Made (Before ➔ After)</th>' +
'              <th class="py-3.5 px-3 w-20 text-center">Inspect</th>' +
'            </tr>' +
'          </thead>' +
'          <tbody id="auditTableBody" class="divide-y divide-slate-800/80 text-slate-200 font-medium">' +
'            ' + tableRowsHtml +
'          </tbody>' +
'        </table>' +
'      </div>' +
'    </div>' +
'  </main>' +
'  <script>' +
'    var currentFilter = "ALL";' +
'    var auditData = ' + rawJsonLogs + ';' +
'    function setFilterAction(action) {' +
'      currentFilter = action;' +
'      document.querySelectorAll(".filter-btn").forEach(function(b) {' +
'        b.classList.remove("bg-indigo-600", "text-white");' +
'        b.classList.add("bg-slate-800", "text-slate-300");' +
'      });' +
'      var activeBtn = document.getElementById("btn-" + action);' +
'      if (activeBtn) {' +
'        activeBtn.classList.remove("bg-slate-800", "text-slate-300");' +
'        activeBtn.classList.add("bg-indigo-600", "text-white");' +
'      }' +
'      filterCards();' +
'    }' +
'    function filterCards() {' +
'      var q = (document.getElementById("searchInput").value || "").toLowerCase().trim();' +
'      document.querySelectorAll(".audit-row").forEach(function(row) {' +
'        var action = row.getAttribute("data-action");' +
'        var search = row.getAttribute("data-search") || "";' +
'        var matchesFilter = (currentFilter === "ALL" || action === currentFilter);' +
'        var matchesQuery = (!q || search.indexOf(q) !== -1);' +
'        row.style.display = (matchesFilter && matchesQuery) ? "" : "none";' +
'      });' +
'    }' +
'    function toggleRowDetail(id) {' +
'      var el = document.getElementById(id);' +
'      if (el) el.classList.toggle("hidden");' +
'    }' +
'    function exportExcel() {' +
'      if (!auditData || auditData.length === 0) { alert("No logs to export"); return; }' +
'      var rows = auditData.map(function(item) {' +
'        var meta = item.metadata || {};' +
'        return {' +
'          Timestamp: item.timestamp,' +
'          Action: item.action,' +
'          RecordId: item.recordId,' +
'          Actor: item.actor || item.user || meta.paidBy || "System",' +
'          Amount: meta.amount || "",' +
'          Category: meta.category || "",' +
'          PaidBy: meta.paidBy || "",' +
'          SplitBetween: meta.splitBetween || ""' +
'        };' +
'      });' +
'      var ws = XLSX.utils.json_to_sheet(rows);' +
'      var wb = XLSX.utils.book_new();' +
'      XLSX.utils.book_append_sheet(wb, ws, "Audit Ledger");' +
'      XLSX.writeFile(wb, "HomeExpenses_Audit_Log.xlsx");' +
'    }' +
'  </script>' +
'</body>' +
'</html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const session = authenticateRequest(req);
  if (!session || !session.householdId) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(401).json({ success: false, error: 'Unauthorized: Please sign in to view audit records.' });
  }

  // The audit trail records who changed what, including configuration and
  // deletions. It is an administrative record, not general household reading,
  // and until now any signed-in MEMBER or VIEWER could read all of it.
  if (!sessionCan(session, P.AUDIT_VIEW)) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(403).json({
      success: false,
      error: 'Forbidden: viewing the audit trail requires an owner or administrator.'
    });
  }

  const householdId = session.householdId;

  try {
    if (req.method === 'GET') {
      const limit = req.query && req.query.limit ? parseInt(req.query.limit, 10) : 200;
      const logs = await storage.getHouseholdAuditLogs(householdId, isNaN(limit) ? 200 : limit, true);

      const acceptsHtml = req.headers && req.headers.accept && req.headers.accept.includes('text/html');
      const wantsJson = req.query && req.query.format === 'json';

      if (acceptsHtml && !wantsJson) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const html = renderAuditHtml(logs);
        if (typeof res.status === 'function') {
          res.status(200);
          if (typeof res.send === 'function') return res.send(html);
        }
        if (typeof res.writeHead === 'function') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        }
        return res.end(html);
      }

      // Default: Return JSON API response
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        success: true,
        householdId: householdId,
        count: logs.length,
        data: logs
      });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('Audit API error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
};
