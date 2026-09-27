// Audit Trail API & Interactive UI Route (/api/audit)
// Provides queryable history and a rich, luxury dashboard for all system edits
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
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"><i class="fa-solid fa-pen-to-square mr-1"></i> UPDATE EXPENSE</span>';
    case 'CREATE_EXPENSE':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"><i class="fa-solid fa-plus mr-1"></i> NEW EXPENSE</span>';
    case 'DELETE_EXPENSE':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-rose-500/20 text-rose-300 border border-rose-500/30"><i class="fa-solid fa-trash mr-1"></i> DELETE EXPENSE</span>';
    case 'UPDATE_CONFIG':
      return '<span class="px-2.5 py-1 rounded-md text-[11px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/30"><i class="fa-solid fa-sliders mr-1"></i> MASTER CONFIG</span>';
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

    if (key === 'amount') {
      if (oldVal !== null) formattedOld = '₹' + Number(oldVal).toLocaleString('en-IN');
      if (newVal !== null) formattedNew = '₹' + Number(newVal).toLocaleString('en-IN');
    }

    const fieldLabel = escapeHtml(key.replace(/([A-Z])/g, ' $1'));
    rows += '<div class="flex flex-col sm:flex-row sm:items-center justify-between py-2 border-b border-slate-800/60 last:border-0 text-xs gap-1.5">' +
      '<span class="font-bold text-slate-400 capitalize w-36 shrink-0">' + fieldLabel + ':</span>' +
      '<div class="flex items-center gap-2 flex-1 font-mono text-[11px] overflow-x-auto">' +
      (formattedOld ? '<span class="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60 line-through">' + escapeHtml(formattedOld) + '</span>' : '') +
      (formattedOld && formattedNew ? '<i class="fa-solid fa-arrow-right text-slate-500 text-[10px]"></i>' : '') +
      (formattedNew ? '<span class="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-semibold">' + escapeHtml(formattedNew) + '</span>' : '') +
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

function renderAuditHtml(logs) {
  const updateCount = logs.filter(l => l.action === 'UPDATE_EXPENSE').length;
  const configCount = logs.filter(l => l.action === 'UPDATE_CONFIG').length;
  const mutateCount = logs.filter(l => l.action === 'CREATE_EXPENSE' || l.action === 'DELETE_EXPENSE').length;

  let cardsHtml = '';
  if (logs.length === 0) {
    cardsHtml = '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">' +
      '<i class="fa-solid fa-clock-rotate-left text-3xl mb-3 text-slate-600"></i>' +
      '<div class="text-sm font-bold text-slate-400">No audit events recorded yet</div>' +
      '</div>';
  } else {
    cardsHtml = logs.map(item => {
      const relTime = formatRelativeTime(item.timestamp);
      const fullTime = formatFullTime(item.timestamp);
      const actionBadge = getActionBadge(item.action);
      const diffBox = renderDiffBox(item.diff);
      const metaPills = renderMetadataPills(item.metadata);
      const searchBlob = escapeHtml((item.recordId + ' ' + item.action + ' ' + JSON.stringify(item.metadata || {}) + ' ' + JSON.stringify(item.diff || {})).toLowerCase());

      return '<div class="audit-card bg-slate-900/80 border border-slate-800 hover:border-slate-700 rounded-xl p-4.5 space-y-3 transition shadow-lg" data-action="' + escapeHtml(item.action) + '" data-search="' + searchBlob + '">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">' +
        '<div class="flex items-center space-x-2.5">' +
        actionBadge +
        '<span class="px-2 py-0.5 rounded bg-slate-800 font-mono text-[11px] font-bold text-slate-300 border border-slate-700">' + escapeHtml(item.recordId) + '</span>' +
        '</div>' +
        '<div class="text-right text-xs text-slate-400">' +
        '<span class="font-extrabold text-slate-200">' + relTime + '</span>' +
        '<span class="text-slate-500 ml-1.5 font-medium">(' + fullTime + ')</span>' +
        '</div></div>' +
        '<div>' +
        '<div class="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">' +
        '<i class="fa-solid fa-code-compare text-indigo-400"></i>' +
        '<span>Field-Level Differences</span>' +
        '</div>' +
        diffBox +
        '</div>' +
        metaPills +
        '</div>';
    }).join('');
  }

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>System Audit & Change History · HomeExpenses</title>' +
'  <link rel="icon" type="image/svg+xml" href="/icon.svg">' +
'  <script src="https://cdn.tailwindcss.com"></script>' +
'  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">' +
'  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">' +
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
'              <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">AUDIT</span>' +
'            </div>' +
'            <div class="text-[10px] text-slate-400 font-medium">Real-Time System Change & Action Trail</div>' +
'          </div>' +
'        </a>' +
'      </div>' +
'      <div class="flex items-center space-x-3">' +
'        <span class="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">' +
'          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-2"></span> Live Cloud Sync Active' +
'        </span>' +
'        <button onclick="window.location.reload()" class="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition flex items-center space-x-1.5">' +
'          <i class="fa-solid fa-arrows-rotate text-indigo-400"></i>' +
'          <span>Refresh</span>' +
'        </button>' +
'        <a href="/" class="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition flex items-center space-x-1.5">' +
'          <i class="fa-solid fa-arrow-left"></i>' +
'          <span>Back to App</span>' +
'        </a>' +
'      </div>' +
'    </div>' +
'  </header>' +
'  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">' +
'    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">' +
'      <div>' +
'        <h1 class="text-2xl font-black text-white flex items-center gap-2.5">' +
'          <i class="fa-solid fa-clock-rotate-left text-indigo-400"></i>' +
'          <span>Audit & Change Tracking Engine</span>' +
'        </h1>' +
'        <p class="text-xs text-slate-400 mt-1">' +
'          Every amount edit, split allocation, domestic payroll update, and admin setting change is captured with before-and-after state diffs.' +
'        </p>' +
'      </div>' +
'      <div class="flex items-center gap-2">' +
'        <a href="/api/audit?format=json" target="_blank" class="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-lg border border-slate-700 transition flex items-center gap-1.5">' +
'          <i class="fa-solid fa-code text-emerald-400"></i>' +
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
'          <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>' +
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
'    <div id="cardsList" class="space-y-3.5">' + cardsHtml + '</div>' +
'  </main>' +
'  <script>' +
'    var currentFilter = "ALL";' +
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
'      document.querySelectorAll(".audit-card").forEach(function(card) {' +
'        var action = card.getAttribute("data-action");' +
'        var search = card.getAttribute("data-search") || "";' +
'        var matchesFilter = (currentFilter === "ALL" || action === currentFilter);' +
'        var matchesQuery = (!q || search.indexOf(q) !== -1);' +
'        card.style.display = (matchesFilter && matchesQuery) ? "block" : "none";' +
'      });' +
'    }' +
'  </script>' +
'</body>' +
'</html>';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    if (req.method === 'GET') {
      const limit = req.query && req.query.limit ? parseInt(req.query.limit, 10) : 200;
      const logs = await getAuditLogs(isNaN(limit) ? 200 : limit);

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
