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
  // Financial Rule: Palash returns 100% of every rupee paid by Pallavi monthly as income flow.
  // Pallavi NEVER owes Palash, and expenses are NOT 50/50.
  // ========================================================

  function renderSplitwiseMatrix(filtered) {
    const grid = document.getElementById('splitwiseCardsGrid');
    const settleContainer = document.getElementById('settleUpActionContainer');
    if (!grid) return;

    let pallaviPaid = 0;
    let palashDirectPaid = 0;
    let reimbursedByPalash = 0;

    filtered.forEach(exp => {
      const amt = parseFloat(exp.amount || 0);
      if (isNaN(amt) || amt <= 0) return;
      if (exp.category === 'Accepted Payments (Income)') return;

      const paidBy = (exp.paidBy || '').trim().toLowerCase();
      const paidTo = (exp.paidTo || exp.vendor || '').trim().toLowerCase();
      const cat = (exp.category || '').toLowerCase();
      const notes = (exp.notes || exp.description || '').toLowerCase();

      // Check if this is a settlement/reimbursement transfer from Palash to Pallavi
      const isSettlement = cat.includes('settlement') || cat.includes('reimbursement') ||
        (paidBy.includes('palash') && (paidTo.includes('pallavi') || notes.includes('reimburse') || notes.includes('settle')));

      if (isSettlement) {
        if (paidBy.includes('palash')) {
          reimbursedByPalash += amt;
        }
      } else {
        if (paidBy.includes('pallavi')) {
          // If explicitly marked as personal non-reimbursable, skip reimbursement
          if (exp.splitBetween === 'Personal Expense (Pallavi - Not Reimbursed)') {
            // Personal expense of Pallavi, not reimbursed
          } else {
            // Household expense paid out of Pallavi's pocket -> Palash returns 100%
            pallaviPaid += amt;
          }
        } else if (paidBy.includes('palash')) {
          // Direct household spend funded by Palash
          palashDirectPaid += amt;
        }
      }
    });

    // Net Reimbursement Balance: Palash owes Pallavi 100% of Pallavi's household spend minus any settlements already paid
    const netDueToPallavi = Math.max(0, Math.round(pallaviPaid - reimbursedByPalash));
    currentNetSettleAmount = netDueToPallavi;
    currentSettlePayer = 'Palash';
    currentSettleReceiver = 'Pallavi';

    let verdictCard = '';
    if (netDueToPallavi <= 0) {
      verdictCard = `
        <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Monthly Reimbursement Status</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">Fully Settled</span>
            </div>
            <h4 class="text-xl font-black text-emerald-950 mt-2">✨ All Reimbursed &amp; Settled Up</h4>
            <div class="text-2xl font-black text-emerald-600 mt-0.5">₹0 Due</div>
            <p class="text-xs text-emerald-700 font-medium mt-1">Palash has reimbursed all payments made by Pallavi for this period.</p>
          </div>
          <div class="mt-3 pt-2 border-t border-emerald-200 text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
            <i class="fa-solid fa-check-circle"></i>
            <span>No pending balance to return to Pallavi.</span>
          </div>
        </div>
      `;
    } else {
      verdictCard = `
        <div class="p-4 rounded-2xl bg-indigo-50/80 border-2 border-indigo-300 flex flex-col justify-between shadow-sm">
          <div>
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-extrabold uppercase tracking-wider text-indigo-900">Reimbursement Balance Due</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-900 border border-indigo-200">Income Flow to Pallavi</span>
            </div>
            <h4 class="text-base font-bold text-slate-700 mt-2">Palash owes Pallavi</h4>
            <div class="text-3xl font-black text-indigo-600 mt-0.5">₹${netDueToPallavi.toLocaleString('en-IN')}</div>
            <p class="text-xs text-indigo-950 font-medium mt-1">
              Every rupee paid by Pallavi is returned monthly by Palash as income flow.
            </p>
          </div>
          <div class="mt-3 pt-2 border-t border-indigo-200 flex justify-between items-center text-xs">
            <span class="font-bold text-slate-600">Pending Return:</span>
            <span class="font-black text-indigo-700">₹${netDueToPallavi.toLocaleString('en-IN')}</span>
          </div>
        </div>
      `;
    }

    grid.innerHTML = `
      <!-- Card 1: Pallavi Household Expenses -->
      <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Pallavi Household Spend</span>
            <span class="text-xs font-black text-pink-700 bg-pink-100 px-2 py-0.5 rounded">Pallavi Paid</span>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Total Paid by Pallavi:</span>
              <span class="font-black text-slate-900">₹${Math.round(pallaviPaid).toLocaleString('en-IN')}</span>
            </div>
            <p class="text-[11px] text-slate-500 mt-1">
              Blinkit, groceries &amp; household purchases funded out of pocket.
            </p>
          </div>
        </div>
        <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
          <span class="font-bold text-slate-500">To be Returned 100%:</span>
          <span class="font-black text-pink-700">₹${Math.round(pallaviPaid).toLocaleString('en-IN')}</span>
        </div>
      </div>

      <!-- Card 2: Palash Direct Expenses & Reimbursements -->
      <div class="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Palash Direct Outflows</span>
            <span class="text-xs font-black text-violet-700 bg-violet-100 px-2 py-0.5 rounded">Palash Funded</span>
          </div>
          <div class="mt-2 space-y-1">
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Direct Spend (Bills/Staff/Rent):</span>
              <span class="font-black text-slate-900">₹${Math.round(palashDirectPaid).toLocaleString('en-IN')}</span>
            </div>
            <div class="flex justify-between text-xs">
              <span class="text-slate-600 font-semibold">Reimbursed to Pallavi so far:</span>
              <span class="font-bold text-emerald-600">₹${Math.round(reimbursedByPalash).toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>
        <div class="mt-3 pt-2 border-t border-slate-200 flex justify-between text-xs">
          <span class="font-bold text-slate-500">Pallavi owes Palash:</span>
          <span class="font-black text-slate-400">₹0 (Never owes)</span>
        </div>
      </div>

      <!-- Card 3: Net Reimbursement Verdict -->
      ${verdictCard}
    `;

    // Settle Up button in header
    if (settleContainer) {
      if (netDueToPallavi <= 0) {
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
            <span>1-Click Settle Up (Return ₹${netDueToPallavi.toLocaleString('en-IN')})</span>
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

    if (amtEl) amtEl.textContent = `₹${currentNetSettleAmount.toLocaleString('en-IN')}`;
    if (descEl) descEl.textContent = `Palash returns ₹${currentNetSettleAmount.toLocaleString('en-IN')} to Pallavi as monthly household reimbursement (income flow).`;
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
    if (payerEl) payerEl.value = 'Palash';

    modal.classList.remove('hidden');
  };

  window.closeSettleUpModal = function () {
    const modal = document.getElementById('settleUpModal');
    if (modal) modal.classList.add('hidden');
  };

  window.executeSettleUpTransaction = async function () {
    const date = document.getElementById('settleUpDate')?.value || new Date().toISOString().split('T')[0];
    const payer = document.getElementById('settleUpPaidBy')?.value || 'Palash';
    const receiver = 'Pallavi';
    const method = document.getElementById('settleUpPaymentMethod')?.value || 'UPI / GPay / PhonePe';
    const amount = currentNetSettleAmount;

    if (!amount || amount <= 0) {
      alert('No outstanding balance to settle.');
      return;
    }

    const payload = {
      date: date,
      amount: amount,
      category: 'Settlement / Transfer',
      paidBy: payer,
      paidTo: receiver,
      vendor: receiver,
      paymentMethod: method,
      notes: `Monthly Reimbursement: ${payer} returned ₹${amount.toLocaleString('en-IN')} to ${receiver} for household expenses`,
      description: `Monthly Reimbursement: ${payer} returned ₹${amount.toLocaleString('en-IN')} to ${receiver} for household expenses`,
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
        window.closeSettleUpModal();
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
        alert('Failed to record settlement: ' + (data.error || 'Server error'));
      }
    } catch (err) {
      console.error('Error settling up:', err);
      alert('Error recording settlement: ' + err.message);
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
      // Find if paid in current month
      const paidExp = allExpenses.find(e => {
        if (!e.date) return false;
        const d = new Date(e.date);
        const isCurrentMonth = (d.getMonth() + 1) === currentMonth && d.getFullYear() === currentYear;
        const isMatch = (e.category || '').toLowerCase().includes(bill.category.toLowerCase()) ||
          (e.paidTo || e.vendor || '').toLowerCase().includes(bill.name.toLowerCase());
        return isCurrentMonth && isMatch;
      });

      let statusBadge = '';
      const daysDiff = bill.dueDay - currentDay;

      if (paidExp) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">Paid ₹${Number(paidExp.amount).toLocaleString('en-IN')} ✅</span>`;
      } else if (daysDiff < 0) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">Overdue by ${Math.abs(daysDiff)}d 🚨</span>`;
        runwaySum += bill.approxAmount;
        runwayItems.push({ name: bill.name, amount: bill.approxAmount, status: 'Overdue' });
      } else if (daysDiff <= 5) {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">Due in ${daysDiff === 0 ? 'Today' : daysDiff + 'd'} ⚠️</span>`;
        runwaySum += bill.approxAmount;
        runwayItems.push({ name: bill.name, amount: bill.approxAmount, status: `Due in ${daysDiff}d` });
      } else {
        statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">Due ${bill.dueDay}th ⏱️</span>`;
        if (daysDiff <= 15) {
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

  async function loadAttendanceFromApi() {
    try {
      const res = await fetch('/api/attendance');
      if (res.ok) {
        const json = await res.json();
        const data = json.data || json;
        if (data && typeof data === 'object') {
          staffAttendanceState = { ...staffAttendanceState, ...data };
        }
      }
    } catch (e) {
      console.warn('Could not load attendance from API:', e);
    }
  }

  async function saveAttendanceToApi(staffName, monthKey, record) {
    try {
      await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staff: staffName,
          month: monthKey,
          days: record.days || {},
          bonus: record.bonus || 0,
          notes: record.notes || ''
        })
      });
    } catch (e) {
      console.error('Error saving attendance to API:', e);
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
        saveAttendanceToApi(staffName, monthKey, monthRecord);
        window.renderAttendanceCalendar();
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
    const bonusInput = document.getElementById('inputStaffBonus');
    const bonus = bonusInput ? (parseFloat(bonusInput.value) || 0) : (monthRecord.bonus || 0);

    const payableDays = (presentCount + holidayCount) + (halfCount * 0.5);
    const netPayable = Math.max(0, Math.round(baseSalary - leaveDeductions + bonus));

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
    if (bonusInput && document.activeElement !== bonusInput) {
      bonusInput.value = monthRecord.bonus || 0;
    }

    // Cache calculation for Quick Pay & Voucher
    window.currentStaffCalc = {
      staff: staffName,
      month: monthKey,
      baseSalary: baseSalary,
      daysInMonth: daysInMonth,
      leaveCount: leaveCount,
      halfCount: halfCount,
      deductions: Math.round(leaveDeductions),
      bonus: bonus,
      netPayable: netPayable
    };
  };

  window.onBonusChange = function () {
    const staffSelect = document.getElementById('attendanceStaffSelect');
    const bonusInput = document.getElementById('inputStaffBonus');
    if (!staffSelect || !bonusInput) return;

    const staffName = staffSelect.value || 'Chef - Nilima Nikose';
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (staffAttendanceState[staffName]?.months?.[monthKey]) {
      staffAttendanceState[staffName].months[monthKey].bonus = parseFloat(bonusInput.value) || 0;
      saveAttendanceToApi(staffName, monthKey, staffAttendanceState[staffName].months[monthKey]);
      window.renderAttendanceCalendar();
    }
  };

  window.generateWhatsAppVoucher = function () {
    const calc = window.currentStaffCalc;
    if (!calc) {
      alert('Attendance data not ready.');
      return;
    }

    const dateFormatted = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const voucherText =
`*PAYROLL & SALARY VOUCHER - HOMEEXPENSES*
👤 *Staff Member:* ${calc.staff}
📅 *Month / Cycle:* ${calc.month}
💵 *Base Monthly Salary:* ₹${calc.baseSalary.toLocaleString('en-IN')}
❌ *Leaves / Absences:* ${calc.leaveCount} days (${calc.halfCount} half-days)
✂️ *Pro-rata Leave Deductions:* -₹${calc.deductions.toLocaleString('en-IN')}
🎁 *Festive / Bonus Allowance:* +₹${calc.bonus.toLocaleString('en-IN')}
------------------------------------------------
✅ *NET SALARY PAYABLE: ₹${calc.netPayable.toLocaleString('en-IN')}*
------------------------------------------------
🗓️ *Voucher Generated:* ${dateFormatted}
*Status:* Confirmed & Disbursed via UPI.
Thank you for your valuable household support! 🙏`;

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

  async function loadMasterConfig() {
    try {
      const res = await fetch('/api/config');
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
          const adminView = document.getElementById('view-admin');
          if (adminView && !adminView.classList.contains('hidden')) {
            window.renderAdminView();
          }
        }
      }
    } catch (err) {
      console.warn('Could not load master config from /api/config:', err);
    }
  }
  window.loadMasterConfig = loadMasterConfig;

  async function saveMasterConfig(partialUpdates) {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (config.familyMembers && Array.isArray(config.familyMembers)) {
      window.FAMILY_MEMBERS = config.familyMembers;

      const inputPaidBy = document.getElementById('inputPaidBy');
      if (inputPaidBy) {
        const currentVal = inputPaidBy.value;
        const memberOptions = config.familyMembers.map(m => 
          `<option value="${m}">${m}</option>`
        ).join('');
        inputPaidBy.innerHTML = memberOptions + `<option value="Not Specified">Not Specified</option>`;
        if (currentVal) {
          inputPaidBy.value = currentVal;
        }
      }

      const filterPaidBy = document.getElementById('filterPaidBy');
      if (filterPaidBy) {
        const currentVal = filterPaidBy.value;
        const memberOptions = config.familyMembers.map(m => 
          `<option value="${m}">👤 ${m}</option>`
        ).join('');
        filterPaidBy.innerHTML = `<option value="all">Paid By: All</option>` + memberOptions + `<option value="Not Specified">❓ Not Specified</option>`;
        if (currentVal) {
          filterPaidBy.value = currentVal;
        }
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
    if (!config) return;

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

    const payload = {
      ...config,
      staff: updatedStaff,
      recurringBills: updatedBills,
      householdCycle: updatedCycle
    };

    await saveMasterConfig(payload);
  };

  window.resetAdminConfigToDefaults = async function () {
    if (!confirm('Are you sure you want to reset all master configuration settings to application defaults?')) return;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          familyMembers: ["Palash", "Pallavi", "Mom", "Dad"],
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

  window.initAdvanceModules = function () {
    initPWA();
    loadMasterConfig();
    loadAttendanceFromApi();

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
