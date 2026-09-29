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
        .then(reg => console.log('[PWA] Service Worker registered:', reg.scope))
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
          <span><strong>Potential Duplicate Detected:</strong> A payment of <strong>₹${amount.toLocaleString('en-IN')}</strong> to <em>"${dup.paidTo}"</em> was already recorded on <strong>${dup.date}</strong> (within 24 hrs). Check to prevent duplicate entry.</span>
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
          <span>• Potential duplicate entry: <strong>₹${Number(d.exp2.amount).toLocaleString('en-IN')}</strong> to <em>${d.exp2.paidTo}</em> on ${d.exp2.date}.</span>
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
        ${c.label}
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
        runwaySum += evalRes.remaining;
        runwayItems.push({ name: bill.name, amount: evalRes.remaining, status: 'Partially Paid' });
      } else if (evalRes && evalRes.status === 'OVERDUE') {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">Overdue by ${Math.abs(evalRes.daysDiff)}d 🚨</span>`;
        runwaySum += bill.approxAmount;
        runwayItems.push({ name: bill.name, amount: bill.approxAmount, status: 'Overdue' });
      } else if (evalRes && (evalRes.status === 'DUE_TODAY' || (evalRes.daysDiff <= 5 && evalRes.daysDiff >= 0))) {
        const text = evalRes.daysDiff === 0 ? 'Due Today ⚠️' : `Due in ${evalRes.daysDiff}d ⚠️`;
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">${text}</span>`;
        runwaySum += bill.approxAmount;
        runwayItems.push({ name: bill.name, amount: bill.approxAmount, status: text });
      } else {
        const daysDiff = evalRes ? evalRes.daysDiff : (bill.dueDay - currentDay);
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">Due ${bill.dueDay}th ⏱️</span>`;
        if (daysDiff <= 15 && daysDiff > 0) {
          runwaySum += bill.approxAmount;
          runwayItems.push({ name: bill.name, amount: bill.approxAmount, status: `Due in ${daysDiff}d` });
        }
      }

      cardsHtml += `
        <div class="p-3 bg-slate-50/70 border border-slate-200 rounded-xl flex items-center justify-between hover:bg-slate-100/70 transition">
          <div class="flex items-center space-x-2.5">
            <span class="text-xl">${bill.icon}</span>
            <div>
              <div class="text-xs font-bold text-slate-900">${bill.name}</div>
              <div class="text-[10px] text-slate-500 font-medium">Cycle: ${bill.dueDay}th of month (~₹${bill.approxAmount.toLocaleString('en-IN')})</div>
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
                  <td class="py-1 text-slate-600">${t.date}</td>
                  <td class="py-1 font-semibold text-slate-900">${t.paidTo || t.vendor || '-'}</td>
                  <td class="py-1 text-slate-600">${t.category || '-'}</td>
                  <td class="py-1 text-slate-600">${t.paidBy || '-'}</td>
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
      const headers = getAdvanceAuthHeaders({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      });
      const res = await fetch(`/api/config?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: headers
      });
      if (res.ok) {
        const json = await res.json();
        const config = json.data || json;
        if (config && typeof config === 'object') {
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

  async function saveMasterConfig(partialUpdates) {
    try {
      const headers = getAdvanceAuthHeaders();
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(partialUpdates)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          window.masterConfig = json.data;
          if (window.updateGlobalsFromConfig) {
            window.updateGlobalsFromConfig(json.data);
          }
          syncDropdownsWithConfig();
          if (window.renderAttendanceCalendar) window.renderAttendanceCalendar();
          if (window.renderBillsRadar && (window.currentFilteredExpenses || window.expensesData)) {
            window.renderBillsRadar(window.currentFilteredExpenses || window.expensesData);
          }
          if (window.renderAdminView) window.renderAdminView();
          if (window.renderAllViews) window.renderAllViews();
          if (window.showToast) {
            window.showToast('success', 'Master Config Saved!', 'Admin changes applied and synchronized in real-time.');
          }
          return true;
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

  function syncDropdownsWithConfig() {
    const config = window.masterConfig;
    if (!config) return;

    // 1. Categories Dropdowns
    if (config.categories && Array.isArray(config.categories)) {
      window.CATEGORIES = config.categories.map(c => c.name);

      const inputCat = document.getElementById('inputCategory');
      if (inputCat) {
        const currentVal = inputCat.value;
        inputCat.innerHTML = config.categories.map(c => 
          `<option value="${c.name}">${c.icon || '🏷️'} ${c.name}</option>`
        ).join('');
        if (currentVal && config.categories.some(c => c.name === currentVal)) {
          inputCat.value = currentVal;
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
        return `<button onclick="quickFilterPaidBy('${m}')" class="quick-chip px-2.5 py-1 rounded-lg font-bold ${colorClass} ${activeClass} border transition shadow-xs text-xs">${icon} ${m}</button>`;
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
          `<option value="${s.name}">${s.name} (${s.role || s.shortName})</option>`
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

    // 1. Staff Members Table
    const staffTbody = document.getElementById('adminStaffTableBody');
    if (staffTbody && config.staff) {
      staffTbody.innerHTML = config.staff.map((s) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100" data-staff-id="${s.id}">
          <td class="py-2.5 px-3">
            <input type="text" class="staff-edit-name bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-bold text-xs w-full focus:border-indigo-500" value="${s.name}">
          </td>
          <td class="py-2.5 px-3">
            <input type="text" class="staff-edit-role bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs w-full focus:border-indigo-500" value="${s.role || ''}">
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center">
              <span class="text-slate-400 mr-1 font-bold">₹</span>
              <input type="number" step="50" min="0" class="staff-edit-salary bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-24 focus:border-indigo-500" value="${s.baseSalary}">
            </div>
          </td>
          <td class="py-2.5 px-3 bg-indigo-50/60 border-x border-indigo-100">
            <div class="flex items-center space-x-1.5">
              <input type="number" min="0" max="31" class="staff-edit-leaves bg-white border-2 border-indigo-400 rounded-lg px-2 py-1 font-black text-xs text-indigo-900 w-16 text-center focus:border-indigo-600 shadow-sm" value="${s.allowedPaidLeaves ?? 4}">
              <span class="text-[10px] text-indigo-700 font-extrabold uppercase">Free Days</span>
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center space-x-1">
              <span class="text-[10px] text-slate-400 font-bold">Day</span>
              <input type="number" min="1" max="31" class="staff-edit-cycleday bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-14 text-center focus:border-indigo-500" value="${s.billingCycleDay || 30}">
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
            <button onclick="adminDeleteStaff('${s.id}')" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition" title="Delete staff member">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </td>
        </tr>
      `).join('');
    }

    // 2. Recurring Bills Table
    const billsTbody = document.getElementById('adminBillsTableBody');
    if (billsTbody && config.recurringBills) {
      billsTbody.innerHTML = config.recurringBills.map((b) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100" data-bill-id="${b.id}">
          <td class="py-2.5 px-3">
            <input type="text" class="bill-edit-icon bg-white border border-slate-200 rounded-lg px-1.5 py-1 text-xs w-10 text-center font-bold" value="${b.icon || '⚡'}">
          </td>
          <td class="py-2.5 px-3">
            <input type="text" class="bill-edit-name bg-white border border-slate-200 rounded-lg px-2.5 py-1 font-bold text-xs w-full focus:border-indigo-500" value="${b.name}">
          </td>
          <td class="py-2.5 px-3">
            <select class="bill-edit-cat bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold focus:border-indigo-500 w-full">
              ${(config.categories || []).map(c => `
                <option value="${c.name}" ${c.name === b.category ? 'selected' : ''}>${c.name}</option>
              `).join('')}
            </select>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center space-x-1">
              <span class="text-[10px] text-slate-400 font-bold">Day</span>
              <input type="number" min="1" max="31" class="bill-edit-dueday bg-white border-2 border-indigo-200 rounded-lg px-2 py-1 font-black text-xs text-indigo-700 w-16 text-center focus:border-indigo-500" value="${b.dueDay}">
            </div>
          </td>
          <td class="py-2.5 px-3">
            <div class="flex items-center">
              <span class="text-slate-400 mr-1 font-bold">₹</span>
              <input type="number" step="50" min="0" class="bill-edit-amount bg-white border border-slate-200 rounded-lg px-2 py-1 font-black text-xs w-28 focus:border-indigo-500" value="${b.approxAmount}">
            </div>
          </td>
          <td class="py-2.5 px-3 text-right">
            <button onclick="adminDeleteBill('${b.id}')" class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition" title="Delete bill">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </td>
        </tr>
      `).join('');
    }

    // 3. Categories Grid
    const catGrid = document.getElementById('adminCategoriesGrid');
    if (catGrid && config.categories) {
      catGrid.innerHTML = config.categories.map((c) => `
        <div class="p-3 bg-white border border-slate-200 rounded-2xl flex items-center justify-between hover:border-slate-300 shadow-sm transition" data-cat-name="${c.name}">
          <div class="flex items-center space-x-2.5 min-w-0">
            <span class="text-xl shrink-0">${c.icon || '🏷️'}</span>
            <div class="min-w-0">
              <div class="text-xs font-black text-slate-900 truncate">${c.name}</div>
              <div class="text-[10px] text-slate-500 flex items-center gap-1.5">
                <span class="px-1.5 py-0.2 rounded font-extrabold uppercase text-[9px] ${c.type === 'income' ? 'bg-emerald-100 text-emerald-800' : (c.type === 'transfer' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700')}">${c.type || 'expense'}</span>
                ${c.defaultPaidTo ? `<span class="truncate text-slate-400">→ ${c.defaultPaidTo}</span>` : ''}
              </div>
            </div>
          </div>
          <button onclick="adminDeleteCategory('${c.name.replace(/'/g, "\\'")}')" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg transition shrink-0" title="Delete category">
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>
      `).join('');
    }

    // 4. Family Members ("Paid By")
    const famList = document.getElementById('adminFamilyMembersList');
    if (famList && config.familyMembers) {
      famList.innerHTML = config.familyMembers.map(m => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-violet-50 text-violet-800 border border-violet-200 shadow-sm">
          <i class="fa-solid fa-user text-violet-500 mr-1.5 text-[10px]"></i>
          <span>${m}</span>
          <button onclick="adminRemoveFamilyMember('${m}')" class="ml-2 text-violet-400 hover:text-rose-600 transition font-black">&times;</button>
        </span>
      `).join('');
    }

    // 5. Payment Methods
    const payList = document.getElementById('adminPaymentMethodsList');
    if (payList && config.paymentMethods) {
      payList.innerHTML = config.paymentMethods.map(m => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-50 text-sky-800 border border-sky-200 shadow-sm">
          <i class="fa-solid fa-credit-card text-sky-500 mr-1.5 text-[10px]"></i>
          <span>${m}</span>
          <button onclick="adminRemovePaymentMethod('${m}')" class="ml-2 text-sky-400 hover:text-rose-600 transition font-black">&times;</button>
        </span>
      `).join('');
    }

    // 5b. Split & Allocation Rules ("Split Dropdown")
    const splitList = document.getElementById('adminSplitRulesList');
    if (splitList && config.splitRules) {
      splitList.innerHTML = config.splitRules.map(r => `
        <span class="inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-bold bg-purple-50 text-purple-800 border border-purple-200 shadow-sm">
          <i class="fa-solid fa-arrows-split-up-and-left text-purple-500 mr-1.5 text-[10px]"></i>
          <span>${r}</span>
          <button onclick="adminRemoveSplitRule('${r.replace(/'/g, "\\'")}')" class="ml-2 text-purple-400 hover:text-rose-600 transition font-black">&times;</button>
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

  window.saveAdminConfigFromUI = async function () {
    const config = window.masterConfig || {};

    // 1. Gather Staff Table Data
    const staffRows = document.querySelectorAll('#adminStaffTableBody tr');
    const updatedStaff = [];
    staffRows.forEach((tr, index) => {
      const id = tr.dataset.staffId || `staff-${index + 1}`;
      const name = tr.querySelector('.staff-edit-name')?.value.trim() || 'Staff';
      const role = tr.querySelector('.staff-edit-role')?.value.trim() || '';
      const baseSalary = parseFloat(tr.querySelector('.staff-edit-salary')?.value) || 0;
      const allowedPaidLeaves = parseInt(tr.querySelector('.staff-edit-leaves')?.value, 10) || 0;
      const billingCycleDay = parseInt(tr.querySelector('.staff-edit-cycleday')?.value, 10) || 30;
      const cycleType = tr.querySelector('.staff-edit-cycletype')?.value || 'calendar_month';
      const active = tr.querySelector('.staff-edit-active')?.checked !== false;

      const shortName = name.includes(' - ') ? name.split(' - ')[1].trim() : name;

      updatedStaff.push({
        id,
        name,
        shortName,
        role,
        baseSalary,
        allowedPaidLeaves,
        billingCycleDay,
        cycleType,
        active
      });
    });

    // 2. Gather Recurring Bills Table Data
    const billRows = document.querySelectorAll('#adminBillsTableBody tr');
    const updatedBills = [];
    billRows.forEach((tr, index) => {
      const id = tr.dataset.billId || `bill-${index + 1}`;
      const icon = tr.querySelector('.bill-edit-icon')?.value.trim() || '⚡';
      const name = tr.querySelector('.bill-edit-name')?.value.trim() || 'Bill';
      const category = tr.querySelector('.bill-edit-cat')?.value || 'Electricity Bill';
      const dueDay = parseInt(tr.querySelector('.bill-edit-dueday')?.value, 10) || 10;
      const approxAmount = parseFloat(tr.querySelector('.bill-edit-amount')?.value) || 0;

      updatedBills.push({
        id,
        name,
        category,
        dueDay,
        approxAmount,
        icon
      });
    });

    // 3. Gather Household Cycle
    const isCustom = document.getElementById('adminCycleTypeCustom')?.checked;
    const startDay = parseInt(document.getElementById('adminCycleStartDay')?.value, 10) || 5;
    const endDay = parseInt(document.getElementById('adminCycleEndDay')?.value, 10) || 5;

    const updatedCycle = {
      type: isCustom ? 'custom' : 'calendar',
      cycleStartDay: startDay,
      cycleEndDay: endDay,
      description: isCustom ? `${startDay}th of current month to ${endDay}th of next month` : 'Standard Calendar Month (1st to month end)'
    };

    // 4. Gather Monthly Budget Target
    const monthlyBudgetLimit = parseFloat(document.getElementById('adminMonthlyBudgetLimit')?.value) || 50000;

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

    await saveMasterConfig(payload);
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
    const approxAmount = parseFloat(document.getElementById('adminNewBillAmount')?.value) || 0;

    if (!name) return;

    const newBill = {
      id: `bill-${Date.now()}`,
      name,
      category,
      icon,
      dueDay,
      approxAmount
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
  window.openAdminAddCategoryModal = function () {
    const modal = document.getElementById('adminAddCategoryModal');
    if (modal) modal.classList.remove('hidden');
  };
  window.closeAdminAddCategoryModal = function () {
    const modal = document.getElementById('adminAddCategoryModal');
    if (modal) modal.classList.add('hidden');
  };
  window.adminSaveNewCategory = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('adminNewCatName')?.value.trim();
    const icon = document.getElementById('adminNewCatIcon')?.value.trim() || '🏷️';
    const type = document.getElementById('adminNewCatType')?.value || 'expense';
    const defaultPaidTo = document.getElementById('adminNewCatPayee')?.value.trim() || '';

    if (!name) return;

    const newCat = { name, icon, type, defaultPaidTo };
    const currentCats = (window.masterConfig && window.masterConfig.categories) ? [...window.masterConfig.categories] : [];
    if (currentCats.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      alert('A category with this name already exists.');
      return;
    }
    currentCats.push(newCat);

    await saveMasterConfig({ categories: currentCats });
    window.closeAdminAddCategoryModal();
    const form = document.getElementById('adminAddCategoryForm');
    if (form) form.reset();
  };

  window.adminDeleteCategory = async function (catName) {
    if (!confirm(`Are you sure you want to remove the category "${catName}"?`)) return;
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
    if (!confirm(`Remove family member "${memberName}"?`)) return;
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
    if (!confirm(`Remove payment method "${methodName}"?`)) return;
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
          <div class="font-black text-slate-900 text-xs">${meta.amount ? '₹' + Number(meta.amount).toLocaleString('en-IN') : ''} <span class="font-normal text-slate-500">(${meta.category || 'General'})</span></div>
          <div class="text-[10px] text-slate-500">Paid: <strong class="text-slate-700">${meta.paidBy || '—'}</strong>${meta.splitBetween ? ' • <span class="text-purple-700 font-semibold">' + meta.splitBetween + '</span>' : ''}</div>
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
                <button onclick="window.toggleAuditInspect('${timelineInspectId}')" class="p-1 px-2.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 border border-slate-200 transition text-[11px] font-bold" title="Inspect Raw Payload">
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
            <button onclick="window.toggleAuditInspect('${tableInspectId}')" class="p-1.5 rounded-lg bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 border border-slate-200 transition" title="Inspect Raw Payload">
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
        <button onclick="setPersonalViewFilter('${m}')" id="btnPersonalFilter_${m.replace(/\s+/g, '_')}" class="px-3 py-1.5 rounded-lg transition ${cls}">
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
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black bg-pink-50 text-pink-700 border border-pink-200">${payer.toLowerCase().includes('pallavi') ? '🌸' : '👤'} ${payer}</span>`
        : `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">👤 ${payer}</span>`;

      const d = item.date ? new Date(item.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

      return `
        <tr class="hover:bg-purple-50/40 transition">
          <td class="py-2.5 px-3 whitespace-nowrap text-slate-600 font-semibold">${d}</td>
          <td class="py-2.5 px-3 whitespace-nowrap">${badge}</td>
          <td class="py-2.5 px-3 font-bold text-slate-900">${item.category || '-'}</td>
          <td class="py-2.5 px-3 text-slate-500 text-[11px]">${item.paymentMethod || 'UPI / Cash'}</td>
          <td class="py-2.5 px-3 text-slate-600 max-w-[200px] truncate" title="${item.notes || item.description || item.paidTo || ''}">${item.notes || item.description || item.paidTo || '-'}</td>
          <td class="py-2.5 px-3 text-right font-black text-purple-900 font-mono text-sm">${window.formatINR ? window.formatINR(item.amount) : '₹' + item.amount.toLocaleString('en-IN')}</td>
          <td class="py-2.5 px-3 text-center whitespace-nowrap">
            <button onclick="editExpense('${item.id}')" class="p-1 text-slate-400 hover:text-indigo-600 transition" title="Edit expense">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="deleteExpense('${item.id}')" class="p-1 ml-1 text-slate-400 hover:text-rose-600 transition" title="Delete expense">
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
                <button onclick="restoreSnapshotPrompt('${s.filename}')" class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-black rounded-lg text-[11px] transition shadow-xs inline-flex items-center space-x-1">
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
    if (bill.active === false) {
      return { status: 'DISABLED', totalPaid: 0, targetAmount: bill.approxAmount, remaining: 0, daysDiff: 0, matchingExpenses: [] };
    }

    const currentDay = refDate.getDate();
    const dueDay = Number(bill.dueDay) || 1;
    const daysDiff = dueDay - currentDay;
    const targetAmount = Number(bill.approxAmount) || 0;

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

  window.toggleNotificationCenter = function () {
    const dropdown = document.getElementById('notificationCenterDropdown');
    if (!dropdown) return;
    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      window.updateNotificationCenter();
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
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

  window.updateNotificationCenter = function () {
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
              <span class="text-lg shrink-0">${item.icon}</span>
              <div>
                <div class="font-black text-slate-900 leading-tight">${item.title}</div>
                <div class="text-[11px] text-slate-600 font-medium mt-0.5">${item.description}</div>
              </div>
            </div>
            <button onclick="dismissNotificationItem('${item.id}')" class="text-slate-400 hover:text-slate-600 p-1 text-xs" title="Dismiss">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="flex justify-end space-x-2 pt-1">
            <button onclick="triggerNotificationAction('${item.id}')" class="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-[11px] shadow-xs transition">
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
    if (!btn) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      btn.textContent = 'Push Unsupported';
      btn.disabled = true;
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') {
        btn.textContent = 'Mobile Push Active ✓';
        btn.className = 'text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/30 text-emerald-300 border border-emerald-400/30';
      } else {
        btn.textContent = 'Enable Push (Closed-App)';
      }
    } catch (e) {}
  };

  window.requestPushNotificationPermission = async function () {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('Background Web Push notifications are not supported in this browser.\n\nTip: On Android, use Chrome or install the PWA for background closed-app alerts.');
      return;
    }

    const btn = document.getElementById('btnPushPermission');

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (btn) btn.textContent = 'Push Blocked';
        alert('Notification permission was denied. Please allow notifications in your mobile browser or Android App site settings.');
        return;
      }

      if (btn) {
        btn.textContent = 'Connecting Push...';
      }

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

      // 3. Register Subscription with Backend
      const subRes = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'subscribe',
          subscription: subscription.toJSON()
        })
      });

      const subResult = await subRes.json();
      if (subResult.success) {
        if (btn) {
          btn.textContent = 'Mobile Push Active ✓';
          btn.className = 'text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/30 text-emerald-300 border border-emerald-400/30';
        }
        window.showToast && window.showToast('success', 'Mobile Push Enabled', 'You will receive reminders even when this app is closed!');
      } else {
        throw new Error(subResult.error || 'Failed to register subscription.');
      }
    } catch (err) {
      console.error('Push registration error:', err);
      if (btn) btn.textContent = 'Enable Push';
      window.showToast && window.showToast('error', 'Push Setup Error', err.message || 'Could not enable background push.');
    }
  };

  window.sendTestClosedAppPush = async function () {
    try {
      window.showToast && window.showToast('info', 'Sending Test Alert', 'Close this app or lock your phone now! A push alert will arrive in 4 seconds...');
      setTimeout(async () => {
        const res = await fetch('/api/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'test_push',
            title: '⚡ HomeExpenses: Test Alert (Closed-App)',
            body: 'It works! You received this notification even with the app closed or phone locked.',
            url: '/'
          })
        });
        const data = await res.json();
        if (data.success) {
          console.log('Test push dispatched:', data.message);
        }
      }, 4000);
    } catch (e) {
      console.warn('Test push trigger error:', e);
    }
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
