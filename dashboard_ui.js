// Dashboard design layer: the "New" dashboard and its Appearance settings.
//
// Two designs share one dashboard tab. "Classic" is the original markup and
// is the default; "New" is built here into #dashNew and shown instead of it.
// Either way the figures come from the same place: the New design copies the
// values the existing render pass already computed and only groups the
// filtered ledger for its own lists, so the two designs cannot disagree. This
// file makes no API calls and reads no storage other than its own preference
// key.
(function () {
    "use strict";

    // ------------------------------------------------------------------ prefs
    const SECTION_KEYS = [
        'kpi', 'insights',
        'chart-category', 'chart-family', 'chart-trend', 'chart-payment',
        'bills', 'reimbursement', 'staff', 'top', 'recent', 'timeline'
    ];
    const SECTION_LABELS = {
        'kpi': 'Key figures', 'insights': 'Financial insights',
        'chart-category': 'Spending by category', 'chart-family': 'Spending by family member',
        'chart-trend': 'Monthly cash-flow trend', 'chart-payment': 'Payment methods',
        'bills': 'Upcoming bills', 'reimbursement': 'Who owes whom', 'staff': 'Staff payments',
        'top': 'Top expenses', 'recent': 'Recent transactions', 'timeline': 'Activity timeline'
    };
    const DESIGNS = ['classic', 'new', 'minimal', 'analytics', 'timeline'];
    const LAYOUTS = ['default', 'compact', 'focus'];
    const DENSITIES = ['comfortable', 'compact'];
    // How the home card treats the monthly budget: lead with what is left, lead
    // with what was spent (budget stays visible), or leave the budget out.
    const HERO_BUDGET = ['remaining', 'spent', 'hidden'];

    // "Financial Focus" keeps the money picture and drops the long lists.
    const FOCUS_OFF = ['top', 'chart-family', 'staff', 'reimbursement'];

    function defaults() {
        const sections = {};
        SECTION_KEYS.forEach(k => { sections[k] = true; });
        return { design: 'classic', layout: 'default', kpiDensity: 'comfortable', mobileDensity: 'comfortable', heroBudget: 'remaining', sections, defaultTheme: '' };
    }

    // Only known keys and known values survive. Anything else - a stale key from
    // an older build, a hand-edited object - is dropped rather than trusted.
    function sanitize(raw) {
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        if (DESIGNS.includes(raw.design)) out.design = raw.design;
        if (LAYOUTS.includes(raw.layout)) out.layout = raw.layout;
        if (DENSITIES.includes(raw.kpiDensity)) out.kpiDensity = raw.kpiDensity;
        if (DENSITIES.includes(raw.mobileDensity)) out.mobileDensity = raw.mobileDensity;
        if (HERO_BUDGET.includes(raw.heroBudget)) out.heroBudget = raw.heroBudget;
        if (typeof raw.defaultTheme === 'string' && /^[a-z0-9_-]{0,24}$/i.test(raw.defaultTheme)) out.defaultTheme = raw.defaultTheme;
        if (raw.sections && typeof raw.sections === 'object') {
            out.sections = {};
            SECTION_KEYS.forEach(k => { if (typeof raw.sections[k] === 'boolean') out.sections[k] = raw.sections[k]; });
        }
        return out;
    }

    function merge(base, over) {
        const o = sanitize(over);
        const r = Object.assign({}, base, o);
        r.sections = Object.assign({}, base.sections, o.sections || {});
        return r;
    }

    function user() { return window.currentSessionUser || {}; }
    function deviceKey() {
        const u = user();
        // Namespaced by user AND household, so a later login on the same device
        // never inherits somebody else's layout.
        return 'ghar_dash_ui:' + (u.userId || 'anon') + ':' + (u.householdId || 'none');
    }
    function readDevice() {
        try { return sanitize(JSON.parse(localStorage.getItem(deviceKey()) || 'null')); } catch (e) { return {}; }
    }
    function householdPrefs() {
        const cfg = window.masterConfig || {};
        return sanitize(cfg.dashboardUi);
    }
    // Defaults < household default (owner-set) < this device.
    function effective() {
        return merge(merge(defaults(), householdPrefs()), readDevice());
    }

    // ---------------------------------------------------------------- helpers
    const fmt = (v) => (window.formatINR ? window.formatINR(v) : '₹' + Number(v || 0).toLocaleString('en-IN'));
    const esc = (v) => (window.escapeHtml ? window.escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
    const $ = (id) => document.getElementById(id);
    // New-design pieces differ per design; a piece a design does not lay out
    // resolves to a detached node so its render function is simply a no-op.
    const SINK = document.createElement('div');
    const $d = (id) => document.getElementById(id) || SINK;
    const text = (id) => { const e = $(id); return e ? e.textContent.trim() : ''; };
    const isHidden = (id) => { const e = $(id); return !e || e.classList.contains('hidden'); };
    const INCOME_CATEGORY = 'Accepted Payments (Income)';

    function categoryTypes() {
        const map = {};
        ((window.masterConfig || {}).categories || []).forEach(c => { map[String(c.name).toLowerCase()] = c.type || 'expense'; });
        return map;
    }
    function isSpend(e, types) {
        const t = types[String(e.category || '').toLowerCase()];
        return !e.isDeleted && t !== 'income' && t !== 'transfer';
    }
    function group(list, keyFn) {
        const by = {};
        let total = 0;
        list.forEach(e => {
            const k = keyFn(e) || 'Other';
            const v = Number(e.amount) || 0;
            by[k] = (by[k] || 0) + v;
            total += v;
        });
        return { by, total, keys: Object.keys(by).sort((a, b) => by[b] - by[a]) };
    }

    // ------------------------------------------------------------------ apply
    function apply() {
        const p = effective();
        const root = document.documentElement;
        root.dataset.dashDesign = p.design;
        root.dataset.dashLayout = p.layout;
        root.dataset.dashKpi = p.kpiDensity;
        root.dataset.dashMobile = p.mobileDensity;
        root.dataset.dashHeroBudget = p.heroBudget;

        SECTION_KEYS.forEach(k => {
            const off = p.sections[k] === false || (p.layout === 'focus' && FOCUS_OFF.includes(k));
            document.querySelectorAll('#dashNew [data-dash-section="' + k + '"]')
                .forEach(el => el.classList.toggle('dash-section-off', off));
        });

        // A default theme is only a default: it never overrides a choice the
        // person already made on this device.
        if (p.defaultTheme && !localStorage.getItem('household_app_theme') && typeof window.changeTheme === 'function') {
            try { window.changeTheme(p.defaultTheme); } catch (e) { /* theme not available */ }
        }
        return p;
    }

    // ------------------------------------------------------- new dashboard DOM
    const KPIS = [
        { id: 'statTotalSpent', label: 'Total expenses', icon: 'i-wallet' },
        { id: 'statTotalIncome', label: 'Total income', icon: 'i-trending-up' },
        { id: 'statNetCashFlow', label: 'Net cash flow', icon: 'i-arrow-left-right', flow: true },
        { id: 'statAvgPerDay', label: 'Daily average', icon: 'i-calendar' },
        { id: 'statBudgetUsed', label: 'Budget used', icon: 'i-gauge', more: true },
        { id: 'statBudgetRemaining', label: 'Remaining budget', icon: 'i-piggy-bank', more: true },
        { id: 'statPendingBillsCount', label: 'Pending bills', icon: 'i-receipt', more: true, source: 'kpiPendingBills' },
        { id: 'statStaffTotal', label: 'Staff payroll', icon: 'i-users', more: true, source: 'kpiStaffPayroll' }
    ];

    function section(key, title, body, extra) {
        return '<section class="dn-card ' + (extra || '') + '" data-dash-section="' + key + '" aria-label="' + esc(title) + '">'
            + '<h3 class="dn-card-title">' + esc(title) + '</h3>' + body + '</section>';
    }
    // On a phone the secondary cards sit behind a one-line header; wider
    // screens always show them open.
    function fold(key, title, bodyId, extra) {
        return '<details class="dn-card dn-fold ' + (extra || '') + '" data-dash-section="' + key + '" data-dn-fold>'
            + '<summary class="dn-card-title"><span>' + esc(title) + '</span>'
            + '<svg class="ic" aria-hidden="true"><use href="#i-chevron-down"></use></svg></summary>'
            + '<div id="' + bodyId + '"></div></details>';
    }

    // Pieces shared by every new design. A design is a different arrangement of
    // the same pieces, each one filled by the render functions below.
    const TITLES = { new: 'Overview', minimal: 'At a glance', analytics: 'Analytics', timeline: 'Activity' };
    function headHtml(design) {
        return '<header class="dn-top">'
            + '<div class="dn-top-text"><p id="dnPeriod" class="dn-eyebrow">This month</p>'
            + '<h2 class="dn-title">' + esc(TITLES[design] || 'Overview') + '</h2></div>'
            + '<button type="button" id="dnScope" class="dn-chip" data-click="a038" aria-label="Dashboard view mode. Change it in Master Settings.">'
            + '<svg class="ic" aria-hidden="true"><use href="#i-house"></use></svg><span>Household</span></button>'
            + '</header>';
    }
    // The one number that matters, with the budget ring.
    function heroHtml() {
        return '<section class="dn-hero" aria-label="Budget">'
            + '<div class="dn-ring" id="dnRingWrap"><svg viewBox="0 0 100 100" class="dn-ring-svg" aria-hidden="true">'
            + '<circle class="dn-ring-bg" cx="50" cy="50" r="42"></circle>'
            + '<circle id="dnRing" class="dn-ring-fg" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="0 100"></circle></svg>'
            + '<span id="dnRingPct" class="dn-ring-pct">0%</span></div>'
            + '<div class="dn-hero-main"><p id="dnHeroLabel" class="dn-hero-label">Remaining budget</p>'
            + '<p id="dnHeroFig" class="dn-hero-fig">₹0</p>'
            + '<p id="dnHeroNote" class="dn-hero-note"></p></div>'
            + '<dl class="dn-hero-stats">'
            + '<div><dt>Spent</dt><dd id="dnHeroSpent">₹0</dd></div>'
            + '<div><dt>Net flow</dt><dd id="dnHeroNet">₹0</dd></div>'
            + '<div id="dnHeroBudgetStat"><dt>Budget</dt><dd id="dnHeroBudget">-</dd></div></dl>'
            + '<div class="dn-hero-actions">'
            + '<button type="button" class="dn-btn dn-btn-primary" data-click="a024"><svg class="ic" aria-hidden="true"><use href="#i-plus"></use></svg><span>Record expense</span></button>'
            + '<button type="button" class="dn-btn" data-dn-go="bills"><svg class="ic" aria-hidden="true"><use href="#i-receipt"></use></svg><span>Bills</span></button>'
            + '<button type="button" class="dn-btn" data-click="a053"><svg class="ic" aria-hidden="true"><use href="#i-file-down"></use></svg><span>Export</span></button>'
            + '</div></section>';
    }
    function kpiHtml() {
        return '<section class="dn-kpis" id="dnKpis" data-dash-section="kpi" aria-label="Key figures">'
            + KPIS.map(k => '<div class="dn-kpi' + (k.more ? ' dn-more' : '') + '" data-dn-kpi="' + k.id + '"'
                + (k.source ? ' data-dn-source="' + k.source + '"' : '') + '>'
                + '<span class="dn-kpi-ic"><svg class="ic" aria-hidden="true"><use href="#' + k.icon + '"></use></svg></span>'
                + '<span class="dn-kpi-k">' + esc(k.label) + '</span>'
                + '<strong class="dn-kpi-v" id="dn_' + k.id + '">-</strong></div>').join('')
            + '<button type="button" id="dnMoreFigures" class="dn-morebtn" aria-expanded="false" aria-controls="dnKpis">'
            + '<span>More figures</span><svg class="ic" aria-hidden="true"><use href="#i-chevron-down"></use></svg></button>'
            + '</section>';
    }
    const insightsHtml = () => '<section class="dn-insights" id="dnInsights" data-dash-section="insights" aria-label="Financial insights"></section>';
    const recentHtml = (extra) => section('recent', 'Recent transactions', '<div id="dnRecent" class="dn-list"></div>'
        + '<button type="button" class="dn-link" data-dn-go="expenses">See all expenses</button>', extra);

    // The four arrangements. "new" is the overview; the others are for
    // different habits: glance only, chart led, and a day-by-day activity feed.
    const BODIES = {
        new: () => '<div class="dn-grid">'
            + section('chart-category', 'Where the money goes', '<div id="dnCategory"></div>', 'dn-span-5')
            + section('chart-trend', 'Cash flow this year', '<div id="dnTrend"></div>', 'dn-span-7')
            + section('bills', 'Upcoming bills', '<div id="dnBills"></div>', 'dn-span-4')
            + section('chart-payment', 'Payment methods', '<div id="dnPayment"></div>', 'dn-span-4')
            + fold('chart-family', 'Spending by family member', 'dnFamily', 'dn-span-4')
            + fold('reimbursement', 'Who owes whom', 'dnReimb', 'dn-span-6')
            + fold('staff', 'Staff payments', 'dnStaff', 'dn-span-6')
            + recentHtml('dn-span-6')
            + fold('top', 'Top expenses', 'dnTop', 'dn-span-6')
            + '</div>',
        // Glance: the budget, what is due and what just happened. Nothing else.
        minimal: () => '<div class="dn-grid">'
            + section('bills', 'Upcoming bills', '<div id="dnBills"></div>', 'dn-span-12')
            + recentHtml('dn-span-12')
            + '</div>',
        // Analytics: charts first, no transaction lists.
        analytics: () => insightsHtml()
            + '<div class="dn-grid">'
            + section('chart-trend', 'Cash flow this year', '<div id="dnTrend"></div>', 'dn-span-12 dn-tall')
            + section('chart-category', 'Where the money goes', '<div id="dnCategory"></div>', 'dn-span-6')
            + section('chart-payment', 'Payment methods', '<div id="dnPayment"></div>', 'dn-span-6')
            + fold('chart-family', 'Spending by family member', 'dnFamily', 'dn-span-6')
            + section('bills', 'Upcoming bills', '<div id="dnBills"></div>', 'dn-span-6')
            + fold('reimbursement', 'Who owes whom', 'dnReimb', 'dn-span-6')
            + fold('staff', 'Staff payments', 'dnStaff', 'dn-span-6')
            + '</div>',
        // Timeline: activity grouped by day beside a slim summary column.
        timeline: () => '<div class="dn-grid">'
            + section('timeline', 'Activity', '<div id="dnTimeline"></div>'
                + '<button type="button" class="dn-link" data-dn-go="expenses">See all expenses</button>', 'dn-span-8')
            + '<div class="dn-aside dn-span-4">'
            + section('bills', 'Upcoming bills', '<div id="dnBills"></div>')
            + section('chart-category', 'Where the money goes', '<div id="dnCategory"></div>')
            + fold('reimbursement', 'Who owes whom', 'dnReimb')
            + fold('staff', 'Staff payments', 'dnStaff')
            + '</div></div>'
    };
    // A design shows the insight row only if it lays one out itself.
    const WITH_INSIGHTS = { new: true, minimal: false, analytics: false, timeline: true };

    function build(design) {
        const host = $('dashNew');
        if (!host || host.dataset.built === design) return;
        host.dataset.built = design;
        host.dataset.dnDesign = design;
        host.innerHTML = headHtml(design) + heroHtml() + kpiHtml()
            + (design === 'analytics' ? '' : (WITH_INSIGHTS[design] ? insightsHtml() : ''))
            + (BODIES[design] || BODIES.new)();
    }

    // ------------------------------------------------------------- the render
    function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
    function barRow(label, value, pct, tone) {
        return '<div class="dn-bar"><div class="dn-bar-head"><span>' + esc(label) + '</span>'
            + '<span>' + esc(value) + '</span></div>'
            + '<div class="dn-bar-track"><div class="dn-bar-fill dn-t' + (tone % 6) + '" style="width:' + Math.max(2, Math.min(100, pct)) + '%"></div></div></div>';
    }
    const emptyLine = (msg) => '<p class="dn-empty">' + esc(msg) + '</p>';
    // The net-flow figure is shown unsigned; the existing badge carries the sign.
    const isDeficit = () => /deficit|negative|over/i.test(text('statNetCashFlowBadge')) || /^-|−/.test(text('statNetCashFlow'));
    const capText = () => text('statBudgetCap').replace(/^of\s*/i, '');

    function renderHero(p) {
        const label = text('statBudgetLabel') || 'Remaining budget';
        const usedTxt = text('statBudgetUsed');
        const hasBudget = !/no budget/i.test(usedTxt) && !/not set/i.test(text('statBudgetRemaining'));
        const pct = parseFloat(usedTxt) || 0;
        const spent = text('statTotalSpent') || fmt(0);
        const mode = p.heroBudget;
        const showBudget = mode !== 'hidden';

        $d('dnRingWrap').classList.toggle('dn-off', !(showBudget && hasBudget));
        $d('dnHeroBudgetStat').classList.toggle('dn-off', !showBudget);
        const ring = $d('dnRing');
        ring.setAttribute('stroke-dasharray', Math.min(100, Math.max(0, pct)) + ' 100');
        ring.classList.toggle('is-warn', pct >= 75 && pct <= 100);
        ring.classList.toggle('is-over', pct > 100);
        setText('dnRingPct', Math.round(pct) + '%');

        if (hasBudget && mode === 'remaining') {
            setText('dnHeroLabel', label);
            setText('dnHeroFig', text('statBudgetRemaining'));
            setText('dnHeroNote', usedTxt + ' of ' + capText());
            $d('dnHeroFig').classList.toggle('is-over', /over/i.test(label));
        } else {
            setText('dnHeroLabel', 'Total spent');
            setText('dnHeroFig', spent);
            setText('dnHeroNote', showBudget ? (hasBudget ? usedTxt + ' of ' + capText() : 'No budget set in Master Settings') : '');
            $d('dnHeroFig').classList.remove('is-over');
        }
        setText('dnHeroSpent', spent);
        setText('dnHeroNet', text('statNetCashFlow') || fmt(0));
        setText('dnHeroBudget', hasBudget ? capText() : 'Not set');
        $d('dnHeroNet').classList.toggle('is-negative', isDeficit());

        setText('dnPeriod', text('statPeriodLabel') || 'This month');
        const badge = $('dashboardModeBadge');
        const scope = $d('dnScope');
        if (scope && badge) scope.querySelector('span').textContent = badge.textContent.trim() || 'Household';
    }

    function renderKpis() {
        KPIS.forEach(k => {
            const el = $d('dn_' + k.id);
            if (el) {
                const v = text(k.id);
                el.textContent = v || '-';
                if (k.flow) el.classList.toggle('is-negative', isDeficit());
            }
            const tile = document.querySelector('[data-dn-kpi="' + k.id + '"]');
            // Pending bills and payroll only exist for households that use them;
            // the source card already encodes that by being hidden.
            if (tile && k.source) tile.classList.toggle('dn-off', isHidden(k.source));
        });
    }

    function nextBills() {
        const cfg = window.masterConfig || {};
        const bills = Array.isArray(cfg.recurringBills) ? cfg.recurringBills : [];
        if (!bills.length) return [];
        const all = (window.expenses || []).filter(e => !e.isDeleted);
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        const out = [];
        bills.forEach(b => {
            const day = Number(b.dueDay);
            if (!day) return;
            // Paid this month = an expense in the bill's category dated this month,
            // the same rule the reminder scan uses.
            const paid = all.some(e => {
                const d = new Date(e.date);
                return e.category === b.category && d.getFullYear() === y && d.getMonth() === m && Number(e.amount) > 0;
            });
            if (paid) return;
            const dim = new Date(y, m + 1, 0).getDate();
            const due = new Date(y, m, Math.min(day, dim));
            const days = Math.round((due - new Date(y, m, now.getDate())) / 86400000);
            out.push({ name: b.name, amount: Number(b.amount) || 0, days });
        });
        return out.sort((a, b) => a.days - b.days);
    }
    const dueText = (d) => d < 0 ? Math.abs(d) + 'd overdue' : (d === 0 ? 'today' : 'in ' + d + 'd');

    function renderInsights(list, bills) {
        const types = categoryTypes();
        const cat = group(list.filter(e => isSpend(e, types)), e => e.category);
        const top = cat.keys[0];
        const hi = text('statHighestExpense');
        const hv = text('statHighestExpenseVendor');
        const flow = text('statNetCashFlowBadge');
        const nb = bills[0];
        const items = [
            ['Budget utilisation', (text('statBudgetUsed') || '-').replace(/\s*used\s*$/i, ''), ''],
            ['vs last month', text('statMoMComparison') || '-', ''],
            ['Top category', top ? top + ' · ' + fmt(cat.by[top]) : '-', ''],
            ['Largest transaction', hi && hi !== fmt(0) ? hi + (hv && hv !== '-' ? ' · ' + hv : '') : '-', ''],
            ['Cash flow', flow || '-', /deficit|negative|over/i.test(flow) ? 'bad' : (/surplus|positive/i.test(flow) ? 'good' : '')],
            ['Next bill due', nb ? nb.name + ' · ' + dueText(nb.days) : '-', nb && nb.days < 0 ? 'bad' : '']
        ];
        $d('dnInsights').innerHTML = items.map(i =>
            '<div class="dn-ins"><span>' + esc(i[0]) + '</span><strong data-tone="' + i[2] + '">' + esc(i[1]) + '</strong></div>').join('');
    }

    function shareRows(g, max) {
        return g.keys.slice(0, max).map((k, i) =>
            barRow(k, fmt(g.by[k]) + ' · ' + Math.round(g.by[k] / g.total * 100) + '%', g.by[k] / g.total * 100, i)).join('');
    }

    function renderCategory(list) {
        const types = categoryTypes();
        const g = group(list.filter(e => isSpend(e, types)), e => e.category);
        if (!g.keys.length || g.total <= 0) { $d('dnCategory').innerHTML = emptyLine('No spending in this period.'); return; }
        const rest = g.keys.slice(6).reduce((s, k) => s + g.by[k], 0);
        let html = shareRows(g, 6);
        if (rest > 0) html += barRow('Other', fmt(rest) + ' · ' + Math.round(rest / g.total * 100) + '%', rest / g.total * 100, 5);
        $d('dnCategory').innerHTML = html;
    }

    function renderFamily(list) {
        const types = categoryTypes();
        const g = group(list.filter(e => isSpend(e, types)), e => e.paidBy);
        $d('dnFamily').innerHTML = (!g.keys.length || g.total <= 0) ? emptyLine('No spending in this period.') : shareRows(g, 6);
    }

    function renderPayment(list) {
        const types = categoryTypes();
        const g = group(list.filter(e => isSpend(e, types)), e => e.paymentMethod);
        $d('dnPayment').innerHTML = (!g.keys.length || g.total <= 0) ? emptyLine('No spending in this period.') : shareRows(g, 5);
    }

    // Same rule as the existing cash-flow chart: the selected year, income being
    // the "Accepted Payments (Income)" category.
    function renderTrend() {
        const all = (window.expenses || []).filter(e => !e.isDeleted && e.date);
        const f = window.dashboardFilters || {};
        const year = (f.year && f.year !== 'all') ? String(f.year) : String(new Date().getFullYear());
        const spend = new Array(12).fill(0), inc = new Array(12).fill(0);
        all.forEach(e => {
            const d = new Date(e.date);
            if (isNaN(d) || String(d.getFullYear()) !== year) return;
            if (e.category === INCOME_CATEGORY) inc[d.getMonth()] += Number(e.amount) || 0;
            else spend[d.getMonth()] += Number(e.amount) || 0;
        });
        const max = Math.max.apply(null, spend.concat(inc, [1]));
        const names = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
        const sel = (f.month && f.month !== 'all') ? new Date(f.month + ' 1, ' + year).getMonth() : -1;
        if (max <= 1) { $d('dnTrend').innerHTML = emptyLine('No activity recorded for ' + year + '.'); return; }
        $d('dnTrend').innerHTML = '<div class="dn-trend" role="img" aria-label="Monthly expenses and income for ' + esc(year) + '">'
            + names.map((n, i) => '<div class="dn-trend-col' + (i === sel ? ' is-sel' : '') + '"><div class="dn-trend-bars">'
                + '<span class="dn-trend-b dn-trend-exp" style="height:' + Math.round(spend[i] / max * 100) + '%" title="Expenses ' + esc(fmt(spend[i])) + '"></span>'
                + '<span class="dn-trend-b dn-trend-inc" style="height:' + Math.round(inc[i] / max * 100) + '%" title="Income ' + esc(fmt(inc[i])) + '"></span>'
                + '</div><span class="dn-trend-m">' + n + '</span></div>').join('')
            + '</div><p class="dn-legend"><span class="dn-legend-max">Peak ' + esc(fmt(max)) + '</span><span class="dn-dot dn-trend-exp"></span>Expenses <span class="dn-dot dn-trend-inc"></span>Income · ' + esc(year) + '</p>';
    }

    function renderBills(bills) {
        $d('dnBills').innerHTML = !bills.length
            ? emptyLine('Nothing pending this month.')
            : '<ul class="dn-rows">' + bills.slice(0, 4).map(b =>
                '<li><span>' + esc(b.name) + '</span><span class="dn-row-r' + (b.days < 0 ? ' is-bad' : '') + '">'
                + (b.amount ? esc(fmt(b.amount)) + ' · ' : '') + esc(dueText(b.days)) + '</span></li>').join('') + '</ul>';
    }

    function renderReimbursement() {
        const body = $d('dnReimb');
        const grid = $('splitwiseCardsGrid');
        if (!grid || !grid.innerHTML.trim()) { body.innerHTML = emptyLine('Nothing to settle in this period.'); return; }
        const settle = $('settleUpActionContainer');
        // Copied from the settlement summary Reports already computed. Ids are
        // stripped so the copy cannot collide with the original.
        const strip = (h) => h.replace(/\sid="[^"]*"/g, '');
        body.innerHTML = '<div class="dn-reimb">' + strip(grid.innerHTML) + (settle ? strip(settle.innerHTML) : '') + '</div>';
    }

    function renderStaff() {
        const sum = text('statStaffStatusSummary');
        const badge = text('statStaffPayrollBadge');
        const pay = text('statStaffTotal');
        $d('dnStaff').innerHTML = isHidden('kpiStaffPayroll')
            ? emptyLine('No staff configured.')
            : '<ul class="dn-rows"><li><span>Payroll</span><span class="dn-row-r">' + esc(pay || '-') + '</span></li>'
              + (badge ? '<li><span>Status</span><span class="dn-row-r">' + esc(badge) + '</span></li>' : '')
              + (sum ? '<li><span>Summary</span><span class="dn-row-r">' + esc(sum) + '</span></li>' : '') + '</ul>';
    }

    function tone(name) {
        let h = 0;
        String(name || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 6; });
        return h;
    }
    function txRow(e, types) {
        const d = e.date ? new Date(e.date) : null;
        const day = d && !isNaN(d) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
        const income = e.category === INCOME_CATEGORY || (types && types[String(e.category || '').toLowerCase()] === 'income');
        const who = [e.paidBy, e.paidTo].filter(Boolean).join(' → ');
        return '<button type="button" class="dn-tx" data-dash-open="' + esc(e.id) + '">'
            + '<span class="dn-av dn-t' + tone(e.category) + '" aria-hidden="true">' + esc(String(e.category || '?').trim().charAt(0).toUpperCase()) + '</span>'
            + '<span class="dn-tx-main"><strong>' + esc(e.category || 'Expense') + '</strong>'
            + '<small>' + esc(day) + (who ? ' · ' + esc(who) : '') + '</small></span>'
            + '<span class="dn-tx-amt' + (income ? ' is-income' : '') + '">' + (income ? '+' : '') + esc(fmt(e.amount)) + '</span></button>';
    }
    function renderLists(list) {
        const types = categoryTypes();
        const live = list.filter(e => !e.isDeleted);
        const top = live.filter(e => isSpend(e, types)).slice().sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 5);
        const recent = live.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);
        const rows = (l) => l.length ? l.map(e => txRow(e, types)).join('') : emptyLine('Nothing recorded for this period.');
        $d('dnRecent').innerHTML = rows(recent);
        $d('dnTop').innerHTML = '<div class="dn-list">' + rows(top) + '</div>';
    }

    // Activity grouped by day, newest first, each day carrying its spend total.
    function renderTimeline(list) {
        const host = $d('dnTimeline');
        if (host === SINK) return;
        const types = categoryTypes();
        const live = list.filter(e => !e.isDeleted && e.date).slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 40);
        if (!live.length) { host.innerHTML = emptyLine('Nothing recorded for this period.'); return; }
        const days = {};
        const order = [];
        live.forEach(e => {
            const k = String(e.date).slice(0, 10);
            if (!days[k]) { days[k] = []; order.push(k); }
            days[k].push(e);
        });
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const label = (k) => {
            const d = new Date(k + 'T00:00:00');
            const diff = Math.round((today - d) / 86400000);
            if (diff === 0) return 'Today';
            if (diff === 1) return 'Yesterday';
            return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
        };
        host.innerHTML = order.map(k => {
            const spend = days[k].filter(e => isSpend(e, types)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
            return '<div class="dn-day"><div class="dn-day-head"><span>' + esc(label(k)) + '</span>'
                + '<span>' + (spend > 0 ? esc(fmt(spend)) : '') + '</span></div>'
                + '<div class="dn-list">' + days[k].map(e => txRow(e, types)).join('') + '</div></div>';
        }).join('');
    }

    function syncFolds() {
        const phone = !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
        document.querySelectorAll('#dashNew details[data-dn-fold]').forEach(d => {
            if (!phone) d.open = true;
            else if (!d.dataset.touched) d.open = false;
        });
    }

    function render(filtered) {
        const view = $('view-dashboard');
        if (!view) return;
        const p = apply();
        const host = $('dashNew');
        // The classic design is untouched; nothing is built or drawn for it.
        if (!host || p.design === 'classic' || !BODIES[p.design]) return;
        build(p.design);
        const list = (Array.isArray(filtered) ? filtered : (window.currentFilteredExpenses || [])).filter(e => !e.isDeleted);
        const bills = nextBills();
        renderHero(p);
        renderKpis();
        renderInsights(list, bills);
        renderCategory(list);
        renderFamily(list);
        renderPayment(list);
        renderTrend();
        renderBills(bills);
        renderReimbursement();
        renderStaff();
        renderLists(list);
        renderTimeline(list);
        apply();
        syncFolds();
    }

    // The home card reads its mode while rendering, so repaint after a change.
    function repaint() { if (typeof window.renderAllViews === 'function') window.renderAllViews(); }

    // ----------------------------------------------------------- settings
    function canSetHousehold() {
        return typeof window.hasPermission === 'function' ? window.hasPermission('settings.manage') : false;
    }

    function readForm() {
        const sections = {};
        document.querySelectorAll('#dashUiSections input[type="checkbox"]').forEach(cb => { sections[cb.value] = cb.checked; });
        return sanitize({
            design: ($('dashUiDesign') || {}).value,
            layout: ($('dashUiLayout') || {}).value,
            kpiDensity: ($('dashUiKpi') || {}).value,
            mobileDensity: ($('dashUiMobile') || {}).value,
            heroBudget: ($('dashUiHeroBudget') || {}).value,
            defaultTheme: ($('dashUiTheme') || {}).value || '',
            sections
        });
    }

    function renderSettings() {
        const host = $('dashUiSections');
        if (!host) return;
        const p = effective();
        const sel = (id, v) => { const e = $(id); if (e) e.value = v; };
        sel('dashUiDesign', p.design);
        sel('dashUiLayout', p.layout);
        sel('dashUiKpi', p.kpiDensity);
        sel('dashUiMobile', p.mobileDensity);
        sel('dashUiHeroBudget', p.heroBudget);
        const themeSel = $('dashUiTheme');
        const src = $('themeSelector');
        if (themeSel && src && !themeSel.options.length) {
            themeSel.innerHTML = '<option value="">No preference</option>'
                + Array.from(src.options).map(o => '<option value="' + esc(o.value) + '">' + esc(o.textContent.trim()) + '</option>').join('');
        }
        sel('dashUiTheme', p.defaultTheme || '');
        host.innerHTML = SECTION_KEYS.map(k =>
            '<label class="dash-check"><input type="checkbox" value="' + k + '"' + (p.sections[k] !== false ? ' checked' : '') + '>'
            + '<span>' + esc(SECTION_LABELS[k]) + '</span></label>').join('');
        const hh = $('dashUiSaveHousehold');
        const hhReset = $('dashUiResetHousehold');
        [hh, hhReset].forEach(b => { if (b) b.classList.toggle('hidden', !canSetHousehold()); });
        const note = $('dashUiScopeNote');
        if (note) note.textContent = 'Scope follows Dashboard View Mode: ' + ((window.getDashboardMode && window.getDashboardMode()) || 'household') + '. Layout, density and section choices apply to the New dashboard design.';
    }

    function toast(type, title, msg) { if (window.showToast) window.showToast(type, title, msg || ''); }

    function saveDevice() {
        const patch = readForm();
        try {
            localStorage.setItem(deviceKey(), JSON.stringify(patch));
        } catch (e) {
            toast('error', 'Not saved', 'This browser would not store the preference.');
            return;
        }
        apply(); repaint();
        toast('success', 'Saved on this device');
    }

    async function saveHousehold() {
        if (!canSetHousehold()) { toast('error', 'Not allowed', 'Only a household owner can set the household default.'); return; }
        const patch = readForm();
        const ok = typeof window.saveMasterConfig === 'function'
            ? await window.saveMasterConfig({ dashboardUi: patch })
            : false;
        if (ok) { apply(); renderSettings(); repaint(); }
    }

    function reset() {
        try { localStorage.removeItem(deviceKey()); } catch (e) { /* nothing to remove */ }
        apply(); renderSettings(); repaint();
        toast('success', 'Dashboard reset', 'This device now follows the household default.');
    }

    async function resetHousehold() {
        if (!canSetHousehold()) return;
        const ok = typeof window.saveMasterConfig === 'function' ? await window.saveMasterConfig({ dashboardUi: {} }) : false;
        if (ok) { apply(); renderSettings(); repaint(); }
    }

    // ----------------------------------------------------------- wiring
    document.addEventListener('click', function (ev) {
        const t = ev.target && ev.target.closest ? ev.target : null;
        if (!t) return;
        const open = t.closest('#dashNew [data-dash-open]');
        if (open && typeof window.openTransactionDetailModal === 'function') {
            window.openTransactionDetailModal(open.getAttribute('data-dash-open'));
            return;
        }
        const go = t.closest('#dashNew [data-dn-go]');
        if (go && typeof window.switchTab === 'function') {
            window.switchTab(go.getAttribute('data-dn-go'));
            return;
        }
        const more = t.closest('#dnMoreFigures');
        if (more) {
            const sec = $d('dnKpis');
            const openNow = sec.classList.toggle('is-open');
            more.setAttribute('aria-expanded', openNow ? 'true' : 'false');
            return;
        }
        const id = (t.closest('button') || {}).id;
        if (id === 'dashUiSaveDevice') saveDevice();
        else if (id === 'dashUiSaveHousehold') saveHousehold();
        else if (id === 'dashUiReset') reset();
        else if (id === 'dashUiResetHousehold') resetHousehold();
    });
    document.addEventListener('toggle', function (ev) {
        if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-dn-fold')) ev.target.dataset.touched = '1';
    }, true);
    if (window.matchMedia) {
        const mq = window.matchMedia('(max-width: 767px)');
        if (mq.addEventListener) mq.addEventListener('change', syncFolds);
    }

    window.renderDashboardUi = render;
    window.renderDashboardUiSettings = renderSettings;
    window.DashboardUi = { effective, HERO_BUDGET, apply, sanitize, SECTION_KEYS, defaults };
})();
