/**
 * HOMEEXPENSES - Advanced Modules Suite
 * 
 * 1. Household Reimbursement & Splitwise Matrix (Palash returns 100% to Pallavi as income flow)
 * 2. 1-Click Settle Up / Reimburse Action with Instant Reconciliation
 * 3. Mobile PWA Install Prompt & Guided Instructions (iOS Safari / Android / Desktop)
 * 4. Smart Anomaly & 24h Duplicate Radar
 * 5. Domestic Staff Attendance Calendar & Payroll Suite (Nilima Nikose & Madhuri)
 * 6. Upcoming Bills Due Date Radar & 15-Day Cash Flow Runway
 * 7. Luxury Executive PDF Monthly Report Generator
 */

(function () {
  // Every user-supplied string rendered into innerHTML goes through this.
  // Defined first so it is available to every renderer in this module.
  const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));

  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  // In-memory state
  let staffAttendanceState = {
    'Maid - Madhuri': { baseSalary: 800, billingCycleDay: 21, months: {} },
    'Chef - Nilima Nikose': { baseSalary: 4500, billingCycleDay: 30, months: {} }
  };

  let deferredPrompt = null;
  let currentNetSettleAmount = 0;
  let currentSettlePayer = 'Palash';
  let currentSettleReceiver = 'Pallavi';

  // ========================================================
  // PWA REGISTRATION & MOBILE / DESKTOP INSTALL CONTROLLER
  // ========================================================

  function initPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('[PWA] Service Worker registered:', reg.scope);
          if ('Notification' in window && Notification.permission === 'granted') {
            setTimeout(() => {
              window.syncPushSubscriptionSilently && window.syncPushSubscriptionSilently();
            }, 1000);
          }
        })
        .catch(err => console.warn('[PWA] SW register warning:', err));
    }

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const banner = document.getElementById('mobilePwaBanner');
    const installBtn = document.getElementById('btnInstallPwa');

    if (isStandalone) {
      if (banner) banner.classList.add('hidden');
      if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.style.display = 'none';
      }
      return;
    }

    if (localStorage.getItem('hideMobilePwaBanner') === 'true' && banner) {
      banner.classList.add('hidden');
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.style.display = 'inline-flex';
      }
      if (banner && localStorage.getItem('hideMobilePwaBanner') !== 'true') {
        banner.classList.remove('hidden');
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] Installed successfully');
      deferredPrompt = null;
      if (installBtn) {
        installBtn.classList.add('hidden');
        installBtn.style.display = 'none';
      }
      if (banner) banner.classList.add('hidden');
    });
  }

  window.dismissMobilePwaBanner = function () {
    const banner = document.getElementById('mobilePwaBanner');
    if (banner) banner.classList.add('hidden');
    localStorage.setItem('hideMobilePwaBanner', 'true');
  };

  window.closePwaGuideModal = function () {
    const modal = document.getElementById('pwaInstallGuideModal');
    if (modal) modal.classList.add('hidden');
  };

  window.installPwaApp = function () {
    // 1. If native beforeinstallprompt is active (Android Chrome, Edge, Desktop Chrome)
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(({ outcome }) => {
        if (outcome === 'accepted') {
          const btn = document.getElementById('btnInstallPwa');
          const banner = document.getElementById('mobilePwaBanner');
          if (btn) btn.classList.add('hidden');
          if (banner) banner.classList.add('hidden');
        }
        deferredPrompt = null;
      });
      return;
    }

    // 2. Check if already in standalone app mode
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      if (window.showToast) {
        window.showToast('success', 'Already Installed!', 'HOMEEXPENSES is running as an installed native app.');
      } else {
        alert('HOMEEXPENSES is already installed and running as a native app!');
      }
      return;
    }

    // 3. Fallback: Show step-by-step install instructions tailored for the current device (iOS Safari vs Android vs Desktop)
    const modal = document.getElementById('pwaInstallGuideModal');
    const title = document.getElementById('pwaGuideTitle');
    const body = document.getElementById('pwaGuideBody');

    if (!modal || !body) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /android/i.test(navigator.userAgent);

    if (isIOS) {
      if (title) title.innerHTML = `<i class="fa-brands fa-apple mr-2"></i> Install on iPhone / iPad (Safari)`;
      body.innerHTML = `
        <div class="space-y-4 text-xs font-medium text-slate-700">
          <p class="text-slate-600">Install HOMEEXPENSES to your iPhone/iPad Home Screen for full-screen view and instant offline access:</p>
          <div class="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0">1</span>
              <div>
                <span class="font-bold text-slate-900">Tap the Share Icon:</span>
                <p class="text-slate-500 mt-0.5">In Safari bottom toolbar, tap the <strong>Share</strong> button <i class="fa-solid fa-arrow-up-from-bracket text-blue-600 text-sm"></i>.</p>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0">2</span>
              <div>
                <span class="font-bold text-slate-900">Add to Home Screen:</span>
                <p class="text-slate-500 mt-0.5">Scroll down in the share sheet and tap <i class="fa-regular fa-square-plus text-slate-800"></i> <strong>"Add to Home Screen"</strong>.</p>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0">3</span>
              <div>
                <span class="font-bold text-slate-900">Confirm &amp; Launch:</span>
                <p class="text-slate-500 mt-0.5">Tap <strong>"Add"</strong> in the top-right corner. The app icon will appear on your Home Screen!</p>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (isAndroid) {
      if (title) title.innerHTML = `<i class="fa-brands fa-android text-emerald-400 mr-2"></i> Install on Android`;
      body.innerHTML = `
        <div class="space-y-4 text-xs font-medium text-slate-700">
          <p class="text-slate-600">Install HOMEEXPENSES directly from your mobile browser:</p>
          <div class="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shrink-0">1</span>
              <div>
                <span class="font-bold text-slate-900">Tap Browser Menu:</span>
                <p class="text-slate-500 mt-0.5">Tap the <strong>three dots (⋮)</strong> in the top-right corner of Chrome / Edge.</p>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shrink-0">2</span>
              <div>
                <span class="font-bold text-slate-900">Select Install:</span>
                <p class="text-slate-500 mt-0.5">Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</p>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-black shrink-0">3</span>
              <div>
                <span class="font-bold text-slate-900">Enjoy Native App:</span>
                <p class="text-slate-500 mt-0.5">Tap <strong>Install</strong> to get fast, offline-ready access from your phone app drawer!</p>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      if (title) title.innerHTML = `<i class="fa-solid fa-desktop mr-2"></i> Install on Desktop / Browser`;
      body.innerHTML = `
        <div class="space-y-4 text-xs font-medium text-slate-700">
          <p class="text-slate-600">Run HOMEEXPENSES in its own standalone desktop window:</p>
          <div class="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0">1</span>
              <div>
                <span class="font-bold text-slate-900">Look for the Install Icon:</span>
                <p class="text-slate-500 mt-0.5">In Chrome/Edge address bar, click the <i class="fa-solid fa-circle-down text-indigo-600"></i> <strong>Install</strong> icon on the right side.</p>
              </div>
            </div>
            <div class="flex items-start space-x-3">
              <span class="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black shrink-0">2</span>
              <div>
                <span class="font-bold text-slate-900">Click Install:</span>
                <p class="text-slate-500 mt-0.5">Click <strong>"Install"</strong> to launch HOMEEXPENSES in its own sleek app window.</p>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    modal.classList.remove('hidden');
  };

  // ========================================================
  // 1. SMART ANOMALY & DUPLICATE DETECTION
  // ========================================================

  window.dismissAnomalyBanner = function () {
    const banner = document.getElementById('dashboardAnomalyBanner');
    if (banner) banner.classList.add('hidden');
  };

  window.clearAnomalyWarning = function () {
    const box = document.getElementById('anomalyWarningBox');
    if (box) {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  };

  function checkRealtimeModalAnomaly() {
    const amtInput = document.getElementById('inputAmount');
    const toInput = document.getElementById('inputPaidTo');
    const catInput = document.getElementById('inputCategory');
    const dateInput = document.getElementById('inputDate');
    const editIdInput = document.getElementById('expenseId');
    const warningBox = document.getElementById('anomalyWarningBox');

    if (!warningBox || !amtInput || !toInput) return;

    const amount = parseFloat(amtInput.value);
    const paidTo = (toInput.value || '').trim().toLowerCase();
    const category = (catInput ? catInput.value : '').toLowerCase();
    const date = dateInput ? dateInput.value : '';
    const editId = editIdInput ? editIdInput.value : '';

    if (!amount || isNaN(amount) || amount <= 0 || !paidTo) {
      warningBox.classList.add('hidden');
      warningBox.innerHTML = '';
      return;
    }

    const allExpenses = window.expensesData || [];
    const targetTime = date ? new Date(date).getTime() : Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // A. 24h Duplicate Check
    const dup = allExpenses.find(e => {
      if (editId && String(e.id) === String(editId)) return false;
      const eAmt = parseFloat(e.amount || 0);
      const eTo = (e.paidTo || e.vendor || '').trim().toLowerCase();
      if (Math.abs(eAmt - amount) < 0.01 && eTo === paidTo) {
        const eTime = new Date(e.date).getTime();
        return Math.abs(eTime - targetTime) <= TWENTY_FOUR_HOURS;
      }
      return false;
    });

    if (dup) {
      warningBox.classList.remove('hidden');
      warningBox.innerHTML = `
        <div class="flex items-center gap-1.5 text-amber-800">
          <i class="fa-solid fa-triangle-exclamation text-amber-600"></i>
          <span><strong>Potential Duplicate Detected:</strong> A payment of <strong>₹${amount.toLocaleString('en-IN')}</strong> to <em>"${esc(dup.paidTo)}"</em> was already recorded on <strong>${esc(dup.date)}</strong> (within 24 hrs). Check to prevent duplicate entry.</span>
        </div>
      `;
      return;
    }

    // B. Bill Spike Check (>30% higher than historical average for utilities)
    const utilityKeywords = ['electricity', 'mseb', 'power', 'wifi', 'broadband', 'internet', 'airtel', 'tata play', 'dish', 'maintenance', 'society', 'gas'];
    const isUtility = utilityKeywords.some(kw => category.includes(kw) || paidTo.includes(kw));

    if (isUtility) {
      const pastBills = allExpenses.filter(e => {
        if (editId && String(e.id) === String(editId)) return false;
        const c = (e.category || '').toLowerCase();
        const p = (e.paidTo || e.vendor || '').toLowerCase();
        return c.includes(category) || (paidTo && p.includes(paidTo));
      });

      if (pastBills.length >= 2) {
        const avg = pastBills.reduce((s, e) => s + parseFloat(e.amount || 0), 0) / pastBills.length;
        if (amount > avg * 1.3) {
          const pct = Math.round(((amount - avg) / avg) * 100);
          warningBox.classList.remove('hidden');
          warningBox.innerHTML = `
            <div class="flex items-center gap-1.5 text-amber-800">
              <i class="fa-solid fa-chart-line text-amber-600"></i>
              <span><strong>Bill Spike Alert:</strong> This amount (<strong>₹${amount.toLocaleString('en-IN')}</strong>) is <strong>${pct}% higher</strong> than your average bill of <strong>₹${Math.round(avg).toLocaleString('en-IN')}</strong> for this utility.</span>
            </div>
          `;
          return;
        }
      }
    }

    warningBox.classList.add('hidden');
    warningBox.innerHTML = '';
  }

  function renderDashboardAnomalyBanner(filtered) {
    const banner = document.getElementById('dashboardAnomalyBanner');
    const badge = document.getElementById('anomalyCountBadge');
    const listContent = document.getElementById('anomalyListContent');

    if (!banner || !badge || !listContent) return;

    const duplicates = [];
    const seen = new Map();

    filtered.forEach(e => {
      const vendor = (e.paidTo || e.vendor || '').trim().toLowerCase();
      const amt = parseFloat(e.amount || 0).toFixed(2);
      if (!vendor || parseFloat(amt) <= 0) return;

      const key = `${vendor}_${amt}`;
      const time = new Date(e.date).getTime();

      if (seen.has(key)) {
        const prev = seen.get(key);
        if (Math.abs(time - prev.time) <= 24 * 60 * 60 * 1000) {
          duplicates.push({ exp1: prev.exp, exp2: e });
        }
      } else {
        seen.set(key, { exp: e, time: time });
      }
    });

    if (duplicates.length > 0) {
      banner.classList.remove('hidden');
      badge.textContent = `${duplicates.length} Alert${duplicates.length > 1 ? 's' : ''}`;
      listContent.innerHTML = duplicates.map(d => `
        <div class="flex items-center gap-2">
          <span>• Potential duplicate entry: <strong>₹${Number(d.exp2.amount).toLocaleString('en-IN')}</strong> to <em>${esc(d.exp2.paidTo)}</em> on ${d.exp2.date}.</span>
        </div>
      `).join('');
    } else {
      banner.classList.add('hidden');
    }
  }

  // ========================================================
  // 2. HOUSEHOLD REIMBURSEMENT & SPLITWISE SETTLEMENT MATRIX
  // Dynamically adapts to household members (single-payer or multi-payer)
  // ========================================================

  function getActiveFamilyMembers() {
    let members = (window.masterConfig && window.masterConfig.familyMembers && Array.isArray(window.masterConfig.familyMembers)) 
      ? [...window.masterConfig.familyMembers] 
      : [];
    if (window.currentSessionUser && window.currentSessionUser.name && !members.includes(window.currentSessionUser.name)) {
      members.unshift(window.currentSessionUser.name);
    }
    if (!members.length) {
      members = (window.FAMILY_MEMBERS && window.FAMILY_MEMBERS.length) ? [...window.FAMILY_MEMBERS] : ['Household Member'];
    }
    return members;
  }
  window.getActiveFamilyMembers = getActiveFamilyMembers;

  function renderSplitwiseMatrix(filtered) {
    const grid = document.getElementById('splitwiseCardsGrid');
    const settleContainer = document.getElementById('settleUpActionContainer');
    const subtitleEl = document.getElementById('splitwiseSubtitle') || document.querySelector('#splitwiseCardsGrid')?.parentElement?.querySelector('p');
    if (!grid) return;

    const members = getActiveFamilyMembers();

    // SINGLE-MEMBER HOUSEHOLD HANDLING (e.g. Sanjay in H002 or individual homes)
    if (members.length < 2) {
      const singleMember = members[0] || 'Household Owner';
      if (subtitleEl) {
        subtitleEl.textContent = `Individual household expense ledger managed directly by ${singleMember}.`;
      }

      let directHouseholdSpend = 0;
      let personalSpend = 0;

      filtered.forEach(exp => {
        const amt = parseFloat(exp.amount || 0);
        if (isNaN(amt) || amt <= 0) return;
        if (exp.category === 'Accepted Payments (Income)') return;
        if (isPersonalExpense(exp)) {
          personalSpend += amt;
        } else {
          directHouseholdSpend += amt;
        }
      });

      currentNetSettleAmount = 0;
      currentSettlePayer = singleMember;
      currentSettleReceiver = singleMember;

      grid.innerHTML = `
        <!-- Card 1: Direct Household Outflows -->
        <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Shared Household Outflow</span>
              <span class="text-xs font-black text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">${singleMember} Funded</span>
            </div>
            <div class="mt-2 space-y-1">
              <div class="flex justify-between text-xs">
                <span class="text-slate-600 font-semibold">Verified Household Spend:</span>
                <span class="font-black text-slate-900">₹${Math.round(directHouseholdSpend).toLocaleString('en-IN')}</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-1">
                Bills, domestic staff, rent &amp; household upkeep.
              </p>
            </div>
          </div>
          <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
            <span class="font-bold text-slate-500">Directly Absorbed:</span>
            <span class="font-black text-indigo-700">₹${Math.round(directHouseholdSpend).toLocaleString('en-IN')}</span>
          </div>
        </div>

        <!-- Card 2: Personal Expenses -->
        <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Personal Purchases</span>
              <span class="text-xs font-black text-purple-700 bg-purple-100 px-2 py-0.5 rounded">Discretionary</span>
            </div>
            <div class="mt-2 space-y-1">
              <div class="flex justify-between text-xs">
                <span class="text-slate-600 font-semibold">Personal Discretionary Spend:</span>
                <span class="font-black text-slate-900">₹${Math.round(personalSpend).toLocaleString('en-IN')}</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-1">
                Independent purchases logged outside shared household budget.
              </p>
            </div>
          </div>
          <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
            <span class="font-bold text-slate-500">Self-Funded:</span>
            <span class="font-black text-purple-700">100%</span>
          </div>
        </div>

        <!-- Card 3: Single Payer Reconciliation Status -->
        <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Reconciliation Status</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">Self-Funded</span>
            </div>
            <h4 class="text-xl font-black text-emerald-950 mt-2">✨ Direct Household</h4>
            <div class="text-2xl font-black text-emerald-600 mt-0.5">₹0 Shared Due</div>
            <p class="text-xs text-emerald-700 font-medium mt-1">All expenses directly funded by ${singleMember}. No splitwise reimbursement needed.</p>
          </div>
          <div class="mt-3 pt-2 border-t border-emerald-200 text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <i class="fa-solid fa-check-circle"></i>
            <span>No pending balance to reimburse.</span>
          </div>
        </div>
      `;

      if (settleContainer) {
        settleContainer.innerHTML = `
          <button disabled class="px-4 py-2 bg-slate-100 text-slate-400 font-extrabold text-xs rounded-xl cursor-not-allowed flex items-center space-x-1.5 shadow-none">
            <i class="fa-solid fa-circle-check text-emerald-500"></i>
            <span>Self-Funded (${singleMember})</span>
          </button>
        `;
      }
      return;
    }

    // MULTI-MEMBER / 2-MEMBER HOUSEHOLD RECONCILIATION
    const payer1 = members[0];
    const payer2 = members[1];
    const p1Low = payer1.toLowerCase();
    const p2Low = payer2.toLowerCase();

    if (subtitleEl) {
      subtitleEl.textContent = `Automatic balance reconciliation between ${payer1} & ${payer2} for shared household expenses.`;
    }

    let p2Paid = 0;
    let p1DirectPaid = 0;
    let reimbursedByP1 = 0;

    filtered.forEach(exp => {
      const amt = parseFloat(exp.amount || 0);
      if (isNaN(amt) || amt <= 0) return;
      if (exp.category === 'Accepted Payments (Income)') return;

      const paidBy = (exp.paidBy || '').trim().toLowerCase();
      const paidTo = (exp.paidTo || exp.vendor || '').trim().toLowerCase();
      const cat = (exp.category || '').toLowerCase();
      const notes = (exp.notes || exp.description || '').toLowerCase();

      // Check if this is a settlement/reimbursement transfer from payer1 to payer2
      const isSettlement = cat.includes('settlement') || cat.includes('reimbursement') ||
        (paidBy.includes(p1Low) && (paidTo.includes(p2Low) || notes.includes('reimburse') || notes.includes('settle')));

      if (isSettlement) {
        if (paidBy.includes(p1Low)) {
          reimbursedByP1 += amt;
        }
      } else if (!isPersonalExpense(exp)) {
        if (paidBy.includes(p2Low)) {
          p2Paid += amt;
        } else if (paidBy.includes(p1Low)) {
          p1DirectPaid += amt;
        }
      }
    });

    const netDueToP2 = Math.max(0, Math.round(p2Paid - reimbursedByP1));
    currentNetSettleAmount = netDueToP2;
    currentSettlePayer = payer1;
    currentSettleReceiver = payer2;

    let verdictCard = '';
    if (netDueToP2 <= 0) {
      verdictCard = `
        <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Monthly Reimbursement Status</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">Fully Settled</span>
            </div>
            <h4 class="text-xl font-black text-emerald-950 mt-2">✨ All Reimbursed &amp; Settled Up</h4>
            <div class="text-2xl font-black text-emerald-600 mt-0.5">₹0 Due</div>
            <p class="text-xs text-emerald-700 font-medium mt-1">${payer1} has reimbursed all payments made by ${payer2} for this period.</p>
          </div>
          <div class="mt-3 pt-2 border-t border-emerald-200 text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <i class="fa-solid fa-check-circle"></i>
            <span>No pending balance to return to ${payer2}.</span>
          </div>
        </div>
      `;
    } else {
      verdictCard = `
        <div class="p-4 rounded-2xl bg-indigo-50/80 border-2 border-indigo-300 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-indigo-900">Reimbursement Balance Due</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-900 border border-indigo-200">Income Flow to ${payer2}</span>
            </div>
            <h4 class="text-base font-bold text-slate-700 mt-2">${payer1} owes ${payer2}</h4>
            <div class="text-3xl font-black text-indigo-600 mt-0.5">₹${netDueToP2.toLocaleString('en-IN')}</div>
            <p class="text-xs text-indigo-950 font-medium mt-1">
              Every rupee paid by ${payer2} is returned monthly by ${payer1} as income flow.
            </p>
          </div>
          <div class="mt-3 pt-2 border-t border-indigo-200 flex justify-between items-center text-xs">
            <span class="font-bold text-slate-600">Pending Return:</span>
            <span class="font-black text-indigo-700">₹${netDueToP2.toLocaleString('en-IN')}</span>
          </div>
        </div>
      `;
    }

    grid.innerHTML = `
      <!-- Card 1: Payer 2 Household Expenses -->
      <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">${payer2} Household Spend</span>
            <span class="text-xs font-black text-pink-700 bg-pink-100 px-2 py-0.5 rounded">${payer2} Paid</span>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Total Paid by ${payer2}:</span>
              <span class="font-black text-slate-900">₹${Math.round(p2Paid).toLocaleString('en-IN')}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">
              Groceries, supplies &amp; household purchases funded out of pocket.
            </p>
          </div>
        </div>
        <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
          <span class="font-bold text-slate-500">To be Returned 100%:</span>
          <span class="font-black text-pink-700">₹${Math.round(p2Paid).toLocaleString('en-IN')}</span>
        </div>
      </div>

      <!-- Card 2: Payer 1 Direct Expenses & Reimbursements -->
      <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">${payer1} Direct Outflows</span>
            <span class="text-xs font-black text-violet-700 bg-violet-100 px-2 py-0.5 rounded">${payer1} Funded</span>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Direct Spend (Bills/Staff/Rent):</span>
              <span class="font-black text-slate-900">₹${Math.round(p1DirectPaid).toLocaleString('en-IN')}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Reimbursed to ${payer2} so far:</span>
              <span class="font-bold text-emerald-600">₹${Math.round(reimbursedByP1).toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>
        <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
          <span class="font-bold text-slate-500">${payer2} owes ${payer1}:</span>
          <span class="font-black text-slate-400">₹0 (Never owes)</span>
        </div>
      </div>

      <!-- Card 3: Net Reimbursement Verdict -->
      ${verdictCard}
    `;

    // Settle Up button in header
    if (settleContainer) {
      if (netDueToP2 <= 0) {
        settleContainer.innerHTML = `
          <button disabled class="px-4 py-2 bg-slate-200 text-slate-400 font-extrabold text-xs rounded-xl cursor-not-allowed flex items-center space-x-1.5 shadow-none">
            <i class="fa-solid fa-circle-check text-emerald-500"></i>
            <span>All Reimbursed (₹0)</span>
          </button>
        `;
      } else {
        settleContainer.innerHTML = `
          <button onclick="openSettleUpModal()" class="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-black text-xs rounded-xl shadow-md transition flex items-center space-x-1.5 active:scale-95">
            <i class="fa-solid fa-handshake"></i>
            <span>1-Click Settle Up (Return ₹${netDueToP2.toLocaleString('en-IN')})</span>
          </button>
        `;
      }
    }
  }

  window.openSettleUpModal = function () {
    const modal = document.getElementById('settleUpModal');
    if (!modal) return;

    const amtEl = document.getElementById('settleUpModalAmount');
    const descEl = document.getElementById('settleUpModalDesc');
    const dateEl = document.getElementById('settleUpDate');
    const payerEl = document.getElementById('settleUpPaidBy');
    const inputAmt = document.getElementById('settleUpAmountInput');
    const notesEl = document.getElementById('settleUpNotes');

    if (amtEl) amtEl.textContent = `₹${currentNetSettleAmount.toLocaleString('en-IN')}`;
    if (descEl) descEl.textContent = `Total pending reimbursement to ${currentSettleReceiver || 'recipient'} is ₹${currentNetSettleAmount.toLocaleString('en-IN')}. You can return the full amount or pay in multiple partial installments.`;
    if (inputAmt) inputAmt.value = currentNetSettleAmount;
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    if (payerEl && currentSettlePayer) payerEl.value = currentSettlePayer;
    if (notesEl) notesEl.value = '';

    window.renderSettleQuickChips(currentNetSettleAmount);
    window.onSettleAmountChange();

    modal.classList.remove('hidden');
  };

  window.renderSettleQuickChips = function (totalDue) {
    const container = document.getElementById('settleQuickChips');
    if (!container) return;

    const chips = [];
    chips.push({ label: `Pay Full (₹${totalDue.toLocaleString('en-IN')})`, val: totalDue });

    if (totalDue > 500) chips.push({ label: '₹500', val: 500 });
    if (totalDue > 1000) chips.push({ label: '₹1,000', val: 1000 });
    if (totalDue > 2000) chips.push({ label: '₹2,000', val: 2000 });
    if (totalDue > 5000) chips.push({ label: '₹5,000', val: 5000 });

    container.innerHTML = chips.map(c => `
      <button type="button" onclick="setSettleAmount(${c.val})" class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 transition active:scale-95">
        ${esc(c.label)}
      </button>
    `).join('');
  };

  window.setSettleAmount = function (val) {
    const input = document.getElementById('settleUpAmountInput');
    if (input) {
      input.value = val;
      window.onSettleAmountChange();
    }
  };

  window.onSettleAmountChange = function () {
    const input = document.getElementById('settleUpAmountInput');
    const preview = document.getElementById('settleRemainingPreview');
    const confirmBtn = document.getElementById('settleConfirmBtn');
    if (!input) return;

    const entered = parseFloat(input.value) || 0;
    const remaining = Math.max(0, currentNetSettleAmount - entered);

    if (preview) {
      if (entered >= currentNetSettleAmount) {
        preview.className = 'text-[10px] text-emerald-700 font-bold';
        preview.textContent = '✨ Full Settlement (Remaining: ₹0)';
      } else {
        preview.className = 'text-[10px] text-amber-700 font-bold';
        preview.textContent = `Remaining Due: ₹${remaining.toLocaleString('en-IN')}`;
      }
    }

    if (confirmBtn) {
      confirmBtn.innerHTML = `Confirm &amp; Record ₹${entered > 0 ? entered.toLocaleString('en-IN') : '0'}`;
    }
  };

  window.closeSettleUpModal = function () {
    const modal = document.getElementById('settleUpModal');
    if (modal) modal.classList.add('hidden');
  };

  window.executeSettleUpTransaction = async function () {
    const date = document.getElementById('settleUpDate')?.value || new Date().toISOString().split('T')[0];
    const payer = document.getElementById('settleUpPaidBy')?.value || currentSettlePayer || 'Household Payer';
    const receiver = currentSettleReceiver || (window.FAMILY_MEMBERS && window.FAMILY_MEMBERS.find(m => m !== payer)) || 'Family Member';
    const method = document.getElementById('settleUpPaymentMethod')?.value || 'UPI / GPay / PhonePe';
    const customNotes = document.getElementById('settleUpNotes')?.value?.trim();
    const inputAmt = parseFloat(document.getElementById('settleUpAmountInput')?.value);
    const amount = (inputAmt && inputAmt > 0) ? inputAmt : currentNetSettleAmount;

    if (!amount || amount <= 0) {
      alert('Please enter a valid amount to settle.');
      return;
    }

    const isPartial = amount < currentNetSettleAmount;
    const defaultNote = isPartial
      ? `Partial Reimbursement: ${payer} returned ₹${amount.toLocaleString('en-IN')} of ₹${currentNetSettleAmount.toLocaleString('en-IN')} balance due to ${receiver}`
      : `Full Reimbursement: ${payer} returned ₹${amount.toLocaleString('en-IN')} to ${receiver} for household expenses`;

    const finalNotes = customNotes ? `${defaultNote} (${customNotes})` : defaultNote;

    const payload = {
      date: date,
      amount: amount,
      category: 'Settlement / Transfer',
      paidBy: payer,
      paidTo: receiver,
      vendor: receiver,
      paymentMethod: method,
      notes: finalNotes,
      description: finalNotes,
      splitBetween: (window.masterConfig?.splitRules && window.masterConfig.splitRules[0]) || 'Household Expense',
      receipt: null
    };

    const handleOfflineSettle = () => {
      payload.id = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      payload.isOfflineDraft = true;
      if (Array.isArray(window.expenses)) {
        window.expenses.unshift(payload);
        if (typeof window.saveLocalCacheData === 'function') window.saveLocalCacheData();
        if (typeof window.renderAllViews === 'function') window.renderAllViews();
      }
      if (typeof window.enqueueOfflineAction === 'function') {
        window.enqueueOfflineAction({ action: 'CREATE', payload, id: payload.id });
      }
      window.closeSettleUpModal();
      if (window.triggerHaptic) window.triggerHaptic('success');
      if (window.showToast) {
        window.showToast('warning', 'Reimbursement Saved (Offline)', `₹${amount.toLocaleString('en-IN')} recorded locally. Will sync when back online.`);
      }
    };

    if (!navigator.onLine) {
      handleOfflineSettle();
      return;
    }

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        window.closeSettleUpModal();
        if (window.triggerHaptic) window.triggerHaptic('success');
        if (window.showToast) {
          window.showToast('success', 'Reimbursement Recorded!', `₹${amount.toLocaleString('en-IN')} returned to ${receiver}.`);
        }
        if (window.loadData) {
          await window.loadData(true);
        } else if (typeof loadData === 'function') {
          await loadData(true);
        }
        if (window.renderAllViews) {
          window.renderAllViews();
        } else if (typeof renderAllViews === 'function') {
          renderAllViews();
        }
      } else {
        if (window.triggerHaptic) window.triggerHaptic('error');
        alert('Failed to record settlement: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.warn('Network exception while recording settlement, saving to offline queue:', err);
      handleOfflineSettle();
    }
  };

  // ========================================================
  // 3. UPCOMING BILLS DUE DATE RADAR & 15-DAY RUNWAY
  // ========================================================

  const RADAR_BILLS = [
    { name: 'MSCB Electricity Bill', category: 'Electricity Bill', dueDay: 10, approxAmount: 2200, icon: '⚡' },
    { name: 'Society Flat Maintenance', category: 'Flat Maintenance', dueDay: 5, approxAmount: 3500, icon: '🏢' },
    { name: 'Airtel Broadband / Wifi', category: 'Wifi / Internet', dueDay: 15, approxAmount: 999, icon: '📶' },
    { name: 'Tata Play / Dish Bill', category: 'Dish Bill (DTH)', dueDay: 20, approxAmount: 450, icon: '📺' },
    { name: 'Maid - Madhuri', category: 'Maid - Madhuri', dueDay: 21, approxAmount: 800, icon: '🧹' },
    { name: 'Chef - Nilima Nikose', category: 'Chef - Nilima Nikose', dueDay: 30, approxAmount: 4500, icon: '👩‍🍳' }
  ];

  function renderBillsRadar(filtered) {
    const grid = document.getElementById('billsRadarGrid');
    const runwayNeededEl = document.getElementById('runwayTotalNeeded');
    const runwayProgressEl = document.getElementById('runwayProgressBar');
    const runwayNoteEl = document.getElementById('runwayDetailNote');
    const runwayListEl = document.getElementById('runwayItemsList');

    if (!grid) return;

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const allExpenses = window.expensesData || [];
    let cardsHtml = '';
    let runwaySum = 0;
    const runwayItems = [];

    const activeBills = (window.masterConfig && window.masterConfig.recurringBills && window.masterConfig.recurringBills.length > 0)
      ? window.masterConfig.recurringBills
      : RADAR_BILLS;

    activeBills.forEach(bill => {
      const evalRes = window.getRecurringPaymentStatus
        ? window.getRecurringPaymentStatus(bill, allExpenses, today)
        : null;

      let statusBadge = '';
      if (evalRes && evalRes.status === 'PAID') {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">Paid ₹${Math.round(evalRes.totalPaid).toLocaleString('en-IN')} ✅</span>`;
      } else if (evalRes && evalRes.status === 'PARTIALLY_PAID') {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-teal-100 text-teal-800 border border-teal-300">Partial ₹${Math.round(evalRes.totalPaid).toLocaleString('en-IN')} 🟡</span>`;
        const billAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
        runwaySum += Number(evalRes.remaining) || 0;
        runwayItems.push({ name: bill.name, amount: evalRes.remaining, status: 'Partially Paid' });
      } else if (evalRes && evalRes.status === 'OVERDUE') {
        const billAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">Overdue by ${Math.abs(evalRes.daysDiff)}d 🚨</span>`;
        runwaySum += billAmt;
        runwayItems.push({ name: bill.name, amount: billAmt, status: 'Overdue' });
      } else if (evalRes && (evalRes.status === 'DUE_TODAY' || (evalRes.daysDiff <= 5 && evalRes.daysDiff >= 0))) {
        const billAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
        const text = evalRes.daysDiff === 0 ? 'Due Today ⚠️' : `Due in ${evalRes.daysDiff}d ⚠️`;
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">${text}</span>`;
        runwaySum += billAmt;
        runwayItems.push({ name: bill.name, amount: billAmt, status: text });
      } else {
        const billAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
        const daysDiff = evalRes ? evalRes.daysDiff : (bill.dueDay - currentDay);
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">Due ${bill.dueDay}th ⏱️</span>`;
        if (daysDiff <= 15 && daysDiff > 0) {
          runwaySum += billAmt;
          runwayItems.push({ name: bill.name, amount: billAmt, status: `Due in ${daysDiff}d` });
        }
      }

      const displayBillAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
      cardsHtml += `
        <div class="p-3 bg-slate-50/70 border border-slate-200 rounded-xl flex items-center justify-between hover:bg-slate-100/70 transition">
          <div class="flex items-center space-x-2.5">
            <span class="text-xl">${bill.icon}</span>
            <div>
              <div class="text-xs font-bold text-slate-900">${bill.name}</div>
              <div class="text-[10px] text-slate-500 font-medium">Cycle: ${bill.dueDay}th of month (~₹${displayBillAmt.toLocaleString('en-IN')})</div>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>
      `;
    });

    grid.innerHTML = cardsHtml;

    // 15-Day Runway Predictor
    if (runwayNeededEl) {
      runwayNeededEl.textContent = `₹${runwaySum.toLocaleString('en-IN')}`;
    }
    if (runwayProgressEl) {
      const pct = Math.min(100, Math.round((runwaySum / 12500) * 100));
      runwayProgressEl.style.width = `${pct}%`;
    }
    if (runwayNoteEl) {
      if (runwaySum === 0) {
        runwayNoteEl.textContent = '✨ All recurring utility obligations are satisfied for this cycle.';
      } else {
        runwayNoteEl.textContent = `${runwayItems.length} upcoming recurring bill${runwayItems.length > 1 ? 's' : ''} due in next 15 days.`;
      }
    }
    if (runwayListEl) {
      if (runwayItems.length === 0) {
        runwayListEl.innerHTML = `<span class="text-emerald-600 font-bold text-[11px]">✓ No pending utility bills in the 15-day radar.</span>`;
      } else {
        runwayListEl.innerHTML = runwayItems.slice(0, 3).map(i => `
          <div class="flex justify-between text-slate-600 text-[11px]">
            <span>${i.name}:</span>
            <span class="font-bold text-slate-900">₹${i.amount.toLocaleString('en-IN')} (${i.status})</span>
          </div>
        `).join('');
      }
    }
  }

  // ========================================================
  // 4. DOMESTIC STAFF ATTENDANCE & LEAVE PAYROLL SUITE
  // ========================================================

  function updateAttendanceSyncStatus(status) {
    const el = document.getElementById('attendanceSyncStatus');
    if (!el) return;
    if (status === 'saving') {
      el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-300 transition-all';
      el.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin text-amber-600"></i> <span>Saving to Cloud...</span>';
    } else if (status === 'saved') {
      el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 transition-all';
      el.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-emerald-600"></i> <span>Auto-Saved to Cloud</span>';
      setTimeout(() => {
        const curEl = document.getElementById('attendanceSyncStatus');
        if (curEl && curEl.innerHTML.includes('Auto-Saved')) {
          curEl.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 transition-all';
          curEl.innerHTML = '<i class="fa-solid fa-cloud text-slate-400"></i> <span>Auto-Saved to Cloud</span>';
        }
      }, 2500);
    } else if (status === 'error') {
      el.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-300 transition-all';
      el.innerHTML = '<i class="fa-solid fa-circle-exclamation text-rose-600"></i> <span>Sync Failed (Saved Locally)</span>';
    }
  }

  async function loadAttendanceFromApi() {
    try {
      const cached = localStorage.getItem('homeexpenses_staff_attendance');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          staffAttendanceState = { ...staffAttendanceState, ...parsed };
        }
      }
    } catch (e) {}

    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders({ 'Cache-Control': 'no-cache' }) : { 'Cache-Control': 'no-cache' };
      const res = await fetch(`/api/attendance?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: headers
      });
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && typeof data === 'object') {
          staffAttendanceState = { ...staffAttendanceState, ...data };
          try {
            localStorage.setItem('homeexpenses_staff_attendance', JSON.stringify(staffAttendanceState));
          } catch (e) {}
        }
      }
    } catch (e) {
      console.warn('Could not load attendance from API:', e);
    }
  }

  async function saveAttendanceToApi(staffName, monthKey, record) {
    try {
      localStorage.setItem('homeexpenses_staff_attendance', JSON.stringify(staffAttendanceState));
    } catch (e) {}

    updateAttendanceSyncStatus('saving');

    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          action: 'saveMonth',
          staff: staffName,
          month: monthKey,
          days: record.days || {},
          bonus: record.bonus || 0,
          notes: record.notes || ''
        })
      });

      if (res.ok) {
        updateAttendanceSyncStatus('saved');
      } else {
        updateAttendanceSyncStatus('error');
      }
    } catch (e) {
      console.error('Error saving attendance to API:', e);
      updateAttendanceSyncStatus('error');
    }
  }

  window.renderAttendanceCalendar = function () {
    const staffSelect = document.getElementById('attendanceStaffSelect');
    const monthTitle = document.getElementById('attendanceMonthTitle');
    const grid = document.getElementById('attendanceDaysGrid');

    if (!grid || !staffSelect) return;

    const staffName = staffSelect.value || 'Chef - Nilima Nikose';
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    const monthKey = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    if (monthTitle) {
      monthTitle.textContent = `${monthName} Attendance (${staffName.split(' - ')[1] || staffName})`;
    }

    if (!staffAttendanceState[staffName]) {
      staffAttendanceState[staffName] = {
        baseSalary: staffName.includes('Nilima') ? 4500 : 800,
        billingCycleDay: staffName.includes('Nilima') ? 30 : 21,
        months: {}
      };
    }
    const staffRecord = staffAttendanceState[staffName];
    if (!staffRecord.months) staffRecord.months = {};
    if (!staffRecord.months[monthKey]) {
      staffRecord.months[monthKey] = { days: {}, bonus: 0, notes: '' };
    }
    const monthRecord = staffRecord.months[monthKey];

    const daysInMonth = new Date(curYear, curMonth, 0).getDate();
    const firstDayIndex = new Date(curYear, curMonth - 1, 1).getDay(); // 0 = Sun

    let presentCount = 0;
    let leaveCount = 0;
    let halfCount = 0;
    let holidayCount = 0;

    let cellsHtml = '';

    for (let i = 0; i < firstDayIndex; i++) {
      cellsHtml += `<div class="p-2 border border-transparent rounded-lg opacity-0"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const status = monthRecord.days[day] || 'P'; // Default Present
      if (status === 'P') presentCount++;
      else if (status === 'L') leaveCount++;
      else if (status === 'HD') halfCount++;
      else if (status === 'H') holidayCount++;

      let bgClass = 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100';
      let badgeText = 'P';
      if (status === 'L') {
        bgClass = 'bg-rose-50 text-rose-900 border-rose-300 hover:bg-rose-100';
        badgeText = 'L';
      } else if (status === 'HD') {
        bgClass = 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100';
        badgeText = '½';
      } else if (status === 'H') {
        bgClass = 'bg-sky-50 text-sky-900 border-sky-300 hover:bg-sky-100';
        badgeText = 'H';
      }

      cellsHtml += `
        <button type="button" data-day="${day}" class="att-day-cell flex flex-col items-center justify-center p-1 sm:p-2 rounded-lg sm:rounded-xl border text-xs font-bold transition transform active:scale-95 cursor-pointer min-h-[38px] sm:min-h-[48px] ${bgClass}">
          <span class="text-[9px] sm:text-[10px] text-slate-500 font-medium">${day}</span>
          <span class="text-xs sm:text-sm font-black mt-0.5 leading-none">${badgeText}</span>
        </button>
      `;
    }

    grid.innerHTML = cellsHtml;

    // Attach click listeners to cycle: P -> L -> HD -> H -> P
    grid.querySelectorAll('.att-day-cell').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.day;
        const cur = monthRecord.days[d] || 'P';
        let next = 'P';
        if (cur === 'P') next = 'L';
        else if (cur === 'L') next = 'HD';
        else if (cur === 'HD') next = 'H';
        else if (cur === 'H') next = 'P';

        monthRecord.days[d] = next;
        window.renderAttendanceCalendar();
        saveAttendanceToApi(staffName, monthKey, monthRecord);
      });
    });

    // Update Pro-Rata Salary Calculation with Configurable Allowed Paid Leaves Quota
    const staffConf = (window.masterConfig && window.masterConfig.staff)
      ? window.masterConfig.staff.find(s => s.name === staffName || s.shortName === staffName || staffName.includes(s.shortName))
      : null;

    const baseSalary = staffConf ? Number(staffConf.baseSalary) : (staffRecord.baseSalary || (staffName.includes('Nilima') ? 4500 : 800));
    const allowedLeaves = staffConf ? Number(staffConf.allowedPaidLeaves ?? (staffName.includes('Nilima') ? 4 : (staffName.includes('Madhuri') ? 2 : 0))) : (staffName.includes('Nilima') ? 4 : (staffName.includes('Madhuri') ? 2 : 0));
    const perDayRate = baseSalary / daysInMonth;

    // Allowed Paid Leaves Quota Calculation:
    // Leaves taken up to allowedLeaves have NO salary deduction!
    // Deductions only apply to leaves exceeding the quota.
    const freeLeavesRemaining = Math.max(0, allowedLeaves - leaveCount);
    const chargeableLeaves = Math.max(0, leaveCount - allowedLeaves);
    const chargeableHalfDays = Math.max(0, halfCount - (freeLeavesRemaining * 2));

    const leaveDeductions = (chargeableLeaves * perDayRate) + (chargeableHalfDays * (perDayRate / 2));
    const payableDays = (presentCount + holidayCount) + (halfCount * 0.5);
    const netPayable = Math.max(0, Math.round(baseSalary - leaveDeductions));

    const baseEl = document.getElementById('calcBaseSalary');
    const totalDaysEl = document.getElementById('calcTotalDays');
    const payableDaysEl = document.getElementById('calcPayableDays');
    const dedEl = document.getElementById('calcDeductions');
    const netEl = document.getElementById('calcNetPayable');

    if (baseEl) baseEl.textContent = `₹${baseSalary.toLocaleString('en-IN')}`;
    if (totalDaysEl) totalDaysEl.textContent = daysInMonth;
    if (payableDaysEl) {
      payableDaysEl.innerHTML = `${payableDays} days <span class="text-[10px] text-slate-500 font-semibold">(${leaveCount} leaves, ${allowedLeaves} free quota)</span>`;
    }
    if (dedEl) {
      dedEl.innerHTML = `-₹${Math.round(leaveDeductions).toLocaleString('en-IN')} <span class="text-[10px] ${chargeableLeaves > 0 ? 'text-rose-500 font-bold' : 'text-emerald-600 font-semibold'}">(${chargeableLeaves} charged)</span>`;
    }
    if (netEl) netEl.textContent = `₹${netPayable.toLocaleString('en-IN')}`;

    // Cache calculation for Quick Pay & Voucher
    window.currentStaffCalc = {
      staff: staffName,
      month: monthKey,
      baseSalary: baseSalary,
      daysInMonth: daysInMonth,
      presentCount: presentCount,
      leaveCount: leaveCount,
      halfCount: halfCount,
      payableDays: payableDays,
      deductions: Math.round(leaveDeductions),
      netPayable: netPayable
    };
  };

  window.onBonusChange = function () {
    // No-op retained for backwards compatibility
  };

  window.generateWhatsAppVoucher = function () {
    const calc = window.currentStaffCalc;
    if (!calc) {
      alert('Attendance data not ready.');
      return;
    }

    const expList = window.expensesData || window.expenses || [];
    const [yearStr, monthStr] = (calc.month || '').split('-');
    const staffNameLower = (calc.staff || '').toLowerCase();
    const shortStaff = calc.staff.replace('Chef - ', '').replace('Maid - ', '').trim();
    const shortStaffLower = shortStaff.toLowerCase();

    // Check if salary payment has already been recorded in current month's expenses
    const matchingPayment = expList.find(e => {
      if (!e.date) return false;
      const d = String(e.date).split('-');
      const isSameMonth = d[0] === yearStr && d[1] === monthStr;
      if (!isSameMonth) return false;

      const cat = (e.category || '').toLowerCase();
      const paidTo = (e.paidTo || '').toLowerCase();
      const vendor = (e.vendor || '').toLowerCase();
      const notes = (e.notes || '').toLowerCase();

      return cat.includes(shortStaffLower) ||
             paidTo.includes(shortStaffLower) ||
             vendor.includes(shortStaffLower) ||
             notes.includes(shortStaffLower) ||
             staffNameLower.includes(cat);
    });

    const isPaid = !!matchingPayment;
    const paymentStatusText = isPaid
      ? `✅ PAID${matchingPayment.amount ? ` (₹${Number(matchingPayment.amount).toLocaleString('en-IN')})` : ''}`
      : `⏳ NOT PAID (Pending)`;

    const dateFormatted = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const voucherText =
`*ATTENDANCE & SALARY UPDATE - HOMEEXPENSES*
👤 *Staff Member:* ${calc.staff}
📅 *Month / Cycle:* ${calc.month}
━━━━━━━━━━━━━━━━━━━━━━
📊 *Attendance & Leaves:*
• Days Worked: ${calc.payableDays || (calc.daysInMonth - calc.leaveCount)} days
• Leaves Taken: ${calc.leaveCount} days${calc.halfCount > 0 ? ` (${calc.halfCount} half-days)` : ''}

💰 *Salary Amount:* ₹${calc.netPayable.toLocaleString('en-IN')}
📌 *Payment Status:* ${paymentStatusText}
━━━━━━━━━━━━━━━━━━━━━━
🗓️ *Date:* ${dateFormatted}
*HomeExpenses Tracker*`;

    const waUrl = `https://wa.me/?text=${encodeURIComponent(voucherText)}`;
    window.open(waUrl, '_blank');
  };

  window.quickPayCalculatedSalary = async function () {
    const calc = window.currentStaffCalc;
    if (!calc || calc.netPayable <= 0) {
      alert('No net salary calculated to record.');
      return;
    }

    const shortStaff = calc.staff.replace('Chef - ', '').replace('Maid - ', '');
    const payload = {
      date: new Date().toISOString().split('T')[0],
      amount: calc.netPayable,
      category: calc.staff,
      paidBy: 'Palash',
      paidTo: shortStaff,
      vendor: shortStaff,
      paymentMethod: 'UPI / GPay / PhonePe',
      notes: `Payroll for ${calc.month} (${calc.staff}) recorded via Attendance Suite`,
      description: `Payroll for ${calc.month} (${calc.staff}) recorded via Attendance Suite`,
      splitBetween: 'Household Expense (Palash Reimburses Pallavi 100%)',
      receipt: null
    };

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (window.showToast) {
          window.showToast('success', 'Payroll Recorded Successfully!', `₹${calc.netPayable.toLocaleString('en-IN')} recorded for ${calc.staff}.`);
        }
        if (window.loadData) window.loadData(true);
      } else {
        alert('Failed to record staff salary: ' + (data.error || 'Server error'));
      }
    } catch (e) {
      console.error(e);
      alert('Error recording salary: ' + e.message);
    }
  };

  // ========================================================
  // 5. LUXURY EXECUTIVE PDF MONTHLY REPORT GENERATOR
  // ========================================================

  window.generateExecutiveReport = function () {
    const reportContainer = document.getElementById('printableExecutiveReport');
    if (!reportContainer) return;

    const filtered = window.currentFilteredExpenses || window.expensesData || [];
    const totalExp = filtered.reduce((s, e) => s + (e.category !== 'Accepted Payments (Income)' ? parseFloat(e.amount || 0) : 0), 0);
    const totalInc = filtered.reduce((s, e) => s + (e.category === 'Accepted Payments (Income)' ? parseFloat(e.amount || 0) : 0), 0);
    const txCount = filtered.length;

    // Categories breakdown
    const catMap = {};
    filtered.filter(e => e.category !== 'Accepted Payments (Income)').forEach(e => {
      const c = e.category || 'Other';
      catMap[c] = (catMap[c] || 0) + parseFloat(e.amount || 0);
    });
    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

    // Top transactions
    const topTxs = [...filtered]
      .filter(e => e.category !== 'Accepted Payments (Income)')
      .sort((a, b) => parseFloat(b.amount || 0) - parseFloat(a.amount || 0))
      .slice(0, 8);

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', day: 'numeric' });

    reportContainer.innerHTML = `
      <div class="print-page bg-white text-slate-900 font-sans max-w-4xl mx-auto space-y-6">
        <!-- Header -->
        <div class="border-b-2 border-slate-900 pb-4 flex justify-between items-end">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-3xl font-black tracking-tight text-slate-900">HOMEEXPENSES</span>
              <span class="text-xs uppercase tracking-widest px-2.5 py-1 bg-slate-900 text-white font-extrabold rounded">Executive Statement</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">Household Expense & Staff Payroll Command Center</p>
          </div>
          <div class="text-right">
            <div class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Statement Date</div>
            <div class="text-sm font-extrabold text-slate-900">${dateStr}</div>
          </div>
        </div>

        <!-- KPI Summary Cards -->
        <div class="grid grid-cols-4 gap-3">
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div class="text-[10px] uppercase font-bold text-slate-500">Total Outflow</div>
            <div class="text-xl font-black text-slate-900 mt-1">₹${Math.round(totalExp).toLocaleString('en-IN')}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${txCount} transactions</div>
          </div>
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div class="text-[10px] uppercase font-bold text-slate-500">Total Income / Recv</div>
            <div class="text-xl font-black text-emerald-600 mt-1">₹${Math.round(totalInc).toLocaleString('en-IN')}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Family deposits</div>
          </div>
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div class="text-[10px] uppercase font-bold text-slate-500">Avg Ticket Size</div>
            <div class="text-xl font-black text-slate-900 mt-1">₹${txCount ? Math.round(totalExp / txCount).toLocaleString('en-IN') : 0}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">Per expense</div>
          </div>
          <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div class="text-[10px] uppercase font-bold text-slate-500">Top Outflow Category</div>
            <div class="text-sm font-black text-slate-900 mt-1 truncate">${sortedCats[0] ? sortedCats[0][0] : 'None'}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">₹${sortedCats[0] ? Math.round(sortedCats[0][1]).toLocaleString('en-IN') : 0}</div>
          </div>
        </div>

        <!-- Major Outflow Categories -->
        <div>
          <h3 class="text-xs font-black uppercase tracking-wider text-slate-800 border-b pb-1 mb-2.5">Category Allocation</h3>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2">
            ${sortedCats.slice(0, 6).map(([cat, amt]) => {
              const pct = totalExp > 0 ? Math.round((amt / totalExp) * 100) : 0;
              return `
                <div>
                  <div class="flex justify-between text-xs font-bold mb-1">
                    <span class="text-slate-700">${cat}</span>
                    <span class="text-slate-900">₹${Math.round(amt).toLocaleString('en-IN')} (${pct}%)</span>
                  </div>
                  <div class="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div class="bg-slate-900 h-1.5 rounded-full" style="width: ${pct}%"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- High-Value Transactions Table -->
        <div>
          <h3 class="text-xs font-black uppercase tracking-wider text-slate-800 border-b pb-1 mb-2.5">Top Outflows (Audited Transactions)</h3>
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-300 font-bold text-slate-600">
                <th class="py-1">Date</th>
                <th class="py-1">Vendor / Recipient</th>
                <th class="py-1">Category</th>
                <th class="py-1">Paid By</th>
                <th class="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${topTxs.map(t => `
                <tr>
                  <td class="py-1 text-slate-600">${esc(t.date)}</td>
                  <td class="py-1 font-semibold text-slate-900">${esc(t.paidTo || t.vendor || '-')}</td>
                  <td class="py-1 text-slate-600">${esc(t.category || '-')}</td>
                  <td class="py-1 text-slate-600">${esc(t.paidBy || '-')}</td>
                  <td class="py-1 text-right font-black text-slate-900">₹${Number(t.amount).toLocaleString('en-IN')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Footer -->
        <div class="border-t pt-3 text-center text-[10px] text-slate-400">
          Generated automatically by HOMEEXPENSES Executive Suite • Confidential Family Financial Record
        </div>
      </div>
    `;

    setTimeout(() => {
      window.print();
    }, 150);
  };


  // ========================================================
  // 8. MASTER CONFIGURATION & ADMIN CENTER CONTROLLER
  // ========================================================

  window.masterConfig = null;

  function getAdvanceAuthHeaders(extra = {}) {
    const token = (typeof authToken !== 'undefined' && authToken) ||
                  (typeof window.authToken !== 'undefined' && window.authToken) ||
                  localStorage.getItem('household_auth_token') ||
                  '';
    const headers = {
      'Content-Type': 'application/json',
      ...extra
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }
  window.getAdvanceAuthHeaders = getAdvanceAuthHeaders;

  async function loadMasterConfig() {
    try {
      const activeHId = (typeof getActiveHouseholdId === 'function') 
        ? getActiveHouseholdId() 
        : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');
      const headers = getAdvanceAuthHeaders({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      });
      const res = await fetch(`/api/config?householdId=${encodeURIComponent(activeHId)}&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: headers
      });
      if (res.ok) {
        const json = await res.json();
        const config = json.data || json;
        if (config && typeof config === 'object') {
          // Preserve locally added categories during replication window
          if (window.masterConfig && Array.isArray(window.masterConfig.categories) && Array.isArray(config.categories)) {
            const serverCatNames = new Set(config.categories.map(c => c.name.toLowerCase()));
            window.masterConfig.categories.forEach(localCat => {
              if (localCat && localCat.name && !serverCatNames.has(localCat.name.toLowerCase())) {
                config.categories.push(localCat);
              }
            });
          }

          // Restore cached budget if server returned undefined
          const cachedBudget = localStorage.getItem(`household_budget_limit_${activeHId}`);
          if (config.monthlyBudgetLimit === undefined && cachedBudget) {
            config.monthlyBudgetLimit = parseFloat(cachedBudget);
          }

          window.masterConfig = config;
          if (window.updateGlobalsFromConfig) {
            window.updateGlobalsFromConfig(config);
          }
          syncDropdownsWithConfig();
          if (window.renderAttendanceCalendar) window.renderAttendanceCalendar();
          if (window.renderBillsRadar && (window.currentFilteredExpenses || window.expensesData)) {
            window.renderBillsRadar(window.currentFilteredExpenses || window.expensesData);
          }
          if (window.renderAdminView) {
            window.renderAdminView();
          }
          if (window.renderAllViews) {
            window.renderAllViews();
          }
        }
      } else {
        console.warn('Could not load master config, HTTP status:', res.status);
      }
    } catch (err) {
      console.warn('Could not load master config from /api/config:', err);
    }
  }
  window.loadMasterConfig = loadMasterConfig;

  // Re-fetch the household config and compare the fields we just wrote against
  // what came back. Returns the stored config so callers can render the truth
  // rather than their own optimistic copy.
  async function verifyConfigSaved(householdId, sent) {
    const result = { ok: true, mismatches: [], stored: null };
    try {
      const res = await fetch(
        `/api/config?householdId=${encodeURIComponent(householdId)}&_t=${Date.now()}`,
        { headers: getAdvanceAuthHeaders(), cache: 'no-store' }
      );
      if (!res.ok) {
        result.ok = false;
        result.mismatches.push('could not re-read the saved config');
        return result;
      }
      const json = await res.json();
      const stored = json.data || json.config || null;
      result.stored = stored;
      if (!stored) {
        result.ok = false;
        result.mismatches.push('server returned no config to verify against');
        return result;
      }

      const sameNumber = (a, b) => Number(a) === Number(b);

      if (sent.monthlyBudgetLimit !== undefined &&
          !sameNumber(stored.monthlyBudgetLimit, sent.monthlyBudgetLimit)) {
        result.mismatches.push(
          `monthly budget (sent ${sent.monthlyBudgetLimit}, stored ${stored.monthlyBudgetLimit})`);
      }

      if (Array.isArray(sent.staff)) {
        const storedById = indexById(stored.staff);
        sent.staff.forEach((s) => {
          const got = storedById[s.id];
          if (!got) {
            result.mismatches.push(`staff ${s.name || s.id} was not saved`);
            return;
          }
          if (!sameNumber(got.baseSalary, s.baseSalary)) {
            result.mismatches.push(`${s.name || s.id} salary (sent ${s.baseSalary}, stored ${got.baseSalary})`);
          }
          if ((got.shortName || '') !== (s.shortName || '')) {
            result.mismatches.push(`${s.name || s.id} short name`);
          }
          if ((got.name || '') !== (s.name || '')) {
            result.mismatches.push(`${s.id} name`);
          }
        });
      }

      if (Array.isArray(sent.recurringBills)) {
        const storedById = indexById(stored.recurringBills);
        sent.recurringBills.forEach((b) => {
          const got = storedById[b.id];
          if (!got) {
            result.mismatches.push(`bill ${b.name || b.id} was not saved`);
            return;
          }
          if (!sameNumber(got.approxAmount, b.approxAmount)) {
            result.mismatches.push(`${b.name || b.id} amount (sent ${b.approxAmount}, stored ${got.approxAmount})`);
          }
          if (!sameNumber(got.dueDay, b.dueDay)) {
            result.mismatches.push(`${b.name || b.id} due day`);
          }
        });
      }

      result.ok = result.mismatches.length === 0;
    } catch (err) {
      result.ok = false;
      result.mismatches.push(`verification failed: ${err.message}`);
    }
    return result;
  }

  async function saveMasterConfig(partialUpdates) {
    try {
      const activeHId = (typeof getActiveHouseholdId === 'function') 
        ? getActiveHouseholdId() 
        : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');
      const headers = getAdvanceAuthHeaders({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      });
      const res = await fetch(`/api/config?householdId=${encodeURIComponent(activeHId)}`, {
        method: 'POST',
        headers: headers,
        cache: 'no-store',
        body: JSON.stringify({
          ...partialUpdates,
          householdId: activeHId
        })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          // Read back before claiming success. A 200 only means the server
          // accepted the request, not that what it stored matches what the
          // owner typed. Anything that disagrees is reported, not hidden.
          const verification = await verifyConfigSaved(activeHId, partialUpdates);

          window.masterConfig = verification.stored || json.data;
          if (window.updateGlobalsFromConfig) {
            window.updateGlobalsFromConfig(window.masterConfig);
          }
          syncDropdownsWithConfig();
          if (window.renderAttendanceCalendar) window.renderAttendanceCalendar();
          if (window.renderBillsRadar && (window.currentFilteredExpenses || window.expensesData)) {
            window.renderBillsRadar(window.currentFilteredExpenses || window.expensesData);
          }
          if (window.renderAdminView) window.renderAdminView();
          if (window.renderAllViews) window.renderAllViews();

          if (!verification.ok) {
            if (window.showToast) {
              window.showToast('error', 'Saved value does not match',
                `The server stored something different for: ${verification.mismatches.join(', ')}. Check the values and try again.`);
            }
            return false;
          }

          window.adminFormDirty = false;
          if (window.showToast) {
            window.showToast('success', 'Saved', 'Changes verified on the server.');
          }
          return true;
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        if (window.showToast) {
          window.showToast('error', 'Update Failed', errData.error || 'Server rejected configuration update.');
        }
      }
    } catch (err) {
      console.error('Error saving master config:', err);
      if (window.showToast) {
        window.showToast('error', 'Save Failed', err.message || 'Error updating config on server.');
      }
    }
    return false;
  }
  window.saveMasterConfig = saveMasterConfig;

  function syncDropdownsWithConfig(preferredCategory = null) {
    const config = window.masterConfig;
    if (!config) return;

    // 1. Categories Dropdowns
    if (config.categories && Array.isArray(config.categories)) {
      window.CATEGORIES = config.categories.map(c => c.name);

      const inputCat = document.getElementById('inputCategory');
      if (inputCat) {
        const currentVal = preferredCategory || inputCat.value;
        const opts = config.categories.map(c => 
          `<option value="${c.name}">${c.icon || '🏷️'} ${c.name}</option>`
        ).join('') + `<option value="__NEW_CAT__">➕ Add New Category...</option>`;
        inputCat.innerHTML = opts;
        if (currentVal && config.categories.some(c => c.name.toLowerCase() === currentVal.toLowerCase())) {
          const match = config.categories.find(c => c.name.toLowerCase() === currentVal.toLowerCase());
          inputCat.value = match.name;
        } else if (config.categories.length > 0) {
          inputCat.value = config.categories[0].name;
        }
      }

      const filterCat = document.getElementById('filterCategory');
      if (filterCat) {
        const currentVal = filterCat.value;
        filterCat.innerHTML = `<option value="all">All Categories</option>` + config.categories.map(c => 
          `<option value="${c.name}">${c.icon || '🏷️'} ${c.name}</option>`
        ).join('');
        if (currentVal && (currentVal === 'all' || config.categories.some(c => c.name === currentVal))) {
          filterCat.value = currentVal;
        } else {
          filterCat.value = 'all';
        }
        const mobileFilterCat = document.getElementById('mobileFilterCategory');
        if (mobileFilterCat) {
          mobileFilterCat.innerHTML = filterCat.innerHTML;
          mobileFilterCat.value = filterCat.value;
        }
      }

      const billCatSelect = document.getElementById('adminNewBillCategory');
      if (billCatSelect) {
        billCatSelect.innerHTML = config.categories.map(c => 
          `<option value="${c.name}">${c.icon || '🏷️'} ${c.name}</option>`
        ).join('');
      }
    }

    // 2. Family Members ("Paid By") Dropdowns (Always include "Not Specified")
    const members = (typeof getActiveFamilyMembers === 'function') 
      ? getActiveFamilyMembers() 
      : ((config.familyMembers && Array.isArray(config.familyMembers)) ? config.familyMembers : ['Household Member']);

    window.FAMILY_MEMBERS = members;

    const inputPaidBy = document.getElementById('inputPaidBy');
    if (inputPaidBy) {
      const currentVal = inputPaidBy.value;
      const memberOptions = members.map(m => 
        `<option value="${m}">${m}</option>`
      ).join('');
      inputPaidBy.innerHTML = memberOptions + `<option value="Not Specified">Not Specified</option>`;
      if (currentVal && (members.includes(currentVal) || currentVal === 'Not Specified')) {
        inputPaidBy.value = currentVal;
      } else {
        inputPaidBy.value = (window.currentSessionUser && window.currentSessionUser.name) || members[0] || 'Not Specified';
      }
    }

    const filterPaidBy = document.getElementById('filterPaidBy');
    if (filterPaidBy) {
      const currentVal = filterPaidBy.value;
      const memberOptions = members.map(m => 
        `<option value="${m}">👤 ${m}</option>`
      ).join('');
      filterPaidBy.innerHTML = `<option value="all">Paid By: All</option>` + memberOptions + `<option value="Not Specified">❓ Not Specified</option>`;
      if (currentVal && (currentVal === 'all' || members.includes(currentVal) || currentVal === 'Not Specified')) {
        filterPaidBy.value = currentVal;
      } else {
        filterPaidBy.value = 'all';
        if (typeof dashboardFilters !== 'undefined') dashboardFilters.paidBy = 'all';
      }
      const mobileFilterPaidBy = document.getElementById('mobileFilterPaidBy');
      if (mobileFilterPaidBy) {
        mobileFilterPaidBy.innerHTML = filterPaidBy.innerHTML;
        mobileFilterPaidBy.value = filterPaidBy.value;
      }
    }

    // 2b. Dynamic Quick Filter Member Chips
    const chipsContainer = document.getElementById('quickFilterMemberChips');
    if (chipsContainer) {
      const chipColors = [
        'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200',
        'bg-pink-50 hover:bg-pink-100 text-pink-700 border-pink-200',
        'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200',
        'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200',
        'bg-violet-50 hover:bg-violet-100 text-violet-700 border-violet-200',
        'bg-cyan-50 hover:bg-cyan-100 text-cyan-700 border-cyan-200'
      ];
      chipsContainer.innerHTML = members.map((m, idx) => {
        const isPalash = m.toLowerCase().includes('palash');
        const isPallavi = m.toLowerCase().includes('pallavi');
        const icon = isPalash ? '👤' : (isPallavi ? '🌸' : '🧑');
        const colorClass = chipColors[idx % chipColors.length];
        const isSelected = (typeof dashboardFilters !== 'undefined' && dashboardFilters.paidBy === m);
        const activeClass = isSelected ? 'ring-2 ring-indigo-500 font-black' : '';
        return `<button onclick="quickFilterPaidBy(${esc(JSON.stringify(m))})" class="quick-chip px-2.5 py-1 rounded-lg font-bold ${colorClass} ${activeClass} border transition shadow-xs text-xs">${icon} ${m}</button>`;
      }).join('');
    }

    // 2c. Dynamic Settle Up Paid By
    const settlePaidBy = document.getElementById('settleUpPaidBy');
    if (settlePaidBy) {
      if (members.length >= 2) {
        settlePaidBy.innerHTML = `
          <option value="${members[0]}" selected>${members[0]} (Reimburses to ${members[1]})</option>
          <option value="${members[1]}">${members[1]} (Reimburses to ${members[0]})</option>
        `;
      } else {
        settlePaidBy.innerHTML = members.map(m => `<option value="${m}">${m}</option>`).join('');
      }
    }

    // 2d. Dynamic In-App Audit Actor Filter
    const auditActor = document.getElementById('inAppAuditActorFilter');
    if (auditActor) {
      const curActor = auditActor.value;
      const opts = members.map(m => `<option value="${m}">👤 ${m}</option>`).join('');
      auditActor.innerHTML = `<option value="ALL">👥 All Actors</option>${opts}<option value="System">⚡ System Sync</option>`;
      if (curActor && (curActor === 'ALL' || curActor === 'System' || members.includes(curActor))) {
        auditActor.value = curActor;
      }
    }

    // 2e. Split / Allocation Rules Dropdown
    const inputSplit = document.getElementById('inputSplitBetween');
    if (inputSplit) {
      const currentVal = inputSplit.value;
      let rules = (config.splitRules && Array.isArray(config.splitRules) && config.splitRules.length) 
        ? [...config.splitRules] 
        : [];
      if (!rules.length) {
        rules = ['Household Expense', ...members.map(m => `Personal Expense (${m})`), 'Equal (50/50)'];
      }
      inputSplit.innerHTML = rules.map(r => `<option value="${r}">${r}</option>`).join('');
      if (currentVal && rules.includes(currentVal)) {
        inputSplit.value = currentVal;
      } else {
        inputSplit.value = rules[0] || 'Household Expense';
      }
    }

    // 3. Payment Methods Dropdown
    if (config.paymentMethods && Array.isArray(config.paymentMethods)) {
      const inputMethod = document.getElementById('inputPaymentMethod');
      if (inputMethod) {
        const currentVal = inputMethod.value;
        inputMethod.innerHTML = config.paymentMethods.map(m => 
          `<option value="${m}">${m}</option>`
        ).join('');
        if (currentVal && config.paymentMethods.includes(currentVal)) {
          inputMethod.value = currentVal;
        }
      }
    }

    // 4. Staff Select in Attendance Suite
    if (config.staff && Array.isArray(config.staff)) {
      const attSelect = document.getElementById('attendanceStaffSelect');
      if (attSelect) {
        const currentVal = attSelect.value;
        attSelect.innerHTML = config.staff.filter(s => s.active !== false).map(s => 
          `<option value="${s.name}">${s.name} (${esc(s.role || s.shortName)})</option>`
        ).join('');
        if (currentVal && config.staff.some(s => s.name === currentVal)) {
          attSelect.value = currentVal;
        }
      }
    }
  }
  window.syncDropdownsWithConfig = syncDropdownsWithConfig;

  // ========================================================
  // RENDER ADMIN VIEW
  // ========================================================

  window.renderAdminView = function () {
    const config = window.masterConfig;
    if (!config) {
      if (typeof window.loadMasterConfig === 'function') {
        window.loadMasterConfig();
      }
      return;
    }

    // 1. Staff Members Table & Mobile Cards
    const staffTbody = document.getElementById('adminStaffTableBody');
    if (staffTbody && config.staff) {
      staffTbody.innerHTML = config.staff.map((s) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100" data-staff-id="${esc(s.id)}">
          <td class="py-2.5 px-3">
            <input type="text" class="staff-edit-name bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-bold text-xs w-full focus:border-indigo-500" value="${esc(s.name)}">
            <p class="staff-err-name field-error"></p>
          </td>
          <td class="py-2.5 px-3">
            <input type="text" class="staff-edit-shortname bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-bold text-xs w-20 focus:border-indigo-500" value="${esc(s.shortName || '')}" placeholder="Short">
          </td>
          <td class="py-2.5 px-3">
            <input type="text" class="staff-edit-role bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs w-full focus:border-indigo-500" value="${esc(s.role || '')}">
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center">
              <span class="text-slate-400 mr-1 font-bold">₹</span>
              <input type="number" step="any" min="0" inputmode="decimal" class="staff-edit-salary bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-24 focus:border-indigo-500" value="${s.baseSalary}">
            </div>
            <p class="staff-err-salary field-error"></p>
          </td>
          <td class="py-2.5 px-3 bg-indigo-50/60 border-x border-indigo-100">
            <div class="flex items-center space-x-1.5">
              <input type="number" min="0" max="31" inputmode="numeric" class="staff-edit-leaves bg-white border-2 border-indigo-400 rounded-lg px-2 py-1 font-black text-xs text-indigo-900 w-16 text-center focus:border-indigo-600 shadow-sm" value="${s.allowedPaidLeaves ?? 4}">
              <span class="text-[10px] text-indigo-700 font-extrabold uppercase">Free Days</span>
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center space-x-1">
              <span class="text-[10px] text-slate-400 font-bold">Day</span>
              <input type="number" min="1" max="31" inputmode="numeric" class="staff-edit-cycleday bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-14 text-center focus:border-indigo-500" value="${s.billingCycleDay || 30}">
            </div>
          </td>
          <td class="py-2.5 px-3">
            <select class="staff-edit-cycletype bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold focus:border-indigo-500">
              <option value="calendar_month" ${s.cycleType === 'calendar_month' ? 'selected' : ''}>Calendar Month</option>
              <option value="custom_cycle" ${s.cycleType === 'custom_cycle' ? 'selected' : ''}>Custom Cycle</option>
            </select>
          </td>
          <td class="py-2.5 px-3 text-center">
            <label class="inline-flex items-center cursor-pointer">
              <input type="checkbox" class="staff-edit-active rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" ${s.active !== false ? 'checked' : ''}>
            </label>
          </td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="adminDeleteStaff(${esc(JSON.stringify(s.id))})" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition" title="Delete staff member" aria-label="Delete staff member">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </td>
        </tr>
      `).join('');
    }

    const staffMobile = document.getElementById('adminStaffMobileList');
    if (staffMobile && config.staff) {
      staffMobile.innerHTML = config.staff.map((s) => `
        <div class="staff-mobile-card p-3.5 bg-white border border-slate-200 rounded-2xl space-y-2.5 shadow-2xs" data-staff-id="${esc(s.id)}">
          <div class="flex items-center justify-between gap-2">
            <input type="text" class="staff-edit-name bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-xs flex-1 min-w-0 focus:bg-white focus:border-indigo-500" value="${esc(s.name)}" placeholder="Staff Name">
            <button onclick="adminDeleteStaff(${esc(JSON.stringify(s.id))})" class="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center" title="Delete staff member" aria-label="Delete staff member">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
          <p class="staff-err-name field-error"></p>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Short Name</label>
              <input type="text" class="staff-edit-shortname bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-xs w-full focus:bg-white focus:border-indigo-500" value="${esc(s.shortName || '')}" placeholder="e.g. AS">
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Role</label>
              <input type="text" class="staff-edit-role bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-xs w-full focus:bg-white focus:border-indigo-500" value="${esc(s.role || '')}" placeholder="Role">
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Base Salary (₹)</label>
              <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
                <span class="text-slate-400 mr-1 font-bold text-xs">₹</span>
                <input type="number" step="any" min="0" inputmode="decimal" class="staff-edit-salary bg-transparent font-black text-xs w-full focus:outline-none" value="${s.baseSalary}">
              </div>
              <p class="staff-err-salary field-error"></p>
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-indigo-600 mb-0.5">Allowed Leaves</label>
              <input type="number" min="0" max="31" inputmode="numeric" class="staff-edit-leaves bg-indigo-50 border border-indigo-200 rounded-xl px-2 py-1 font-black text-xs text-indigo-900 w-full text-center" value="${s.allowedPaidLeaves ?? 4}">
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Payday</label>
              <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
                <span class="text-[10px] text-slate-400 font-bold mr-1">Day</span>
                <input type="number" min="1" max="31" inputmode="numeric" class="staff-edit-cycleday bg-transparent font-black text-xs w-full focus:outline-none" value="${s.billingCycleDay || 30}">
              </div>
            </div>
          </div>
          <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
            <select class="staff-edit-cycletype bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold">
              <option value="calendar_month" ${s.cycleType === 'calendar_month' ? 'selected' : ''}>Calendar Month</option>
              <option value="custom_cycle" ${s.cycleType === 'custom_cycle' ? 'selected' : ''}>Custom Cycle</option>
            </select>
            <label class="inline-flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-700">
              <input type="checkbox" class="staff-edit-active rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" ${s.active !== false ? 'checked' : ''}>
              <span>Active</span>
            </label>
          </div>
        </div>
      `).join('');
    }

    // 2. Recurring Bills Table & Mobile Cards
    const billsTbody = document.getElementById('adminBillsTableBody');
    if (billsTbody && config.recurringBills) {
      billsTbody.innerHTML = config.recurringBills.map((b) => {
        const billAmt = Number(b.approxAmount !== undefined && b.approxAmount !== null ? b.approxAmount : (b.budgetedAmount !== undefined ? b.budgetedAmount : 0)) || 0;
        return `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100" data-bill-id="${esc(b.id)}">
          <td class="py-2.5 px-3">
            <input type="text" class="bill-edit-icon bg-white border border-slate-200 rounded-lg px-1.5 py-1 text-xs w-10 text-center font-bold" value="${esc(b.icon || '⚡')}">
          </td>
          <td class="py-2.5 px-3">
            <input type="text" class="bill-edit-name bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-bold text-xs w-full focus:border-indigo-500" value="${esc(b.name)}">
            <p class="bill-err-name field-error"></p>
          </td>
          <td class="py-2.5 px-3">
            <select class="bill-edit-cat bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold focus:border-indigo-500 w-full">
              ${(config.categories || []).map(c => `
                <option value="${esc(c.name)}" ${c.name === b.category ? 'selected' : ''}>${esc(c.name)}</option>
              `).join('')}
            </select>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center space-x-1">
              <span class="text-[10px] text-slate-400 font-bold">Day</span>
              <input type="number" min="1" max="31" inputmode="numeric" class="bill-edit-dueday bg-white border-2 border-indigo-200 rounded-lg px-2 py-1 font-black text-xs text-indigo-700 w-16 text-center focus:border-indigo-500" value="${b.dueDay}">
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center">
              <span class="text-slate-400 mr-1 font-bold">₹</span>
              <input type="number" step="any" min="0" inputmode="decimal" class="bill-edit-amount bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-28 focus:border-indigo-500" value="${billAmt}">
            </div>
            <p class="bill-err-amount field-error"></p>
          </td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="adminDeleteBill(${esc(JSON.stringify(b.id))})" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition" title="Delete bill" aria-label="Delete bill">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </td>
        </tr>
      `;
      }).join('');
    }

    const billsMobile = document.getElementById('adminBillsMobileList');
    if (billsMobile && config.recurringBills) {
      billsMobile.innerHTML = config.recurringBills.map((b) => {
        const billAmt = Number(b.approxAmount !== undefined && b.approxAmount !== null ? b.approxAmount : (b.budgetedAmount !== undefined ? b.budgetedAmount : 0)) || 0;
        return `
        <div class="bill-mobile-card p-3.5 bg-white border border-slate-200 rounded-2xl space-y-2.5 shadow-2xs" data-bill-id="${esc(b.id)}">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-1 min-w-0">
              <input type="text" class="bill-edit-icon bg-slate-50 border border-slate-200 rounded-xl px-1 py-1 text-center font-bold text-base w-9 shrink-0" value="${esc(b.icon || '⚡')}">
              <input type="text" class="bill-edit-name bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-bold text-xs flex-1 min-w-0 focus:bg-white focus:border-indigo-500" value="${esc(b.name)}" placeholder="Bill Name">
            </div>
            <button onclick="adminDeleteBill(${esc(JSON.stringify(b.id))})" class="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-xl transition shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center" title="Delete bill" aria-label="Delete bill">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="col-span-2">
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Category</label>
              <select class="bill-edit-cat bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-semibold focus:bg-white focus:border-indigo-500 w-full">
                ${(config.categories || []).map(c => `
                  <option value="${esc(c.name)}" ${c.name === b.category ? 'selected' : ''}>${esc(c.name)}</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Due Day</label>
              <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
                <span class="text-[10px] text-slate-400 font-bold mr-1">Day</span>
                <input type="number" min="1" max="31" inputmode="numeric" class="bill-edit-dueday bg-transparent font-black text-xs text-indigo-700 w-full focus:outline-none" value="${b.dueDay}">
              </div>
            </div>
            <div>
              <label class="block text-[10px] font-black uppercase text-slate-400 mb-0.5">Approx Amount (₹)</label>
              <div class="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
                <span class="text-slate-400 mr-1 font-bold text-xs">₹</span>
                <input type="number" step="any" min="0" inputmode="decimal" class="bill-edit-amount bg-transparent font-black text-xs w-full focus:outline-none" value="${billAmt}">
              </div>
              <p class="bill-err-amount field-error"></p>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    // 3. Categories Grid
    const catGrid = document.getElementById('adminCategoriesGrid');
    if (catGrid) {
      const cats = (config && Array.isArray(config.categories)) ? config.categories : [];
      if (cats.length === 0) {
        catGrid.innerHTML = `
          <div class="col-span-full py-8 text-center text-slate-400 font-semibold text-xs bg-slate-50 rounded-2xl border border-dashed border-slate-200">
            No categories defined for this household yet. Click "+ Add Category" to create one.
          </div>
        `;
      } else {
        catGrid.innerHTML = cats.map((c) => {
          const jsName = esc(JSON.stringify(c.name || ''));
          return `
            <div class="p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-slate-300 shadow-sm transition" data-cat-name="${esc(c.name || '')}">
              <div class="flex items-center space-x-2.5 min-w-0">
                <span class="text-xl shrink-0">${esc(c.icon || '🏷️')}</span>
                <div class="min-w-0">
                  <div class="text-xs font-black text-slate-900 truncate">${esc(c.name || '')}</div>
                  <div class="text-[10px] text-slate-500 flex items-center gap-1.5">
                    <span class="px-1.5 py-0.2 rounded font-extrabold uppercase text-[9px] ${c.type === 'income' ? 'bg-emerald-100 text-emerald-800' : (c.type === 'transfer' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700')}">${esc(c.type || 'expense')}</span>
                    ${c.defaultPaidTo ? `<span class="truncate text-slate-400">→ ${esc(c.defaultPaidTo)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button onclick="adminEditCategory(${jsName})" class="cat-edit-btn p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg transition" title="Edit category" aria-label="Edit category ${esc(c.name || '')}">
                  <i class="fa-solid fa-pen text-xs"></i>
                </button>
                <button onclick="adminDeleteCategory(${jsName})" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition" title="Delete category" aria-label="Delete category ${esc(c.name || '')}">
                  <i class="fa-solid fa-xmark text-xs"></i>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // 4. Family Members ("Paid By")
    const famList = document.getElementById('adminFamilyMembersList');
    if (famList && config.familyMembers) {
      famList.innerHTML = config.familyMembers.map(m => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-violet-50 text-violet-800 border border-violet-200 shadow-sm">
          <i class="fa-solid fa-user text-violet-500 mr-1.5 text-[10px]"></i>
          <span>${esc(m)}</span>
          <button onclick="adminRenameEntity('familyMember', ${esc(JSON.stringify(m))})" class="ml-2 text-violet-400 hover:text-indigo-600 transition" title="Rename" aria-label="Rename ${esc(m)}"><i class="fa-solid fa-pen text-[10px]"></i></button>
          <button onclick="adminRemoveFamilyMember(${esc(JSON.stringify(m))})" class="ml-1.5 text-violet-400 hover:text-rose-600 transition font-black" title="Remove" aria-label="Remove ${esc(m)}">&times;</button>
        </span>
      `).join('');
    }

    // 5. Payment Methods
    const payList = document.getElementById('adminPaymentMethodsList');
    if (payList && config.paymentMethods) {
      payList.innerHTML = config.paymentMethods.map(m => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-50 text-sky-800 border border-sky-200 shadow-sm">
          <i class="fa-solid fa-credit-card text-sky-500 mr-1.5 text-[10px]"></i>
          <span>${esc(m)}</span>
          <button onclick="adminRenameEntity('paymentMethod', ${esc(JSON.stringify(m))})" class="ml-2 text-sky-400 hover:text-indigo-600 transition" title="Rename" aria-label="Rename ${esc(m)}"><i class="fa-solid fa-pen text-[10px]"></i></button>
          <button onclick="adminRemovePaymentMethod(${esc(JSON.stringify(m))})" class="ml-1.5 text-sky-400 hover:text-rose-600 transition font-black" title="Remove" aria-label="Remove ${esc(m)}">&times;</button>
        </span>
      `).join('');
    }

    // 5b. Split & Allocation Rules ("Split Dropdown")
    const splitList = document.getElementById('adminSplitRulesList');
    if (splitList && config.splitRules) {
      splitList.innerHTML = config.splitRules.map(r => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200 shadow-sm">
          <i class="fa-solid fa-arrows-split-up-and-left text-purple-500 mr-1.5 text-[10px]"></i>
          <span>${esc(r)}</span>
          <button onclick="adminRenameEntity('splitRule', ${esc(JSON.stringify(r))})" class="ml-2 text-purple-400 hover:text-indigo-600 transition" title="Rename" aria-label="Rename ${esc(r)}"><i class="fa-solid fa-pen text-[10px]"></i></button>
          <button onclick="adminRemoveSplitRule(${esc(JSON.stringify(r))})" class="ml-1.5 text-purple-400 hover:text-rose-600 transition font-black" title="Remove" aria-label="Remove ${esc(r)}">&times;</button>
        </span>
      `).join('');
    }

    // 5c. Monthly Budget Limit
    const budgetInput = document.getElementById('adminMonthlyBudgetLimit');
    if (budgetInput && config.monthlyBudgetLimit !== undefined) {
      budgetInput.value = config.monthlyBudgetLimit;
    }

    // 6. Household Cycle Window Settings
    const isCustom = config.householdCycle && config.householdCycle.type === 'custom';
    const radCal = document.getElementById('adminCycleTypeCalendar');
    const radCus = document.getElementById('adminCycleTypeCustom');
    const customInputs = document.getElementById('adminCustomCycleInputs');
    const startDayInput = document.getElementById('adminCycleStartDay');
    const endDayInput = document.getElementById('adminCycleEndDay');

    if (radCal && radCus) {
      if (isCustom) {
        radCus.checked = true;
        if (customInputs) customInputs.classList.remove('hidden');
      } else {
        radCal.checked = true;
        if (customInputs) customInputs.classList.add('hidden');
      }
    }

    if (startDayInput && config.householdCycle) {
      startDayInput.value = config.householdCycle.cycleStartDay || 5;
    }
    if (endDayInput && config.householdCycle) {
      endDayInput.value = config.householdCycle.cycleEndDay || 5;
    }
  };

  // ========================================================
  // ADMIN SAVE & UPDATE ACTIONS
  // ========================================================

  // --- form reading helpers -------------------------------------------------
  // These deliberately return null for "the user left it blank" instead of
  // substituting a plausible-looking default. A silent `|| 0` or `|| 30` writes
  // a number nobody chose straight into the household's records.


  function indexById(list) {
    const out = {};
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (item && item.id != null) out[item.id] = item;
    });
    return out;
  }

  function fieldOf(scope, selector) {
    if (!scope) return null;
    return scope === document ? document.querySelector(selector) : scope.querySelector(selector);
  }

  function readText(scope, selector, fallback) {
    const el = fieldOf(scope, selector);
    if (!el) return fallback === undefined ? '' : (fallback || '');
    return String(el.value == null ? '' : el.value).trim();
  }

  function readNumber(scope, selector, fallback) {
    const el = fieldOf(scope, selector);
    if (!el) return fallback === undefined ? null : fallback;
    const raw = String(el.value == null ? '' : el.value).trim();
    if (raw === '') return null;                       // blank is blank, not zero
    const n = Number(raw.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function readInt(scope, selector, fallback) {
    const n = readNumber(scope, selector, fallback);
    if (n === null) return null;
    return Number.isInteger(n) ? n : Math.trunc(n);
  }

  function clearFieldErrors() {
    document.querySelectorAll('.field-error').forEach((p) => {
      p.textContent = '';
      p.classList.remove('is-visible');
    });
    document.querySelectorAll('.has-field-error').forEach((el) => el.classList.remove('has-field-error'));
  }

  function fieldError(scope, selector, message) {
    const slot = fieldOf(scope, selector);
    if (slot) {
      slot.textContent = message;
      slot.classList.add('is-visible');
      const row = slot.closest('tr, .staff-mobile-card, .bill-mobile-card, div');
      if (row) row.classList.add('has-field-error');
    }
    return message;
  }

  // ========================================================
  // RENAME / EDIT FOR CATEGORIES, MEMBERS, METHODS, SPLIT RULES
  // Previously these could only be added and deleted. Renaming one has to
  // carry the existing expenses with it, so the server does the cascade and
  // tells us how much history is affected before anything moves.
  // ========================================================

  const ENTITY_LABEL = {
    category: 'Category',
    familyMember: 'Family Member',
    paymentMethod: 'Payment Method',
    splitRule: 'Split Rule'
  };

  async function configRequest(body) {
    const activeHId = (typeof getActiveHouseholdId === 'function')
      ? getActiveHouseholdId()
      : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');
    const res = await fetch(`/api/config?householdId=${encodeURIComponent(activeHId)}`, {
      method: 'POST',
      headers: getAdvanceAuthHeaders({ 'Cache-Control': 'no-cache, no-store, must-revalidate' }),
      cache: 'no-store',
      body: JSON.stringify({ ...body, householdId: activeHId })
    });
    let json = {};
    try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  async function entityUsageCount(entity, name) {
    try {
      const activeHId = (typeof getActiveHouseholdId === 'function')
        ? getActiveHouseholdId()
        : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');
      const res = await fetch(
        `/api/config?action=usage&entity=${encodeURIComponent(entity)}` +
        `&name=${encodeURIComponent(name)}&householdId=${encodeURIComponent(activeHId)}&_t=${Date.now()}`,
        { headers: getAdvanceAuthHeaders(), cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      return typeof json.count === 'number' ? json.count : null;
    } catch (e) {
      return null;
    }
  }

  function applyConfigResponse(json) {
    if (!json || !json.data) return;
    window.masterConfig = json.data;
    if (window.updateGlobalsFromConfig) window.updateGlobalsFromConfig(json.data);
    syncDropdownsWithConfig();
    if (window.renderAdminView) window.renderAdminView();
    if (window.renderAllViews) window.renderAllViews();
  }

  // Ask before a delete, and say how much history it affects. Deleting a
  // category or member that expenses still refer to leaves those records
  // pointing at something that no longer exists, so the count has to be in
  // front of the owner before they decide.
  async function confirmDeleteWithUsage(entity, name, whatItIs) {
    const count = await entityUsageCount(entity, name);
    if (count === null) {
      return window.confirm(
        `Remove ${whatItIs} "${name}"?\n\n` +
        `The number of expenses using it could not be checked, so some records ` +
        `may still refer to it.`);
    }
    if (count === 0) {
      return window.confirm(`Remove ${whatItIs} "${name}"?\n\nNo expenses use it.`);
    }
    return window.confirm(
      `"${name}" is used by ${count} expense${count === 1 ? '' : 's'}.\n\n` +
      `Removing it from Master Settings keeps ${count === 1 ? 'that record' : 'those records'} ` +
      `and ${count === 1 ? 'its' : 'their'} history intact, but ${count === 1 ? 'it' : 'they'} ` +
      `will refer to a value that is no longer in the list.\n\n` +
      `To keep everything consistent, cancel and rename it instead.\n\nRemove anyway?`);
  }

  // Rename one of the simple string lists, or a category's name.
  window.adminRenameEntity = async function (entity, currentName) {
    const label = ENTITY_LABEL[entity] || 'Item';
    const next = window.prompt(`Rename ${label}\n\nCurrent name: ${currentName}`, currentName);
    if (next === null) return false;                 // cancelled
    const to = String(next).trim();
    if (!to) {
      if (window.showToast) window.showToast('error', 'Name required', `A ${label.toLowerCase()} needs a name.`);
      return false;
    }
    if (to === currentName) return false;            // nothing to do

    const affected = await entityUsageCount(entity, currentName);
    if (affected && affected > 0) {
      const ok = window.confirm(
        `"${currentName}" is used by ${affected} expense${affected === 1 ? '' : 's'}.\n\n` +
        `Renaming it to "${to}" will update ${affected === 1 ? 'that record' : 'all of them'} so no history is orphaned.\n\nContinue?`);
      if (!ok) return false;
    }

    const { status, json } = await configRequest({
      action: 'rename_entity', entity, from: currentName, to, cascade: true
    });

    if (status === 200 && json.success) {
      applyConfigResponse(json);
      if (window.showToast) {
        window.showToast('success', `${label} renamed`,
          json.updatedExpenses
            ? `"${currentName}" is now "${to}". ${json.updatedExpenses} expense${json.updatedExpenses === 1 ? '' : 's'} updated.`
            : `"${currentName}" is now "${to}".`);
      }
      return true;
    }

    if (window.showToast) {
      window.showToast('error', 'Rename failed',
        json.error || `Could not rename this ${label.toLowerCase()}.`);
    }
    return false;
  };

  // Categories carry more than a name, so they get their own small editor.
  window.adminEditCategory = async function (categoryName) {
    const config = window.masterConfig || {};
    const cat = (config.categories || []).find(c => c.name === categoryName);
    if (!cat) {
      if (window.showToast) window.showToast('error', 'Not found', 'That category no longer exists.');
      return false;
    }

    const modal = document.getElementById('adminEditCategoryModal');
    if (!modal) {
      // No modal in the DOM: fall back to a plain rename so the action still works.
      return window.adminRenameEntity('category', categoryName);
    }

    modal.dataset.originalName = categoryName;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('editCategoryName', cat.name);
    set('editCategoryIcon', cat.icon || '🏷️');
    set('editCategoryType', cat.type || 'expense');
    set('editCategoryDefaultPaidTo', cat.defaultPaidTo || '');
    const errSlot = document.getElementById('editCategoryError');
    if (errSlot) { errSlot.textContent = ''; errSlot.classList.remove('is-visible'); }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    return true;
  };

  window.closeAdminEditCategoryModal = function () {
    const modal = document.getElementById('adminEditCategoryModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
  };

  window.submitAdminEditCategory = async function () {
    const modal = document.getElementById('adminEditCategoryModal');
    if (!modal) return false;
    const originalName = modal.dataset.originalName || '';
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const newName = val('editCategoryName');
    const errSlot = document.getElementById('editCategoryError');
    const showErr = (m) => {
      if (errSlot) { errSlot.textContent = m; errSlot.classList.add('is-visible'); }
      else if (window.showToast) window.showToast('error', 'Cannot save', m);
    };
    if (errSlot) { errSlot.textContent = ''; errSlot.classList.remove('is-visible'); }

    if (!newName) return showErr('Category name is required.'), false;

    const btn = document.getElementById('btnSubmitEditCategory');
    if (btn) btn.dataset.busy = '1';
    try {
      // 1. Rename first, so history moves with the name.
      if (newName !== originalName) {
        const affected = await entityUsageCount('category', originalName);
        if (affected && affected > 0) {
          const ok = window.confirm(
            `"${originalName}" is used by ${affected} expense${affected === 1 ? '' : 's'}.\n\n` +
            `Renaming to "${newName}" will update ${affected === 1 ? 'that record' : 'all of them'}.\n\nContinue?`);
          if (!ok) return false;
        }
        const r = await configRequest({
          action: 'rename_entity', entity: 'category',
          from: originalName, to: newName, cascade: true
        });
        if (r.status !== 200 || !r.json.success) {
          showErr(r.json.error || 'Could not rename the category.');
          return false;
        }
        applyConfigResponse(r.json);
      }

      // 2. Then the other attributes, on the (possibly new) name.
      const config = window.masterConfig || {};
      const cats = (config.categories || []).map(c =>
        c.name === newName
          ? {
              ...c,
              icon: val('editCategoryIcon') || c.icon || '🏷️',
              type: val('editCategoryType') || c.type || 'expense',
              defaultPaidTo: val('editCategoryDefaultPaidTo')
            }
          : c);
      const r2 = await configRequest({ categories: cats });
      if (r2.status !== 200 || !r2.json.success) {
        showErr(r2.json.error || 'Category renamed, but the other details could not be saved.');
        return false;
      }
      applyConfigResponse(r2.json);

      // 3. Read back and confirm before claiming success.
      const check = (window.masterConfig.categories || []).find(c => c.name === newName);
      if (!check) {
        showErr('The server did not store the category under that name.');
        return false;
      }
      const wantIcon = val('editCategoryIcon') || '🏷️';
      const wantType = val('editCategoryType') || 'expense';
      const wantPaidTo = val('editCategoryDefaultPaidTo');
      if (check.icon !== wantIcon || check.type !== wantType || (check.defaultPaidTo || '') !== wantPaidTo) {
        showErr('Saved values do not match what you entered. Please check and try again.');
        return false;
      }

      window.closeAdminEditCategoryModal();
      if (window.showToast) window.showToast('success', 'Category saved', `"${newName}" updated and verified.`);
      return true;
    } finally {
      if (btn) delete btn.dataset.busy;
    }
  };

  // --- unsaved-changes guard (C5) -------------------------------------------
  // Staff and bill edits are typed into rows and only persisted by the one
  // global Save. On a phone it is very easy to tap away and lose them silently,
  // so track dirtiness and warn before the edits can disappear.
  window.adminFormDirty = false;

  const ADMIN_EDIT_SELECTOR =
    '.staff-edit-name, .staff-edit-shortname, .staff-edit-role, .staff-edit-salary, ' +
    '.staff-edit-leaves, .staff-edit-cycleday, .staff-edit-cycletype, .staff-edit-active, ' +
    '.bill-edit-icon, .bill-edit-name, .bill-edit-cat, .bill-edit-dueday, .bill-edit-amount, ' +
    '#adminMonthlyBudgetLimit, #adminCycleStartDay, #adminCycleEndDay, ' +
    '#adminCycleTypeCustom, #adminCycleTypeCalendar';

  function markAdminDirty(e) {
    if (e.target && e.target.closest && e.target.closest(ADMIN_EDIT_SELECTOR)) {
      window.adminFormDirty = true;
      const banner = document.getElementById('adminUnsavedBanner');
      if (banner) banner.classList.remove('hidden');
    }
  }
  document.addEventListener('input', markAdminDirty, true);
  document.addEventListener('change', markAdminDirty, true);

  window.adminHasUnsavedChanges = () => window.adminFormDirty === true;

  window.addEventListener('beforeunload', (e) => {
    if (window.adminFormDirty) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });

  // Leaving the admin tab with edits pending is the common way to lose them.
  (function guardTabSwitch() {
    const original = window.switchTab;
    if (typeof original !== 'function') return;
    window.switchTab = function (tab, ...rest) {
      if (window.adminFormDirty && tab !== 'admin') {
        const leave = window.confirm(
          'You have unsaved master-settings changes.\n\nLeave this tab and discard them?'
        );
        if (!leave) return;
        window.adminFormDirty = false;
        const banner = document.getElementById('adminUnsavedBanner');
        if (banner) banner.classList.add('hidden');
      }
      return original.call(this, tab, ...rest);
    };
  })();

  window.saveAdminConfigFromUI = async function () {
    const config = window.masterConfig || {};

    // 1. Gather Staff Data (Check mobile cards first if on mobile, else table rows)
    const mobileStaffCards = document.querySelectorAll('#adminStaffMobileList .staff-mobile-card');
    const staffElements = (window.innerWidth < 768 && mobileStaffCards.length > 0)
      ? mobileStaffCards
      : document.querySelectorAll('#adminStaffTableBody tr');

    clearFieldErrors();
    const errors = [];
    const existingStaffById = indexById(config.staff);

    const updatedStaff = [];
    staffElements.forEach((el, index) => {
      const id = el.dataset.staffId || `staff-${index + 1}`;
      // Start from the stored record so properties without an input on screen
      // (shortName, and anything added later) survive the save. Rebuilding the
      // object from the visible inputs silently deleted them.
      const existing = existingStaffById[id] || {};

      const name = readText(el, '.staff-edit-name', existing.name);
      const shortName = readText(el, '.staff-edit-shortname', existing.shortName);
      const role = readText(el, '.staff-edit-role', existing.role);
      const salary = readNumber(el, '.staff-edit-salary', existing.baseSalary);
      const leaves = readInt(el, '.staff-edit-leaves', existing.allowedPaidLeaves);
      const cycleDay = readInt(el, '.staff-edit-cycleday', existing.billingCycleDay);
      const cycleType = el.querySelector('.staff-edit-cycletype')?.value || existing.cycleType || 'calendar_month';
      const activeEl = el.querySelector('.staff-edit-active');
      const active = activeEl ? activeEl.checked : (existing.active !== false);

      // Validate. Never invent a value the owner did not type.
      if (!name) {
        errors.push(fieldError(el, '.staff-err-name', 'Staff name is required.'));
      }
      if (salary === null || !Number.isFinite(salary) || salary < 0) {
        errors.push(fieldError(el, '.staff-err-salary', 'Enter a salary of 0 or more.'));
      }
      if (leaves !== null && (!Number.isInteger(leaves) || leaves < 0 || leaves > 31)) {
        errors.push(fieldError(el, '.staff-err-name', 'Allowed leaves must be between 0 and 31.'));
      }
      if (cycleDay !== null && (!Number.isInteger(cycleDay) || cycleDay < 1 || cycleDay > 31)) {
        errors.push(fieldError(el, '.staff-err-name', 'Payday must be a day between 1 and 31.'));
      }

      updatedStaff.push({
        ...existing,
        id,
        name,
        // An empty short name means "same as name" for display, but we store the
        // owner's choice as typed rather than overwriting it with the full name.
        shortName: shortName || existing.shortName || '',
        role,
        baseSalary: salary,
        allowedPaidLeaves: leaves,
        billingCycleDay: cycleDay,
        cycleType,
        active
      });
    });

    // 2. Gather Recurring Bills Data (Check mobile cards first if on mobile, else table rows)
    const mobileBillCards = document.querySelectorAll('#adminBillsMobileList .bill-mobile-card');
    const billElements = (window.innerWidth < 768 && mobileBillCards.length > 0)
      ? mobileBillCards
      : document.querySelectorAll('#adminBillsTableBody tr');

    const existingBillsById = indexById(config.recurringBills);

    const updatedBills = [];
    billElements.forEach((el, index) => {
      const id = el.dataset.billId || `bill-${index + 1}`;
      const existing = existingBillsById[id] || {};

      const icon = readText(el, '.bill-edit-icon', existing.icon) || existing.icon || '⚡';
      const name = readText(el, '.bill-edit-name', existing.name);
      const category = el.querySelector('.bill-edit-cat')?.value || existing.category || '';
      const dueDay = readInt(el, '.bill-edit-dueday', existing.dueDay);
      const approxAmount = readNumber(el, '.bill-edit-amount', existing.approxAmount);

      if (!name) {
        errors.push(fieldError(el, '.bill-err-name', 'Bill name is required.'));
      }
      if (approxAmount === null || !Number.isFinite(approxAmount) || approxAmount < 0) {
        errors.push(fieldError(el, '.bill-err-amount', 'Enter an amount of 0 or more.'));
      }
      if (dueDay === null || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        errors.push(fieldError(el, '.bill-err-name', 'Due day must be a day between 1 and 31.'));
      }

      updatedBills.push({
        ...existing,
        id,
        name,
        category,
        dueDay,
        approxAmount: approxAmount,
        budgetedAmount: approxAmount,
        icon
      });
    });

    // 3. Gather Household Cycle
    const isCustom = document.getElementById('adminCycleTypeCustom')?.checked;
    const prevCycle = config.householdCycle || {};
    const startDay = readInt(document, '#adminCycleStartDay', prevCycle.cycleStartDay);
    const endDay = readInt(document, '#adminCycleEndDay', prevCycle.cycleEndDay);

    if (startDay === null || !Number.isInteger(startDay) || startDay < 1 || startDay > 31) {
      errors.push(fieldError(document, '#adminCycleStartDayError', 'Cycle start day must be between 1 and 31.'));
    }
    if (endDay === null || !Number.isInteger(endDay) || endDay < 1 || endDay > 31) {
      errors.push(fieldError(document, '#adminCycleEndDayError', 'Cycle end day must be between 1 and 31.'));
    }

    const updatedCycle = {
      ...prevCycle,
      type: isCustom ? 'custom' : 'calendar',
      cycleStartDay: startDay,
      cycleEndDay: endDay,
      description: isCustom ? `${startDay}th of current month to ${endDay}th of next month` : 'Standard Calendar Month (1st to month end)'
    };

    // 4. Gather Monthly Budget Target
    const monthlyBudgetLimit = readNumber(document, '#adminMonthlyBudgetLimit', config.monthlyBudgetLimit);
    if (monthlyBudgetLimit === null || !Number.isFinite(monthlyBudgetLimit) || monthlyBudgetLimit < 0) {
      errors.push(fieldError(document, '#adminMonthlyBudgetLimitError', 'Enter a monthly budget of 0 or more.'));
    }

    // Block the save rather than persisting invented values.
    if (errors.length) {
      if (window.showToast) {
        window.showToast('error', 'Nothing saved',
          `${errors.length} field${errors.length === 1 ? '' : 's'} need${errors.length === 1 ? 's' : ''} attention. Your changes are still on screen.`);
      }
      const firstBad = document.querySelector('.field-error.is-visible');
      if (firstBad && firstBad.scrollIntoView) {
        firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return false;
    }

    const payload = {
      ...config,
      staff: updatedStaff,
      recurringBills: updatedBills,
      householdCycle: updatedCycle,
      monthlyBudgetLimit: monthlyBudgetLimit,
      splitRules: config.splitRules || [
        "Household Expense (Palash Reimburses Pallavi 100%)",
        "Personal Expense (Pallavi - Not Reimbursed)",
        "Personal Expense (Palash)",
        "Equal (50/50)"
      ]
    };

    // Busy state: the owner must be able to see the save is in flight, and a
    // double tap must not fire a second write.
    const saveButtons = [
      document.getElementById('btnSaveAdminConfig'),
      document.getElementById('btnSaveAdminConfigMobile')
    ].filter(Boolean);
    saveButtons.forEach((b) => {
      b.dataset.busy = '1';
      b.dataset.prevHtml = b.innerHTML;
      b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Saving...</span>';
    });

    let ok = false;
    try {
      ok = await saveMasterConfig(payload);
    } finally {
      saveButtons.forEach((b) => {
        delete b.dataset.busy;
        if (b.dataset.prevHtml) b.innerHTML = b.dataset.prevHtml;
        delete b.dataset.prevHtml;
      });
    }

    if (ok) {
      window.adminFormDirty = false;
      const banner = document.getElementById('adminUnsavedBanner');
      if (banner) banner.classList.add('hidden');
    }
    return ok;
  };

  window.adminSaveBudget = async function () {
    const budgetInput = document.getElementById('adminMonthlyBudgetLimit');
    const rawVal = budgetInput ? budgetInput.value : '';
    const cleanBudget = parseFloat(String(rawVal || '').replace(/[^0-9.]/g, ''));
    if (isNaN(cleanBudget) || cleanBudget <= 0) {
      if (window.showToast) window.showToast('error', 'Invalid Budget', 'Please enter a valid positive budget amount.');
      return;
    }

    // Immediately persist in memory, globals and localStorage for future reference
    if (window.masterConfig) window.masterConfig.monthlyBudgetLimit = cleanBudget;
    if (window.updateGlobalsFromConfig) window.updateGlobalsFromConfig({ monthlyBudgetLimit: cleanBudget });
    const activeHId = (typeof getActiveHouseholdId === 'function') 
      ? getActiveHouseholdId() 
      : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');
    try {
      localStorage.setItem(`household_budget_limit_${activeHId}`, String(cleanBudget));
      localStorage.setItem('household_monthly_budget_limit', String(cleanBudget));
    } catch (e) {}

    if (window.renderAllViews) window.renderAllViews();
    if (window.renderAdminView) window.renderAdminView();

    const success = await saveMasterConfig({ monthlyBudgetLimit: cleanBudget });
    if (success && window.showToast) {
      window.showToast('success', 'Budget Saved', `Monthly budget updated to ₹${cleanBudget.toLocaleString('en-IN')}`);
    }
  };

  window.adminAddSplitRule = async function () {
    const input = document.getElementById('adminNewSplitRuleInput');
    const val = input ? input.value.trim() : '';
    if (!val) return;
    const config = window.masterConfig || {};
    const current = config.splitRules || [
      "Household Expense (Palash Reimburses Pallavi 100%)",
      "Personal Expense (Pallavi - Not Reimbursed)",
      "Personal Expense (Palash)",
      "Equal (50/50)"
    ];
    if (current.includes(val)) {
      if (window.showToast) window.showToast('info', 'Already Exists', 'This split rule is already in the list.');
      return;
    }
    const updated = [...current, val];
    config.splitRules = updated;
    if (input) input.value = '';
    await saveMasterConfig({ splitRules: updated });
  };

  window.adminRemoveSplitRule = async function (ruleName) {
    if (!await confirmDeleteWithUsage('splitRule', ruleName, 'split rule')) return;
    const config = window.masterConfig || {};
    const current = config.splitRules || [];
    const updated = current.filter(r => r !== ruleName);
    config.splitRules = updated;
    await saveMasterConfig({ splitRules: updated });
  };

  window.resetAdminConfigToDefaults = async function () {
    if (!confirm('Are you sure you want to reset all master configuration settings to application defaults?')) return;
    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          staff: [
            { id: "staff-1", name: "Chef - Nilima Nikose", shortName: "Nilima", role: "Chef / Cook", baseSalary: 4500, allowedPaidLeaves: 4, billingCycleDay: 30, cycleType: "calendar_month", active: true },
            { id: "staff-2", name: "Maid - Madhuri", shortName: "Madhuri", role: "Housemaid", baseSalary: 800, allowedPaidLeaves: 2, billingCycleDay: 21, cycleType: "custom_cycle", cycleStartDay: 21, active: true }
          ],
          categories: [
            { name: "Grocery & Vegetables", icon: "🛒", type: "expense", defaultPaidTo: "Blinkit" },
            { name: "Electricity Bill", icon: "⚡", type: "expense", defaultPaidTo: "MSCB / MSEDCL" },
            { name: "Flat Maintenance", icon: "🏢", type: "expense", defaultPaidTo: "Society Office" },
            { name: "Chef - Nilima Nikose", icon: "👩‍🍳", type: "expense", defaultPaidTo: "Nilima Nikose" },
            { name: "Maid - Madhuri", icon: "🧹", type: "expense", defaultPaidTo: "Madhuri" },
            { name: "Wifi & Internet", icon: "📶", type: "expense", defaultPaidTo: "Airtel" },
            { name: "Dish Bill (DTH)", icon: "📺", type: "expense", defaultPaidTo: "Tata Play" },
            { name: "Shopping & Miscellaneous", icon: "🛍️", type: "expense", defaultPaidTo: "Amazon" },
            { name: "Accepted Payments (Income)", icon: "💰", type: "income", defaultPaidTo: "" },
            { name: "Settlement / Transfer", icon: "🤝", type: "transfer", defaultPaidTo: "Pallavi" }
          ],
          recurringBills: [
            { id: "bill-1", name: "MSCB Electricity Bill", category: "Electricity Bill", dueDay: 10, approxAmount: 2200, icon: "⚡" },
            { id: "bill-2", name: "Society Flat Maintenance", category: "Flat Maintenance", dueDay: 5, approxAmount: 3500, icon: "🏢" },
            { id: "bill-3", name: "Airtel Broadband / Wifi", category: "Wifi & Internet", dueDay: 15, approxAmount: 999, icon: "📶" },
            { id: "bill-4", name: "Tata Play / Dish Bill", category: "Dish Bill (DTH)", dueDay: 20, approxAmount: 450, icon: "📺" },
            { id: "bill-5", name: "Maid - Madhuri Salary", category: "Maid - Madhuri", dueDay: 21, approxAmount: 800, icon: "🧹" },
            { id: "bill-6", name: "Chef - Nilima Salary", category: "Chef - Nilima Nikose", dueDay: 30, approxAmount: 4500, icon: "👩‍🍳" }
          ],
          familyMembers: ["Palash", "Pallavi"],
          monthlyBudgetLimit: 50000,
          splitRules: [
            "Household Expense (Palash Reimburses Pallavi 100%)",
            "Personal Expense (Pallavi - Not Reimbursed)",
            "Personal Expense (Palash)",
            "Equal (50/50)"
          ],
          paymentMethods: ["UPI / GPay / PhonePe", "Credit Card", "Net Banking", "Cash"],
          householdCycle: { type: "custom", cycleStartDay: 5, cycleEndDay: 5, description: "5th of current month to 5th of next month" }
        })
      });
      if (res.ok) {
        await loadMasterConfig();
        if (window.showToast) window.showToast('success', 'Reset Completed', 'Master settings restored to system defaults.');
      }
    } catch (e) {
      console.error('Error resetting config:', e);
    }
  };

  // 1. Staff Modals & Actions
  window.openAdminAddStaffModal = function () {
    const modal = document.getElementById('adminAddStaffModal');
    if (modal) modal.classList.remove('hidden');
  };
  window.closeAdminAddStaffModal = function () {
    const modal = document.getElementById('adminAddStaffModal');
    if (modal) modal.classList.add('hidden');
  };
  window.adminSaveNewStaff = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('adminNewStaffName')?.value.trim();
    const shortName = document.getElementById('adminNewStaffShortName')?.value.trim() || name;
    const role = document.getElementById('adminNewStaffRole')?.value.trim() || '';
    const baseSalary = parseFloat(document.getElementById('adminNewStaffSalary')?.value) || 0;
    const allowedPaidLeaves = parseInt(document.getElementById('adminNewStaffLeaves')?.value, 10) || 0;
    const billingCycleDay = parseInt(document.getElementById('adminNewStaffCycleDay')?.value, 10) || 30;
    const cycleType = document.getElementById('adminNewStaffCycleType')?.value || 'calendar_month';

    if (!name) return;

    const newStaff = {
      id: `staff-${Date.now()}`,
      name,
      shortName,
      role,
      baseSalary,
      allowedPaidLeaves,
      billingCycleDay,
      cycleType,
      active: true
    };

    const currentStaff = (window.masterConfig && window.masterConfig.staff) ? [...window.masterConfig.staff] : [];
    currentStaff.push(newStaff);

    await saveMasterConfig({ staff: currentStaff });
    window.closeAdminAddStaffModal();
    const form = document.getElementById('adminAddStaffForm');
    if (form) form.reset();
  };

  window.adminDeleteStaff = async function (staffId) {
    if (!confirm('Are you sure you want to remove this staff member from configuration?')) return;
    const currentStaff = (window.masterConfig && window.masterConfig.staff) ? [...window.masterConfig.staff] : [];
    const filtered = currentStaff.filter(s => s.id !== staffId);
    await saveMasterConfig({ staff: filtered });
  };

  // 2. Bills Modals & Actions
  window.openAdminAddBillModal = function () {
    const modal = document.getElementById('adminAddBillModal');
    if (modal) modal.classList.remove('hidden');
  };
  window.closeAdminAddBillModal = function () {
    const modal = document.getElementById('adminAddBillModal');
    if (modal) modal.classList.add('hidden');
  };
  window.adminSaveNewBill = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('adminNewBillName')?.value.trim();
    const category = document.getElementById('adminNewBillCategory')?.value || 'Electricity Bill';
    const icon = document.getElementById('adminNewBillIcon')?.value.trim() || '⚡';
    const dueDay = parseInt(document.getElementById('adminNewBillDueDay')?.value, 10) || 10;
    const rawAmt = document.getElementById('adminNewBillAmount')?.value;
    const approxAmount = Number(String(rawAmt || '0').replace(/[^0-9.]/g, '')) || 0;

    if (!name) return;

    const newBill = {
      id: `bill-${Date.now()}`,
      name,
      category,
      icon,
      dueDay,
      approxAmount: approxAmount,
      budgetedAmount: approxAmount
    };

    const currentBills = (window.masterConfig && window.masterConfig.recurringBills) ? [...window.masterConfig.recurringBills] : [];
    currentBills.push(newBill);

    await saveMasterConfig({ recurringBills: currentBills });
    window.closeAdminAddBillModal();
    const form = document.getElementById('adminAddBillForm');
    if (form) form.reset();
  };

  window.adminDeleteBill = async function (billId) {
    if (!confirm('Are you sure you want to delete this recurring bill?')) return;
    const currentBills = (window.masterConfig && window.masterConfig.recurringBills) ? [...window.masterConfig.recurringBills] : [];
    const filtered = currentBills.filter(b => b.id !== billId);
    await saveMasterConfig({ recurringBills: filtered });
  };

  // 3. Category Modals & Actions
  // 3. Category Modals & Actions
  window.quickAddCategoryToHousehold = async function (name, icon = '🏷️', type = 'expense', defaultPaidTo = '') {
    const cleanName = String(name || '').trim();
    if (!cleanName) return false;

    if (window.currentSessionUser && window.currentSessionUser.role === 'VIEWER') {
      const msg = 'Viewer role has read-only access and cannot add or edit categories.';
      if (window.showToast) window.showToast('error', 'Access Denied', msg);
      else alert(msg);
      return false;
    }

    // 1. Immediate optimistic addition to in-memory config & DOM
    if (!window.masterConfig) window.masterConfig = {};
    if (!Array.isArray(window.masterConfig.categories)) window.masterConfig.categories = [];
    
    const existingIdx = window.masterConfig.categories.findIndex(c => c.name.toLowerCase() === cleanName.toLowerCase());
    const newCatObj = {
      name: cleanName,
      icon: icon || '🏷️',
      type: type || 'expense',
      defaultPaidTo: defaultPaidTo || ''
    };
    if (existingIdx !== -1) {
      window.masterConfig.categories[existingIdx] = { ...window.masterConfig.categories[existingIdx], ...newCatObj };
    } else {
      window.masterConfig.categories.push(newCatObj);
    }

    // Immediately update globals and dropdowns with the new category pre-selected
    if (window.updateGlobalsFromConfig) window.updateGlobalsFromConfig(window.masterConfig);
    syncDropdownsWithConfig(cleanName);
    if (window.renderAdminView) window.renderAdminView();

    // Directly ensure #inputCategory selects the new category
    const catSelect = document.getElementById('inputCategory');
    if (catSelect) {
      catSelect.value = cleanName;
      if (typeof onCategoryChange === 'function') onCategoryChange();
    }

    // If default payee is provided and paidTo field is empty, autofill it
    if (defaultPaidTo) {
      const paidToInput = document.getElementById('inputPaidTo');
      if (paidToInput && !paidToInput.value.trim()) {
        paidToInput.value = defaultPaidTo;
      }
    }

    try {
      const activeHId = (typeof getActiveHouseholdId === 'function') 
        ? getActiveHouseholdId() 
        : ((window.currentSessionUser && window.currentSessionUser.householdId) || 'H001');

      const headers = getAdvanceAuthHeaders({
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      });

      const res = await fetch(`/api/config?householdId=${encodeURIComponent(activeHId)}`, {
        method: 'POST',
        headers: headers,
        cache: 'no-store',
        body: JSON.stringify({
          action: 'add_category',
          category: newCatObj,
          householdId: activeHId
        })
      });

      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          window.masterConfig = json.data;
          if (window.updateGlobalsFromConfig) window.updateGlobalsFromConfig(json.data);
          syncDropdownsWithConfig(cleanName);
          if (window.renderAdminView) window.renderAdminView();
          
          if (catSelect) {
            catSelect.value = cleanName;
            if (typeof onCategoryChange === 'function') onCategoryChange();
          }
        }
      }
      if (window.showToast) {
        window.showToast('success', 'Category Saved', `"${cleanName}" has been added to Master Settings.`);
      }
      return true;
    } catch (e) {
      console.warn('quickAddCategoryToHousehold network notice:', e);
      if (window.showToast) {
        window.showToast('success', 'Category Saved', `"${cleanName}" has been added to Master Settings.`);
      }
      return true;
    }
  };

  window.promptNewCategoryForExpense = function () {
    const modal = document.getElementById('adminAddCategoryModal');
    if (modal) {
      modal.classList.remove('hidden');
      const nameInput = document.getElementById('adminNewCatName');
      if (nameInput) {
        nameInput.value = '';
        setTimeout(() => nameInput.focus(), 80);
      }
    } else {
      const name = prompt('Enter new category name:');
      if (name && name.trim()) {
        window.quickAddCategoryToHousehold(name.trim());
      } else {
        const catSelect = document.getElementById('inputCategory');
        if (catSelect && catSelect.value === '__NEW_CAT__') {
          const firstCat = (window.masterConfig && window.masterConfig.categories && window.masterConfig.categories[0]) ? window.masterConfig.categories[0].name : '';
          catSelect.value = firstCat;
          if (typeof onCategoryChange === 'function') onCategoryChange();
        }
      }
    }
  };

  window.openAdminAddCategoryModal = function () {
    const modal = document.getElementById('adminAddCategoryModal');
    if (modal) modal.classList.remove('hidden');
    const nameInput = document.getElementById('adminNewCatName');
    if (nameInput) setTimeout(() => nameInput.focus(), 80);
  };

  window.closeAdminAddCategoryModal = function () {
    const modal = document.getElementById('adminAddCategoryModal');
    if (modal) modal.classList.add('hidden');
    const catSelect = document.getElementById('inputCategory');
    if (catSelect && catSelect.value === '__NEW_CAT__') {
      const firstCat = (window.masterConfig && window.masterConfig.categories && window.masterConfig.categories[0]) ? window.masterConfig.categories[0].name : '';
      catSelect.value = firstCat;
      if (typeof onCategoryChange === 'function') onCategoryChange();
    }
  };

  window.adminSaveNewCategory = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('adminNewCatName')?.value.trim();
    const icon = document.getElementById('adminNewCatIcon')?.value.trim() || '🏷️';
    const type = document.getElementById('adminNewCatType')?.value || 'expense';
    const defaultPaidTo = document.getElementById('adminNewCatPayee')?.value.trim() || '';

    if (!name) return;

    const ok = await window.quickAddCategoryToHousehold(name, icon, type, defaultPaidTo);
    if (ok) {
      window.closeAdminAddCategoryModal();
      const form = document.getElementById('adminAddCategoryForm');
      if (form) form.reset();
    }
  };

  window.adminDeleteCategory = async function (catName) {
    if (!await confirmDeleteWithUsage('category', catName, 'the category')) return;
    const currentCats = (window.masterConfig && window.masterConfig.categories) ? [...window.masterConfig.categories] : [];
    const filtered = currentCats.filter(c => c.name !== catName);
    await saveMasterConfig({ categories: filtered });
  };

  // 4. Family Members
  window.adminAddFamilyMember = async function () {
    const input = document.getElementById('adminNewMemberInput');
    const name = input ? input.value.trim() : '';
    if (!name) return;

    const currentMembers = (window.masterConfig && window.masterConfig.familyMembers) ? [...window.masterConfig.familyMembers] : [];
    if (currentMembers.includes(name)) {
      alert('This family member already exists.');
      return;
    }
    currentMembers.push(name);
    await saveMasterConfig({ familyMembers: currentMembers });
    if (input) input.value = '';
  };

  window.adminRemoveFamilyMember = async function (memberName) {
    if (!await confirmDeleteWithUsage('familyMember', memberName, 'family member')) return;
    const currentMembers = (window.masterConfig && window.masterConfig.familyMembers) ? [...window.masterConfig.familyMembers] : [];
    const filtered = currentMembers.filter(m => m !== memberName);
    await saveMasterConfig({ familyMembers: filtered });
  };

  // 5. Payment Methods
  window.adminAddPaymentMethod = async function () {
    const input = document.getElementById('adminNewPaymentMethodInput');
    const method = input ? input.value.trim() : '';
    if (!method) return;

    const currentMethods = (window.masterConfig && window.masterConfig.paymentMethods) ? [...window.masterConfig.paymentMethods] : [];
    if (currentMethods.includes(method)) {
      alert('This payment method already exists.');
      return;
    }
    currentMethods.push(method);
    await saveMasterConfig({ paymentMethods: currentMethods });
    if (input) input.value = '';
  };

  window.adminRemovePaymentMethod = async function (methodName) {
    if (!await confirmDeleteWithUsage('paymentMethod', methodName, 'payment method')) return;
    const currentMethods = (window.masterConfig && window.masterConfig.paymentMethods) ? [...window.masterConfig.paymentMethods] : [];
    const filtered = currentMethods.filter(m => m !== methodName);
    await saveMasterConfig({ paymentMethods: filtered });
  };

  // 6. Cycle Type Radio Change
  window.onAdminCycleTypeChange = function () {
    const isCustom = document.getElementById('adminCycleTypeCustom')?.checked;
    const customInputs = document.getElementById('adminCustomCycleInputs');
    if (customInputs) {
      if (isCustom) customInputs.classList.remove('hidden');
      else customInputs.classList.add('hidden');
    }
  };

  // ========================================================
  // PUBLIC BRIDGES & LIFECYCLE HOOKS
  // ========================================================

  window.renderAdvanceDashboard = function (filtered) {
    window.currentFilteredExpenses = filtered;
    renderDashboardAnomalyBanner(filtered);
    renderSplitwiseMatrix(filtered);
    renderBillsRadar(filtered);
  };

  // ========================================================
  // 9. SYSTEM AUDIT & CHANGE HISTORY CONTROLLER
  // ========================================================
  let inAppAuditLogs = [];
  let inAppAuditFilter = 'ALL';

  async function renderAuditView() {
    const listEl = document.getElementById('inAppAuditList');

    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders({ 'Cache-Control': 'no-cache' }) : { 'Cache-Control': 'no-cache' };
      const res = await fetch(`/api/audit?format=json&_t=${Date.now()}`, {
        cache: 'no-store',
        headers: headers
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          inAppAuditLogs = json.data;
          
          // Update KPI stats
          const totalEl = document.getElementById('inAppAuditTotal');
          const updatesEl = document.getElementById('inAppAuditUpdates');
          const configsEl = document.getElementById('inAppAuditConfigs');
          const mutationsEl = document.getElementById('inAppAuditMutations');
          const navBadge = document.getElementById('navAuditBadge');

          if (totalEl) totalEl.textContent = inAppAuditLogs.length;
          if (navBadge) navBadge.textContent = inAppAuditLogs.length;
          if (updatesEl) updatesEl.textContent = inAppAuditLogs.filter(l => l.action === 'UPDATE_EXPENSE').length;
          if (configsEl) configsEl.textContent = inAppAuditLogs.filter(l => l.action === 'UPDATE_CONFIG').length;
          if (mutationsEl) mutationsEl.textContent = inAppAuditLogs.filter(l => l.action === 'CREATE_EXPENSE' || l.action === 'DELETE_EXPENSE').length;

          // Dynamically populate actor filter dropdown
          const actorSelect = document.getElementById('inAppAuditActorFilter');
          if (actorSelect && inAppAuditLogs && inAppAuditLogs.length > 0) {
            const currentVal = actorSelect.value || 'ALL';
            const actors = new Set();
            inAppAuditLogs.forEach(l => {
              const a = l.actor || l.user || l.metadata?.paidBy;
              if (a && a !== 'System' && a !== 'undefined') actors.add(a);
            });
            let opts = '<option value="ALL">👥 All Actors</option><option value="System">⚡ System Sync</option>';
            Array.from(actors).sort().forEach(act => {
              opts += `<option value="${act}">${act}</option>`;
            });
            actorSelect.innerHTML = opts;
            if (Array.from(actorSelect.options).some(o => o.value === currentVal)) {
              actorSelect.value = currentVal;
            }
          }

          renderInAppAuditList();
        }
      }
    } catch (err) {
      console.warn('Could not load in-app audit logs:', err);
      if (listEl) {
        listEl.innerHTML = `<div class="p-6 text-center text-rose-500 font-bold text-xs">Error loading audit logs: ${err.message}</div>`;
      }
    }
  }
  window.renderAuditView = renderAuditView;

  function escapeAuditHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.setAuditLayoutMode = function(mode) {
    const timelineC = document.getElementById('inAppAuditTimelineContainer');
    const tableC = document.getElementById('inAppAuditTableContainer');
    const btnT = document.getElementById('btnAuditViewTimeline');
    const btnTab = document.getElementById('btnAuditViewTable');
    if (mode === 'table') {
      if (timelineC) timelineC.classList.add('hidden');
      if (tableC) tableC.classList.remove('hidden');
      if (btnTab) {
        btnTab.className = 'px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-black shadow-xs transition flex items-center gap-1';
      }
      if (btnT) {
        btnT.className = 'px-2.5 py-1 rounded-lg text-slate-600 font-bold hover:text-slate-900 transition flex items-center gap-1';
      }
    } else {
      if (timelineC) timelineC.classList.remove('hidden');
      if (tableC) tableC.classList.add('hidden');
      if (btnT) {
        btnT.className = 'px-2.5 py-1 rounded-lg bg-white text-indigo-700 font-black shadow-xs transition flex items-center gap-1';
      }
      if (btnTab) {
        btnTab.className = 'px-2.5 py-1 rounded-lg text-slate-600 font-bold hover:text-slate-900 transition flex items-center gap-1';
      }
    }
  };

  function renderInAppAuditList() {
    const timelineContainer = document.getElementById('inAppAuditTimeline');
    const tbody = document.getElementById('inAppAuditTbody') || document.getElementById('inAppAuditList');
    if (!timelineContainer && !tbody) return;

    const search = (document.getElementById('inAppAuditSearch')?.value || '').toLowerCase().trim();
    const actorFilter = (document.getElementById('inAppAuditActorFilter')?.value || 'ALL').trim();

    const filtered = inAppAuditLogs.filter(item => {
      if (inAppAuditFilter !== 'ALL' && item.action !== inAppAuditFilter) return false;
      
      // Actor filter check
      if (actorFilter !== 'ALL') {
        const itemActor = (item.actor || item.user || item.metadata?.paidBy || '').toLowerCase();
        if (actorFilter === 'System') {
          if (!itemActor.includes('system') && !itemActor.includes('sync') && !itemActor.includes('automation') && item.action !== 'UPDATE_CONFIG') return false;
        } else if (!itemActor.includes(actorFilter.toLowerCase())) {
          return false;
        }
      }

      if (!search) return true;
      return JSON.stringify(item).toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
      if (timelineContainer) {
        timelineContainer.innerHTML = `
          <div class="p-10 text-center glass-card rounded-2xl border border-slate-200/90 bg-white">
            <div class="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl mb-3 shadow-inner">
              <i class="fa-solid fa-filter-circle-xmark"></i>
            </div>
            <div class="text-sm font-black text-slate-800">No matching audit events found</div>
            <div class="text-xs text-slate-500 mt-1 max-w-sm mx-auto font-medium">Try resetting active filters or searching by different terms.</div>
            <button onclick="document.getElementById('inAppAuditSearch').value=''; document.getElementById('inAppAuditActorFilter').value='ALL'; window.setInAppAuditFilter('ALL');" class="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow transition">
              Reset Filters
            </button>
          </div>
        `;
      }
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="p-12 text-center text-slate-400">
              <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center text-xl text-slate-400 mb-2">
                <i class="fa-solid fa-filter-circle-xmark"></i>
              </div>
              <div class="text-sm font-bold text-slate-700">No matching audit events found</div>
              <div class="text-xs text-slate-400 mt-0.5">Try resetting active filters or searching by different terms.</div>
              <button onclick="document.getElementById('inAppAuditSearch').value=''; document.getElementById('inAppAuditActorFilter').value='ALL'; window.setInAppAuditFilter('ALL');" class="mt-3 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl border border-indigo-200 transition">
                Reset Filters
              </button>
            </td>
          </tr>
        `;
      }
      return;
    }

    let timelineHtml = '';
    let tableHtml = '';

    filtered.forEach((item, idx) => {
      let badge = '';
      let dotClass = 'dot-system';
      let dotIcon = 'fa-solid fa-bolt';

      if (item.action === 'UPDATE_EXPENSE') {
        dotClass = 'dot-update';
        dotIcon = 'fa-solid fa-pen-to-square';
        badge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap"><i class="fa-solid fa-pen-to-square"></i> Edit</span>';
      } else if (item.action === 'CREATE_EXPENSE') {
        dotClass = 'dot-create';
        dotIcon = 'fa-solid fa-plus';
        badge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap"><i class="fa-solid fa-plus"></i> New</span>';
      } else if (item.action === 'DELETE_EXPENSE') {
        dotClass = 'dot-delete';
        dotIcon = 'fa-solid fa-trash';
        badge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap"><i class="fa-solid fa-trash"></i> Delete</span>';
      } else if (item.action === 'UPDATE_CONFIG') {
        dotClass = 'dot-config';
        dotIcon = 'fa-solid fa-sliders';
        badge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap"><i class="fa-solid fa-sliders"></i> Config</span>';
      } else {
        badge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-black bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">${item.action}</span>`;
      }

      const meta = item.metadata || {};
      let actorName = item.actor || item.user || meta.paidBy || 'System';
      let actorHtml = `<span class="inline-flex items-center gap-1 font-bold text-slate-600 text-xs whitespace-nowrap"><i class="fa-solid fa-bolt text-amber-500 text-[10px]"></i> ${actorName}</span>`;
      if (actorName.toLowerCase().includes('palash')) {
        actorHtml = '<span class="inline-flex items-center gap-1 font-bold text-indigo-700 text-xs whitespace-nowrap"><i class="fa-solid fa-user-shield text-[10px] text-indigo-500"></i> Palash</span>';
      } else if (actorName.toLowerCase().includes('pallavi')) {
        actorHtml = '<span class="inline-flex items-center gap-1 font-bold text-pink-700 text-xs whitespace-nowrap"><i class="fa-solid fa-user-check text-[10px] text-pink-500"></i> Pallavi</span>';
      }

      // Times
      const d = new Date(item.timestamp);
      let relTime = 'Recent';
      let fullTime = item.timestamp;
      if (!isNaN(d.getTime())) {
        const diffMs = Date.now() - d.getTime();
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHours = Math.floor(diffMin / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSec < 60) relTime = 'Just now';
        else if (diffMin < 60) relTime = `${diffMin}m ago`;
        else if (diffHours < 24) relTime = `${diffHours}h ago`;
        else relTime = `${diffDays}d ago`;

        fullTime = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      }

      // Context
      let contextHtml = '<span class="text-slate-400 text-xs">—</span>';
      if (meta.amount || meta.category) {
        contextHtml = `
          <div class="font-black text-slate-900 text-xs">${meta.amount ? '₹' + Number(meta.amount).toLocaleString('en-IN') : ''} <span class="font-normal text-slate-500">(${esc(meta.category || 'General')})</span></div>
          <div class="text-[10px] text-slate-500">Paid: <strong class="text-slate-700">${esc(meta.paidBy || '—')}</strong>${esc(meta.splitBetween ? ' • <span class="text-purple-700 font-semibold">' + meta.splitBetween + '</span>' : '')}</div>
        `;
      } else if (item.action === 'UPDATE_CONFIG') {
        contextHtml = '<div class="font-bold text-purple-700 text-xs">Master Settings</div><div class="text-[10px] text-slate-500">Configuration & Rules</div>';
      }

      // Change summary
      let changeHtml = '';
      if (item.action === 'CREATE_EXPENSE') {
        changeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-xs"><i class="fa-solid fa-circle-check text-emerald-600"></i> New Receipt Created (₹${Number(meta.amount || 0).toLocaleString('en-IN')})</span>`;
      } else if (item.action === 'DELETE_EXPENSE') {
        changeHtml = '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-50 text-rose-800 border border-rose-200 font-bold text-xs"><i class="fa-solid fa-trash text-rose-600"></i> Transaction Removed from Ledger</span>';
      } else if (item.action === 'UPDATE_CONFIG') {
        const sects = meta.modifiedSections && Array.isArray(meta.modifiedSections) ? meta.modifiedSections.join(', ') : 'Rules & Budgets';
        changeHtml = `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-50 text-purple-800 border border-purple-200 font-bold text-xs"><i class="fa-solid fa-sliders text-purple-600"></i> Master Policy Updated (${sects})</span>`;
      } else if (item.diff && typeof item.diff === 'object' && Object.keys(item.diff).length > 0) {
        let diffPills = '';
        for (const [key, val] of Object.entries(item.diff)) {
          if (!val || typeof val !== 'object') continue;
          let oldVal = val.old !== undefined ? val.old : null;
          let newVal = val.new !== undefined ? val.new : (val.updated ? val.summary || 'Updated' : null);

          let deltaBadge = '';
          if (key === 'amount' && oldVal !== null && newVal !== null && !isNaN(Number(oldVal)) && !isNaN(Number(newVal))) {
            const numOld = Number(oldVal);
            const numNew = Number(newVal);
            const diffAmount = numNew - numOld;
            const pct = numOld !== 0 ? Math.abs((diffAmount / numOld) * 100).toFixed(1) : 0;
            if (diffAmount > 0) {
              deltaBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">+₹${diffAmount.toLocaleString('en-IN')} (+${pct}%)</span>`;
            } else if (diffAmount < 0) {
              deltaBadge = `<span class="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">-₹${Math.abs(diffAmount).toLocaleString('en-IN')} (-${pct}%)</span>`;
            }
          }

          if (key === 'amount') {
            if (oldVal !== null) oldVal = '₹' + Number(oldVal).toLocaleString('en-IN');
            if (newVal !== null) newVal = '₹' + Number(newVal).toLocaleString('en-IN');
          }

          const fieldLabel = key.replace(/([A-Z])/g, ' $1');
          diffPills += `
            <div class="inline-flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200/90 rounded-lg px-2.5 py-1 text-xs m-0.5">
              <span class="font-bold text-slate-500 capitalize">${fieldLabel}:</span>
              ${oldVal !== null ? `<span class="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 line-through font-mono text-[11px]">${oldVal}</span>` : ''}
              ${oldVal !== null && newVal !== null ? `<i class="fa-solid fa-arrow-right text-slate-400 text-[10px]"></i>` : ''}
              ${newVal !== null ? `<span class="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold font-mono text-[11px]">${newVal}</span>` : ''}
              ${deltaBadge}
            </div>
          `;
        }
        changeHtml = diffPills || '<span class="text-slate-400 italic text-xs">State modified</span>';
      } else {
        changeHtml = '<span class="text-slate-400 italic text-xs">No explicit field diff</span>';
      }

      const timelineInspectId = `timelineInspect_${idx}`;
      const tableInspectId = `tableInspect_${idx}`;
      const jsonStr = escapeAuditHtml(JSON.stringify(item, null, 2));

      // 1. Timeline Card
      timelineHtml += `
        <div class="audit-timeline-node">
          <div class="audit-timeline-dot ${dotClass}" title="${item.action}">
            <i class="${dotIcon}"></i>
          </div>
          <div class="glass-card p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-xs bg-white hover:shadow-md transition">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div class="flex items-center gap-2 flex-wrap">
                ${badge}
                <span class="px-2 py-0.5 rounded bg-slate-100 font-mono text-[11px] font-bold text-slate-700 border border-slate-200">${item.recordId || 'N/A'}</span>
                ${actorHtml}
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[11px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">${relTime}</span>
                <span class="text-xs text-slate-400 font-medium">${fullTime}</span>
                <button onclick="window.toggleAuditInspect(${esc(JSON.stringify(timelineInspectId))})" class="p-1 px-2.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 border border-slate-200 transition text-[11px] font-bold" title="Inspect Raw Payload">
                  <i class="fa-solid fa-code mr-1"></i>Inspect
                </button>
              </div>
            </div>
            <div class="mt-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div class="min-w-0">
                ${contextHtml}
              </div>
              <div class="flex-1">
                ${changeHtml}
              </div>
            </div>
            <div id="${timelineInspectId}" class="hidden mt-3 bg-slate-950 text-slate-300 rounded-xl p-3 border border-slate-800 font-mono text-[11px] overflow-x-auto leading-relaxed">
              <pre><code>${jsonStr}</code></pre>
            </div>
          </div>
        </div>
      `;

      // 2. Table Row
      tableHtml += `
        <tr class="hover:bg-slate-50/80 transition text-xs border-b border-slate-100 last:border-0">
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <div class="w-6 h-6 mx-auto rounded-full ${dotClass} flex items-center justify-center text-[10px] text-white shadow-xs" title="${item.action}">
              <i class="${dotIcon}"></i>
            </div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">
            <div class="font-extrabold text-slate-900 text-xs">${fullTime}</div>
            <div class="text-[10px] text-indigo-600 font-bold">${relTime}</div>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">${badge}</td>
          <td class="py-3 px-3 whitespace-nowrap">
            <span class="px-2 py-0.5 rounded bg-slate-100 font-mono text-xs font-bold text-slate-700 border border-slate-200">${item.recordId || 'N/A'}</span>
          </td>
          <td class="py-3 px-3 whitespace-nowrap">${actorHtml}</td>
          <td class="py-3 px-3 min-w-[150px]">${contextHtml}</td>
          <td class="py-3 px-4">${changeHtml}</td>
          <td class="py-3 px-3 text-center whitespace-nowrap">
            <button onclick="window.toggleAuditInspect(${esc(JSON.stringify(tableInspectId))})" class="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 border border-slate-200 transition" title="Inspect Raw Payload">
              <i class="fa-solid fa-code text-xs"></i>
            </button>
          </td>
        </tr>
        <tr id="${tableInspectId}" class="hidden bg-slate-950 text-slate-300 border-b border-slate-800">
          <td colspan="8" class="p-4">
            <div class="font-mono text-[11px] bg-slate-900 p-3 rounded-xl border border-slate-800 overflow-x-auto leading-relaxed">
              <pre><code>${jsonStr}</code></pre>
            </div>
          </td>
        </tr>
      `;
    });

    if (timelineContainer) timelineContainer.innerHTML = timelineHtml;
    if (tbody) tbody.innerHTML = tableHtml;
  }

  window.toggleAuditInspect = function(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden');
  };

  window.setInAppAuditFilter = function(filter) {
    inAppAuditFilter = filter;
    document.querySelectorAll('.inapp-flt-btn').forEach(btn => {
      btn.classList.remove('bg-indigo-600', 'text-white', 'font-extrabold', 'shadow-sm');
      btn.classList.add('bg-slate-100', 'text-slate-700', 'font-bold');
    });
    const active = document.getElementById('inAppFlt-' + filter);
    if (active) {
      active.classList.remove('bg-slate-100', 'text-slate-700', 'font-bold');
      active.classList.add('bg-indigo-600', 'text-white', 'font-extrabold', 'shadow-sm');
    }
    renderInAppAuditList();
  };

  window.filterInAppAuditLogs = function() {
    renderInAppAuditList();
  };

  window.exportAuditToExcel = function() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJS is currently initializing. Please check connection and try again.');
      return;
    }
    if (!inAppAuditLogs || inAppAuditLogs.length === 0) {
      alert('No audit logs available to export.');
      return;
    }

    const rows = inAppAuditLogs.map(item => {
      const d = new Date(item.timestamp);
      const timeStr = isNaN(d.getTime()) ? item.timestamp : d.toLocaleString('en-IN');
      const meta = item.metadata || {};
      
      let diffSummary = '';
      if (item.diff && typeof item.diff === 'object') {
        diffSummary = Object.entries(item.diff).map(([k, v]) => {
          if (!v || typeof v !== 'object') return '';
          return `${k}: ${v.old !== undefined ? v.old : ''} -> ${v.new !== undefined ? v.new : ''}`;
        }).filter(Boolean).join('; ');
      }

      return {
        'Timestamp': timeStr,
        'Action': item.action,
        'Record ID': item.recordId || '',
        'Actor': item.actor || item.user || meta.paidBy || 'System',
        'Amount (INR)': meta.amount ? Number(meta.amount) : '',
        'Category': meta.category || '',
        'Paid By': meta.paidBy || '',
        'Split Ratio': meta.splitBetween || '',
        'Payment Method': meta.paymentMethod || '',
        'Field Changes': diffSummary,
        'Raw Metadata': JSON.stringify(meta)
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Ledger');
    const filename = `HomeExpenses_Audit_Log_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, filename);
  };

  window.exportAuditToJson = function() {
    if (!inAppAuditLogs || inAppAuditLogs.length === 0) {
      alert('No audit logs available to export.');
      return;
    }
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(inAppAuditLogs, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `homeexpenses_audit_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  };

  // ========================================================
  // DEDICATED PERSONAL EXPENSES DASHBOARD (PALASH & PALLAVI)
  // ========================================================

  let currentPersonalFilter = 'all'; // 'all' | 'Palash' | 'Pallavi'
  let personalChartInstance = null;

  function isPersonalExpense(item) {
    if (window.isPersonalExpense && window.isPersonalExpense !== isPersonalExpense) {
      return window.isPersonalExpense(item);
    }
    if (!item) return false;
    if (item.isPersonal === true || item.expenseType === 'personal') return true;
    const split = (item.splitBetween || '').toLowerCase();
    if (split.includes('personal') || split.includes('not reimbursed')) return true;
    const cat = (item.category || '').toLowerCase();
    if (cat === 'personal expense' || cat.startsWith('personal -') || cat === 'food delivery') return true;
    return false;
  }
  window.isPersonalExpense = isPersonalExpense;

  function getPersonalPayer(item) {
    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    const defaultMember = members[0] || 'Household Member';
    if (!item) return defaultMember;

    const paidBy = (item.paidBy || '').trim();
    const split = (item.splitBetween || '').toLowerCase();

    // 1. Direct match with active members
    for (const m of members) {
      if (paidBy.toLowerCase() === m.toLowerCase()) return m;
    }
    // 2. Mentioned in split rule
    for (const m of members) {
      if (split.includes(m.toLowerCase())) return m;
    }
    // 3. Partial match in paidBy
    for (const m of members) {
      if (paidBy.toLowerCase().includes(m.toLowerCase())) return m;
    }

    return paidBy || defaultMember;
  }

  window.syncPersonalFilterWithPaidBy = function (paidBy) {
    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    if (paidBy && paidBy !== 'all' && members.includes(paidBy)) {
      currentPersonalFilter = paidBy;
    } else {
      currentPersonalFilter = 'all';
    }
    updatePersonalFilterPillStyles();
    window.renderPersonalExpensesDashboard();
  };

  function updatePersonalFilterPillStyles() {
    const container = document.getElementById('personalFilterButtonGroup');
    if (!container) return;
    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    
    // Update active members pill in header if present
    const pill = document.getElementById('personalMembersPill');
    if (pill) {
      pill.textContent = `💼 ${members.join(' & ')} Personal Spend`;
    }

    let html = `
      <button onclick="setPersonalViewFilter('all')" id="btnPersonalFilterAll" class="px-3 py-1.5 rounded-lg transition ${currentPersonalFilter === 'all' ? 'bg-purple-600 text-white shadow-sm font-black' : 'text-slate-300 hover:text-white font-semibold'}">
        👥 All Personal
      </button>
    `;

    members.forEach(m => {
      const isPalash = m.toLowerCase().includes('palash');
      const isPallavi = m.toLowerCase().includes('pallavi');
      const icon = isPalash ? '👤' : (isPallavi ? '🌸' : '🧑');
      const isActive = (currentPersonalFilter === m);
      const cls = isActive ? 'bg-purple-600 text-white shadow-sm font-black' : 'text-slate-300 hover:text-white font-semibold';
      html += `
        <button onclick="setPersonalViewFilter(${esc(JSON.stringify(m))})" id="btnPersonalFilter_${m.replace(/\s+/g, '_')}" class="px-3 py-1.5 rounded-lg transition ${cls}">
          ${icon} ${m} Only
        </button>
      `;
    });

    container.innerHTML = html;
  }

  window.setPersonalViewFilter = function (person) {
    currentPersonalFilter = person;

    // Synchronize top filter toolbar Paid By control
    if (typeof dashboardFilters !== 'undefined') {
      dashboardFilters.paidBy = person === 'all' ? 'all' : person;
      const filterPaidBy = document.getElementById('filterPaidBy');
      if (filterPaidBy) filterPaidBy.value = dashboardFilters.paidBy;
    }

    updatePersonalFilterPillStyles();
    window.renderPersonalExpensesDashboard();

    // Also update active filter tags and tables
    if (typeof renderActiveFilterTags === 'function') renderActiveFilterTags();
  };

  window.openPersonalExpenseModal = function () {
    if (window.openExpenseModal) {
      window.openExpenseModal();
      const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
      const payer = (currentPersonalFilter && currentPersonalFilter !== 'all') 
        ? currentPersonalFilter 
        : ((window.currentSessionUser && window.currentSessionUser.name) || members[0] || 'Household Member');
      const inputPaidBy = document.getElementById('inputPaidBy');
      const inputSplit = document.getElementById('inputSplitBetween');
      if (inputPaidBy) inputPaidBy.value = payer;
      if (inputSplit) {
        const targetOption = Array.from(inputSplit.options).find(opt => 
          opt.value.toLowerCase().includes('personal') && opt.value.toLowerCase().includes(payer.toLowerCase())
        );
        if (targetOption) {
          inputSplit.value = targetOption.value;
        } else {
          inputSplit.value = `Personal Expense (${payer})`;
        }
      }
    }
  };

  function getExpensesForCurrentPeriod() {
    const allExp = window.expensesData || (typeof expenses !== 'undefined' ? expenses : []);
    if (typeof dashboardFilters === 'undefined') return allExp;
    const cur = typeof getCurrentPeriod === 'function' ? getCurrentPeriod() : { month: 'September', year: '2026' };
    const hasCustomRange = !!(dashboardFilters.dateFrom || dashboardFilters.dateTo);

    return allExp.filter(item => {
      if (!item.date) return false;
      const itemDate = new Date(item.date);
      if (isNaN(itemDate.getTime())) return false;
      if (hasCustomRange) {
        const itemTime = itemDate.getTime();
        if (dashboardFilters.dateFrom && itemTime < new Date(dashboardFilters.dateFrom).getTime()) return false;
        if (dashboardFilters.dateTo && itemTime > new Date(dashboardFilters.dateTo).getTime()) return false;
      } else {
        const itemMonth = typeof MONTHS !== 'undefined' ? MONTHS[itemDate.getMonth()] : '';
        const itemYear = itemDate.getFullYear().toString();
        const matchMonth = dashboardFilters.month === 'all' || itemMonth === (dashboardFilters.month || cur.month);
        const matchYear = dashboardFilters.year === 'all' || itemYear === (dashboardFilters.year || cur.year);
        if (!matchMonth || !matchYear) return false;
      }

      // Respect Category filter if selected in filter toolbar
      if (dashboardFilters.category && dashboardFilters.category !== 'all') {
        if (item.category !== dashboardFilters.category) return false;
      }

      // Respect Payment Method filter if selected
      if (dashboardFilters.paymentMethod && dashboardFilters.paymentMethod !== 'all') {
        if (item.paymentMethod !== dashboardFilters.paymentMethod) return false;
      }

      // Respect Global Search query
      if (dashboardFilters.searchVal) {
        const q = dashboardFilters.searchVal.toLowerCase();
        const fullText = [
          item.notes, item.description, item.paidTo, item.vendor,
          item.paidBy, item.category, item.paymentMethod, item.amount, item.date
        ].filter(Boolean).join(' ').toLowerCase();
        if (!fullText.includes(q)) return false;
      }

      return true;
    });
  }

  window.renderPersonalExpensesDashboard = function () {
    updatePersonalFilterPillStyles();

    const periodExpenses = getExpensesForCurrentPeriod();
    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    const m1 = members[0] || 'Member 1';
    const m2 = members.length > 1 ? members[1] : null;

    const personalItems = periodExpenses.filter(isPersonalExpense);
    const householdItems = periodExpenses.filter(e => !isPersonalExpense(e) && e.category !== 'Accepted Payments (Income)');

    const m1Items = personalItems.filter(e => {
      const p = getPersonalPayer(e);
      return p.toLowerCase() === m1.toLowerCase();
    });
    const m2Items = m2 ? personalItems.filter(e => {
      const p = getPersonalPayer(e);
      return p.toLowerCase() === m2.toLowerCase();
    }) : [];

    const m1Total = m1Items.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const m2Total = m2Items.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const combinedTotal = personalItems.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const householdTotal = householdItems.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    const overallTotal = combinedTotal + householdTotal;
    const personalRatioPct = overallTotal > 0 ? Math.round((combinedTotal / overallTotal) * 100) : 0;

    // 1. Update Context Indicator
    const filterContextText = document.getElementById('personalFilterContextText');
    if (filterContextText) {
      const cur = typeof getCurrentPeriod === 'function' ? getCurrentPeriod() : { month: 'September', year: '2026' };
      const periodStr = (typeof dashboardFilters !== 'undefined' && dashboardFilters.month !== 'all') 
        ? `${dashboardFilters.month || cur.month} ${dashboardFilters.year || cur.year}` 
        : 'All Time';
      const personStr = currentPersonalFilter !== 'all' 
        ? `👤 ${currentPersonalFilter} Only` 
        : '👥 All Personal';
      const catStr = (typeof dashboardFilters !== 'undefined' && dashboardFilters.category && dashboardFilters.category !== 'all')
        ? ` • Category: ${dashboardFilters.category}`
        : '';
      filterContextText.textContent = `Period: ${periodStr} • Scope: ${personStr}${catStr}`;
    }

    // 2. Update KPI Card 1: Member 1 Personal
    const cardM1 = document.getElementById('cardPersonalPalash');
    if (cardM1) {
      const labelSpan = cardM1.querySelector('span');
      if (labelSpan) labelSpan.textContent = `👤 ${m1} Personal`;
    }
    const elM1Total = document.getElementById('statPersonalPalashTotal');
    const elM1Count = document.getElementById('statPersonalPalashCount');
    const elM1Avg = document.getElementById('statPersonalPalashAvg');
    if (elM1Total) elM1Total.textContent = (window.formatINR ? window.formatINR(m1Total) : '₹' + m1Total.toLocaleString('en-IN'));
    if (elM1Count) elM1Count.textContent = `${m1Items.length} records`;
    if (elM1Avg) elM1Avg.textContent = `Avg: ₹${m1Items.length ? Math.round(m1Total / m1Items.length).toLocaleString('en-IN') : '0'}`;

    // 3. Update KPI Card 2: Member 2 Personal (or Household Shared if 1 member)
    const cardM2 = document.getElementById('cardPersonalPallavi');
    const elM2Total = document.getElementById('statPersonalPallaviTotal');
    const elM2Count = document.getElementById('statPersonalPallaviCount');
    const elM2Avg = document.getElementById('statPersonalPallaviAvg');
    if (m2) {
      if (cardM2) {
        const labelSpan = cardM2.querySelector('span');
        if (labelSpan) labelSpan.textContent = `🌸 ${m2} Personal`;
      }
      if (elM2Total) elM2Total.textContent = (window.formatINR ? window.formatINR(m2Total) : '₹' + m2Total.toLocaleString('en-IN'));
      if (elM2Count) elM2Count.textContent = `${m2Items.length} records`;
      if (elM2Avg) elM2Avg.textContent = `Avg: ₹${m2Items.length ? Math.round(m2Total / m2Items.length).toLocaleString('en-IN') : '0'}`;
    } else {
      if (cardM2) {
        const labelSpan = cardM2.querySelector('span');
        if (labelSpan) labelSpan.textContent = `🏠 Household Spend`;
      }
      if (elM2Total) elM2Total.textContent = (window.formatINR ? window.formatINR(householdTotal) : '₹' + householdTotal.toLocaleString('en-IN'));
      if (elM2Count) elM2Count.textContent = `${householdItems.length} records`;
      if (elM2Avg) elM2Avg.textContent = `Avg: ₹${householdItems.length ? Math.round(householdTotal / (householdItems.length || 1)).toLocaleString('en-IN') : '0'}`;
    }

    // 4. Update KPI Card 3: Combined / Focused Personal Spend
    const elCombinedTotal = document.getElementById('statPersonalCombinedTotal');
    const elSplitRatio = document.getElementById('statPersonalSplitRatio');
    const elLabelCombined = document.getElementById('labelPersonalCombined');

    // Visual card highlighting depending on active filter
    if (currentPersonalFilter && currentPersonalFilter !== 'all') {
      const activeTotal = (currentPersonalFilter.toLowerCase() === m1.toLowerCase()) ? m1Total : ((m2 && currentPersonalFilter.toLowerCase() === m2.toLowerCase()) ? m2Total : combinedTotal);
      if (elLabelCombined) elLabelCombined.innerHTML = `<span>🎯 Focused Spend (${currentPersonalFilter})</span>`;
      if (elCombinedTotal) elCombinedTotal.textContent = (window.formatINR ? window.formatINR(activeTotal) : '₹' + activeTotal.toLocaleString('en-IN'));
      if (elSplitRatio) elSplitRatio.textContent = `100% of active ${currentPersonalFilter} view`;
    } else {
      if (elLabelCombined) elLabelCombined.innerHTML = '<span>💳 Combined Personal</span>';
      if (elCombinedTotal) elCombinedTotal.textContent = (window.formatINR ? window.formatINR(combinedTotal) : '₹' + combinedTotal.toLocaleString('en-IN'));
      if (elSplitRatio) {
        if (m2) {
          const m1Pct = combinedTotal > 0 ? Math.round((m1Total / combinedTotal) * 100) : 0;
          const m2Pct = combinedTotal > 0 ? (100 - m1Pct) : 0;
          elSplitRatio.textContent = `${m1} ${m1Pct}% • ${m2} ${m2Pct}%`;
        } else {
          elSplitRatio.textContent = `${m1} 100% of personal purchases`;
        }
      }
    }

    // 5. Update KPI Card 4: Ratio
    const elRatioPct = document.getElementById('statPersonalRatioPct');
    const elHouseholdShared = document.getElementById('statHouseholdSharedText');
    if (elRatioPct) elRatioPct.textContent = `${personalRatioPct}%`;
    if (elHouseholdShared) elHouseholdShared.textContent = `Household: ${window.formatINR ? window.formatINR(householdTotal) : '₹' + householdTotal.toLocaleString('en-IN')}`;

    // 6. Determine Focused Items for Donut Chart & Lists
    let focusedItems = personalItems;
    let focusedTotal = combinedTotal;
    let activePersonName = 'Combined';

    if (currentPersonalFilter && currentPersonalFilter !== 'all') {
      focusedItems = personalItems.filter(i => getPersonalPayer(i).toLowerCase() === currentPersonalFilter.toLowerCase());
      focusedTotal = focusedItems.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
      activePersonName = currentPersonalFilter;
    }

    // 7. Render Category Donut Chart & Breakdown List
    renderPersonalCategoryDonut(focusedItems, focusedTotal, activePersonName);

    // 8. Render Dynamic Comparison Matrix
    renderPersonalComparisonMatrix(personalItems, currentPersonalFilter);

    // 9. Render Personal Log Table
    renderPersonalTable(focusedItems);
  };

  function renderPersonalCategoryDonut(items, total, activePersonName) {
    const canvas = document.getElementById('personalCategoryChart');
    const emptyMsg = document.getElementById('personalChartEmptyMsg');
    const listEl = document.getElementById('personalCategoryBreakdownList');
    const titleEl = document.getElementById('personalChartTitle');
    const badgeEl = document.getElementById('personalChartTotalBadge');

    if (titleEl) {
      const icon = activePersonName.toLowerCase().includes('pallavi') ? '🌸 ' : '👤 ';
      titleEl.textContent = activePersonName === 'Combined' 
        ? 'Personal Category Breakdown (Combined)' 
        : `${icon}${activePersonName}'s Category Breakdown`;
    }

    if (badgeEl) {
      badgeEl.textContent = `Total: ${window.formatINR ? window.formatINR(total) : '₹' + total.toLocaleString('en-IN')}`;
    }

    if (!canvas) return;

    if (items.length === 0 || total === 0) {
      if (emptyMsg) {
        emptyMsg.classList.remove('hidden');
        emptyMsg.textContent = `No personal expenses logged for ${activePersonName} in this period.`;
      }
      if (listEl) listEl.innerHTML = `<div class="text-xs text-slate-400 font-medium py-3 text-center">No personal items logged for ${activePersonName} in this period.</div>`;
      if (personalChartInstance) {
        personalChartInstance.destroy();
        personalChartInstance = null;
      }
      return;
    }

    if (emptyMsg) emptyMsg.classList.add('hidden');

    const catMap = {};
    items.forEach(i => {
      const cat = i.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + (Number(i.amount) || 0);
    });

    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const labels = sortedCats.map(c => c[0]);
    const data = sortedCats.map(c => c[1]);

    const palette = [
      '#8b5cf6', '#ec4899', '#3b82f6', '#10b981', '#f59e0b',
      '#06b6d4', '#6366f1', '#14b8a6', '#f43f5e', '#84cc16'
    ];

    if (listEl) {
      listEl.innerHTML = sortedCats.map(([cat, amount], idx) => {
        const pct = total > 0 ? Math.round((amount / total) * 100) : 0;
        const color = palette[idx % palette.length];
        return `
          <div class="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
            <div class="flex items-center space-x-2 truncate">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${color}"></span>
              <span class="font-bold text-slate-700 truncate">${cat}</span>
            </div>
            <div class="flex items-center space-x-2 font-mono">
              <span class="font-black text-slate-900">${window.formatINR ? window.formatINR(amount) : '₹' + amount.toLocaleString('en-IN')}</span>
              <span class="text-[10px] text-slate-400 font-semibold w-8 text-right">${pct}%</span>
            </div>
          </div>
        `;
      }).join('');
    }

    if (typeof Chart !== 'undefined') {
      if (personalChartInstance) {
        personalChartInstance.destroy();
      }
      personalChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: palette.slice(0, labels.length),
            borderWidth: 2,
            borderColor: '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const val = ctx.raw || 0;
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                  return ` ${ctx.label}: ₹${val.toLocaleString('en-IN')} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }
  }

  function renderPersonalComparisonMatrix(personalItems, activeFilter) {
    const container = document.getElementById('personalComparisonContainer');
    const compTitle = document.getElementById('personalComparisonTitle');
    if (!container) return;

    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    const m1 = members[0] || 'Member 1';
    const m2 = members.length > 1 ? members[1] : null;

    if (compTitle) {
      if (!m2) {
        compTitle.textContent = `${m1} Personal Spend by Category`;
      } else if (activeFilter === m2) {
        compTitle.textContent = `${m2} vs ${m1} Category Benchmark`;
      } else if (activeFilter === m1) {
        compTitle.textContent = `${m1} vs ${m2} Category Benchmark`;
      } else {
        compTitle.textContent = `${m1} vs ${m2} Category Comparison`;
      }
    }

    if (personalItems.length === 0) {
      container.innerHTML = '<div class="text-xs text-slate-400 font-medium py-6 text-center">No personal expenses to compare.</div>';
      return;
    }

    const catMap = {};
    personalItems.forEach(i => {
      const cat = i.category || 'Other';
      const payer = getPersonalPayer(i);
      if (!catMap[cat]) {
        catMap[cat] = { total: 0 };
        members.forEach(m => { catMap[cat][m] = 0; });
      }
      catMap[cat][payer] = (catMap[cat][payer] || 0) + (Number(i.amount) || 0);
      catMap[cat].total += (Number(i.amount) || 0);
    });

    const entries = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);

    container.innerHTML = entries.map(([cat, data]) => {
      if (!m2) {
        // Single member household
        const amount = data[m1] || data.total || 0;
        return `
          <div class="p-3 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-1.5 transition">
            <div class="flex items-center justify-between text-xs">
              <span class="font-black text-slate-900">${cat}</span>
              <span class="font-extrabold text-slate-600 font-mono text-[11px]">${window.formatINR ? window.formatINR(data.total) : '₹' + data.total.toLocaleString('en-IN')}</span>
            </div>
            
            <!-- Single Progress Bar -->
            <div class="w-full h-2 bg-indigo-50 rounded-full overflow-hidden flex">
              <div style="width: 100%" class="bg-indigo-600 h-full transition-all duration-300"></div>
            </div>

            <div class="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span class="text-indigo-900 font-bold">👤 ${m1}: ₹${amount.toLocaleString('en-IN')} (100%)</span>
              <span class="text-slate-400 font-medium">Self-Funded</span>
            </div>
          </div>
        `;
      }

      // Two or more members
      const m1Val = data[m1] || 0;
      const m2Val = data[m2] || 0;
      const m1Pct = data.total > 0 ? Math.round((m1Val / data.total) * 100) : 0;
      const m2Pct = data.total > 0 ? (100 - m1Pct) : 0;

      const isM1Active = activeFilter === m1;
      const isM2Active = activeFilter === m2;
      const m2Icon = m2.toLowerCase().includes('pallavi') ? '🌸' : '👤';

      return `
        <div class="p-3 bg-white border ${isM2Active && m2Val > 0 ? 'border-pink-300 ring-1 ring-pink-100' : (isM1Active && m1Val > 0 ? 'border-indigo-300 ring-1 ring-indigo-100' : 'border-slate-200/80')} rounded-2xl shadow-xs space-y-1.5 transition">
          <div class="flex items-center justify-between text-xs">
            <span class="font-black text-slate-900">${cat}</span>
            <span class="font-extrabold text-slate-600 font-mono text-[11px]">${window.formatINR ? window.formatINR(data.total) : '₹' + data.total.toLocaleString('en-IN')}</span>
          </div>
          
          <!-- Dual Progress Bar -->
          <div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden flex">
            <div style="width: ${m1Pct}%" class="${isM1Active ? 'bg-indigo-600' : 'bg-indigo-500'} h-full transition-all duration-300" title="${m1}: ${m1Pct}%"></div>
            <div style="width: ${m2Pct}%" class="${isM2Active ? 'bg-pink-600' : 'bg-pink-500'} h-full transition-all duration-300" title="${m2}: ${m2Pct}%"></div>
          </div>

          <div class="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span class="${isM1Active ? 'text-indigo-900 font-black' : 'text-indigo-700 font-bold'}">👤 ${m1}: ₹${m1Val.toLocaleString('en-IN')} (${m1Pct}%)</span>
            <span class="${isM2Active ? 'text-pink-900 font-black' : 'text-pink-700 font-bold'}">${m2Icon} ${m2}: ₹${m2Val.toLocaleString('en-IN')} (${m2Pct}%)</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPersonalTable(items) {
    const tbody = document.getElementById('personalExpensesTableBody');
    const emptyState = document.getElementById('personalExpensesEmptyState');
    if (!tbody) return;

    const members = (typeof getActiveFamilyMembers === 'function') ? getActiveFamilyMembers() : ['Household Member'];
    const search = (document.getElementById('searchPersonalExpenses')?.value || '').trim().toLowerCase();

    const filtered = items.filter(i => {
      if (search) {
        const payer = getPersonalPayer(i);
        const text = `${i.notes || ''} ${i.description || ''} ${i.category || ''} ${i.paidTo || ''} ${payer}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.classList.remove('hidden');
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = filtered.map(item => {
      const payer = getPersonalPayer(item);
      const isSecondMember = members.length > 1 && payer.toLowerCase() === (members[1] || '').toLowerCase();
      const badge = isSecondMember
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black bg-pink-50 text-pink-700 border border-pink-200">${esc(payer.toLowerCase().includes('pallavi') ? '🌸' : '👤')} ${esc(payer)}</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">👤 ${esc(payer)}</span>`;

      const d = item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

      return `
        <tr class="hover:bg-purple-50/40 transition">
          <td class="py-2.5 px-3 whitespace-nowrap text-slate-600 font-semibold">${d}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${badge}</td>
          <td class="py-2.5 px-3 font-bold text-slate-900">${esc(item.category || '-')}</td>
          <td class="py-2.5 px-3 text-slate-500 text-[11px]">${esc(item.paymentMethod || 'UPI / Cash')}</td>
          <td class="py-2.5 px-3 text-slate-600 max-w-[200px] truncate" title="${esc(item.notes || item.description || item.paidTo || '')}">${esc(item.notes || item.description || item.paidTo || '-')}</td>
          <td class="py-2.5 px-3 text-right font-black text-purple-900 font-mono text-sm">${window.formatINR ? window.formatINR(item.amount) : '₹' + item.amount.toLocaleString('en-IN')}</td>
          <td class="py-2.5 px-3 text-center whitespace-nowrap">
            <button onclick="editExpense(${esc(JSON.stringify(item.id))})" class="p-1 text-slate-400 hover:text-indigo-600 transition" title="Edit expense">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="deleteExpense(${esc(JSON.stringify(item.id))})" class="p-1 ml-1 text-slate-400 hover:text-rose-600 transition" title="Delete expense">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ========================================================
  // 8. BACKUP & DISASTER RECOVERY COMMAND CENTER
  // ========================================================

  window.downloadFullBackupJson = async function () {
    try {
      window.showToast && window.showToast('info', 'Exporting Backup', 'Generating comprehensive JSON archive...');
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : {};
      const res = await fetch('/api/backup', { headers: headers });
      const data = await res.json();
      if (data.success && data.data) {
        const dateStr = new Date().toISOString().slice(0, 10);
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `homeexpenses-full-backup-${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        window.showToast && window.showToast('success', 'Backup Exported', `Saved ${data.data.expenses?.length || 0} expenses & master configs.`);
      } else {
        throw new Error(data.error || 'Failed to download backup.');
      }
    } catch (err) {
      console.error('Backup export error:', err);
      window.showToast && window.showToast('error', 'Export Failed', err.message || 'Could not export backup JSON.');
    }
  };

  window.createInstantBackupSnapshot = async function () {
    try {
      window.showToast && window.showToast('info', 'Taking Snapshot', 'Creating point-in-time recovery image...');
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'create_snapshot' })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast && window.showToast('success', 'Snapshot Captured', `Saved ${data.snapshot?.filename || 'snapshot'}`);
        window.loadBackupSnapshots();
        window.updateDataCenterMetrics();
      } else {
        throw new Error(data.error || 'Failed to create snapshot.');
      }
    } catch (err) {
      console.error('Snapshot error:', err);
      window.showToast && window.showToast('error', 'Snapshot Error', err.message || 'Could not save recovery snapshot.');
    }
  };

  window.loadBackupSnapshots = async function () {
    const tbody = document.getElementById('snapshotVaultTableBody');
    if (!tbody) return;

    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders({ 'Cache-Control': 'no-cache' }) : {};
      const res = await fetch('/api/backup?action=list', { headers: headers });
      const data = await res.json();
      if (data.success && Array.isArray(data.snapshots)) {
        const list = data.snapshots;
        const countEl = document.getElementById('dataSnapshotsCountMetric');
        if (countEl) countEl.textContent = list.length;

        if (list.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="5" class="py-6 text-center text-slate-400">
                <i class="fa-solid fa-folder-open text-2xl text-slate-300 block mb-1"></i>
                No snapshots yet. Click "Take Snapshot" to create your first recovery point.
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = list.map(s => {
          const date = new Date(s.createdAt).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          const isSafety = s.isSafetyBackup || s.filename.startsWith('safety-');
          const badge = isSafety
            ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">🛡️ Safety Pre-Restore</span>'
            : '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-100 text-indigo-800 border border-indigo-300">📸 Manual Point</span>';
          const sizeKb = (s.sizeBytes / 1024).toFixed(1) + ' KB';

          return `
            <tr class="hover:bg-slate-50 transition">
              <td class="py-2.5 px-3 font-bold text-slate-900 font-mono text-[11px]">${s.filename}</td>
              <td class="py-2.5 px-3 text-slate-600 whitespace-nowrap">${date}</td>
              <td class="py-2.5 px-3 whitespace-nowrap">${badge}</td>
              <td class="py-2.5 px-3 text-slate-500 font-mono">${sizeKb}</td>
              <td class="py-2.5 px-3 text-right whitespace-nowrap">
                <button onclick="restoreSnapshotPrompt(${esc(JSON.stringify(s.filename))})" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-lg text-[11px] transition shadow-xs inline-flex items-center space-x-1">
                  <i class="fa-solid fa-clock-rotate-left"></i>
                  <span>Restore</span>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      console.error('Failed to load snapshots:', err);
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="py-4 text-center text-rose-500 font-medium">Could not load snapshot vault.</td>
        </tr>
      `;
    }
  };

  window.restoreSnapshotPrompt = async function (filename) {
    if (!confirm(`Are you sure you want to rollback to snapshot:\n\n${filename}\n\nNote: A new safety snapshot of current data will automatically be captured before restoring!`)) {
      return;
    }

    try {
      window.showToast && window.showToast('info', 'Restoring Snapshot', `Applying ${filename}...`);
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'restore_snapshot', filename })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast && window.showToast('success', 'Snapshot Restored', data.message);
        if (window.loadData) window.loadData();
        window.loadBackupSnapshots();
        window.updateDataCenterMetrics();
        if (window.triggerDataHealthScan) window.triggerDataHealthScan();
      } else {
        throw new Error(data.error || 'Failed to restore snapshot.');
      }
    } catch (err) {
      console.error('Restore error:', err);
      window.showToast && window.showToast('error', 'Restore Failed', err.message);
    }
  };

  window.restoreBackupFromFile = async function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!parsed || (!Array.isArray(parsed.expenses) && !parsed.backupVersion)) {
        alert('Invalid file format. Please upload a valid HomeExpenses backup JSON file.');
        return;
      }

      const count = parsed.expenses ? parsed.expenses.length : 0;
      if (!confirm(`Restore backup containing ${count} expenses and master configuration?\n\nA safety pre-restore snapshot will be saved automatically.`)) {
        event.target.value = '';
        return;
      }

      window.showToast && window.showToast('info', 'Restoring Backup', 'Validating and restoring records...');
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: 'restore', backupData: parsed })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast && window.showToast('success', 'Backup Restored', `Successfully loaded ${data.restoredExpensesCount} expenses.`);
        if (window.loadData) window.loadData();
        window.loadBackupSnapshots();
        window.updateDataCenterMetrics();
        if (window.triggerDataHealthScan) window.triggerDataHealthScan();
      } else {
        throw new Error(data.error || 'Restore failed.');
      }
    } catch (err) {
      console.error('Restore from file error:', err);
      window.showToast && window.showToast('error', 'Restore Error', err.message || 'Could not read or restore JSON file.');
    } finally {
      event.target.value = '';
    }
  };

  window.updateDataCenterMetrics = function () {
    const totalEl = document.getElementById('dataTotalRecordsMetric');
    if (totalEl) {
      const list = window.expenses || [];
      totalEl.textContent = list.length;
    }
  };

  // ========================================================
  // 9. DATA HEALTH & INTEGRITY DIAGNOSTIC SCANNER
  // ========================================================

  let lastDetectedHealthIssues = [];

  window.triggerDataHealthScan = function () {
    const list = window.expenses || [];
    const config = window.masterConfig || {};
    const knownCategories = Array.isArray(config.categories) ? config.categories.map(c => c.name) : [];
    const knownPayers = Array.isArray(config.familyMembers) ? config.familyMembers : ['Palash', 'Pallavi'];

    const issues = [];
    const seenSignatures = new Map();

    list.forEach((item, idx) => {
      // 1. Invalid or missing ID
      if (!item.id || String(item.id).trim() === '') {
        issues.push({
          severity: 'CRITICAL',
          type: 'MISSING_ID',
          index: idx,
          item: item,
          repairable: true,
          message: `Row #${idx + 1} has no unique ID.`
        });
      }

      // 2. Negative or invalid amount
      const amt = Number(item.amount);
      if (isNaN(amt) || amt <= 0) {
        issues.push({
          severity: 'CRITICAL',
          type: 'INVALID_AMOUNT',
          index: idx,
          item: item,
          repairable: false,
          message: `Transaction on ${item.date || 'unknown date'} has non-positive amount (${item.amount}).`
        });
      }

      // 3. Invalid date
      if (!item.date || isNaN(new Date(item.date).getTime())) {
        issues.push({
          severity: 'CRITICAL',
          type: 'INVALID_DATE',
          index: idx,
          item: item,
          repairable: true,
          message: `Invalid date format '${item.date}' on transaction of ₹${item.amount}.`
        });
      }

      // 4. Unmapped or blank category
      if (!item.category || String(item.category).trim() === '') {
        issues.push({
          severity: 'WARNING',
          type: 'BLANK_CATEGORY',
          index: idx,
          item: item,
          repairable: true,
          message: `Missing category on ₹${item.amount} (${item.date}).`
        });
      } else if (knownCategories.length > 0 && !knownCategories.includes(item.category)) {
        issues.push({
          severity: 'INFO',
          type: 'CUSTOM_CATEGORY',
          index: idx,
          item: item,
          repairable: false,
          message: `Custom category '${item.category}' not in master presets list.`
        });
      }

      // 5. Unknown payer
      if (item.paidBy && !knownPayers.includes(item.paidBy) && item.paidBy !== 'Not Specified') {
        issues.push({
          severity: 'INFO',
          type: 'UNKNOWN_PAYER',
          index: idx,
          item: item,
          repairable: true,
          message: `Payer '${item.paidBy}' is not configured in Family Members.`
        });
      }

      // 6. Duplicate transaction detection
      const sig = `${item.date}_${item.amount}_${item.category}_${(item.notes || '').trim().toLowerCase()}`;
      if (seenSignatures.has(sig)) {
        const firstIdx = seenSignatures.get(sig);
        issues.push({
          severity: 'WARNING',
          type: 'POTENTIAL_DUPLICATE',
          index: idx,
          item: item,
          repairable: false,
          message: `Possible duplicate with Row #${firstIdx + 1}: ₹${item.amount} (${item.category} on ${item.date}).`
        });
      } else {
        seenSignatures.set(sig, idx);
      }
    });

    lastDetectedHealthIssues = issues;

    const totalDeduction = issues.reduce((acc, iss) => {
      if (iss.severity === 'CRITICAL') return acc + 5;
      if (iss.severity === 'WARNING') return acc + 2;
      return acc + 0.5;
    }, 0);

    const score = Math.max(0, Math.min(100, Math.round(100 - totalDeduction)));

    const scorePill = document.getElementById('dataHealthScorePill');
    const statusSub = document.getElementById('dataHealthStatusSubtitle');
    const repairBtn = document.getElementById('btnRepairDataHealth');
    const resultsContainer = document.getElementById('dataHealthResultsContainer');

    if (scorePill) scorePill.textContent = `${score}%`;
    if (statusSub) {
      if (score === 100) {
        statusSub.textContent = 'All Systems Operational · 0 Anomalies';
        statusSub.className = 'text-[11px] text-emerald-600 font-bold mt-0.5';
      } else if (score >= 85) {
        statusSub.textContent = `${issues.length} Minor Anomalies Detected`;
        statusSub.className = 'text-[11px] text-amber-600 font-bold mt-0.5';
      } else {
        statusSub.textContent = `${issues.length} Critical Issues Detected`;
        statusSub.className = 'text-[11px] text-rose-600 font-bold mt-0.5';
      }
    }

    const hasRepairable = issues.some(i => i.repairable);
    if (repairBtn) {
      if (hasRepairable) {
        repairBtn.classList.remove('hidden');
      } else {
        repairBtn.classList.add('hidden');
      }
    }

    if (resultsContainer) {
      if (issues.length === 0) {
        resultsContainer.innerHTML = `
          <div class="flex items-center space-x-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800">
            <div class="w-8 h-8 rounded-lg bg-emerald-200 text-emerald-700 flex items-center justify-center font-black">
              <i class="fa-solid fa-check"></i>
            </div>
            <div>
              <h4 class="font-black text-xs">Perfect Health Score (100%)</h4>
              <p class="text-[11px] text-emerald-700">All ${list.length} expense records have valid IDs, positive amounts, valid dates, and mapped categories.</p>
            </div>
          </div>
        `;
      } else {
        resultsContainer.innerHTML = `
          <div class="space-y-2">
            <div class="flex justify-between items-center font-bold text-slate-700">
              <span>Diagnostic Audit (${issues.length} Findings):</span>
              <span class="text-[11px] text-slate-500">${hasRepairable ? 'Auto-repairable issues found' : 'Manual inspection required'}</span>
            </div>
            <div class="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              ${issues.map(iss => {
                let badgeClass = 'bg-rose-100 text-rose-800 border-rose-200';
                if (iss.severity === 'WARNING') badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
                if (iss.severity === 'INFO') badgeClass = 'bg-blue-100 text-blue-800 border-blue-200';

                return `
                  <div class="p-2.5 bg-white border border-slate-200 rounded-xl flex items-start justify-between gap-2 shadow-xs">
                    <div class="flex items-start space-x-2">
                      <span class="px-2 py-0.5 text-[10px] font-black rounded-md border ${badgeClass} uppercase shrink-0 mt-0.5">
                        ${iss.severity}
                      </span>
                      <span class="text-slate-800 font-medium">${iss.message}</span>
                    </div>
                    ${iss.repairable ? '<span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">Auto-Healable</span>' : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
    }
  };

  window.repairDataHealthIssues = async function () {
    if (!lastDetectedHealthIssues.length) {
      window.showToast && window.showToast('info', 'No Issues', 'No repairable health issues currently detected.');
      return;
    }

    if (!confirm('Run Automated Safe Healing on repairable issues?\n\n- Generates missing IDs\n- Formats amounts to clean decimals\n- Normalizes dates\n- Replaces blank categories with "Shopping & Miscellaneous"\n- Takes automated safety backup before applying.')) {
      return;
    }

    const currentExpenses = [...(window.expenses || [])];
    let repairedCount = 0;

    currentExpenses.forEach((item, idx) => {
      let changed = false;
      if (!item.id || String(item.id).trim() === '') {
        item.id = `exp-heal-${Date.now()}-${idx}`;
        changed = true;
      }
      const amt = Number(item.amount);
      if (!isNaN(amt) && amt > 0) {
        const cleanAmt = Number(amt.toFixed(2));
        if (cleanAmt !== item.amount) {
          item.amount = cleanAmt;
          changed = true;
        }
      }
      if (!item.category || String(item.category).trim() === '') {
        item.category = 'Shopping & Miscellaneous';
        changed = true;
      }
      if (item.paidBy && item.paidBy !== item.paidBy.trim()) {
        item.paidBy = item.paidBy.trim();
        changed = true;
      }
      if (item.notes && item.notes !== item.notes.trim()) {
        item.notes = item.notes.trim();
        changed = true;
      }

      if (changed) repairedCount++;
    });

    if (repairedCount === 0) {
      window.showToast && window.showToast('info', 'All Clean', 'No auto-repairable items needed modification.');
      return;
    }

    try {
      window.showToast && window.showToast('info', 'Applying Healing', `Saving ${repairedCount} healed records...`);
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          action: 'restore',
          backupData: {
            expenses: currentExpenses
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        window.showToast && window.showToast('success', 'Health Repaired', `Safely healed ${repairedCount} records.`);
        if (window.loadData) window.loadData();
        window.triggerDataHealthScan();
      } else {
        throw new Error(data.error || 'Failed to save repaired records.');
      }
    } catch (err) {
      console.error('Repair error:', err);
      window.showToast && window.showToast('error', 'Repair Failed', err.message);
    }
  };

  // ========================================================
  // 10. CANONICAL RECURRING PAYMENT ENGINE & NOTIFICATION CENTER
  // ========================================================

  /**
   * Evaluates the payment status of a recurring bill against recorded expenses for the period.
   * Canonical statuses: DISABLED, SKIPPED, PAID, PARTIALLY_PAID, DUE_TODAY, OVERDUE, UPCOMING
   */
  window.getRecurringPaymentStatus = function (bill, periodExpenses, refDate = new Date()) {
    const rawBillAmt = Number(bill.approxAmount !== undefined && bill.approxAmount !== null ? bill.approxAmount : (bill.budgetedAmount || 0)) || 0;
    if (bill.active === false) {
      return { status: 'DISABLED', totalPaid: 0, targetAmount: rawBillAmt, remaining: 0, daysDiff: 0, matchingExpenses: [] };
    }

    const currentDay = refDate.getDate();
    const dueDay = Number(bill.dueDay) || 1;
    const daysDiff = dueDay - currentDay;
    const targetAmount = rawBillAmt;

    // Match expenses
    const billCatLower = (bill.category || '').toLowerCase().trim();
    const billNameLower = (bill.name || '').toLowerCase().trim();

    const matching = (periodExpenses || []).filter(e => {
      const cat = (e.category || '').toLowerCase().trim();
      const paidTo = (e.paidTo || e.vendor || '').toLowerCase().trim();
      const desc = (e.description || e.notes || '').toLowerCase().trim();

      const catMatches = cat === billCatLower || (billCatLower && cat.includes(billCatLower));
      const nameMatches = (billNameLower && paidTo.includes(billNameLower)) || (billNameLower && desc.includes(billNameLower));

      return catMatches || nameMatches;
    });

    const totalPaid = matching.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    let status = 'UPCOMING';
    // Paid threshold: >= target, or at least 80% if target is an approximation
    if (totalPaid >= targetAmount || (targetAmount > 0 && totalPaid >= targetAmount * 0.8)) {
      status = 'PAID';
    } else if (totalPaid > 0) {
      status = 'PARTIALLY_PAID';
    } else if (daysDiff < 0) {
      status = 'OVERDUE';
    } else if (daysDiff === 0) {
      status = 'DUE_TODAY';
    } else {
      status = 'UPCOMING';
    }

    return {
      status,
      totalPaid,
      targetAmount,
      remaining: Math.max(0, targetAmount - totalPaid),
      daysDiff,
      matchingExpenses: matching
    };
  };

  let currentNotificationFilter = 'action';
  let activeNotificationsList = [];

  function getDismissedNotificationIds() {
    try {
      const raw = localStorage.getItem('homeexpenses-dismissed-notifications');
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveDismissedNotificationId(id) {
    const list = getDismissedNotificationIds();
    if (!list.includes(id)) {
      list.push(id);
      try { localStorage.setItem('homeexpenses-dismissed-notifications', JSON.stringify(list)); } catch (e) {}
    }
  }

  const shownInAppBannerIds = new Set();
  let initialNotificationSyncDone = false;

  window.toggleNotificationCenter = function () {
    const dropdown = document.getElementById('notificationCenterDropdown');
    const backdrop = document.getElementById('notificationCenterBackdrop');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      window.updateNotificationCenter();
      window.checkPushSubscriptionStatus();
      dropdown.classList.remove('hidden');
      if (backdrop) backdrop.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
    }
  };

  window.switchNotificationFilter = function (filter) {
    currentNotificationFilter = filter;
    ['action', 'upcoming', 'all'].forEach(f => {
      const btn = document.getElementById(`notifTab-${f}`);
      if (btn) {
        if (f === filter) {
          btn.className = 'flex-1 py-2 text-center border-b-2 border-indigo-600 text-indigo-900 bg-white font-black';
        } else {
          btn.className = 'flex-1 py-2 text-center border-b-2 border-transparent hover:text-slate-900';
        }
      }
    });
    renderNotificationItemsList();
  };

  window.updateNotificationCenter = async function () {
    const expenses = window.expenses || [];
    const config = window.masterConfig || {};
    const bills = config.recurringBills || RADAR_BILLS;
    const dismissed = getDismissedNotificationIds();

    const today = new Date();
    const curMonth = today.getMonth() + 1;
    const curYear = today.getFullYear();

    const curMonthExpenses = expenses.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return (d.getMonth() + 1) === curMonth && d.getFullYear() === curYear;
    });

    const notifs = [];

    // 0. Fetch Live Household In-App Activity Notifications from Server
    try {
      const headers = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : {};
      const res = await fetch('/api/notifications?action=list_in_app', { headers });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const currentUsername = (window.currentUser && (window.currentUser.username || window.currentUser.name) || '').toLowerCase();
          const currentUserId = (window.currentUser && (window.currentUser.userId || window.currentUser.id)) || '';

          json.data.forEach(item => {
            if (dismissed.includes(item.id)) return;
            if (item.readBy && (item.readBy.includes(currentUserId) || item.readBy.includes(currentUsername))) return;

            // Trigger real-time floating in-app banner for incoming alerts
            if (!initialNotificationSyncDone) {
              shownInAppBannerIds.add(item.id);
            } else if (!shownInAppBannerIds.has(item.id)) {
              shownInAppBannerIds.add(item.id);
              const notifTime = item.timestamp ? new Date(item.timestamp).getTime() : 0;
              const age = Date.now() - notifTime;
              const isOtherUser = (item.actor && item.actor.toLowerCase() !== currentUsername && item.actor.toLowerCase() !== 'you') || item.type === 'TEST_PUSH';
              if (age < 60000 && isOtherUser) {
                if (window.showInAppNotificationBanner) {
                  window.showInAppNotificationBanner({
                    id: item.id,
                    title: item.title,
                    body: item.body,
                    url: item.url,
                    type: item.type,
                    actor: item.actor,
                    amount: item.amount
                  });
                }
              }
            }

            let icon = '💰';
            let sev = 'high';
            if (item.type === 'EXPENSE_UPDATE') { icon = '✏️'; sev = 'medium'; }
            else if (item.type === 'EXPENSE_DELETE') { icon = '🗑️'; sev = 'critical'; }
            else if (item.type === 'STAFF_ATTENDANCE') { icon = '👩‍🍳'; sev = 'high'; }
            else if (item.type === 'CONFIG_UPDATE') { icon = '⚙️'; sev = 'medium'; }

            notifs.push({
              id: item.id,
              type: 'action',
              severity: sev,
              title: item.title,
              description: item.body,
              icon: icon,
              actionLabel: item.type === 'STAFF_ATTENDANCE' ? 'View Staff' : (item.type === 'CONFIG_UPDATE' ? 'View Settings' : 'View Expenses'),
              onAction: () => {
                if (item.type === 'STAFF_ATTENDANCE') {
                  window.switchTab && window.switchTab('staff');
                } else if (item.type === 'CONFIG_UPDATE') {
                  window.switchTab && window.switchTab('settings');
                } else {
                  window.switchTab && window.switchTab('expenses');
                }
                window.toggleNotificationCenter();
              }
            });
          });
          initialNotificationSyncDone = true;
        }
      }
    } catch (e) {}

    // 1. Evaluate Recurring Bills
    bills.forEach(bill => {
      if (bill.active === false) return;
      const evalRes = window.getRecurringPaymentStatus(bill, curMonthExpenses, today);
      const billKey = `bill-${bill.id || bill.name}-${curYear}-${curMonth}`;

      if (dismissed.includes(billKey)) return;

      if (evalRes.status === 'OVERDUE') {
        notifs.push({
          id: billKey,
          type: 'action',
          severity: 'critical',
          title: `${bill.name} Overdue`,
          description: `Payment of approx ₹${evalRes.targetAmount.toLocaleString('en-IN')} was due on ${bill.dueDay}th.`,
          icon: bill.icon || '⚡',
          actionLabel: 'Pay Now',
          bill: bill,
          onAction: () => {
            window.openExpenseModal && window.openExpenseModal(null, {
              category: bill.category,
              amount: evalRes.remaining || evalRes.targetAmount,
              paidTo: bill.name,
              notes: `Monthly recurring payment for ${bill.name}`
            });
            window.toggleNotificationCenter();
          }
        });
      } else if (evalRes.status === 'DUE_TODAY') {
        notifs.push({
          id: billKey,
          type: 'action',
          severity: 'high',
          title: `${bill.name} Due Today!`,
          description: `Due today (${bill.dueDay}th). Expected: ₹${evalRes.targetAmount.toLocaleString('en-IN')}.`,
          icon: bill.icon || '⏰',
          actionLabel: 'Pay Today',
          bill: bill,
          onAction: () => {
            window.openExpenseModal && window.openExpenseModal(null, {
              category: bill.category,
              amount: evalRes.targetAmount,
              paidTo: bill.name,
              notes: `Monthly bill payment for ${bill.name}`
            });
            window.toggleNotificationCenter();
          }
        });
      } else if (evalRes.status === 'UPCOMING' && evalRes.daysDiff <= 5 && evalRes.daysDiff > 0) {
        notifs.push({
          id: billKey,
          type: 'upcoming',
          severity: 'info',
          title: `${bill.name} Due in ${evalRes.daysDiff} days`,
          description: `Due on ${bill.dueDay}th of this month (~₹${evalRes.targetAmount.toLocaleString('en-IN')}).`,
          icon: bill.icon || '📅',
          actionLabel: 'Pre-Pay',
          bill: bill,
          onAction: () => {
            window.openExpenseModal && window.openExpenseModal(null, {
              category: bill.category,
              amount: evalRes.targetAmount,
              paidTo: bill.name,
              notes: `Pre-payment for ${bill.name}`
            });
            window.toggleNotificationCenter();
          }
        });
      }
    });

    // 2. Evaluate Staff Attendance / Leave & Salary Cutoffs
    const day = today.getDate();
    const madhuriKey = `staff-madhuri-${curYear}-${curMonth}`;
    if (!dismissed.includes(madhuriKey) && day >= 19 && day <= 24) {
      const madhuriExp = curMonthExpenses.find(e => (e.category || '').includes('Madhuri'));
      if (!madhuriExp) {
        notifs.push({
          id: madhuriKey,
          type: day > 21 ? 'action' : 'upcoming',
          severity: day > 21 ? 'critical' : 'high',
          title: day > 21 ? 'Madhuri Salary Overdue' : 'Madhuri Salary Cutoff Approaching',
          description: 'Billing cycle closes on 21st Date (Base: ₹800). Verify attendance and process payment.',
          icon: '🧹',
          actionLabel: 'Check Staff',
          onAction: () => {
            window.switchTab && window.switchTab('staff');
            window.toggleNotificationCenter();
          }
        });
      }
    }

    // 3. High Value Unsettled Reimbursements
    if (window.currentNetSettleAmount && window.currentNetSettleAmount > 5000) {
      const settleKey = `settle-${curYear}-${curMonth}-${Math.floor(window.currentNetSettleAmount / 1000)}`;
      if (!dismissed.includes(settleKey)) {
        notifs.push({
          id: settleKey,
          type: 'action',
          severity: 'medium',
          title: `Pending Settle-Up (₹${Math.round(window.currentNetSettleAmount).toLocaleString('en-IN')})`,
          description: 'Palash reimburses Pallavi for household expenses. 1-Click reconciliation available.',
          icon: '🤝',
          actionLabel: 'Settle Up',
          onAction: () => {
            window.openSettleUpModal && window.openSettleUpModal();
            window.toggleNotificationCenter();
          }
        });
      }
    }

    activeNotificationsList = notifs;

    const actionCount = notifs.filter(n => n.type === 'action').length;
    const upcomingCount = notifs.filter(n => n.type === 'upcoming').length;

    const countActionEl = document.getElementById('notifCountAction');
    const countUpcomingEl = document.getElementById('notifCountUpcoming');
    const badgeEl = document.getElementById('notificationBadgeCount');
    const mobileBadgeEl = document.getElementById('mobileNotificationBadgeCount');

    if (countActionEl) countActionEl.textContent = actionCount;
    if (countUpcomingEl) countUpcomingEl.textContent = upcomingCount;

    const totalAlerts = actionCount + upcomingCount;
    const text = totalAlerts > 9 ? '9+' : String(totalAlerts);
    [badgeEl, mobileBadgeEl].forEach(el => {
      if (!el) return;
      if (totalAlerts > 0) {
        el.textContent = text;
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    renderNotificationItemsList();
  };

  function renderNotificationItemsList() {
    const container = document.getElementById('notificationItemsList');
    if (!container) return;

    let filtered = activeNotificationsList;
    if (currentNotificationFilter === 'action') {
      filtered = activeNotificationsList.filter(n => n.type === 'action');
    } else if (currentNotificationFilter === 'upcoming') {
      filtered = activeNotificationsList.filter(n => n.type === 'upcoming');
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-400 text-xs">
          <i class="fa-solid fa-bell-slash text-2xl text-slate-300 block mb-2"></i>
          No notifications in this filter.
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(item => {
      let borderClass = 'border-amber-200 bg-amber-50/40';
      if (item.severity === 'critical') borderClass = 'border-rose-200 bg-rose-50/40';
      if (item.severity === 'info') borderClass = 'border-slate-200 bg-slate-50/50';

      return `
        <div class="p-3 rounded-2xl border ${borderClass} space-y-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-start space-x-2.5">
              <span class="text-lg shrink-0">${esc(item.icon)}</span>
              <div>
                <div class="font-black text-slate-900 leading-tight">${esc(item.title)}</div>
                <div class="text-[11px] text-slate-600 font-medium mt-0.5">${esc(item.description)}</div>
              </div>
            </div>
            <button onclick="dismissNotificationItem(${esc(JSON.stringify(item.id))})" class="text-slate-400 hover:text-slate-600 p-1 text-xs" title="Dismiss">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="flex justify-end space-x-2 pt-1">
            <button onclick="triggerNotificationAction(${esc(JSON.stringify(item.id))})" class="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-[11px] shadow-xs transition">
              ${item.actionLabel}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.triggerNotificationAction = function (id) {
    const item = activeNotificationsList.find(n => n.id === id);
    if (item && item.onAction) {
      item.onAction();
    }
  };

  window.dismissNotificationItem = function (id) {
    saveDismissedNotificationId(id);
    window.updateNotificationCenter();
  };

  window.dismissAllNotifications = function () {
    activeNotificationsList.forEach(item => {
      saveDismissedNotificationId(item.id);
    });
    window.updateNotificationCenter();
    window.showToast && window.showToast('info', 'Alerts Dismissed', 'All current notifications marked as read.');
  };

  window.clearAllDismissedNotifications = function () {
    try {
      localStorage.removeItem('homeexpenses-dismissed-notifications');
    } catch (e) {}
    window.updateNotificationCenter();
    window.showToast && window.showToast('success', 'Reset Completed', 'Notification history restored.');
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  window.checkPushSubscriptionStatus = async function () {
    const btn = document.getElementById('btnPushPermission');
    const dot = document.getElementById('pushStatusDot');
    const text = document.getElementById('pushStatusText');
    const inlineBtn = document.getElementById('btnPushToggleInline');

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (btn) { btn.textContent = 'Push Unsupported'; btn.disabled = true; }
      if (text) text.textContent = 'Push not supported on this browser';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-400 shrink-0';
      if (inlineBtn) inlineBtn.classList.add('hidden');
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub && Notification.permission === 'granted') {
        if (btn) {
          btn.textContent = 'Mobile Push Active ✓';
          btn.className = 'text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/30 text-emerald-300 border border-emerald-400/30';
        }
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0';
        if (text) text.textContent = 'Mobile Closed-App Push: Active ✓';
        if (inlineBtn) {
          inlineBtn.textContent = 'Active ✓';
          inlineBtn.className = 'text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200 shrink-0';
        }
      } else if (Notification.permission === 'granted') {
        if (btn) btn.textContent = 'Syncing Push...';
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-500 shrink-0';
        if (text) text.textContent = 'OS Allowed: Connecting...';
        window.syncPushSubscriptionSilently && window.syncPushSubscriptionSilently();
      } else if (Notification.permission === 'denied') {
        if (btn) btn.textContent = 'Push Blocked';
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0';
        if (text) text.textContent = 'Blocked in App Settings';
        if (inlineBtn) inlineBtn.textContent = 'Allow in OS';
      } else {
        if (btn) btn.textContent = 'Enable Push (Closed-App)';
        if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-400 shrink-0';
        if (text) text.textContent = 'Mobile Closed-App Push: Off';
        if (inlineBtn) {
          inlineBtn.textContent = 'Activate';
          inlineBtn.className = 'text-[10px] font-black text-indigo-700 hover:text-indigo-900 bg-white px-2 py-0.5 rounded-md border border-indigo-200 shadow-2xs shrink-0 transition';
        }
      }
    } catch (e) {}
  };

  window.requestPushNotificationPermission = async function (silent = false) {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      if (!silent) {
        alert('Background Web Push notifications are not supported in this browser.\n\nTip: On Android, use Chrome or install the PWA for background closed-app alerts.');
      }
      return;
    }

    const btn = document.getElementById('btnPushPermission');

    try {
      let permission = Notification.permission;
      if (permission !== 'granted') {
        permission = await Notification.requestPermission();
      }

      if (permission !== 'granted') {
        if (btn) btn.textContent = 'Push Blocked';
        if (!silent) {
          alert('Notification permission was not granted. Please allow notifications in your mobile browser or Android App site settings.');
        }
        window.checkPushSubscriptionStatus();
        return;
      }

      if (btn) btn.textContent = 'Connecting Push...';

      // 1. Fetch Server VAPID Public Key
      const keyRes = await fetch('/api/notifications?action=vapid_key');
      const keyData = await keyRes.json();
      if (!keyData.success || !keyData.publicKey) {
        throw new Error('Could not retrieve VAPID key from server.');
      }

      // 2. Wait for Service Worker and Subscribe
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
        });
      }

      // 3. Register Subscription with Backend (Tagged with current logged in user & household)
      const authHeaders = typeof getAdvanceAuthHeaders === 'function' ? getAdvanceAuthHeaders() : { 'Content-Type': 'application/json' };
      const curUser = (typeof currentUser !== 'undefined' && currentUser) || (window.currentUser) || {};
      const curHousehold = (typeof currentHouseholdId !== 'undefined' && currentHouseholdId) || window.currentHouseholdId || curUser.householdId || 'H001';

      const subRes = await fetch('/api/notifications', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'subscribe',
          subscription: subscription.toJSON(),
          householdId: curHousehold,
          userId: curUser.userId || curUser.id || 'U001',
          username: curUser.username || curUser.name || 'user',
          name: curUser.name || curUser.username || 'User'
        })
      });

      const subResult = await subRes.json();
      if (subResult.success) {
        window.checkPushSubscriptionStatus();
        if (!silent && window.showToast) {
          window.showToast('success', 'Mobile Push Enabled', 'You will receive reminders even when this app is closed!');
        }
      } else {
        throw new Error(subResult.error || 'Failed to register subscription.');
      }
    } catch (err) {
      console.warn('Push registration error:', err.message);
      window.checkPushSubscriptionStatus();
      if (!silent && window.showToast) {
        window.showToast('error', 'Push Setup Error', err.message || 'Could not enable background push.');
      }
    }
  };

  window.syncPushSubscriptionSilently = function () {
    if ('Notification' in window && Notification.permission === 'granted') {
      window.requestPushNotificationPermission(true);
    }
  };

  // ========================================================
  // IN-APP FLOATING HEADS-UP NOTIFICATION BANNER SYSTEM
  // Compact 72-90px Height, Mobile Safe-Area, Strict Deduplication
  // ========================================================
  const seenNotificationEventIds = new Set();

  window.showInAppNotificationBanner = function ({ id, eventId, notificationEventId, title, body, icon, url, type, actor, amount } = {}) {
    const uniqueKey = eventId || notificationEventId || id || (title + ':' + body);
    if (uniqueKey) {
      if (seenNotificationEventIds.has(uniqueKey)) return;
      seenNotificationEventIds.add(uniqueKey);
      if (seenNotificationEventIds.size > 200) {
        const first = seenNotificationEventIds.values().next().value;
        seenNotificationEventIds.delete(first);
      }
    }

    let container = document.getElementById('inAppNotificationBannerContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'inAppNotificationBannerContainer';
      container.className = 'fixed top-3 inset-x-3 sm:inset-x-auto sm:right-5 sm:top-5 z-[9999] pointer-events-none flex flex-col items-center sm:items-end gap-2 max-w-[calc(100vw-24px)] sm:max-w-sm mx-auto sm:mx-0 w-full';
      document.body.appendChild(container);
    }

    // Enforce maximum 1 or 2 visible notifications (dismiss oldest)
    const existing = container.querySelectorAll('.in-app-banner');
    if (existing.length >= 2) {
      for (let i = 0; i <= existing.length - 2; i++) {
        if (existing[i].dismissBanner) existing[i].dismissBanner();
      }
    }

    // Play subtle haptic feedback on supported mobile devices
    if (navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100]); } catch (e) {}
    }

    // Gentle unobtrusive audio chime using Web Audio API
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {}

    const banner = document.createElement('div');
    banner.className = 'in-app-banner pointer-events-auto w-full max-w-[calc(100vw-24px)] sm:max-w-sm rounded-2xl bg-slate-900/95 text-white border border-indigo-500/50 shadow-xl backdrop-blur-md px-3.5 py-2.5 flex items-center gap-2.5 transform transition-all duration-300 ease-out translate-y-[-24px] opacity-0 cursor-pointer select-none hover:border-indigo-400 active:scale-[0.98] shadow-indigo-950/50 min-h-[72px] max-h-[90px]';
    banner.setAttribute('role', 'alert');

    let displayIcon = '<i class="fa-solid fa-bell text-amber-400"></i>';
    if (type === 'EXPENSE_ADD' || (body && body.toLowerCase().includes('added'))) {
      displayIcon = '<i class="fa-solid fa-receipt text-emerald-400"></i>';
    } else if (type === 'EXPENSE_UPDATE') {
      displayIcon = '<i class="fa-solid fa-pen text-indigo-400"></i>';
    } else if (type === 'STAFF_ATTENDANCE' || (body && body.toLowerCase().includes('staff'))) {
      displayIcon = '<i class="fa-solid fa-user-check text-purple-400"></i>';
    } else if (type === 'CONFIG_UPDATE') {
      displayIcon = '<i class="fa-solid fa-gear text-cyan-400"></i>';
    }

    const safeTitle = (title || 'Home Expence Alert').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeBody = (body || 'New household activity received.').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    banner.innerHTML = `
      <div class="w-9 h-9 rounded-xl bg-slate-800/90 border border-slate-700/80 flex items-center justify-center shrink-0 text-sm shadow-sm">
        ${displayIcon}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1 mb-0.5">
          <span class="text-[9px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            Live Alert
          </span>
          <span class="text-[9px] font-bold text-slate-400">Now</span>
        </div>
        <div class="text-xs font-black text-white leading-tight truncate">${safeTitle}</div>
        <div class="text-[11px] font-medium text-slate-300 leading-tight truncate mt-0.5">${safeBody}</div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button class="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-black shadow transition" onclick="event.stopPropagation(); this.closest('.in-app-banner').click();">
          View
        </button>
        <button class="text-slate-400 hover:text-white transition p-1 text-xs shrink-0" onclick="event.stopPropagation(); this.closest('.in-app-banner').dismissBanner();" title="Close">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;

    const dismiss = () => {
      banner.style.transform = 'translateY(-24px)';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 250);
    };
    banner.dismissBanner = dismiss;

    banner.onclick = () => {
      dismiss();
      if (url) {
        if (url.includes('#tab-expenses')) {
          window.switchTab && window.switchTab('expenses');
        } else if (url.includes('#tab-staff')) {
          window.switchTab && window.switchTab('staff');
        } else if (url.includes('#tab-settings')) {
          window.switchTab && window.switchTab('settings');
        } else {
          window.toggleNotificationCenter && window.toggleNotificationCenter();
        }
      } else {
        window.toggleNotificationCenter && window.toggleNotificationCenter();
      }
    };

    container.appendChild(banner);

    // Slide-down animation
    requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
      banner.style.opacity = '1';
    });

    // Auto dismiss after 6 seconds
    const timer = setTimeout(dismiss, 6000);
    banner.addEventListener('mouseenter', () => clearTimeout(timer));
  };

  window.initAdvanceModules = function () {
    initPWA();
    loadMasterConfig();
    loadAttendanceFromApi();
    renderAuditView();
    window.loadBackupSnapshots && window.loadBackupSnapshots();
    window.updateDataCenterMetrics && window.updateDataCenterMetrics();
    window.updateNotificationCenter && window.updateNotificationCenter();
    window.checkPushSubscriptionStatus && window.checkPushSubscriptionStatus();

    // Attach real-time input watchers to expense modal inputs
    ['inputAmount', 'inputPaidTo', 'inputCategory', 'inputDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', checkRealtimeModalAnomaly);
        el.addEventListener('change', checkRealtimeModalAnomaly);
      }
    });
  };

  // Auto-init on script load or DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.initAdvanceModules);
  } else {
    window.initAdvanceModules();
  }

})();
