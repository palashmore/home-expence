// =====================================================================
// HOMEEXPENSES · LUXURY HOUSEHOLD FINANCE COMMAND CENTER
// Full-Stack Client State Engine, Filter System & Advanced Analytics
// =====================================================================

// Safe environment guard
const _win = typeof window !== 'undefined' ? window : {};

// Preset Categories
let CATEGORIES = _win.CATEGORIES || [
    "Electricity Bill",
    "Flat Maintenance",
    "Dish Bill (DTH)",
    "Grocery & Vegetables",
    "Gas & Water",
    "Wifi & Internet",
    "Accepted Payments (Income)",
    "Shopping & Miscellaneous"
];

let currentSessionUser = null;
try {
    const storedUser = (typeof localStorage !== 'undefined') ? localStorage.getItem("household_session_user") : null;
    if (storedUser) currentSessionUser = JSON.parse(storedUser);
} catch (e) {}
if (typeof window !== 'undefined') {
    window.currentSessionUser = currentSessionUser;
// A restored session must get the same treatment as a fresh one; the nav is
// built from markup, so without this every tab shows until the first sign-in.
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.applyNavPermissions) window.applyNavPermissions();
    });
}
}

let FAMILY_MEMBERS = _win.FAMILY_MEMBERS || (currentSessionUser?.name ? [currentSessionUser.name] : ["Palash", "Pallavi"]);
if (typeof window !== 'undefined') {
    window.FAMILY_MEMBERS = FAMILY_MEMBERS;
    window.CATEGORIES = CATEGORIES;
}

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

// Reusable Dynamic Current Period Utility (Never Hardcoded)
function getCurrentPeriod() {
    const now = new Date();
    return {
        monthIndex: now.getMonth(), // 0-11
        monthName: MONTHS[now.getMonth()], // e.g. "September"
        year: now.getFullYear(), // e.g. 2026
        yearStr: now.getFullYear().toString(),
        isoDate: now.toISOString().split('T')[0]
    };
}

// Global Application State
let expenses = [];
let authToken = (typeof localStorage !== 'undefined' ? localStorage.getItem("household_auth_token") : "") || "";
let currentSelectedReceiptBase64 = null;
let trendGranularity = "monthly"; // "monthly" or "quarterly"
let pendingDeleteExpenseId = null;
let monthlyBudgetLimit = 50000; // Configurable budget limit

// Global Personal vs Household Expense Classifier
function isPersonalExpense(item) {
    if (!item) return false;
    if (item.isPersonal === true || item.expenseType === 'personal') return true;
    const split = (item.splitBetween || '').toLowerCase();
    if (split.includes('personal') || split.includes('not reimbursed')) return true;
    const cat = (item.category || '').toLowerCase();
    if (cat === 'personal expense' || cat.startsWith('personal -') || cat === 'food delivery') return true;
    return false;
}
window.isPersonalExpense = isPersonalExpense;

// ================= MASTER-CONFIG DRIVEN DASHBOARD =================
// The dashboard used to be hardwired to one household with two named staff
// members and a fixed list of utility bills. Everything below reads the
// household's own Master Configuration instead, so a brand new household with
// no staff and no recurring bills sees neither - rather than someone else's.
const DASHBOARD_MODES = ['household', 'personal', 'combined'];

function getDashboardMode() {
    const m = window.masterConfig && window.masterConfig.dashboardMode;
    return DASHBOARD_MODES.includes(m) ? m : 'household';
}
window.getDashboardMode = getDashboardMode;

// In this schema staff[].name IS the expense category ("Maid - Madhuri") and
// staff[].shortName is the person ("Madhuri"). Older records may carry an
// explicit category, so that wins when present.
function staffCategoryOf(s) {
    return String((s && (s.category || s.name)) || '').trim();
}
function staffDisplayName(s) {
    return String((s && (s.shortName || s.name)) || '').trim();
}
function getConfiguredStaff() {
    const list = (window.masterConfig && Array.isArray(window.masterConfig.staff))
        ? window.masterConfig.staff
        : [];
    return list.filter(s => s && (s.name || s.shortName) && s.active !== false);
}
function getStaffCategorySet() {
    const set = new Set();
    getConfiguredStaff().forEach(s => {
        const c = staffCategoryOf(s).toLowerCase();
        if (c) set.add(c);
    });
    return set;
}
function isStaffExpense(item, categorySet) {
    const set = categorySet || getStaffCategorySet();
    return set.has(String((item && item.category) || '').trim().toLowerCase());
}
// A category's own monthly budget, or null when none is set. Budgets live on
// the category object so they follow a rename and travel with the config.
function categoryBudgetFor(categoryName) {
    const cats = (window.masterConfig && Array.isArray(window.masterConfig.categories))
        ? window.masterConfig.categories
        : [];
    const target = String(categoryName || '').trim().toLowerCase();
    const hit = cats.find(c => c && String(c.name || '').trim().toLowerCase() === target);
    if (!hit || hit.monthlyBudget === undefined || hit.monthlyBudget === null) return null;
    const n = Number(hit.monthlyBudget);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
window.categoryBudgetFor = categoryBudgetFor;

function getConfiguredBills() {
    const list = (window.masterConfig && Array.isArray(window.masterConfig.recurringBills))
        ? window.masterConfig.recurringBills
        : [];
    return list.filter(b => b && b.active !== false);
}
window.staffCategoryOf = staffCategoryOf;
window.staffDisplayName = staffDisplayName;
window.getConfiguredStaff = getConfiguredStaff;
window.getStaffCategorySet = getStaffCategorySet;
window.isStaffExpense = isStaffExpense;
window.getConfiguredBills = getConfiguredBills;

function getPersonalPayer(item) {
    const members = (window.masterConfig && window.masterConfig.familyMembers) || window.FAMILY_MEMBERS || ['Household Member'];
    const defaultMember = (currentSessionUser && currentSessionUser.name) || members[0] || 'Household Member';
    if (!item) return defaultMember;

    const paidBy = (item.paidBy || '').trim();
    const split = (item.splitBetween || '').toLowerCase();

    for (const m of members) {
        if (paidBy.toLowerCase() === m.toLowerCase()) return m;
    }
    for (const m of members) {
        if (split.includes(m.toLowerCase())) return m;
    }
    for (const m of members) {
        if (paidBy.toLowerCase().includes(m.toLowerCase())) return m;
    }
    return paidBy || defaultMember;
}
window.getPersonalPayer = getPersonalPayer;

// Chart Instances
let categoryPieChartInstance = null;
let paidByChartInstance = null;
let monthlyTrendChartInstance = null;
let paymentMethodChartInstance = null;

// Centralized Reactive Filter State Model (Requirement 25)
let dashboardFilters = {
    month: getCurrentPeriod().monthName, // Defaults to Current Month dynamically
    year: getCurrentPeriod().yearStr,    // Defaults to Current Year dynamically
    category: "all",
    paidBy: "all",
    paymentMethod: "all",
    expenseType: "all", // "all", "expense", "income"
    scope: "household", // "household" (default: pure household only) or "combined"
    dateFrom: null,
    dateTo: null,
    searchVal: ""
};
// `let` at the top level of a classic script does not land on window, and the
// filter state is never reassigned - only mutated - so exposing the object once
// keeps every reader in step.
window.dashboardFilters = dashboardFilters;

const DASHBOARD_MODE_META = {
    household: {
        label: 'Household',
        icon: 'i-house',
        subtitle: 'Viewing verified household expenses, staff payroll, and utilities.'
    },
    personal: {
        label: 'Personal',
        icon: 'i-user',
        subtitle: 'Viewing personal expenditure only. Household bills are excluded.'
    },
    combined: {
        label: 'Combined',
        icon: 'i-layers',
        subtitle: 'Viewing combined household expenses and personal expenditures.'
    }
};

// Reflect the active mode in the hero header. The mode itself is no longer
// switchable from the dashboard - it belongs to the household's Master
// Configuration, so one member cannot silently change what everyone sees.
function updateDashboardModeBadge() {
    const mode = getDashboardMode();
    const meta = DASHBOARD_MODE_META[mode] || DASHBOARD_MODE_META.household;

    const badge = document.getElementById("dashboardModeBadge");
    if (badge) {
        const icon = badge.querySelector('i');
        const text = badge.querySelector('span');
        if (icon) icon.className = `fa-solid ${meta.icon} text-[9px]`;
        if (text) text.textContent = `${meta.label} View`;
        badge.title = `Dashboard view mode: ${meta.label}. Change it in Master Settings.`;
    }

    const subTitle = document.getElementById("dashboardPeriodSubtitle");
    if (subTitle) subTitle.textContent = meta.subtitle;
}
window.updateDashboardModeBadge = updateDashboardModeBadge;

// Show or hide whole dashboard sections based on what the household actually
// configured. No staff -> no payroll anywhere. No recurring bills -> no bill
// radar or bill counters.
function applyDashboardSectionVisibility() {
    const mode = getDashboardMode();
    // Personal view is one person's own spending; payroll and shared utilities
    // are household concerns and have no place in it.
    const showStaff = getConfiguredStaff().length > 0 && mode !== 'personal';
    const showBills = getConfiguredBills().length > 0 && mode !== 'personal';

    const toggle = (id, visible) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !visible);
    };
    toggle('kpiStaffPayroll', showStaff);
    toggle('dashStaffLedgerSection', showStaff);
    toggle('dashBillsRadarSection', showBills);
    toggle('kpiPendingBills', showBills);
    toggle('kpiPaidBills', showBills);

    // Keep the 12-column rows from leaving a hole when one half is hidden.
    const budgetCard = document.getElementById('dashBudgetYtdSection');
    if (budgetCard) {
        budgetCard.classList.toggle('lg:col-span-6', showStaff);
        budgetCard.classList.toggle('lg:col-span-12', !showStaff);
    }
    const runwayCard = document.getElementById('dashRunwaySection');
    if (runwayCard) {
        runwayCard.classList.toggle('lg:col-span-4', showBills);
        runwayCard.classList.toggle('lg:col-span-12', !showBills);
    }
}
window.applyDashboardSectionVisibility = applyDashboardSectionVisibility;

// Pull the stored mode into the live filter state. Called whenever the config
// is (re)loaded, so switching household switches the dashboard with it.
function applyDashboardModeFromConfig(render = false) {
    dashboardFilters.scope = getDashboardMode();
    updateDashboardModeBadge();
    applyDashboardSectionVisibility();
    if (render && typeof renderDashboard === 'function') {
        renderDashboard(getFilteredExpenses());
    }
}
window.applyDashboardModeFromConfig = applyDashboardModeFromConfig;

function setDashboardScope(scope) {
    dashboardFilters.scope = DASHBOARD_MODES.includes(scope) ? scope : 'household';
    updateDashboardModeBadge();
    applyDashboardSectionVisibility();
    renderDashboard(getFilteredExpenses());
}
window.setDashboardScope = setDashboardScope;

// The only place the mode can be changed: Master Settings. Persisting it means
// every member and every device sees the same dashboard.
async function setDashboardMode(mode) {
    if (!DASHBOARD_MODES.includes(mode)) return false;
    const previous = getDashboardMode();
    if (window.masterConfig) window.masterConfig.dashboardMode = mode;
    if (typeof renderDashboardModeControl === 'function') renderDashboardModeControl();
    setDashboardScope(mode);

    if (typeof window.saveMasterConfig !== 'function') return false;
    const ok = await window.saveMasterConfig({ dashboardMode: mode });
    if (!ok) {
        // The server did not keep it - put the UI back rather than showing a
        // mode that is not actually stored.
        if (window.masterConfig) window.masterConfig.dashboardMode = previous;
        if (typeof renderDashboardModeControl === 'function') renderDashboardModeControl();
        setDashboardScope(previous);
    }
    return ok;
}
window.setDashboardMode = setDashboardMode;

// Segmented control inside Master Settings.
function renderDashboardModeControl() {
    const host = document.getElementById('adminDashboardModeOptions');
    if (!host) return;
    const active = getDashboardMode();
    const copy = {
        household: 'Shared household spending only - bills, utilities and staff payroll.',
        personal: 'Personal expenditure only - individual spending, no shared household bills.',
        combined: 'Everything together - household plus personal in one view.'
    };
    host.innerHTML = DASHBOARD_MODES.map(mode => {
        const meta = DASHBOARD_MODE_META[mode];
        const on = mode === active;
        return `
            <button type="button" role="radio" aria-checked="${on}"
                onclick="setDashboardMode('${mode}')"
                class="text-left p-3.5 rounded-xl border-2 transition min-h-[44px] ${on
                    ? 'border-indigo-500 bg-indigo-50/70 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-indigo-300'}">
                <span class="flex items-center gap-2">
                    <svg class="ic ${on ? 'text-indigo-600' : 'text-slate-400'}" aria-hidden="true"><use href="#${meta.icon}"></use></svg>
                    <span class="text-sm font-black ${on ? 'text-indigo-900' : 'text-slate-700'}">${meta.label}</span>
                    ${on ? '<span class="ml-auto text-[10px] font-black uppercase tracking-wider text-indigo-700">Active</span>' : ''}
                </span>
                <span class="block text-[11px] font-medium text-slate-500 mt-1.5 leading-snug">${copy[mode]}</span>
            </button>`;
    }).join('');
}
window.renderDashboardModeControl = renderDashboardModeControl;

// ================= LUXURY HAPTIC ENGINE (Phase 13) =================
function triggerHaptic(type = 'light') {
    if (!('vibrate' in navigator)) return;
    try {
        switch (type) {
            case 'light':
            case 'tap':
                navigator.vibrate(10);
                break;
            case 'medium':
                navigator.vibrate(25);
                break;
            case 'success':
                navigator.vibrate([15, 60, 25]);
                break;
            case 'warning':
                navigator.vibrate([30, 80, 30]);
                break;
            case 'error':
                navigator.vibrate([50, 80, 50, 80, 50]);
                break;
            case 'delete':
                navigator.vibrate([40, 90, 40]);
                break;
            default:
                navigator.vibrate(15);
        }
    } catch (e) {}
}
window.triggerHaptic = triggerHaptic;

// ================= OFFLINE SYNC QUEUE ENGINE (Phase 12) =================
function getOfflineQueue() {
    try {
        const raw = localStorage.getItem("homeexpenses_offline_queue");
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        return [];
    }
}
window.getOfflineQueue = getOfflineQueue;

function setOfflineQueue(queue) {
    try {
        localStorage.setItem("homeexpenses_offline_queue", JSON.stringify(queue));
    } catch (e) {}
    updateOfflineQueueBadge();
}
window.setOfflineQueue = setOfflineQueue;

function enqueueOfflineAction(actionObj) {
    const queue = getOfflineQueue();
    const item = {
        queueId: 'queue_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        action: actionObj.action, // 'CREATE', 'UPDATE', 'DELETE'
        payload: actionObj.payload || null,
        id: actionObj.id || (actionObj.payload ? actionObj.payload.id : null),
        timestamp: new Date().toISOString(),
        retryCount: 0
    };
    queue.push(item);
    setOfflineQueue(queue);
    return item;
}
window.enqueueOfflineAction = enqueueOfflineAction;

function updateOfflineQueueBadge(isSyncing = false) {
    const queue = getOfflineQueue();
    const count = queue.length;

    const desktopBadge = document.getElementById("offlineQueueBadge");
    const desktopCount = document.getElementById("offlineQueueCount");
    const mobileBadge = document.getElementById("mobileOfflineQueueBadge");
    const mobileCount = document.getElementById("mobileOfflineQueueCount");

    if (count > 0 || isSyncing) {
        if (desktopBadge) {
            desktopBadge.classList.remove("hidden");
            desktopBadge.classList.add("inline-flex");
            if (desktopCount) {
                desktopCount.textContent = isSyncing ? "Syncing..." : `${count} Pending Sync`;
            }
        }
        if (mobileBadge) {
            mobileBadge.classList.remove("hidden");
            mobileBadge.classList.add("inline-flex");
            if (mobileCount) {
                mobileCount.textContent = isSyncing ? "..." : String(count);
            }
        }
    } else {
        if (desktopBadge) {
            desktopBadge.classList.add("hidden");
            desktopBadge.classList.remove("inline-flex");
        }
        if (mobileBadge) {
            mobileBadge.classList.add("hidden");
            mobileBadge.classList.remove("inline-flex");
        }
    }
}
window.updateOfflineQueueBadge = updateOfflineQueueBadge;

let isSyncingOfflineQueue = false;
async function syncOfflineQueue() {
    if (isSyncingOfflineQueue) return;
    if (!navigator.onLine) {
        updateOfflineQueueBadge();
        return;
    }

    const queue = getOfflineQueue();
    if (!queue || queue.length === 0) {
        updateOfflineQueueBadge();
        return;
    }

    isSyncingOfflineQueue = true;
    updateOfflineQueueBadge(true);

    let successfulSyncs = 0;
    const remainingQueue = [];

    for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        try {
            if (item.action === 'CREATE') {
                const res = await fetch("/api/expenses", {
                    method: "POST",
                    headers: getAuthHeaders({
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache'
                    }),
                    cache: 'no-store',
                    body: JSON.stringify(item.payload)
                });
                const data = await res.json();
                if (res.ok && data.success && data.data) {
                    successfulSyncs++;
                    if (item.payload && item.payload.id) {
                        const tempId = String(item.payload.id).trim();
                        const realId = String(data.data.id).trim();
                        const localIdx = expenses.findIndex(x => String(x.id).trim() === tempId);
                        if (localIdx !== -1) {
                            expenses[localIdx] = {
                                ...expenses[localIdx],
                                ...data.data,
                                isOfflineDraft: false
                            };
                        }
                    }
                } else if (res.status === 400 || res.status === 422) {
                    console.error("Offline CREATE rejected with permanent error:", data);
                } else {
                    item.retryCount = (item.retryCount || 0) + 1;
                    remainingQueue.push(item);
                }
            } else if (item.action === 'UPDATE') {
                const res = await fetch("/api/expenses", {
                    method: "PUT",
                    headers: getAuthHeaders({
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache'
                    }),
                    cache: 'no-store',
                    body: JSON.stringify(item.payload)
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    successfulSyncs++;
                } else if (res.status === 404 || res.status === 400) {
                    console.error("Offline UPDATE permanent error:", data);
                } else {
                    item.retryCount = (item.retryCount || 0) + 1;
                    remainingQueue.push(item);
                }
            } else if (item.action === 'DELETE') {
                const targetId = encodeURIComponent(String(item.id).trim());
                const res = await fetch(`/api/expenses?id=${targetId}&_t=${Date.now()}`, {
                    method: "DELETE",
                    headers: getAuthHeaders({
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache'
                    }),
                    cache: 'no-store'
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    successfulSyncs++;
                } else if (res.status === 404) {
                    successfulSyncs++;
                } else {
                    item.retryCount = (item.retryCount || 0) + 1;
                    remainingQueue.push(item);
                }
            }
        } catch (netErr) {
            console.warn("Network error during offline sync replay:", netErr);
            item.retryCount = (item.retryCount || 0) + 1;
            remainingQueue.push(item);
            for (let j = i + 1; j < queue.length; j++) {
                remainingQueue.push(queue[j]);
            }
            break;
        }
    }

    setOfflineQueue(remainingQueue);
    isSyncingOfflineQueue = false;
    updateOfflineQueueBadge();

    if (successfulSyncs > 0) {
        saveLocalCacheData();
        renderAllViews();
        updateHeaderStatus();
        triggerHaptic('success');
        showToast("success", "Sync Complete", `${successfulSyncs} offline change${successfulSyncs > 1 ? 's' : ''} synchronized with server.`);
        loadData(true);
        broadcastTransactionUpdate('SYNC');
    }
}
window.syncOfflineQueue = syncOfflineQueue;

function saveOfflineDraft(payload, isEdit, existingRecord, submitBtn) {
    const savedItem = {
        ...(existingRecord || {}),
        ...payload,
        id: isEdit && payload.id ? payload.id : `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        isOfflineDraft: true,
        offlineSavedAt: new Date().toISOString()
    };

    const targetId = String(savedItem.id).trim();
    if (isEdit) {
        const idx = expenses.findIndex(i => String(i.id).trim() === targetId);
        if (idx !== -1) {
            expenses[idx] = savedItem;
        } else {
            expenses.unshift(savedItem);
        }
    } else {
        expenses.unshift(savedItem);
    }

    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    window.expenses = expenses;
    window.expensesData = expenses;

    enqueueOfflineAction({
        action: isEdit ? 'UPDATE' : 'CREATE',
        payload: savedItem,
        id: savedItem.id
    });

    saveLocalCacheData();
    renderAllViews();
    updateHeaderStatus();
    closeExpenseModal();

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `Save Expense Record`;
    }

    triggerHaptic('warning');
    const actionTitle = isEdit ? "Draft Updated (Offline)" : "Saved in Offline Queue";
    const secondaryText = `${formatINR(savedItem.amount)} · ${savedItem.category} · Will auto-sync when online`;
    showToast("warning", actionTitle, secondaryText);
}

// ================= INITIALIZATION =================
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setDefaultDateToToday();
    
    // Set dynamic default filter state (Current Month + Current Year)
    const cur = getCurrentPeriod();
    dashboardFilters.month = cur.monthName;
    dashboardFilters.year = cur.yearStr;
    
    populateFilterMonthDropdown();
    
    // Real-Time Cross-Tab / Cross-Window Sync Channel (0ms lag across tabs)
    try {
        if (typeof BroadcastChannel !== 'undefined') {
            window.txBroadcastChannel = new BroadcastChannel('homeexpenses_tx_sync');
            window.txBroadcastChannel.onmessage = (event) => {
                if (event.data && (event.data.type === 'TRANSACTIONS_UPDATED' || event.data.type === 'CONFIG_UPDATED')) {
                    loadData(true);
                    if (window.loadMasterConfig) window.loadMasterConfig();
                }
            };
        }
    } catch (e) {}

    // Service Worker Push Sync Listener (refreshes data immediately & triggers in-app banner)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && (event.data.type === 'SYNC_TRANSACTIONS' || event.data.type === 'TRANSACTIONS_UPDATED')) {
                loadData(true);
                if (window.loadMasterConfig) window.loadMasterConfig();
                if (window.updateNotificationCenter) window.updateNotificationCenter();
            }
            if (event.data && (event.data.type === 'SHOW_IN_APP_BANNER' || event.data.type === 'PUSH_NOTIFICATION')) {
                const payload = event.data.payload || event.data;
                if (window.showInAppNotificationBanner) {
                    window.showInAppNotificationBanner(payload);
                }
            }
        });
    }

    // Auto-sync listeners for multi-device concurrency (Fast 7s polling & instant visibility resume)
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            loadData(true);
            if (window.loadMasterConfig) window.loadMasterConfig();
        }
    });
    window.addEventListener("focus", () => {
        loadData(true);
        if (window.loadMasterConfig) window.loadMasterConfig();
    });
    setInterval(() => {
        if (!document.hidden) {
            loadData(true);
            if (window.loadMasterConfig) window.loadMasterConfig();
        }
    }, 7000);

    // Online/Offline status listeners & auto-sync
    window.addEventListener("online", () => {
        updateSyncBadge("Online & Synced", "emerald");
        showToast("info", "Connection Restored", "Back online. Syncing pending offline transactions...");
        syncOfflineQueue();
        loadData(true);
    });
    window.addEventListener("offline", () => {
        updateSyncBadge("Offline Mode", "amber");
        showToast("warning", "Offline Mode", "Working in offline mode. Changes will be saved locally and queued.");
        updateOfflineQueueBadge();
    });

    // Initial Data Fetch & Household Auth Verification
    updateOfflineQueueBadge();
    initAuthSession();
    if (navigator.onLine) {
        setTimeout(syncOfflineQueue, 1500);
    }
});

// Format Indian Currency Helper
function formatINR(val, includeSymbol = true) {
    const num = Number(val) || 0;
    const formatted = num.toLocaleString('en-IN', {
        maximumFractionDigits: 2,
        minimumFractionDigits: Number.isInteger(num) ? 0 : 2
    });
    return includeSymbol ? `₹${formatted}` : formatted;
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = MONTHS[d.getMonth()].substring(0, 3);
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
}

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem("household_app_theme") || "indigo";
    changeTheme(savedTheme, false);
}

function changeTheme(themeName, render = true) {
    document.documentElement.setAttribute("data-theme", themeName);
    localStorage.setItem("household_app_theme", themeName);
    const selector = document.getElementById("themeSelector");
    if (selector) selector.value = themeName;
    const mobileSelector = document.getElementById("mobileThemeSelector");
    if (mobileSelector) mobileSelector.value = themeName;
    if (render) renderAllViews();
}

function toggleMobileActionMenu() {
    const menu = document.getElementById("mobileActionDropdown");
    if (menu) menu.classList.toggle("hidden");
}
window.toggleMobileActionMenu = toggleMobileActionMenu;

function openMobileMoreSheet() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const sheet = document.getElementById("moreNavSheet");
    const drawer = document.getElementById("moreNavDrawer");
    if (sheet) sheet.classList.remove("hidden");
    if (drawer) drawer.classList.remove("hidden");
}
window.openMobileMoreSheet = openMobileMoreSheet;

function closeMobileMoreSheet() {
    const sheet = document.getElementById("moreNavSheet");
    const drawer = document.getElementById("moreNavDrawer");
    if (sheet) sheet.classList.add("hidden");
    if (drawer) drawer.classList.add("hidden");
}
window.closeMobileMoreSheet = closeMobileMoreSheet;

// Global listener to close dropdowns when clicked outside
document.addEventListener("click", function(e) {
    const mobileMenu = document.getElementById("mobileActionDropdown");
    const mobileBtn = document.getElementById("btnMobileActionMenu");
    if (mobileMenu && !mobileMenu.classList.contains("hidden")) {
        if (!mobileMenu.contains(e.target) && !mobileBtn?.contains(e.target)) {
            mobileMenu.classList.add("hidden");
        }
    }
    const exportMenu = document.getElementById("exportDropdownMenu");
    const exportBtn = e.target.closest("button[onclick*='toggleExportMenu']");
    if (exportMenu && !exportMenu.classList.contains("hidden") && !exportMenu.contains(e.target) && !exportBtn) {
        exportMenu.classList.add("hidden");
    }
});

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        closeMobileMoreSheet();
    }
});

function setDefaultDateToToday() {
    const cur = getCurrentPeriod();
    const dateInput = document.getElementById("inputDate");
    if (dateInput) dateInput.value = cur.isoDate;
}

// Navigation Tab Switching
// ============================================================
// PERMISSION SERVICE
// ============================================================
// One place that answers "may this user do X". Capability used to be inferred
// from a role string in seventeen separate spots on the client and thirty on
// the server, so a new screen was gated by whatever its author remembered.
//
// The server sends the permission list with the session; this mirrors the
// registry in api/_permissions.js as a fallback for a session minted before
// that existed. Hiding a control is presentation, never protection - every
// permission here is also enforced server-side.
const ROLE_PERMISSION_FALLBACK = {
    VIEWER: ['dashboard.view', 'expense.view', 'bill.view', 'personal.view',
             'reports.view', 'staff.view', 'household.view', 'settings.view',
             'excel.export'],
    MEMBER: null,   // filled below
    OWNER: null,
    ADMIN: null,
    SYSTEM_ADMIN: null
};
ROLE_PERMISSION_FALLBACK.MEMBER = ROLE_PERMISSION_FALLBACK.VIEWER.concat(
    ['expense.create', 'expense.edit', 'expense.delete', 'matrix.view', 'settlement.view']);
ROLE_PERMISSION_FALLBACK.OWNER = ROLE_PERMISSION_FALLBACK.MEMBER.concat(
    ['bill.manage', 'attendance.manage', 'payroll.view', 'excel.import',
     'backup.manage', 'restore.manage', 'audit.view', 'users.view', 'settings.manage']);
ROLE_PERMISSION_FALLBACK.ADMIN = ROLE_PERMISSION_FALLBACK.OWNER.concat(
    ['users.manage', 'household.manage']);
ROLE_PERMISSION_FALLBACK.SYSTEM_ADMIN = ROLE_PERMISSION_FALLBACK.ADMIN;

function currentPermissions() {
    const u = currentSessionUser;
    if (u && Array.isArray(u.permissions) && u.permissions.length) return u.permissions;
    // A session stored before the server sent permissions: derive from the role
    // rather than locking the user out of their own app.
    return ROLE_PERMISSION_FALLBACK[String((u && u.role) || '').toUpperCase()] || [];
}

function hasPermission(permission) {
    return currentPermissions().indexOf(permission) !== -1;
}
function hasAnyPermission(permissions) {
    const held = currentPermissions();
    return (permissions || []).some(p => held.indexOf(p) !== -1);
}
function hasAllPermissions(permissions) {
    const held = currentPermissions();
    return (permissions || []).every(p => held.indexOf(p) !== -1);
}
window.hasPermission = hasPermission;
window.hasAnyPermission = hasAnyPermission;
window.hasAllPermissions = hasAllPermissions;
window.currentPermissions = currentPermissions;

// Navigation, declared once. Each surface - sidebar, top strip, bottom bar -
// reads this instead of carrying its own hand-maintained copy.
const NAV_ITEMS = [
    { tab: 'dashboard', permission: 'dashboard.view' },
    { tab: 'expenses',  permission: 'expense.view' },
    { tab: 'personal',  permission: 'personal.view' },
    { tab: 'staff',     permission: 'staff.view' },
    { tab: 'bills',     permission: 'bill.view' },
    { tab: 'reports',   permission: 'reports.view' },
    { tab: 'matrix',    permission: 'matrix.view' },
    { tab: 'settings',  permission: 'settings.view' },
    { tab: 'admin',     permission: 'settings.manage' },
    { tab: 'audit',     permission: 'audit.view' }
];
window.NAV_ITEMS = NAV_ITEMS;

// The mobile More menu, grouped and permission-filtered. It used to be a flat
// row of four buttons with inline handlers, showing Admin and Audit to every
// role regardless of whether they could open them.
const MORE_MENU_GROUPS = [
    {
        title: 'Household',
        items: [
            { tab: 'personal', label: 'Personal', icon: 'i-user',          permission: 'personal.view' },
            { tab: 'staff',    label: 'Staff',    icon: 'i-user-round',      permission: 'staff.view' },
            { tab: 'reports',  label: 'Reports',  icon: 'i-chart-column',  permission: 'reports.view' },
            { tab: 'matrix',   label: 'Matrix',   icon: 'i-table',   permission: 'matrix.view' }
        ]
    },
    {
        title: 'Administration',
        items: [
            { tab: 'admin',    label: 'Settings', icon: 'i-sliders-horizontal',            permission: 'settings.manage' },
            { tab: 'settings', label: 'Data',     icon: 'i-database',           permission: 'settings.view' },
            { tab: 'audit',    label: 'Audit',    icon: 'i-history',  permission: 'audit.view' }
        ]
    }
];
window.MORE_MENU_GROUPS = MORE_MENU_GROUPS;

function renderMoreMenu() {
    const host = document.getElementById('moreMenuGroups');
    if (!host) return;
    const groups = MORE_MENU_GROUPS
        .map(g => ({ title: g.title, items: g.items.filter(i => hasPermission(i.permission)) }))
        .filter(g => g.items.length);

    if (!groups.length) {
        host.innerHTML = '<p class="text-xs font-medium text-slate-400 py-4 text-center">No other sections available for your role.</p>';
        return;
    }

    host.innerHTML = groups.map(g => `
        <div>
            <p class="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">${escapeHtml(g.title)}</p>
            <div class="grid grid-cols-4 gap-2">
                ${g.items.map(i => `
                    <button type="button" data-more-tab="${i.tab}"
                        class="bnav-btn flex flex-col items-center gap-1 p-3 rounded-xl bg-slate-800/80 border border-slate-700/50">
                        <svg class="ic text-lg" aria-hidden="true"><use href="#${i.icon}"></use></svg>
                        <span class="text-xs font-medium">${escapeHtml(i.label)}</span>
                    </button>`).join('')}
            </div>
        </div>`).join('');

    // Delegated once, rather than an inline handler per rendered button.
    if (host.dataset.wired !== '1') {
        host.dataset.wired = '1';
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-more-tab]');
            if (!btn) return;
            switchTab(btn.dataset.moreTab);
            if (window.closeMobileMoreSheet) window.closeMobileMoreSheet();
        });
    }
}
window.renderMoreMenu = renderMoreMenu;

function canOpenTab(tabId) {
    const item = NAV_ITEMS.find(n => n.tab === tabId);
    if (!item) return true;                  // unknown tab: not ours to police
    return hasPermission(item.permission);
}
window.canOpenTab = canOpenTab;

// Hide what the user cannot reach, on every navigation surface at once.
// Disabled-but-visible entries are deliberately not used: advertising a module
// somebody cannot open is noise, not information.
function applyNavPermissions() {
    if (typeof initBillsScreen === 'function') initBillsScreen();
    if (typeof applyDashboardWidgets === 'function') applyDashboardWidgets();
    if (typeof renderMoreMenu === 'function') renderMoreMenu();
    let hiddenCount = 0;
    NAV_ITEMS.forEach(item => {
        const allowed = hasPermission(item.permission);
        if (!allowed) hiddenCount++;
        document.querySelectorAll(
            `#tab-${item.tab}, [data-nav-tab="${item.tab}"], ` +
            `.sidebar-link[onclick*="'${item.tab}'"], .bnav-btn[onclick*="'${item.tab}'"]`
        ).forEach(el => {
            el.classList.toggle('hidden', !allowed);
        });
    });
    return hiddenCount;
}
window.applyNavPermissions = applyNavPermissions;

// ============================================================
// DASHBOARD WIDGET REGISTRY
// ============================================================
// The dashboard carried 24 sections of equal visual weight, every one of them
// rendered for every role. Two problems in one: a member saw payroll they have
// no business seeing, and the budget competed for attention with a payment-
// method donut.
//
// Widgets are declared once, with the permission that earns them and the
// priority that places them. One engine, not a dashboard per role.
const DASHBOARD_WIDGETS = [
    // Priority 1 - what needs attention right now.
    { id: 'dashboardAnomalyBanner',   permission: 'dashboard.view', priority: 1 },
    { id: 'financialInsightsContainer', permission: 'dashboard.view', priority: 1 },
    { id: 'dashSummaryGrid',          permission: 'dashboard.view', priority: 1 },
    { id: 'dashBudgetYtdSection',     permission: 'dashboard.view', priority: 1 },

    // Priority 2 - the near future.
    { id: 'dashBillsRadarSection',    permission: 'bill.view',      priority: 2 },
    { id: 'dashChecklistSection',     permission: 'bill.view',      priority: 2 },
    { id: 'dashTrendSection',         permission: 'dashboard.view', priority: 2 },

    // Priority 3 - supporting detail.
    { id: 'dashCategorySection',      permission: 'dashboard.view', priority: 3 },
    { id: 'dashMemberSection',        permission: 'dashboard.view', priority: 3 },
    { id: 'dashStaffSummary',         permission: 'payroll.view',   priority: 3 },
    { id: 'dashRecentSection',        permission: 'expense.view',   priority: 3 }
];
window.DASHBOARD_WIDGETS = DASHBOARD_WIDGETS;

// Render only what this role has earned. A widget the user cannot have is not
// shown disabled - advertising a module somebody cannot open is noise.
function applyDashboardWidgets() {
    let hidden = 0;
    DASHBOARD_WIDGETS.forEach(w => {
        const el = document.getElementById(w.id);
        if (!el) return;
        const allowed = hasPermission(w.permission);
        if (!allowed) hidden++;
        el.classList.toggle('perm-hidden', !allowed);
    });
    return hidden;
}
window.applyDashboardWidgets = applyDashboardWidgets;

// ================= TAB: BILLS =================
// Adds no bill logic. Status comes from getRecurringPaymentStatus - the same
// function the dashboard radar and the server-side reminder scan use - so
// "paid" means one thing across the application rather than three.
let billsFilter = 'all';

const BILL_STATUS_META = {
    OVERDUE:        { label: 'Overdue',   tone: 'danger',  bucket: 'overdue' },
    DUE_TODAY:      { label: 'Due today', tone: 'warning', bucket: 'due' },
    UPCOMING:       { label: 'Upcoming',  tone: 'info',    bucket: 'upcoming' },
    PARTIALLY_PAID: { label: 'Partial',   tone: 'warning', bucket: 'upcoming' },
    PAID:           { label: 'Paid',      tone: 'success', bucket: 'paid' },
    DISABLED:       { label: 'Inactive',  tone: 'neutral', bucket: 'paid' }
};

function renderBillsView(filteredData) {
    const list = document.getElementById('billsList');
    if (!list) return;

    const bills = (typeof getConfiguredBills === 'function') ? getConfiguredBills() : [];
    const empty = document.getElementById('billsEmptyState');
    const rows = filteredData || window.expensesData || expenses || [];

    if (!bills.length) {
        list.innerHTML = '';
        if (empty) empty.classList.remove('hidden');
        ['billsOverdueCount', 'billsDueCount', 'billsPaidCount'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '0';
        });
        return;
    }
    if (empty) empty.classList.add('hidden');

    const today = new Date();
    const evaluated = bills.map(bill => {
        const res = window.getRecurringPaymentStatus
            ? window.getRecurringPaymentStatus(bill, rows, today)
            : { status: 'UPCOMING', totalPaid: 0, targetAmount: Number(bill.approxAmount) || 0, daysDiff: 0 };
        const meta = BILL_STATUS_META[res.status] || BILL_STATUS_META.UPCOMING;
        return { bill, res, meta };
    });

    const count = (bucket) => evaluated.filter(e => e.meta.bucket === bucket).length;
    const setCount = (id, n) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(n);
    };
    setCount('billsOverdueCount', count('overdue'));
    setCount('billsDueCount', count('due'));
    setCount('billsPaidCount', count('paid'));

    // Most urgent first: overdue, then due today, then by how soon.
    const order = { overdue: 0, due: 1, upcoming: 2, paid: 3 };
    const shown = evaluated
        .filter(e => billsFilter === 'all' || e.meta.bucket === billsFilter)
        .sort((a, b) => (order[a.meta.bucket] - order[b.meta.bucket]) ||
                        ((a.res.daysDiff || 0) - (b.res.daysDiff || 0)));

    if (!shown.length) {
        list.innerHTML = `<div class="glass-card p-6 rounded-2xl border border-dashed border-slate-300 text-center">
            <p class="text-sm font-medium text-slate-600">Nothing in this group</p>
        </div>`;
        return;
    }

    list.innerHTML = shown.map(({ bill, res, meta }) => {
        const amount = Number(res.targetAmount) || 0;
        const paid = Number(res.totalPaid) || 0;
        const days = Number(res.daysDiff) || 0;
        const when = meta.bucket === 'paid'
            ? `Paid ${formatINR(paid)}`
            : days > 0 ? `Due in ${days} day${days === 1 ? '' : 's'}`
            : days === 0 ? 'Due today'
            : `${-days} day${days === -1 ? '' : 's'} overdue`;
        return `
        <div class="bill-row bill-row-${meta.tone}">
            <div class="bill-row-main">
                <span class="bill-row-name">${escapeHtml(bill.name || bill.category || 'Bill')}</span>
                <span class="bill-row-when">${escapeHtml(when)}</span>
            </div>
            <div class="bill-row-side">
                <span class="bill-row-amount">${amount > 0 ? formatINR(amount) : '—'}</span>
                <span class="badge badge-${meta.tone === 'danger' ? 'danger'
                    : meta.tone === 'warning' ? 'warning'
                    : meta.tone === 'success' ? 'success' : 'info'}">${meta.label}</span>
            </div>
            <button type="button" class="bill-row-pay" data-bill-pay="${escapeHtml(bill.category || bill.name || '')}"
                data-bill-amount="${amount}" data-bill-to="${escapeHtml(bill.name || '')}"
                aria-label="Record payment for ${escapeHtml(bill.name || 'this bill')}">
                <svg class="ic" aria-hidden="true"><use href="#i-plus"></use></svg>
            </button>
        </div>`;
    }).join('');
}
window.renderBillsView = renderBillsView;

// Delegated, not inline: one listener for the whole screen rather than a
// handler per row, which is what the brief asks for in new code.
function initBillsScreen() {
    const view = document.getElementById('view-bills');
    if (!view || view.dataset.wired === '1') return;
    view.dataset.wired = '1';

    view.addEventListener('click', (e) => {
        const filterBtn = e.target.closest('[data-bill-filter]');
        if (filterBtn) {
            billsFilter = filterBtn.dataset.billFilter;
            view.querySelectorAll('[data-bill-filter]').forEach(b =>
                b.setAttribute('aria-pressed', String(b === filterBtn)));
            renderBillsView();
            return;
        }
        const payBtn = e.target.closest('[data-bill-pay]');
        if (payBtn) {
            quickPayItem(payBtn.dataset.billPay,
                         Number(payBtn.dataset.billAmount) || 0,
                         payBtn.dataset.billTo || '');
            return;
        }
        if (e.target.closest('#btnBillsManage')) {
            switchTab('admin');
        }
    });
}
window.initBillsScreen = initBillsScreen;

// ============================================================================
// SETTINGS SECTIONS
// ----------------------------------------------------------------------------
// Master Settings was ten cards on one scroll with nothing to aim at. Each card
// now declares the group it belongs to; this builds the chip rail from the
// groups that are actually present on the screen and shows one at a time.
//
// The grouping is presentation only. Nothing is hidden for authorisation here -
// cards the role may not use are already removed elsewhere, and a card hidden
// by a chip is still in the document, which is exactly why hiding is never
// treated as a permission check.
// ============================================================================

const SETTINGS_SECTIONS = [
    { key: 'account',   label: 'Account',   icon: 'i-id-card' },
    { key: 'household', label: 'Household', icon: 'i-house' },
    { key: 'finance',   label: 'Finance',   icon: 'i-indian-rupee' },
    { key: 'appearance', label: 'Appearance', icon: 'i-palette' },
    { key: 'bills',     label: 'Bills',     icon: 'i-receipt-text' },
    { key: 'staff',     label: 'Staff',     icon: 'i-users' },
    { key: 'data',      label: 'Data',      icon: 'i-database' },
    { key: 'security',  label: 'Security',  icon: 'i-shield' }
];

// Remembering the chosen section per screen, so coming back to Master Settings
// after adding a bill does not drop the person at the top of the page again.
const settingsSectionState = {};

// Which group each screen opens on. Master Settings opens on Household
// because that is where users and households are managed; Account is a
// read-only summary and a poor landing page.
function settingsScreens() {
    return [
        { nav: 'adminSettingsNav', view: 'view-admin', first: 'household' },
        { nav: 'dataSettingsNav', view: 'view-settings', first: 'data' }
    ];
}

function initSettingsSections() {
    settingsScreens().forEach(screen => {
        const nav = document.getElementById(screen.nav);
        const view = document.getElementById(screen.view);
        if (!nav || !view) return;

        const cards = Array.from(view.querySelectorAll('[data-settings-section]'));
        const counts = {};
        cards.forEach(c => {
            const k = c.getAttribute('data-settings-section');
            counts[k] = (counts[k] || 0) + 1;
        });

        const present = SETTINGS_SECTIONS.filter(sec => counts[sec.key]);
        // One group is not a choice; showing a single chip would be decoration.
        if (present.length < 2) {
            nav.innerHTML = '';
            cards.forEach(c => c.classList.remove('settings-section-hidden'));
            return;
        }

        const chosen = settingsSectionState[screen.view] && counts[settingsSectionState[screen.view]]
            ? settingsSectionState[screen.view]
            : (counts[screen.first] ? screen.first : present[0].key);

        nav.setAttribute('role', 'tablist');
        nav.innerHTML = present.map(sec => `
            <button type="button" role="tab" class="settings-chip"
                    aria-selected="${sec.key === chosen ? 'true' : 'false'}"
                    data-section-key="${escapeHtml(sec.key)}"
                    onclick="showSettingsSection(${escapeHtml(JSON.stringify(screen.view))}, ${escapeHtml(JSON.stringify(sec.key))})">
                <svg class="ic" aria-hidden="true"><use href="#${escapeHtml(sec.icon)}"></use></svg>
                <span>${escapeHtml(sec.label)}</span>
                <span class="settings-chip-count">${counts[sec.key]}</span>
            </button>
        `).join('');

        showSettingsSection(screen.view, chosen);
    });
}
window.initSettingsSections = initSettingsSections;

function showSettingsSection(viewId, key) {
    const view = document.getElementById(viewId);
    if (!view) return;
    settingsSectionState[viewId] = key;

    view.querySelectorAll('[data-settings-section]').forEach(card => {
        card.classList.toggle('settings-section-hidden',
            card.getAttribute('data-settings-section') !== key);
    });
    view.querySelectorAll('.settings-chip').forEach(chip => {
        chip.setAttribute('aria-selected',
            chip.getAttribute('data-section-key') === key ? 'true' : 'false');
    });
}
window.showSettingsSection = showSettingsSection;

// The Account card reads from the live session rather than from a copy, so it
// cannot show a stale household after a switch.
function renderAccountCard() {
    const u = currentSessionUser;
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '—';
    };
    if (!u) {
        ['accountCardName', 'accountCardUsername', 'accountCardEmail',
         'accountCardHousehold', 'accountCardRole'].forEach(id => set(id, '—'));
        return;
    }
    set('accountCardName', u.name);
    set('accountCardUsername', u.username ? '@' + u.username : '');
    set('accountCardEmail', u.email);
    set('accountCardHousehold', (u.householdName || u.householdId || ''));

    const held = currentPermissions().length;
    const custom = u.permissionsAreCustom === true;
    set('accountCardRole', (u.role || '') +
        ' · ' + held + ' permission' + (held === 1 ? '' : 's') +
        (custom ? ' (set individually)' : ' (from this role)'));
}
window.renderAccountCard = renderAccountCard;

// Mount or remove the Household & User Access Management card.
// Only a system administrator gets it in the DOM at all; for everyone else it
// is removed rather than hidden. Returns the card, or null when not allowed.
function syncAdminTenantCard() {
    const allowed = !!authToken && isAdminRole(currentSessionUser && currentSessionUser.role);
    let card = document.getElementById("adminTenantManagementCard");
    const tpl = document.getElementById("adminTenantManagementTemplate");
    const modalsTpl = document.getElementById("adminModalsTemplate");
    const MODAL_IDS = ["modalCreateHousehold", "modalCreateUser", "modalEditHousehold", "modalEditUser"];
    if (allowed && !card && tpl && tpl.parentNode) {
        tpl.parentNode.insertBefore(tpl.content.cloneNode(true), tpl);
        card = document.getElementById("adminTenantManagementCard");
        if (card) card.classList.remove("hidden");
    } else if (!allowed && card) {
        card.remove();
        card = null;
    }
    // The four admin dialogs travel with the card.
    if (allowed && modalsTpl && !document.getElementById("modalEditUser")) {
        document.body.appendChild(modalsTpl.content.cloneNode(true));
    } else if (!allowed) {
        document.querySelectorAll(
            ".modal-backdrop[id^='modalCreate'], .modal-backdrop[id^='modalEdit']"
        ).forEach(el => el.remove());
    }
    return allowed ? card : null;
}
window.syncAdminTenantCard = syncAdminTenantCard;

function switchTab(tabId) {
    // The views all live in one document and switchTab is global, so hiding a
    // nav button is presentation only. This is the client-side guard; the API
    // enforces the same permissions independently.
    if (!canOpenTab(tabId)) {
        if (window.showToast) {
            window.showToast('error', 'Not available',
                'Your role does not have access to that section.');
        }
        return;
    }
    triggerHaptic('tap');
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.remove("active");
        btn.classList.add("text-slate-600");
    });
    // A class change tells a sighted user which section they are in; only
    // aria-current tells anyone else.
    document.querySelectorAll('.tab-btn, .bnav-btn, .sidebar-link')
        .forEach(btn => btn.removeAttribute('aria-current'));
    document.querySelectorAll(".tab-view").forEach(view => {
        view.classList.add("hidden");
        view.classList.remove("section-enter");
    });

    const activeBtn = document.getElementById(`tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add("active");
        activeBtn.setAttribute('aria-current', 'page');
        activeBtn.classList.remove("text-slate-600");
        try {
            activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (e) {}
    }

    // Synchronize Mobile Bottom Navigation Bar buttons
    document.querySelectorAll(".bnav-btn").forEach(btn => {
        btn.classList.remove("active");
    });
    const activeBnav = document.getElementById(`bnav-${tabId}`);
    if (activeBnav) {
        activeBnav.classList.add("active");
        activeBnav.setAttribute('aria-current', 'page');
    }

    if (tabId === 'admin' || tabId === 'settings') {
        try {
            // The tenant card must be in the page before the section chips are
            // counted and before its group is shown or hidden; mounted afterwards
            // it would carry no hidden class and appear under every group.
            syncAdminTenantCard();
            renderAccountCard();
            if (window.renderDashboardUiSettings) window.renderDashboardUiSettings();
            initSettingsSections();
        } catch (e) { /* a settings screen that is not rendered yet */ }
    }

    // Synchronize Desktop Sidebar links
    document.querySelectorAll(".sidebar-link").forEach(link => {
        link.classList.remove("active");
    });
    const activeSidebarLink = document.getElementById(`sidebar-${tabId}`);
    if (activeSidebarLink) {
        activeSidebarLink.classList.add("active");
        activeSidebarLink.setAttribute('aria-current', 'page');
    }

    const activeView = document.getElementById(`view-${tabId}`);
    if (activeView) {
        activeView.classList.remove("hidden");
        // Trigger section-enter animation
        requestAnimationFrame(() => {
            activeView.classList.add("section-enter");
        });
    }

    // Contextually toggle global expense filter toolbar
    const filterToolbar = document.getElementById("mainFilterToolbar");
    if (filterToolbar) {
        if (['dashboard', 'expenses', 'matrix', 'personal'].includes(tabId)) {
            filterToolbar.classList.remove("hidden");
        } else {
            filterToolbar.classList.add("hidden");
        }
    }

    if (tabId === 'admin' || tabId === 'settings') {
        // Declared here because the code below still reads it: it used to come
        // from the block this call replaced, and removing it broke every tab switch.
        const isSysAdmin = isAdminRole(currentSessionUser && currentSessionUser.role);
        syncAdminTenantCard();
        if (window.loadMasterConfig) {
            window.loadMasterConfig().then(() => {
                if (window.renderAdminView) window.renderAdminView();
            });
        } else if (window.renderAdminView) {
            window.renderAdminView();
        }
        if (tabId === 'admin' && isSysAdmin && window.loadAdminConsoleData) {
            window.loadAdminConsoleData();
        }
        if (tabId === 'settings') {
            if (window.loadBackupSnapshots) window.loadBackupSnapshots();
            if (window.updateDataCenterMetrics) window.updateDataCenterMetrics();
            if (window.triggerDataHealthScan) window.triggerDataHealthScan();
        }
    }
    if (tabId === 'audit' && window.renderAuditView) {
        window.renderAuditView();
    }
    if (tabId === 'personal' && window.renderPersonalExpensesDashboard) {
        window.renderPersonalExpensesDashboard();
    }

    // Name the account on the password card when arriving, and wipe the fields
    // when leaving, so a typed password is never left sitting revealed on a
    // screen somebody walks away from.
    if (tabId === 'admin') {
        if (window.renderPasswordCardIdentity) window.renderPasswordCardIdentity();
    } else if (window.resetPasswordFields) {
        window.resetPasswordFields();
    }

    // Scroll to top when switching views on mobile/desktop
    try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}

    // Always trigger fresh zero-cache transaction sync when switching into transaction or dashboard views
    if (['dashboard', 'expenses', 'matrix', 'personal', 'audit'].includes(tabId)) {
        loadData(true);
    }

    // When navigating between views, render all charts/tables
    renderAllViews();
}

function getAuthHeaders(extra = {}) {
    const token = authToken || localStorage.getItem("household_auth_token") || "";
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...extra
    };
}
window.getAuthHeaders = getAuthHeaders;

function broadcastTransactionUpdate(action = 'UPDATE') {
    try {
        if (window.txBroadcastChannel) {
            window.txBroadcastChannel.postMessage({
                type: 'TRANSACTIONS_UPDATED',
                action: action,
                householdId: (typeof getActiveHouseholdId === 'function') ? getActiveHouseholdId() : 'H001',
                timestamp: Date.now()
            });
        }
    } catch (e) {}
}
window.broadcastTransactionUpdate = broadcastTransactionUpdate;

// ================= DATA LOADING & SYNC =================
async function loadData(silent = false) {
    if (!silent) updateSyncBadge("Syncing...", "amber");

    try {
        const activeHId = (typeof getActiveHouseholdId === 'function') 
            ? getActiveHouseholdId() 
            : ((currentSessionUser && currentSessionUser.householdId) || 'H001');

        const res = await fetch(`/api/expenses?householdId=${encodeURIComponent(activeHId)}&_t=${Date.now()}`, {
            method: "GET",
            headers: {
                ...getAuthHeaders(),
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            },
            cache: 'no-store'
        });

        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
            const serverExpenses = result.data.map(item => ({
                ...item,
                paidBy: item.paidBy || inferPaidBy(item)
            }));

            // Merge server records with any recently saved client-side records that may still be propagating
            const serverIds = new Set(serverExpenses.map(i => String(i.id).trim()));
            const recentClientRecords = expenses.filter(i => {
                if (serverIds.has(String(i.id).trim())) return false;
                if (i.clientUpdatedAt) {
                    const age = Date.now() - new Date(i.clientUpdatedAt).getTime();
                    return age < 120000;
                }
                return false;
            });

            expenses = [...recentClientRecords, ...serverExpenses];
            expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

            window.expenses = expenses;
            window.expensesData = expenses;

            saveLocalCacheData();
            populateFilterYearDropdown();
            renderAllViews();
            updateSyncBadge("Online & Synced", "emerald");
            updateHeaderStatus();
        } else {
            console.error("Failed to load records from server:", result.error);
            updateSyncBadge("Sync Error", "red");
            loadLocalFallbackData();
        }
    } catch (err) {
        console.warn("Network error loading records, using local fallback cache:", err);
        updateSyncBadge("Offline Mode", "amber");
        loadLocalFallbackData();
    }
}
window.loadData = loadData;
window.renderAllViews = renderAllViews;

function inferPaidBy(item) {
    if (item.paidBy) return item.paidBy;
    const text = ((item.notes || '') + ' ' + (item.description || '')).toLowerCase();
    const members = (window.masterConfig && window.masterConfig.familyMembers) || window.FAMILY_MEMBERS || [];
    for (const m of members) {
        if (m && text.includes(m.toLowerCase())) return m;
    }
    return "Not Specified";
}

function updateSyncBadge(text, color) {
    const badge = document.getElementById("recordCountBadge");
    if (!badge) return;
    const dotColor = color === "emerald" ? "text-emerald-500" : (color === "amber" ? "text-amber-500" : "text-rose-500");
    badge.innerHTML = `<svg class="ic ${dotColor} mr-1" aria-hidden="true"><use href="#i-circle-check"></use></svg> Status: ${text} (${expenses.length} records)`;
}

function updateHeaderStatus() {
    const countEl = document.getElementById("hdrTxCount");
    const updatedEl = document.getElementById("hdrLastUpdated");
    const statusEl = document.getElementById("hdrStatusText");
    if (countEl) countEl.textContent = `${expenses.length} Transactions`;
    if (updatedEl) {
        const d = new Date();
        const hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        updatedEl.textContent = `${displayHours}:${mins} ${ampm}`;
    }
    // Update live/offline status text in v5.0 header
    if (statusEl) {
        statusEl.textContent = navigator.onLine ? 'Live' : 'Offline';
    }
    // Update header period badge safely
    const periodText = document.getElementById("hdrPeriodText");
    const periodBadge = document.getElementById("hdrPeriodBadge");
    if (periodText || periodBadge) {
        const p = getCurrentPeriod();
        if (periodText) {
            periodText.textContent = `${p.monthName} ${p.year}`;
        } else if (periodBadge) {
            const periodSpan = periodBadge.querySelector('span');
            if (periodSpan) periodSpan.textContent = `${p.monthName.substring(0, 3)} '${String(p.year).substring(2)}`;
        }
    }
}

function getActiveHouseholdId() {
    return currentSessionUser?.householdId || 'H001';
}
window.getActiveHouseholdId = getActiveHouseholdId;

function getHouseholdCacheKey() {
    return `household_expenses_cache_${getActiveHouseholdId()}`;
}

function saveLocalCacheData() {
    if (!currentSessionUser || !currentSessionUser.householdId) return;
    const key = getHouseholdCacheKey();
    localStorage.setItem(key, JSON.stringify(expenses));
    // Also maintain legacy cache if H001 for backward compatibility
    if (currentSessionUser.householdId === 'H001') {
        localStorage.setItem("household_expenses_online_cache", JSON.stringify(expenses));
    }
}

function loadLocalFallbackData() {
    const key = getHouseholdCacheKey();
    const cached = localStorage.getItem(key) || (getActiveHouseholdId() === 'H001' ? localStorage.getItem("household_expenses_online_cache") : null);
    if (cached) {
        try {
            expenses = JSON.parse(cached).map(item => ({
                ...item,
                paidBy: item.paidBy || inferPaidBy(item)
            }));
            populateFilterYearDropdown();
            renderAllViews();
        } catch (e) {}
    } else {
        expenses = [];
        renderAllViews();
    }
}

// ================= USER & HOUSEHOLD AUTHENTICATION ENGINE =================
function getActiveUser() {
    return currentSessionUser;
}
window.getActiveUser = getActiveUser;

function updateUserProfileUI() {
    const name = currentSessionUser?.name || currentSessionUser?.username || 'Guest';
    const role = (currentSessionUser?.role || 'GUEST').toUpperCase();
    const hName = currentSessionUser?.householdName || 'Sign In Required';
    const initial = name.charAt(0).toUpperCase();

    const hdrName = document.getElementById("hdrUserName");
    const hdrRole = document.getElementById("hdrUserRole");
    const hdrAvatar = document.getElementById("hdrUserAvatar");
    const hdrHName = document.getElementById("hdrHouseholdName");
    const mobInitial = document.getElementById("mobileUserInitial");

    if (hdrName) hdrName.textContent = name;
    if (hdrRole) hdrRole.textContent = role;
    if (hdrAvatar) hdrAvatar.textContent = initial;
    if (hdrHName) hdrHName.textContent = hName;
    if (mobInitial) mobInitial.textContent = initial;

    const pModalName = document.getElementById("profileModalName");
    const pModalRole = document.getElementById("profileModalRole");
    const pModalAvatar = document.getElementById("profileModalAvatar");
    const pModalHName = document.getElementById("profileModalHousehold");

    if (pModalName) pModalName.textContent = name;
    if (pModalRole) pModalRole.textContent = role;
    if (pModalAvatar) pModalAvatar.textContent = initial;
    if (pModalHName) pModalHName.textContent = hName;

    const mobActionAvatar = document.getElementById("mobileActionUserAvatar");
    const mobActionName = document.getElementById("mobileActionUserName");
    const mobActionRole = document.getElementById("mobileActionUserRole");
    if (mobActionAvatar) mobActionAvatar.textContent = initial;
    if (mobActionName) mobActionName.textContent = name;
    if (mobActionRole) mobActionRole.textContent = role;

    // Restrict Section 0: Household & User Access Management STRICTLY to System Admin
    syncAdminTenantCard();
}
window.updateUserProfileUI = updateUserProfileUI;

function openLoginModal() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const modal = document.getElementById("loginModal");
    if (modal) {
        modal.classList.remove("hidden");
        const userInput = document.getElementById("loginUsername");
        if (userInput) setTimeout(() => userInput.focus(), 100);
    }
}
window.openLoginModal = openLoginModal;

function closeLoginModal() {
    if (!authToken || !currentSessionUser) {
        if (typeof showToast === 'function') {
            showToast('warning', 'Authentication Required', 'Please sign in to access your household command center.');
        }
        return;
    }
    const modal = document.getElementById("loginModal");
    if (modal) modal.classList.add("hidden");
}
window.closeLoginModal = closeLoginModal;

function openUserProfileModal() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    updateUserProfileUI();
    const modal = document.getElementById("userProfileModal");
    if (modal) modal.classList.remove("hidden");
}
window.openUserProfileModal = openUserProfileModal;

function closeUserProfileModal() {
    const modal = document.getElementById("userProfileModal");
    if (modal) modal.classList.add("hidden");
}
window.closeUserProfileModal = closeUserProfileModal;

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btn) btn.textContent = 'Hide';
    } else {
        input.type = 'password';
        if (btn) btn.textContent = 'Show';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

async function handleLoginFormSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const username = document.getElementById("loginUsername")?.value || "";
    const password = document.getElementById("loginPassword")?.value || "";
    await signIn(username, password);
}
window.handleLoginFormSubmit = handleLoginFormSubmit;

async function signIn(username, password) {
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');
    const submitBtn = document.getElementById("btnLoginSubmit");
    const errorEl = document.getElementById("loginErrorMsg");
    if (errorEl) errorEl.classList.add("hidden");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<svg class="ic animate-spin mr-2" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Signing In...`;
    }

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'login', username, password })
        });
        const result = await res.json();
        if (result.success && result.token) {
            authToken = result.token;
            currentSessionUser = result.user;
            window.currentSessionUser = currentSessionUser;
            localStorage.setItem("household_auth_token", authToken);
            localStorage.setItem("household_session_user", JSON.stringify(currentSessionUser));

            // Cleanly reset in-memory records to guarantee zero cross-household bleed
            expenses = [];
            window.expenses = [];
            window.expensesData = [];

            closeLoginModal();
            updateUserProfileUI();
            applyNavPermissions();
            await loadData();
            if (window.loadMasterConfig) await window.loadMasterConfig();
            if (window.renderAdminView) window.renderAdminView();
            const isSysAdmin = currentSessionUser && (currentSessionUser.role === 'ADMIN' || currentSessionUser.role === 'SYSTEM_ADMIN');
            if (isSysAdmin && window.loadAdminConsoleData) window.loadAdminConsoleData();
            showToast('success', `Signed In as ${result.user.name}`, `Active: ${result.user.householdName}`);
            if (window.syncPushSubscriptionSilently) window.syncPushSubscriptionSilently();
        } else {
            if (errorEl) {
                errorEl.textContent = result.error || "Invalid username or password. Please verify credentials.";
                errorEl.classList.remove("hidden");
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = "Network error signing in. Please verify connection.";
            errorEl.classList.remove("hidden");
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Sign In to Command Center</span> <svg class="ic ml-1" aria-hidden="true"><use href="#i-arrow-right"></use></svg>`;
        }
    }
}
window.signIn = signIn;

function signOut() {
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');
    authToken = '';
    currentSessionUser = null;
    window.currentSessionUser = null;
    expenses = [];
    window.expenses = [];
    window.expensesData = [];
    localStorage.removeItem("household_auth_token");
    localStorage.removeItem("household_session_user");

    // Clear every cached copy of household data, not just the token. Leaving
    // the ledger, budgets and attendance in localStorage means the next person
    // to pick up the phone can read the household's finances after a sign-out.
    // The offline queue is deliberately kept: it holds the owner's own unsent
    // entries, which would otherwise be lost, and carries no server data.
    try {
        // Device preferences, not household data: keeping them across a sign-out
        // leaks nothing and avoids resetting the UI for the next sign-in.
        const keep = new Set([
            'homeexpenses_offline_queue',
            'household_app_theme',
            'homeexpenses_expense_view'
        ]);
        Object.keys(localStorage)
            .filter(k => !keep.has(k) &&
                /^(household_|homeexpenses_)/i.test(k))
            .forEach(k => localStorage.removeItem(k));
    } catch (e) {
        console.warn('Sign out: could not fully clear cached data:', e.message);
    }

    fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' })
    }).catch(() => {});

    updateUserProfileUI();
    renderAllViews();
    openLoginModal();
}
window.signOut = signOut;

async function initAuthSession() {
    const storedToken = localStorage.getItem("household_auth_token");
    const storedUser = localStorage.getItem("household_session_user");

    if (storedUser) {
        try { currentSessionUser = JSON.parse(storedUser); window.currentSessionUser = currentSessionUser; } catch (e) {}
    }

    if (storedToken) {
        authToken = storedToken;
        try {
            const res = await fetch('/api/auth', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${storedToken}` }
            });
            const result = await res.json();
            if (result.success && result.user) {
                currentSessionUser = result.user;
                window.currentSessionUser = currentSessionUser;
                localStorage.setItem("household_session_user", JSON.stringify(currentSessionUser));
                updateUserProfileUI();
                await loadData();
                if (window.loadMasterConfig) await window.loadMasterConfig();
                if (window.renderAdminView) window.renderAdminView();
                const isSysAdmin = currentSessionUser && (currentSessionUser.role === 'ADMIN' || currentSessionUser.role === 'SYSTEM_ADMIN');
                if (isSysAdmin && window.loadAdminConsoleData) window.loadAdminConsoleData();
                if (window.syncPushSubscriptionSilently) window.syncPushSubscriptionSilently();
                return;
            }
        } catch (e) {}
    }

    // If no valid session exists or session expired, remain signed out and prompt for login
    authToken = '';
    currentSessionUser = null;
    localStorage.removeItem("household_auth_token");
    localStorage.removeItem("household_session_user");
    expenses = [];
    window.expenses = [];
    window.expensesData = [];
    updateUserProfileUI();
    renderAllViews();
    openLoginModal();
}
window.initAuthSession = initAuthSession;

// ================= ADVANCED FILTER ENGINE =================
function populateFilterMonthDropdown() {
    const monthSelect = document.getElementById("filterMonth");
    if (!monthSelect) return;
    
    const cur = getCurrentPeriod();
    let html = `<option value="${cur.monthName}">Current Month (${cur.monthName})</option>`;
    html += `<option value="all">All Months (Complete Ledger)</option>`;
    
    MONTHS.forEach((m) => {
        html += `<option value="${m}">${m}</option>`;
    });

    monthSelect.innerHTML = html;
    monthSelect.value = dashboardFilters.month || cur.monthName;

    const mobileMonthSelect = document.getElementById("mobileFilterMonth");
    if (mobileMonthSelect) {
        mobileMonthSelect.innerHTML = html;
        mobileMonthSelect.value = dashboardFilters.month || cur.monthName;
    }
}

function populateFilterYearDropdown() {
    const yearSelect = document.getElementById("filterYear");
    if (!yearSelect) return;

    const cur = getCurrentPeriod();
    const yearsSet = new Set([cur.yearStr]);
    expenses.forEach(i => {
        if (i.date) {
            const y = new Date(i.date).getFullYear().toString();
            if (y && !isNaN(Number(y))) yearsSet.add(y);
        }
    });

    const sortedYears = Array.from(yearsSet).sort().reverse();

    let html = `<option value="${cur.yearStr}">Current Year (${cur.yearStr})</option>`;
    html += `<option value="all">All Years (Complete History)</option>`;
    sortedYears.forEach(y => {
        if (y !== cur.yearStr) {
            html += `<option value="${y}">${y}</option>`;
        }
    });

    yearSelect.innerHTML = html;
    yearSelect.value = dashboardFilters.year || cur.yearStr;

    const mobileYearSelect = document.getElementById("mobileFilterYear");
    if (mobileYearSelect) {
        mobileYearSelect.innerHTML = html;
        mobileYearSelect.value = dashboardFilters.year || cur.yearStr;
    }
}

// Category Icon Helper for visual recognition across desktop & mobile
function getCategoryIcon(catName) {
    if (!catName) return '<svg class="ic text-slate-500" aria-hidden="true"><use href="#i-receipt"></use></svg>';
    const c = String(catName).toLowerCase();
    if (c.includes('grocery') || c.includes('vegetable')) return '<svg class="ic text-emerald-600" aria-hidden="true"><use href="#i-shopping-basket"></use></svg>';
    if (c.includes('electricity')) return '<svg class="ic text-amber-500" aria-hidden="true"><use href="#i-zap"></use></svg>';
    if (c.includes('maintenance') || c.includes('flat')) return '<svg class="ic text-blue-600" aria-hidden="true"><use href="#i-building"></use></svg>';
    if (c.includes('maid') || c.includes('madhuri')) return '<svg class="ic text-pink-500" aria-hidden="true"><use href="#i-brush"></use></svg>';
    if (c.includes('chef') || c.includes('nilima') || c.includes('cook')) return '<svg class="ic text-orange-500" aria-hidden="true"><use href="#i-utensils"></use></svg>';
    if (c.includes('wifi') || c.includes('internet')) return '<svg class="ic text-cyan-600" aria-hidden="true"><use href="#i-wifi"></use></svg>';
    if (c.includes('dish') || c.includes('dth') || c.includes('tv')) return '<svg class="ic text-purple-600" aria-hidden="true"><use href="#i-tv"></use></svg>';
    if (c.includes('shopping') || c.includes('misc')) return '<svg class="ic text-indigo-600" aria-hidden="true"><use href="#i-shopping-bag"></use></svg>';
    if (c.includes('income') || c.includes('accepted')) return '<svg class="ic text-emerald-600" aria-hidden="true"><use href="#i-arrow-down"></use></svg>';
    if (c.includes('settlement') || c.includes('transfer')) return '<svg class="ic text-teal-600" aria-hidden="true"><use href="#i-arrow-left-right"></use></svg>';
    return '<svg class="ic text-indigo-500" aria-hidden="true"><use href="#i-receipt"></use></svg>';
}
window.getCategoryIcon = getCategoryIcon;

// Updates the compact filter summary pill on mobile screens
function updateMobileFilterSummary() {
    const summaryEl = document.getElementById("mobileActiveFilterSummary");
    const badgeEl = document.getElementById("mobileActiveFilterBadge");
    if (!summaryEl) return;

    const cur = getCurrentPeriod();
    let customFilterCount = 0;

    let periodStr = "";
    if (dashboardFilters.month === "all" && dashboardFilters.year === "all") {
        periodStr = "All Time";
        customFilterCount++;
    } else if (dashboardFilters.month === "all") {
        periodStr = `All Months ${dashboardFilters.year}`;
        customFilterCount++;
    } else if (dashboardFilters.year === "all") {
        periodStr = `${dashboardFilters.month} (All Years)`;
        customFilterCount++;
    } else if (dashboardFilters.month === cur.monthName && dashboardFilters.year === cur.yearStr) {
        periodStr = `${cur.monthName} ${cur.yearStr}`;
    } else {
        periodStr = `${dashboardFilters.month} ${dashboardFilters.year}`;
        customFilterCount++;
    }

    let catStr = "All Categories";
    if (dashboardFilters.category && dashboardFilters.category !== "all") {
        catStr = dashboardFilters.category;
        customFilterCount++;
        if (catStr.length > 18) {
            catStr = catStr.substring(0, 16) + "…";
        }
    }

    let paidStr = "";
    if (dashboardFilters.paidBy && dashboardFilters.paidBy !== "all") {
        paidStr = ` • ${dashboardFilters.paidBy}`;
        customFilterCount++;
    }

    if (dashboardFilters.paymentMethod && dashboardFilters.paymentMethod !== "all") {
        customFilterCount++;
    }
    if (dashboardFilters.expenseType && dashboardFilters.expenseType !== "all") {
        customFilterCount++;
    }

    summaryEl.textContent = `${periodStr} • ${catStr}${paidStr}`;

    if (badgeEl) {
        if (customFilterCount > 0) {
            badgeEl.textContent = customFilterCount;
            badgeEl.classList.remove("hidden");
        } else {
            badgeEl.classList.add("hidden");
        }
    }
}
window.updateMobileFilterSummary = updateMobileFilterSummary;

// Mobile Filter Bottom Sheet Handlers
function openMobileFilterSheet() {
    const modal = document.getElementById("modalMobileFilter");
    if (!modal) return;

    const desktopMonth = document.getElementById("filterMonth");
    const mobileMonth = document.getElementById("mobileFilterMonth");
    if (desktopMonth && mobileMonth) mobileMonth.innerHTML = desktopMonth.innerHTML;

    const desktopYear = document.getElementById("filterYear");
    const mobileYear = document.getElementById("mobileFilterYear");
    if (desktopYear && mobileYear) mobileYear.innerHTML = desktopYear.innerHTML;

    const desktopCat = document.getElementById("filterCategory");
    const mobileCat = document.getElementById("mobileFilterCategory");
    if (desktopCat && mobileCat) mobileCat.innerHTML = desktopCat.innerHTML;

    const desktopPaidBy = document.getElementById("filterPaidBy");
    const mobilePaidBy = document.getElementById("mobileFilterPaidBy");
    if (desktopPaidBy && mobilePaidBy) mobilePaidBy.innerHTML = desktopPaidBy.innerHTML;

    if (mobileMonth) mobileMonth.value = dashboardFilters.month;
    if (mobileYear) mobileYear.value = dashboardFilters.year;
    if (mobileCat) mobileCat.value = dashboardFilters.category;
    if (mobilePaidBy) mobilePaidBy.value = dashboardFilters.paidBy;

    const mobileMethod = document.getElementById("mobileFilterPaymentMethod");
    if (mobileMethod) mobileMethod.value = dashboardFilters.paymentMethod;

    const mobileType = document.getElementById("mobileFilterExpenseType");
    if (mobileType) mobileType.value = dashboardFilters.expenseType;

    modal.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
}

function closeMobileFilterSheet() {
    const modal = document.getElementById("modalMobileFilter");
    if (modal) modal.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
}

function syncMobileFilterToDesktop(field) {
    if (field === 'month') {
        const el = document.getElementById("mobileFilterMonth");
        if (el) dashboardFilters.month = el.value;
    } else if (field === 'year') {
        const el = document.getElementById("mobileFilterYear");
        if (el) dashboardFilters.year = el.value;
    } else if (field === 'category') {
        const el = document.getElementById("mobileFilterCategory");
        if (el) dashboardFilters.category = el.value;
    } else if (field === 'paidBy') {
        const el = document.getElementById("mobileFilterPaidBy");
        if (el) dashboardFilters.paidBy = el.value;
    } else if (field === 'paymentMethod') {
        const el = document.getElementById("mobileFilterPaymentMethod");
        if (el) dashboardFilters.paymentMethod = el.value;
    } else if (field === 'expenseType') {
        const el = document.getElementById("mobileFilterExpenseType");
        if (el) dashboardFilters.expenseType = el.value;
    }

    updateMobileFilterSummary();
}

function applyMobileFiltersAndClose() {
    triggerHaptic('medium');
    const mm = document.getElementById("mobileFilterMonth");
    const my = document.getElementById("mobileFilterYear");
    const mc = document.getElementById("mobileFilterCategory");
    const mp = document.getElementById("mobileFilterPaidBy");
    const mmet = document.getElementById("mobileFilterPaymentMethod");
    const mt = document.getElementById("mobileFilterExpenseType");

    if (mm) dashboardFilters.month = mm.value;
    if (my) dashboardFilters.year = my.value;
    if (mc) dashboardFilters.category = mc.value;
    if (mp) dashboardFilters.paidBy = mp.value;
    if (mmet) dashboardFilters.paymentMethod = mmet.value;
    if (mt) dashboardFilters.expenseType = mt.value;

    syncFilterControlsToState();
    if (window.syncPersonalFilterWithPaidBy) {
        window.syncPersonalFilterWithPaidBy(dashboardFilters.paidBy);
    }
    renderAllViews();
    closeMobileFilterSheet();
}

window.openMobileFilterSheet = openMobileFilterSheet;
window.closeMobileFilterSheet = closeMobileFilterSheet;
window.syncMobileFilterToDesktop = syncMobileFilterToDesktop;
window.applyMobileFiltersAndClose = applyMobileFiltersAndClose;

// Called on any dropdown filter change
function onFilterChange() {
    triggerHaptic('light');
    const monthSelect = document.getElementById("filterMonth");
    const yearSelect = document.getElementById("filterYear");
    const catSelect = document.getElementById("filterCategory");
    const paidBySelect = document.getElementById("filterPaidBy");
    const methodSelect = document.getElementById("filterPaymentMethod");
    const typeSelect = document.getElementById("filterExpenseType");

    if (monthSelect) dashboardFilters.month = monthSelect.value;
    if (yearSelect) dashboardFilters.year = yearSelect.value;
    if (catSelect) dashboardFilters.category = catSelect.value;
    if (paidBySelect) dashboardFilters.paidBy = paidBySelect.value;
    if (methodSelect) dashboardFilters.paymentMethod = methodSelect.value;
    if (typeSelect) dashboardFilters.expenseType = typeSelect.value;

    if (window.syncPersonalFilterWithPaidBy) {
        window.syncPersonalFilterWithPaidBy(dashboardFilters.paidBy);
    }

    updateMobileFilterSummary();
    renderAllViews();
}

function applyFilters() {
    const searchInput = document.getElementById("searchExpenses");
    if (searchInput) dashboardFilters.searchVal = searchInput.value.toLowerCase().trim();
    renderAllViews();
}

// Reset specifically to Current Month + Current Year (Requirement 1, 2, 49)
function resetToCurrentMonth() {
    triggerHaptic('medium');
    const cur = getCurrentPeriod();
    dashboardFilters.month = cur.monthName;
    dashboardFilters.year = cur.yearStr;
    dashboardFilters.category = "all";
    dashboardFilters.paidBy = "all";
    dashboardFilters.paymentMethod = "all";
    dashboardFilters.expenseType = "all";
    dashboardFilters.dateFrom = null;
    dashboardFilters.dateTo = null;
    dashboardFilters.searchVal = "";
    activePeriodPreset = 'this-month';

    syncFilterControlsToState();
    updatePeriodSwitch();
    if (window.syncPersonalFilterWithPaidBy) {
        window.syncPersonalFilterWithPaidBy("all");
    }
    renderAllViews();
}

function resetAllFilters() {
    resetToCurrentMonth();
}

function syncFilterControlsToState() {
    const m = document.getElementById("filterMonth");
    const y = document.getElementById("filterYear");
    const c = document.getElementById("filterCategory");
    const p = document.getElementById("filterPaidBy");
    const met = document.getElementById("filterPaymentMethod");
    const t = document.getElementById("filterExpenseType");
    const s = document.getElementById("searchExpenses");

    if (m) m.value = dashboardFilters.month;
    if (y) y.value = dashboardFilters.year;
    if (c) c.value = dashboardFilters.category;
    if (p) p.value = dashboardFilters.paidBy;
    if (met) met.value = dashboardFilters.paymentMethod;
    if (t) t.value = dashboardFilters.expenseType;
    if (s) s.value = dashboardFilters.searchVal;

    const mm = document.getElementById("mobileFilterMonth");
    const my = document.getElementById("mobileFilterYear");
    const mc = document.getElementById("mobileFilterCategory");
    const mp = document.getElementById("mobileFilterPaidBy");
    const mmet = document.getElementById("mobileFilterPaymentMethod");
    const mt = document.getElementById("mobileFilterExpenseType");

    if (mm) mm.value = dashboardFilters.month;
    if (my) my.value = dashboardFilters.year;
    if (mc) mc.value = dashboardFilters.category;
    if (mp) mp.value = dashboardFilters.paidBy;
    if (mmet) mmet.value = dashboardFilters.paymentMethod;
    if (mt) mt.value = dashboardFilters.expenseType;

    const drawer = document.getElementById("customDateDrawer");
    if (drawer) drawer.classList.add("hidden");

    updateMobileFilterSummary();
}

// Quick Filter Chips handlers
// Which preset the period switch is showing as active. A custom date range
// entered by hand clears it, because none of the presets describes it.
let activePeriodPreset = 'this-month';

function toYmd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function quickFilterPeriod(period) {
    triggerHaptic('tap');
    const cur = getCurrentPeriod();
    const now = new Date();

    // Day and week are genuine date ranges; month and year are month/year
    // selections. getFilteredExpenses gives a range precedence over the
    // month/year pair, so the two must not both be set.
    let from = null;
    let to = null;

    if (period === 'today') {
        from = to = toYmd(now);
        dashboardFilters.month = "all";
        dashboardFilters.year = "all";
    } else if (period === 'this-week') {
        const start = new Date(now);
        start.setDate(now.getDate() - ((now.getDay() + 6) % 7));   // back to Monday
        from = toYmd(start);
        to = toYmd(now);
        dashboardFilters.month = "all";
        dashboardFilters.year = "all";
    } else if (period === 'this-month') {
        dashboardFilters.month = cur.monthName;
        dashboardFilters.year = cur.yearStr;
    } else if (period === 'last-month') {
        const lastMonthIdx = (cur.monthIndex + 11) % 12;
        dashboardFilters.month = MONTHS[lastMonthIdx];
        dashboardFilters.year = (lastMonthIdx === 11 ? cur.year - 1 : cur.year).toString();
    } else if (period === 'this-year') {
        dashboardFilters.month = "all";
        dashboardFilters.year = cur.yearStr;
    } else if (period === 'all-time') {
        dashboardFilters.month = "all";
        dashboardFilters.year = "all";
    }

    dashboardFilters.dateFrom = from;
    dashboardFilters.dateTo = to;
    activePeriodPreset = period;
    syncFilterControlsToState();
    updatePeriodSwitch();
    renderAllViews();
}

// The phone period switch. Ids are fixed, so this is cheap to call often.
const PERIOD_SWITCH_BUTTONS = {
    'today': 'mPeriodToday',
    'this-week': 'mPeriodWeek',
    'this-month': 'mPeriodMonth',
    'this-year': 'mPeriodYear'
};
const PERIOD_SWITCH_LABELS = {
    'today': 'Today',
    'this-week': 'This Week',
    'this-month': 'This Month',
    'this-year': 'This Year',
    'last-month': 'Last Month',
    'all-time': 'All Time'
};

function updatePeriodSwitch() {
    for (const [preset, id] of Object.entries(PERIOD_SWITCH_BUTTONS)) {
        const btn = document.getElementById(id);
        if (btn) btn.setAttribute('aria-pressed', String(preset === activePeriodPreset));
    }
}
window.updatePeriodSwitch = updatePeriodSwitch;

function quickFilterPaidBy(member) {
    dashboardFilters.paidBy = (dashboardFilters.paidBy === member) ? "all" : member;
    syncFilterControlsToState();
    if (window.syncPersonalFilterWithPaidBy) {
        window.syncPersonalFilterWithPaidBy(dashboardFilters.paidBy);
    }
    renderAllViews();
}

function quickFilterFlow(type) {
    dashboardFilters.expenseType = (dashboardFilters.expenseType === type) ? "all" : type;
    syncFilterControlsToState();
    renderAllViews();
}

// Custom Date Range Handling
function toggleCustomDateRange() {
    const drawer = document.getElementById("customDateDrawer");
    if (drawer) drawer.classList.toggle("hidden");
}

function applyCustomDateRange() {
    const fromInput = document.getElementById("filterDateFrom");
    const toInput = document.getElementById("filterDateTo");

    if (fromInput && fromInput.value) dashboardFilters.dateFrom = fromInput.value;
    if (toInput && toInput.value) dashboardFilters.dateTo = toInput.value;
    activePeriodPreset = null;
    updatePeriodSwitch();

    renderAllViews();
}

function clearCustomDateRange() {
    dashboardFilters.dateFrom = null;
    dashboardFilters.dateTo = null;
    activePeriodPreset = (dashboardFilters.month === 'all' && dashboardFilters.year === 'all')
        ? 'all-time'
        : (dashboardFilters.month === 'all' ? 'this-year' : 'this-month');
    updatePeriodSwitch();
    const fromInput = document.getElementById("filterDateFrom");
    const toInput = document.getElementById("filterDateTo");
    if (fromInput) fromInput.value = "";
    if (toInput) toInput.value = "";
    const drawer = document.getElementById("customDateDrawer");
    if (drawer) drawer.classList.add("hidden");
    renderAllViews();
}

// ================= CANONICAL FILTER SELECTOR (Requirement 46) =================
function getFilteredExpenses() {
    const cur = getCurrentPeriod();
    const hasCustomRange = !!(dashboardFilters.dateFrom || dashboardFilters.dateTo);

    return expenses.filter(item => {
        if (!item.date) return false;
        const itemDate = new Date(item.date);
        if (isNaN(itemDate.getTime())) return false;

        const itemMonth = MONTHS[itemDate.getMonth()];
        const itemYear = itemDate.getFullYear().toString();
        const itemPaidBy = item.paidBy || "Not Specified";

        // 1. Period / Date Filtering
        let matchPeriod = true;
        if (hasCustomRange) {
            const itemTime = itemDate.getTime();
            if (dashboardFilters.dateFrom) {
                const fromTime = new Date(dashboardFilters.dateFrom).getTime();
                if (itemTime < fromTime) matchPeriod = false;
            }
            if (dashboardFilters.dateTo) {
                const toTime = new Date(dashboardFilters.dateTo).getTime();
                if (itemTime > toTime) matchPeriod = false;
            }
        } else {
            const matchMonth = (dashboardFilters.month === "all" || itemMonth === dashboardFilters.month);
            const matchYear = (dashboardFilters.year === "all" || itemYear === dashboardFilters.year);
            matchPeriod = matchMonth && matchYear;
        }

        // 2. Category Filter
        const matchCat = (dashboardFilters.category === "all" || item.category === dashboardFilters.category);

        // 3. Paid By Filter
        const matchPaidBy = (dashboardFilters.paidBy === "all" || itemPaidBy === dashboardFilters.paidBy);

        // 4. Payment Method Filter
        const matchMethod = (dashboardFilters.paymentMethod === "all" || item.paymentMethod === dashboardFilters.paymentMethod);

        // 5. Expense Type (Flow) Filter
        let matchFlow = true;
        if (dashboardFilters.expenseType === "expense") {
            matchFlow = item.category !== "Accepted Payments (Income)";
        } else if (dashboardFilters.expenseType === "income") {
            matchFlow = item.category === "Accepted Payments (Income)";
        }

        // 6. Search Filter
        let matchSearch = true;
        if (dashboardFilters.searchVal) {
            const q = dashboardFilters.searchVal;
            const fullText = [
                item.notes, item.description, item.paidTo, item.vendor,
                item.paidBy, item.category, item.paymentMethod, item.amount, item.date
            ].filter(Boolean).join(" ").toLowerCase();
            matchSearch = fullText.includes(q);
        }

        return matchPeriod && matchCat && matchPaidBy && matchMethod && matchFlow && matchSearch;
    });
}

// ================= MAIN RENDER PIPELINE =================
function renderAllViews() {
    const filtered = getFilteredExpenses();

    renderActiveFilterTags();
    renderDashboard(filtered);
    renderExpenseTable(filtered);
    renderStaffView(filtered);
    renderBillsView(filtered);
    renderMonthlyMatrix();
    if (window.renderPersonalExpensesDashboard) {
        window.renderPersonalExpensesDashboard();
    }
    // The attendance calendar follows the selected period, so it has to be
    // redrawn whenever the filters change - otherwise it keeps showing the
    // month it was first rendered for.
    if (window.renderAttendanceCalendar) {
        window.renderAttendanceCalendar();
    }
}

// Active Filter Tags with '×' Remove Buttons
function renderActiveFilterTags() {
    const container = document.getElementById("activeFilterTags");
    if (!container) return;

    const cur = getCurrentPeriod();
    const tags = [];

    // Period tag (if not current month + current year)
    if (dashboardFilters.dateFrom || dashboardFilters.dateTo) {
        tags.push({
            label: `Date: ${formatDisplayDate(dashboardFilters.dateFrom)} to ${formatDisplayDate(dashboardFilters.dateTo)}`,
            clear: clearCustomDateRange
        });
    } else {
        if (dashboardFilters.month === "all") {
            tags.push({
                label: `Month: All Months`,
                clear: () => { dashboardFilters.month = cur.monthName; syncFilterControlsToState(); renderAllViews(); }
            });
        } else if (dashboardFilters.month !== cur.monthName) {
            tags.push({
                label: `Month: ${dashboardFilters.month}`,
                clear: () => { dashboardFilters.month = cur.monthName; syncFilterControlsToState(); renderAllViews(); }
            });
        }

        if (dashboardFilters.year === "all") {
            tags.push({
                label: `Year: All Years`,
                clear: () => { dashboardFilters.year = cur.yearStr; syncFilterControlsToState(); renderAllViews(); }
            });
        } else if (dashboardFilters.year !== cur.yearStr) {
            tags.push({
                label: `Year: ${dashboardFilters.year}`,
                clear: () => { dashboardFilters.year = cur.yearStr; syncFilterControlsToState(); renderAllViews(); }
            });
        }
    }

    if (dashboardFilters.category !== "all") {
        tags.push({
            label: `Category: ${dashboardFilters.category}`,
            clear: () => { dashboardFilters.category = "all"; syncFilterControlsToState(); renderAllViews(); }
        });
    }

    if (dashboardFilters.paidBy !== "all") {
        tags.push({
            label: `Paid By: ${dashboardFilters.paidBy}`,
            clear: () => { dashboardFilters.paidBy = "all"; syncFilterControlsToState(); renderAllViews(); }
        });
    }

    if (dashboardFilters.paymentMethod !== "all") {
        tags.push({
            label: `Method: ${dashboardFilters.paymentMethod}`,
            clear: () => { dashboardFilters.paymentMethod = "all"; syncFilterControlsToState(); renderAllViews(); }
        });
    }

    if (dashboardFilters.expenseType !== "all") {
        tags.push({
            label: `Flow: ${dashboardFilters.expenseType === 'expense' ? 'Expenses' : 'Income'}`,
            clear: () => { dashboardFilters.expenseType = "all"; syncFilterControlsToState(); renderAllViews(); }
        });
    }

    if (tags.length === 0) {
        container.classList.add("hidden");
        container.innerHTML = "";
    } else {
        container.classList.remove("hidden");
        container.innerHTML = `<span class="text-slate-400 font-bold mr-1">Active:</span>` + tags.map((t, idx) => `
            <span class="active-filter-tag">
                <span>${escapeHtml(t.label)}</span>
                <button type="button" onclick="activeTagRemove(${idx})" title="Remove filter" aria-label="Remove filter">&times;</button>
            </span>
        `).join("");
        window._activeTagCallbacks = tags.map(t => t.clear);
    }
}

window.activeTagRemove = function(idx) {
    if (window._activeTagCallbacks && window._activeTagCallbacks[idx]) {
        window._activeTagCallbacks[idx]();
    }
};

// ================= RENDER DASHBOARD (Requirement 7-23, 46) =================
function renderDashboard(filtered) {
    const cur = getCurrentPeriod();

    // 1. Dynamic Period Headline
    let periodTitleStr = "";
    if (dashboardFilters.dateFrom || dashboardFilters.dateTo) {
        periodTitleStr = `${formatDisplayDate(dashboardFilters.dateFrom)} – ${formatDisplayDate(dashboardFilters.dateTo)}`;
    } else {
        const mStr = dashboardFilters.month === "all" ? "All Months" : dashboardFilters.month;
        const yStr = dashboardFilters.year === "all" ? "Complete History" : dashboardFilters.year;
        periodTitleStr = `${mStr} ${yStr}`;
    }

    if (dashboardFilters.paidBy !== "all") {
        periodTitleStr += ` &bull; <span class="text-violet-300 font-extrabold">${escapeHtml(dashboardFilters.paidBy)}</span>`;
    }
    if (dashboardFilters.category !== "all") {
        periodTitleStr += ` &bull; <span class="text-emerald-300 font-extrabold">${escapeHtml(dashboardFilters.category)}</span>`;
    }

    const titleEl = document.getElementById("dashboardPeriodTitle");
    if (titleEl) titleEl.innerHTML = periodTitleStr;

    const periodVal = dashboardFilters.month === "all" ? "All Time" : `${dashboardFilters.month} ${dashboardFilters.year}`;
    const hdrText = document.getElementById("hdrPeriodText");
    const hdrBadge = document.getElementById("hdrPeriodBadge");
    if (hdrText) {
        hdrText.textContent = periodVal;
    } else if (hdrBadge) {
        const span = hdrBadge.querySelector('span');
        if (span) span.textContent = periodVal;
        else hdrBadge.textContent = periodVal;
    }

    // 2. Derive Financial Metrics strictly from filtered dataset
    const allExpenseItems = filtered.filter(i => i.category !== "Accepted Payments (Income)");
    const incomeItems = filtered.filter(i => i.category === "Accepted Payments (Income)");

    // Strict Segregation: Household vs Personal Expenses
    const householdExpenseItems = allExpenseItems.filter(i => !isPersonalExpense(i));
    const personalExpenseItems = allExpenseItems.filter(i => isPersonalExpense(i));

    const totalHouseholdSpent = householdExpenseItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const totalPersonalSpent = personalExpenseItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const totalCombinedSpent = totalHouseholdSpent + totalPersonalSpent;


    // Which slice the dashboard is reporting on comes from Master Settings.
    const viewMode = DASHBOARD_MODES.includes(dashboardFilters.scope)
        ? dashboardFilters.scope
        : 'household';
    const isCombinedMode = viewMode === 'combined';
    const isPersonalMode = viewMode === 'personal';
    const modeLabel = (DASHBOARD_MODE_META[viewMode] || DASHBOARD_MODE_META.household).label;

    const activeExpenseItems = isCombinedMode
        ? allExpenseItems
        : (isPersonalMode ? personalExpenseItems : householdExpenseItems);
    const totalDisplaySpent = isCombinedMode
        ? totalCombinedSpent
        : (isPersonalMode ? totalPersonalSpent : totalHouseholdSpent);
    const totalIncome = incomeItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const netCashFlow = totalIncome - totalDisplaySpent;
    const expenseCount = activeExpenseItems.length;
    const incomeCount = incomeItems.length;

    // Days in period for burn rate
    let daysInPeriod = 30;
    if (dashboardFilters.month !== "all") {
        const mIdx = MONTHS.indexOf(dashboardFilters.month);
        const yNum = dashboardFilters.year !== "all" ? Number(dashboardFilters.year) : cur.year;
        daysInPeriod = new Date(yNum, mIdx + 1, 0).getDate();
    }
    const avgDaily = Math.round(totalDisplaySpent / (daysInPeriod || 1));

    // Highest single expense (from active view items)
    let highestExpenseItem = null;
    activeExpenseItems.forEach(i => {
        if (!highestExpenseItem || Number(i.amount) > Number(highestExpenseItem.amount)) {
            highestExpenseItem = i;
        }
    });

    // Staff Payments - strictly the staff this household configured.
    const configuredStaff = getConfiguredStaff();
    const staffCategorySet = getStaffCategorySet();
    const staffExpenses = householdExpenseItems.filter(i => isStaffExpense(i, staffCategorySet));
    const staffTotal = staffExpenses.reduce((acc, i) => acc + Number(i.amount), 0);
    const staffExpected = configuredStaff.reduce((acc, s) => acc + (Number(s.baseSalary) || 0), 0);

    // Groceries
    const groceryItems = householdExpenseItems.filter(i => i.category === "Grocery & Vegetables");
    const groceryTotal = groceryItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const groceryShare = totalDisplaySpent > 0 ? ((groceryTotal / totalDisplaySpent) * 100).toFixed(1) : 0;

    // Recurring Bills Checklist Status
    const checklistStatus = calculateRecurringChecklist(filtered);

    // 3. Update KPI Elements in DOM
    const periodLabelEl = document.getElementById("statPeriodLabel");
    if (periodLabelEl) {
        periodLabelEl.textContent = isCombinedMode
            ? "Total Expenses (Combined)"
            : (isPersonalMode ? "Personal Expenses" : "Household Expenses");
    }

    const spentEl = document.getElementById("statTotalSpent");
    if (spentEl) spentEl.textContent = formatINR(totalDisplaySpent);

    const spentCountEl = document.getElementById("statSpentCount");
    if (spentCountEl) spentCountEl.textContent = `${expenseCount} ${isCombinedMode ? 'total' : (isPersonalMode ? 'personal' : 'household')} exp`;

    const personalSpentEl = document.getElementById("statPersonalSpentVal");
    if (personalSpentEl) personalSpentEl.textContent = formatINR(totalPersonalSpent);

    const combinedSpentEl = document.getElementById("statCombinedSpentVal");
    if (combinedSpentEl) combinedSpentEl.textContent = formatINR(totalCombinedSpent);

    const incomeEl = document.getElementById("statTotalIncome");
    if (incomeEl) incomeEl.textContent = formatINR(totalIncome);

    const incomeCountEl = document.getElementById("statIncomeCount");
    if (incomeCountEl) incomeCountEl.textContent = `${incomeCount} credits`;

    const netEl = document.getElementById("statNetCashFlow");
    const netBadgeEl = document.getElementById("statNetCashFlowBadge");
    const netIconEl = document.getElementById("statNetCashFlowIcon");
    if (netEl) netEl.textContent = formatINR(Math.abs(netCashFlow));
    if (netBadgeEl && netIconEl) {
        if (netCashFlow > 0) {
            netBadgeEl.className = "font-black text-emerald-600";
            netBadgeEl.innerHTML = `<svg class="ic mr-1" aria-hidden="true"><use href="#i-trending-up"></use></svg> Surplus +${formatINR(netCashFlow)}`;
            netIconEl.className = "w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold";
        } else if (netCashFlow < 0) {
            netBadgeEl.className = "font-black text-rose-600";
            netBadgeEl.innerHTML = `<svg class="ic mr-1" aria-hidden="true"><use href="#i-trending-down"></use></svg> Deficit -${formatINR(Math.abs(netCashFlow))}`;
            netIconEl.className = "w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold";
        } else {
            netBadgeEl.className = "font-black text-slate-500";
            netBadgeEl.textContent = "Neutral / Balanced";
            netIconEl.className = "w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center font-bold";
        }
    }

    const avgEl = document.getElementById("statAvgPerDay");
    if (avgEl) avgEl.textContent = formatINR(avgDaily);
    const dailyDaysEl = document.getElementById("statDailyDaysCount");
    if (dailyDaysEl) dailyDaysEl.textContent = `${daysInPeriod} days (${modeLabel})`;

    const highestEl = document.getElementById("statHighestExpense");
    const highestVendorEl = document.getElementById("statHighestExpenseVendor");
    if (highestEl) highestEl.textContent = highestExpenseItem ? formatINR(highestExpenseItem.amount) : "₹0";
    if (highestVendorEl) {
        highestVendorEl.textContent = highestExpenseItem 
            ? `${highestExpenseItem.paidTo || highestExpenseItem.category} (${formatDisplayDate(highestExpenseItem.date)})`
            : "No expenses";
    }

    const staffTotalEl = document.getElementById("statStaffTotal");
    if (staffTotalEl) staffTotalEl.textContent = formatINR(staffTotal);
    const staffSummaryEl = document.getElementById("statStaffStatusSummary");
    if (staffSummaryEl) {
        const allPaid = staffExpected > 0 ? staffTotal >= staffExpected : staffTotal > 0;
        staffSummaryEl.textContent = allPaid ? "Fully Paid" : "Pending Action";
        staffSummaryEl.className = allPaid ? "font-bold text-emerald-600" : "font-bold text-amber-600";
    }
    const staffPayrollBadgeEl = document.getElementById("statStaffPayrollBadge");
    if (staffPayrollBadgeEl) {
        staffPayrollBadgeEl.textContent = configuredStaff.length === 1
            ? staffDisplayName(configuredStaff[0])
            : `${configuredStaff.length} staff`;
    }

    const groceryTotalEl = document.getElementById("statGroceryTotal");
    if (groceryTotalEl) groceryTotalEl.textContent = formatINR(groceryTotal);
    const groceryCountEl = document.getElementById("statGroceryCount");
    if (groceryCountEl) groceryCountEl.textContent = `${groceryItems.length} orders`;
    const groceryShareEl = document.getElementById("statGroceryShare");
    if (groceryShareEl) groceryShareEl.textContent = `${groceryShare}% of total`;

    const txCountEl = document.getElementById("statTxCountTotal");
    if (txCountEl) {
        txCountEl.textContent = isCombinedMode
            ? filtered.length
            : filtered.filter(i => isPersonalMode ? isPersonalExpense(i) : !isPersonalExpense(i)).length;
    }

    // Staff payroll ledger - one card per configured staff member.
    renderStaffPayrollLedger(staffExpenses, configuredStaff);

    // Pending vs Paid Recurring count
    const pendingBillsCountEl = document.getElementById("statPendingBillsCount");
    const pendingBillsTextEl = document.getElementById("statPendingBillsText");
    if (pendingBillsCountEl) pendingBillsCountEl.textContent = checklistStatus.pendingCount;
    if (pendingBillsTextEl) pendingBillsTextEl.textContent = `${checklistStatus.pendingCount} unpaid utilities`;

    const paidBillsCountEl = document.getElementById("statPaidBillsCount");
    const paidBillsTextEl = document.getElementById("statPaidBillsText");
    if (paidBillsCountEl) paidBillsCountEl.textContent = checklistStatus.paidCount;
    if (paidBillsTextEl) paidBillsTextEl.textContent = `${checklistStatus.paidCount} confirmed`;

    // 4. Empty State Toggle
    const emptyState = document.getElementById("emptyDashboardState");
    const emptyDesc = document.getElementById("emptyDashboardDesc");
    if (emptyState) {
        if (filtered.length === 0) {
            emptyState.classList.remove("hidden");
            if (emptyDesc) emptyDesc.textContent = `No transactions recorded for ${dashboardFilters.month} ${dashboardFilters.year} with active filters.`;
        } else {
            emptyState.classList.add("hidden");
        }
    }

    // 5. Generate Dynamic Data-Backed Insights & Alerts (Requirement 19, 52)
    renderFinancialInsights(activeExpenseItems, totalDisplaySpent, totalIncome, netCashFlow);

    // 6. Visualizations
    const visualData = isCombinedMode
        ? filtered
        : filtered.filter(i => isPersonalMode ? isPersonalExpense(i) : !isPersonalExpense(i));
    renderCategoryPieChart(visualData);
    renderPaidByChart(visualData);
    renderMonthlyTrendChart(expenses);
    renderPaymentMethodChart(visualData);

    // 7. Spending Matrix
    renderHouseholdSpendingMatrix(visualData);

    // 8. Budget & Checklist & Tables
    renderBudgetProgress(totalHouseholdSpent, totalPersonalSpent, totalCombinedSpent);

    // Budget Remaining, the second of the four primary figures. Same source as
    // the budget bar and the phone hero, so the three cannot disagree.
    (function renderBudgetKpi() {
        const el = document.getElementById("statBudgetRemaining");
        if (!el) return;
        const cap = (window.masterConfig && Number(window.masterConfig.monthlyBudgetLimit))
            || monthlyBudgetLimit || 0;
        const spentAll = Number(totalCombinedSpent) || 0;
        const left = cap - spentAll;
        const pct = cap > 0 ? Math.round((spentAll / cap) * 100) : 0;

        const label = document.getElementById("statBudgetLabel");
        if (label) label.textContent = cap <= 0 ? "Budget" : (left >= 0 ? "Budget Remaining" : "Over Budget By");
        el.textContent = cap <= 0 ? "Not set" : formatINR(Math.abs(left));
        el.classList.toggle("text-rose-600", cap > 0 && left < 0);

        const used = document.getElementById("statBudgetUsed");
        if (used) {
            used.textContent = cap > 0 ? `${pct}% used` : "No budget set";
            used.className = "font-medium truncate " +
                (cap > 0 && pct > 100 ? "text-rose-600" : "text-emerald-600");
        }
        const capEl = document.getElementById("statBudgetCap");
        if (capEl) capEl.textContent = cap > 0 ? `of ${formatINR(cap)}` : "Master Settings";
    })();
    renderMobileHero(totalDisplaySpent, totalIncome, netCashFlow, modeLabel);
    renderChecklistUI(checklistStatus.items);
    renderTopExpensesTable(activeExpenseItems);
    renderRecentTransactionsTable(visualData);
    renderMoMAndYtd(expenses);

    // Advance Modules Dashboard Bridge
    window.expensesData = expenses;
    if (window.renderAdvanceDashboard) {
        window.renderAdvanceDashboard(filtered);
    }

    // Real-time Notification Center & Due Reminders
    if (window.updateNotificationCenter) {
        window.updateNotificationCenter();
    }
}

// ================= FINANCIAL INSIGHTS & SMART ALERTS =================
function renderFinancialInsights(filtered, totalSpent, totalIncome, netCashFlow) {
    const container = document.getElementById("financialInsightsContainer");
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = "";
        return;
    }

    const insights = [];

    // Category Insight
    const catMap = {};
    filtered.filter(i => i.category !== "Accepted Payments (Income)").forEach(i => {
        catMap[i.category] = (catMap[i.category] || 0) + Number(i.amount);
    });
    const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    if (sortedCats.length > 0 && totalSpent > 0) {
        const topCat = sortedCats[0];
        const pct = ((topCat[1] / totalSpent) * 100).toFixed(0);
        insights.push({
            type: "info",
            icon: "i-chart-pie",
            text: `Highest spending category is <strong>${topCat[0]}</strong> at <strong>${formatINR(topCat[1])}</strong> (${pct}% of period total).`
        });
    }

    // Paid By Insight
    const memberMap = {};
    filtered.filter(i => i.category !== "Accepted Payments (Income)").forEach(i => {
        const m = i.paidBy || "Not Specified";
        memberMap[m] = (memberMap[m] || 0) + Number(i.amount);
    });
    const sortedMembers = Object.entries(memberMap).sort((a, b) => b[1] - a[1]);
    if (sortedMembers.length > 0 && totalSpent > 0 && sortedMembers[0][0] !== "Not Specified") {
        const topMember = sortedMembers[0];
        const pct = ((topMember[1] / totalSpent) * 100).toFixed(0);
        insights.push({
            type: "member",
            icon: "i-user-check",
            text: `<strong>${topMember[0]}</strong> has funded the majority of expenses (<strong>${formatINR(topMember[1])}</strong> &bull; ${pct}% share).`
        });
    }

    // Staff Payment Insight - only when this household actually has staff.
    const configuredStaff = getConfiguredStaff();
    if (configuredStaff.length > 0) {
        const staffCategorySet = getStaffCategorySet();
        const staffExpenses = filtered.filter(i => isStaffExpense(i, staffCategorySet));
        const pending = configuredStaff.filter(s => {
            const paid = staffPaidInPeriod(staffExpenses, s);
            const due = Number(s.baseSalary) || 0;
            return due > 0 ? paid < due : paid <= 0;
        });

        if (pending.length === 0) {
            insights.push({
                type: "success",
                icon: "i-circle-check",
                text: `Staff payments are fully settled for this billing cycle (${configuredStaff.length} ${configuredStaff.length === 1 ? 'member' : 'members'}).`
            });
        } else {
            const names = pending.map(s => {
                const due = Number(s.baseSalary) || 0;
                return escapeHtml(staffDisplayName(s)) + (due > 0 ? ` (${formatINR(due)})` : '');
            });
            insights.push({
                type: "warning",
                icon: "i-triangle-alert",
                text: `Staff payment pending: <strong>${names.join(", ")}</strong> for this billing cycle.`
            });
        }
    }

    container.innerHTML = insights.map(ins => {
        const colorClass = ins.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
            : (ins.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900');
        const iconColor = ins.type === 'success' ? 'text-emerald-600' : (ins.type === 'warning' ? 'text-amber-600' : 'text-indigo-600');
        return `
            <div class="p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${colorClass}">
                <div class="flex items-center space-x-2">
                    <svg class="ic ${iconColor} text-sm" aria-hidden="true"><use href="#${ins.icon}"></use></svg>
                    <span>${ins.text}</span>
                </div>
            </div>
        `;
    }).join("");
}

// ================= VISUALIZATIONS: CHART.JS (Requirement 6, 11, 12, 15) =================

// 1. Where Your Money Goes (Category Donut)
function renderCategoryPieChart(filteredData) {
    const canvas = document.getElementById("categoryPieChart");
    if (!canvas) return;

    const expenseOnly = filteredData.filter(i => i.category !== "Accepted Payments (Income)");
    const catTotals = {};
    expenseOnly.forEach(i => {
        catTotals[i.category] = (catTotals[i.category] || 0) + Number(i.amount);
    });

    const labels = Object.keys(catTotals);
    const data = Object.values(catTotals);
    const totalSpent = data.reduce((a, b) => a + b, 0);

    const colors = [
        "#6366f1", "#10b981", "#f59e0b", "#06b6d4",
        "#8b5cf6", "#ec4899", "#f97316", "#3b82f6",
        "#14b8a6", "#64748b"
    ];

    if (categoryPieChartInstance) categoryPieChartInstance.destroy();

    const legendContainer = document.getElementById("categoryChartLegend");
    if (legendContainer) {
        if (labels.length === 0) {
            legendContainer.innerHTML = `<span class="text-slate-400 italic col-span-3 text-center">No category data</span>`;
        } else {
            // A ranked breakdown with a bar per category reads far faster than
            // a grid of percentages, and matches the "Spending Breakdown" panel
            // the reference designs use. The bar is scaled to the largest
            // category, not to the total, so small ones stay visible.
            const topAmount = Math.max(...labels.map(c => catTotals[c]), 0);
            // Ranked biggest first. The chart's own label order follows the
            // dataset, which is not what a reader scanning for their largest
            // outgoing wants.
            const ranked = labels
                .map((cat, idx) => ({ cat, colour: colors[idx % colors.length] }))
                .sort((a, b) => catTotals[b.cat] - catTotals[a.cat]);
            legendContainer.innerHTML = ranked.map(({ cat, colour }) => {
                const amt = catTotals[cat];
                const pct = totalSpent > 0 ? ((amt / totalSpent) * 100).toFixed(1) : 0;
                // With a budget set the bar means "how much of your limit is
                // gone", which is the reference pattern. Without one it is a
                // share of total spend, scaled to the largest category - two
                // different meanings, so each says which it is.
                const budget = categoryBudgetFor(cat);
                const hasBudget = budget !== null && budget > 0;
                const width = hasBudget
                    ? Math.min(100, (amt / budget) * 100)
                    : (topAmount > 0 ? Math.max(3, (amt / topAmount) * 100) : 0);
                const over = hasBudget && amt > budget;
                const remaining = hasBudget ? budget - amt : 0;
                const caption = hasBudget
                    ? (over
                        ? `${formatINR(amt - budget)} over the ${formatINR(budget)} budget`
                        : `${formatINR(remaining)} left of ${formatINR(budget)}`)
                    : `${pct}% of spend`;
                return `
                    <button type="button" onclick="filterByCategory(${escapeHtml(JSON.stringify(cat))})"
                        class="cat-bar-row" title="Filter by ${escapeHtml(cat)}" aria-label="Filter by ${escapeHtml(cat)}">
                        <span class="cat-bar-top">
                            <span class="cat-bar-name">
                                <span class="cat-bar-dot" style="background-color: ${colour}"></span>
                                <span class="truncate">${escapeHtml(cat)}</span>
                            </span>
                            <span class="cat-bar-amt">${formatINR(amt)}</span>
                        </span>
                        <span class="cat-bar-track">
                            <span class="cat-bar-fill${over ? ' is-over' : ''}"
                                style="width: ${width}%;${over ? '' : ` background-color: ${colour}`}"></span>
                        </span>
                        <span class="cat-bar-pct${over ? ' is-over' : ''}">${caption}</span>
                    </button>
                `;
            }).join("");
        }
    }

    if (labels.length === 0) return;

    categoryPieChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        plugins: [donutCenterTotal(totalSpent)],
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                // The slice gap has to be the card colour, not white, or every
                // segment gets a bright outline on a dark card.
                borderColor: surfaceColor(),
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
                        label: function(ctx) {
                            const val = ctx.raw || 0;
                            const pct = totalSpent > 0 ? ((val / totalSpent) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ₹${val.toLocaleString('en-IN')} (${pct}%)`;
                        }
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const clickedCat = labels[idx];
                    filterByCategory(clickedCat);
                }
            }
        }
    });
}

function filterByCategory(cat) {
    dashboardFilters.category = (dashboardFilters.category === cat) ? "all" : cat;
    syncFilterControlsToState();
    renderAllViews();
}

// 2. Expenses by Paid By (Donut / Bar Chart)
function renderPaidByChart(filteredData) {
    const canvas = document.getElementById("paidByDonutChart");
    if (!canvas) return;

    const expenseOnly = filteredData.filter(i => i.category !== "Accepted Payments (Income)");
    const memberTotals = {};
    const memberCounts = {};

    FAMILY_MEMBERS.concat(["Not Specified"]).forEach(m => {
        memberTotals[m] = 0;
        memberCounts[m] = 0;
    });

    expenseOnly.forEach(i => {
        const m = i.paidBy || "Not Specified";
        memberTotals[m] = (memberTotals[m] || 0) + Number(i.amount);
        memberCounts[m] = (memberCounts[m] || 0) + 1;
    });

    // Only include members with spend or core family
    const activeMembers = Object.keys(memberTotals).filter(m => memberTotals[m] > 0 || FAMILY_MEMBERS.includes(m));
    const labels = activeMembers;
    const data = activeMembers.map(m => memberTotals[m]);
    const totalSpent = data.reduce((a, b) => a + b, 0);

    const colors = ["#8b5cf6", "#ec4899", "#f59e0b", "#0ea5e9", "#94a3b8"];

    if (paidByChartInstance) paidByChartInstance.destroy();

    const statsGrid = document.getElementById("paidByStatsGrid");
    if (statsGrid) {
        statsGrid.innerHTML = activeMembers.map((m, idx) => {
            const amt = memberTotals[m];
            const pct = totalSpent > 0 ? ((amt / totalSpent) * 100).toFixed(0) : 0;
            const count = memberCounts[m] || 0;
            const isSelected = dashboardFilters.paidBy === m;
            return `
                <div onclick="quickFilterPaidBy(${escapeHtml(JSON.stringify(m))})" class="p-2 rounded-xl border ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'} cursor-pointer transition text-center">
                    <span class="block text-[11px] font-black text-slate-700 truncate">${m}</span>
                    <span class="block text-sm font-black text-slate-900 mt-0.5">${formatINR(amt)}</span>
                    <span class="block text-[10px] text-slate-500 font-bold">${pct}% &bull; ${count} tx</span>
                </div>
            `;
        }).join("");
    }

    if (totalSpent === 0) return;

    paidByChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const val = ctx.raw || 0;
                            const pct = totalSpent > 0 ? ((val / totalSpent) * 100).toFixed(1) : 0;
                            return ` ${ctx.label}: ₹${val.toLocaleString('en-IN')} (${pct}%)`;
                        }
                    }
                }
            },
            onClick: (e, elements) => {
                if (elements.length > 0) {
                    const idx = elements[0].index;
                    const clickedMember = labels[idx];
                    quickFilterPaidBy(clickedMember);
                }
            }
        }
    });
}

// 3. Monthly Expense & Trend Bar Chart
function renderMonthlyTrendChart(allExpenses) {
    const canvas = document.getElementById("monthlyTrendChart");
    if (!canvas) return;

    const cur = getCurrentPeriod();
    const selYear = dashboardFilters.year !== "all" ? dashboardFilters.year : cur.yearStr;

    const yearItems = allExpenses.filter(i => {
        if (!i.date) return false;
        return new Date(i.date).getFullYear().toString() === selYear;
    });

    let labels = [];
    let expenseData = [];
    let incomeData = [];
    let netFlowData = [];

    if (trendGranularity === 'quarterly') {
        labels = ["Q1 (Jan-Mar)", "Q2 (Apr-Jun)", "Q3 (Jul-Sep)", "Q4 (Oct-Dec)"];
        expenseData = [0, 0, 0, 0];
        incomeData = [0, 0, 0, 0];

        yearItems.forEach(i => {
            const m = new Date(i.date).getMonth();
            const q = Math.floor(m / 3);
            if (i.category === "Accepted Payments (Income)") {
                incomeData[q] += Number(i.amount);
            } else {
                expenseData[q] += Number(i.amount);
            }
        });
        netFlowData = incomeData.map((inc, idx) => inc - expenseData[idx]);
    } else {
        labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        expenseData = new Array(12).fill(0);
        incomeData = new Array(12).fill(0);

        yearItems.forEach(i => {
            const m = new Date(i.date).getMonth();
            if (i.category === "Accepted Payments (Income)") {
                incomeData[m] += Number(i.amount);
            } else {
                expenseData[m] += Number(i.amount);
            }
        });
        netFlowData = incomeData.map((inc, idx) => inc - expenseData[idx]);
    }

    if (monthlyTrendChartInstance) monthlyTrendChartInstance.destroy();

    monthlyTrendChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: `Expenses (Debit)`,
                    data: expenseData,
                    // The period being viewed is drawn solid; the rest of the
                    // year is dimmed, so the bar you are reading about is
                    // obvious at a glance. Every reference chart does this.
                    backgroundColor: expenseData.map((_, idx) =>
                        isHighlightedBucket(idx, labels.length) ? '#ef4444' : 'rgba(239, 68, 68, .34)'),
                    borderRadius: 6
                },
                {
                    label: `Income / Inflow`,
                    data: incomeData,
                    backgroundColor: incomeData.map((_, idx) =>
                        isHighlightedBucket(idx, labels.length)
                            ? '#10b981' : 'rgba(16, 185, 129, .34)'),
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: val => '₹' + (val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val)
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ` ${ctx.dataset.label}: ₹${Number(ctx.raw).toLocaleString('en-IN')}`;
                        }
                    }
                }
            }
        }
    });
}

function setTrendGranularity(type) {
    trendGranularity = type;
    const btnM = document.getElementById("btnTrendMonthly");
    const btnQ = document.getElementById("btnTrendQuarterly");
    if (btnM && btnQ) {
        if (type === 'quarterly') {
            btnQ.className = "px-2.5 py-1 rounded-lg bg-white text-indigo-700 shadow-sm font-extrabold";
            btnM.className = "px-2.5 py-1 rounded-lg hover:text-slate-900";
        } else {
            btnM.className = "px-2.5 py-1 rounded-lg bg-white text-indigo-700 shadow-sm font-extrabold";
            btnQ.className = "px-2.5 py-1 rounded-lg hover:text-slate-900";
        }
    }
    renderMonthlyTrendChart(expenses);
}

// 4. Payment Method Analytics Chart
function renderPaymentMethodChart(filteredData) {
    const canvas = document.getElementById("paymentMethodChart");
    if (!canvas) return;

    const methodTotals = {};
    const methodCounts = {};

    filteredData.filter(i => i.category !== "Accepted Payments (Income)").forEach(i => {
        const m = i.paymentMethod || "UPI";
        methodTotals[m] = (methodTotals[m] || 0) + Number(i.amount);
        methodCounts[m] = (methodCounts[m] || 0) + 1;
    });

    const labels = Object.keys(methodTotals);
    const data = Object.values(methodTotals);
    const total = data.reduce((a, b) => a + b, 0);

    const colors = ["#10b981", "#6366f1", "#f59e0b", "#ec4899", "#06b6d4"];

    if (paymentMethodChartInstance) paymentMethodChartInstance.destroy();

    const listContainer = document.getElementById("paymentMethodList");
    if (listContainer) {
        listContainer.innerHTML = labels.map((met, idx) => {
            const val = methodTotals[met];
            const pct = total > 0 ? ((val / total) * 100).toFixed(0) : 0;
            return `
                <div class="flex items-center justify-between text-xs py-1">
                    <span class="flex items-center space-x-1.5 font-bold text-slate-700">
                        <span class="w-2 h-2 rounded-full inline-block" style="background-color: ${colors[idx % colors.length]}"></span>
                        <span>${met}</span>
                    </span>
                    <span class="font-bold text-slate-900">${formatINR(val)} <span class="text-slate-400 font-normal">(${pct}%)</span></span>
                </div>
            `;
        }).join("");
    }

    if (labels.length === 0) return;

    paymentMethodChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ================= HOUSEHOLD SPENDING MATRIX (Requirement 16) =================
function renderHouseholdSpendingMatrix(filteredData) {
    const thead = document.getElementById("spendingMatrixThead");
    const tbody = document.getElementById("spendingMatrixTbody");
    if (!thead || !tbody) return;

    // Dynamically get categories: masterConfig.categories or CATEGORIES or from data
    let matrixCategories = [];
    if (window.masterConfig && window.masterConfig.categories && Array.isArray(window.masterConfig.categories)) {
        matrixCategories = window.masterConfig.categories.filter(c => c.type !== 'income').map(c => c.name);
    } else if (window.CATEGORIES && Array.isArray(window.CATEGORIES)) {
        matrixCategories = window.CATEGORIES.filter(c => c !== "Accepted Payments (Income)");
    } else {
        matrixCategories = [
            "Grocery & Vegetables",
            "Electricity Bill",
            "Flat Maintenance",
            "Dish Bill (DTH)",
            "Wifi & Internet",
            "Shopping & Miscellaneous"
        ];
    }

    const matrixMode = getDashboardMode();
    const dataToMatrix = matrixMode === 'combined'
        ? filteredData
        : filteredData.filter(i => matrixMode === 'personal' ? isPersonalExpense(i) : !isPersonalExpense(i));

    // Include any new categories present in the active filtered data
    dataToMatrix.filter(i => i.category && i.category !== "Accepted Payments (Income)").forEach(i => {
        if (!matrixCategories.includes(i.category)) {
            matrixCategories.push(i.category);
        }
    });

    // Dynamically get active members: strictly masterConfig.familyMembers, never hardcoded Mom/Dad!
    let members = [];
    if (window.masterConfig && window.masterConfig.familyMembers && Array.isArray(window.masterConfig.familyMembers)) {
        members = [...window.masterConfig.familyMembers];
    } else if (window.FAMILY_MEMBERS && Array.isArray(window.FAMILY_MEMBERS)) {
        members = [...window.FAMILY_MEMBERS];
    } else if (currentSessionUser && currentSessionUser.name) {
        members = [currentSessionUser.name];
    } else {
        members = ["Palash", "Pallavi"];
    }
    if (!members.includes("Not Specified")) {
        members.push("Not Specified");
    }

    // Compute sums: member -> category -> sum
    const matrix = {};
    const colTotals = {};
    matrixCategories.forEach(c => colTotals[c] = 0);

    members.forEach(m => {
        matrix[m] = {};
        matrixCategories.forEach(c => matrix[m][c] = 0);
    });

    dataToMatrix.filter(i => i.category !== "Accepted Payments (Income)").forEach(i => {
        const m = (i.paidBy && members.includes(i.paidBy)) ? i.paidBy : "Not Specified";
        const c = i.category;
        if (matrix[m] && matrix[m][c] !== undefined) {
            matrix[m][c] += Number(i.amount);
            colTotals[c] += Number(i.amount);
        }
    });

    thead.innerHTML = `
        <tr>
            <th class="py-2.5 px-3">Family Member</th>
            ${matrixCategories.map(c => `<th class="py-2.5 px-3 text-right truncate max-w-[120px]">${c.replace(" - ", " ")}</th>`).join("")}
            <th class="py-2.5 px-3 text-right bg-indigo-950 text-white font-black">Total Paid</th>
        </tr>
    `;

    tbody.innerHTML = members.map(m => {
        const rowTotal = matrixCategories.reduce((acc, c) => acc + matrix[m][c], 0);
        return `
            <tr class="hover:bg-indigo-50/50 transition">
                <td class="py-2.5 px-3 font-black text-slate-900 whitespace-nowrap">
                    <span class="tap-row-link cursor-pointer hover:text-indigo-600" onclick="quickFilterPaidBy(${escapeHtml(JSON.stringify(m))})">
                        ${m}
                    </span>
                </td>
                ${matrixCategories.map(c => `
                    <td class="py-2.5 px-3 text-right ${matrix[m][c] > 0 ? 'text-slate-900 font-extrabold' : 'text-slate-300 font-normal'}">
                        ${matrix[m][c] > 0 ? formatINR(matrix[m][c]) : '-'}
                    </td>
                `).join("")}
                <td class="py-2.5 px-3 text-right font-black text-indigo-700 bg-indigo-50/40">
                    ${formatINR(rowTotal)}
                </td>
            </tr>
        `;
    }).join("");
}

// ================= PHONE HOME HERO =================
// One figure, a progress track and three supporting stats - the shape every
// reference design uses. The references lead with an account balance, which
// this app has no source for: it tracks expenses, income and budgets, not a
// bank balance. Remaining budget is the honest equivalent and the one number
// that is actually actionable, with spend, net flow and the cap beneath it.
function renderMobileHero(totalSpent, totalIncome, netCashFlow, modeLabel) {
    const host = document.getElementById("mHeroPrimaryVal");
    if (!host) return;

    const budget = (window.masterConfig && Number(window.masterConfig.monthlyBudgetLimit))
        || monthlyBudgetLimit || 0;
    const spent = Number(totalSpent) || 0;
    const remaining = budget - spent;
    const rawPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;

    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    // Appearance setting: lead with what is left, lead with what was spent, or
    // leave the budget out of the card altogether.
    const heroMode = (window.DashboardUi && window.DashboardUi.effective().heroBudget) || 'remaining';
    const showBudget = heroMode !== 'hidden';
    const bar0 = document.getElementById("mHeroBar");
    if (bar0 && bar0.parentElement) bar0.parentElement.classList.toggle("hidden", !showBudget);
    const noteEl = document.getElementById("mHeroBarNote");
    if (noteEl) noteEl.classList.toggle("hidden", !showBudget);
    const budgetStat = document.getElementById("mHeroBudget");
    if (budgetStat && budgetStat.parentElement) budgetStat.parentElement.classList.toggle("hidden", !showBudget);

    // With no budget configured there is nothing to be "remaining" from, so the
    // card leads with the spend instead of showing a negative of the whole total.
    if (budget > 0 && heroMode === 'remaining') {
        setText("mHeroPrimaryLabel", remaining >= 0 ? "Remaining Budget" : "Over Budget By");
        host.textContent = formatINR(Math.abs(remaining));
        host.classList.toggle("is-over", remaining < 0);
        setText("mHeroBarNote", `${rawPct}% of budget used`);
    } else {
        setText("mHeroPrimaryLabel", `Total Spent · ${modeLabel || 'Household'}`);
        host.textContent = formatINR(spent);
        host.classList.remove("is-over");
        setText("mHeroBarNote", budget > 0 ? `${rawPct}% of budget used` : "No budget set in Master Settings");
    }

    const bar = document.getElementById("mHeroBar");
    if (bar) {
        bar.style.width = `${Math.min(100, Math.max(0, rawPct))}%`;
        bar.classList.toggle("is-warn", rawPct >= 75 && rawPct <= 100);
        bar.classList.toggle("is-over", rawPct > 100);
    }

    setText("mHeroSpent", formatINR(spent));
    setText("mHeroNet", (Number(netCashFlow) >= 0 ? "+" : "-") + formatINR(Math.abs(Number(netCashFlow) || 0)));
    setText("mHeroBudget", budget > 0 ? formatINR(budget) : "Not set");

    const net = document.getElementById("mHeroNet");
    if (net) net.classList.toggle("is-negative", Number(netCashFlow) < 0);

    setText("mHeroPeriod", PERIOD_SWITCH_LABELS[activePeriodPreset] || currentPeriodLabel());

    // The mode chip mirrors the desktop badge rather than keeping its own state.
    const chip = document.getElementById("mHeroModeChip");
    if (chip) {
        const meta = DASHBOARD_MODE_META[getDashboardMode()] || DASHBOARD_MODE_META.household;
        const icon = chip.querySelector('i');
        const text = chip.querySelector('span');
        if (icon) icon.className = `fa-solid ${meta.icon}`;
        if (text) text.textContent = meta.label;
    }
}
window.renderMobileHero = renderMobileHero;

// What the period reads as when no preset is active (a hand-entered range).
function currentPeriodLabel() {
    if (dashboardFilters.dateFrom || dashboardFilters.dateTo) {
        return `${formatDisplayDate(dashboardFilters.dateFrom)} - ${formatDisplayDate(dashboardFilters.dateTo)}`;
    }
    if (dashboardFilters.month === 'all') {
        return dashboardFilters.year === 'all' ? 'All Time' : dashboardFilters.year;
    }
    return `${dashboardFilters.month} ${dashboardFilters.year}`;
}

// ================= BUDGET, RECURRING & YTD =================
function renderBudgetProgress(householdSpent, personalSpent = 0, combinedSpent = 0) {
    const progressBar = document.getElementById("budgetProgressBar");
    const spentVal = document.getElementById("budgetSpentVal");
    const capVal = document.getElementById("budgetCapVal");
    const remText = document.getElementById("budgetRemainingText");
    const pctText = document.getElementById("budgetPercentText");
    const pill = document.getElementById("budgetAlertPill");
    const householdSubtext = document.getElementById("budgetHouseholdSubtext");
    const personalSubtext = document.getElementById("budgetPersonalSubtext");

    const effectiveBudget = (window.masterConfig && Number(window.masterConfig.monthlyBudgetLimit)) || monthlyBudgetLimit || 50000;

    // The monthly budget measures every expense in the period - household and
    // personal together. It used to count household spending only, so personal
    // spending could run past the cap without the bar ever moving.
    const totalSpent = Number(combinedSpent) || (Number(householdSpent) + Number(personalSpent)) || 0;

    if (spentVal) spentVal.textContent = formatINR(totalSpent);
    if (capVal) capVal.textContent = formatINR(effectiveBudget);

    const rawPct = effectiveBudget > 0 ? Math.round((totalSpent / effectiveBudget) * 100) : 0;
    const pct = Math.min(100, rawPct);
    const remaining = Math.max(0, effectiveBudget - totalSpent);

    if (progressBar) {
        progressBar.style.width = `${pct}%`;
        if (pct >= 90) {
            progressBar.className = "bg-rose-500 h-full rounded-full transition-all duration-500";
        } else if (pct >= 75) {
            progressBar.className = "bg-amber-500 h-full rounded-full transition-all duration-500";
        } else {
            progressBar.className = "bg-emerald-500 h-full rounded-full transition-all duration-500";
        }
    }

    if (remText) remText.textContent = `Remaining: ${formatINR(remaining)}`;
    if (pctText) pctText.textContent = `${rawPct}% utilized`;

    // Both halves count towards the cap, so show what each contributed.
    const share = (v) => (totalSpent > 0 ? Math.round((Number(v) / totalSpent) * 100) : 0);
    if (householdSubtext) {
        householdSubtext.textContent = `Household: ${formatINR(householdSpent)} (${share(householdSpent)}%)`;
    }
    if (personalSubtext) {
        personalSubtext.textContent = `Personal: ${formatINR(personalSpent)} (${share(personalSpent)}%)`;
    }

    if (pill) {
        // Compare against the unclamped figure - the clamped one can never
        // exceed 100, so "Over Budget" used to be unreachable.
        if (rawPct > 100) {
            pill.className = "text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800";
            pill.textContent = "Over Budget";
        } else if (pct >= 85) {
            pill.className = "text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800";
            pill.textContent = "Approaching Limit";
        } else {
            pill.className = "text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
            pill.textContent = "On Track";
        }
    }
}

function calculateRecurringChecklist(filteredData) {
    let checklistConfig = [];
    if (window.masterConfig && window.masterConfig.recurringBills && Array.isArray(window.masterConfig.recurringBills) && window.masterConfig.recurringBills.length > 0) {
        checklistConfig = window.masterConfig.recurringBills.filter(b => b.active !== false);
    }

    let paidCount = 0;
    const items = checklistConfig.map(cfg => {
        const evalRes = window.getRecurringPaymentStatus
            ? window.getRecurringPaymentStatus(cfg, filteredData)
            : { status: 'UPCOMING', totalPaid: 0, targetAmount: cfg.approxAmount || 0 };

        const isPaid = evalRes.status === 'PAID';
        if (isPaid) paidCount++;

        return {
            ...cfg,
            name: cfg.name || cfg.category,
            target: Number(cfg.approxAmount) || evalRes.targetAmount || 0,
            actual: evalRes.totalPaid,
            isPaid: isPaid,
            status: evalRes.status
        };
    });

    return {
        items: items,
        paidCount: paidCount,
        pendingCount: checklistConfig.length - paidCount
    };
}

function renderChecklistUI(items) {
    const container = document.getElementById("checklistContainer");
    if (!container) return;

    container.innerHTML = items.map(item => `
        <div class="p-3 rounded-xl border ${item.isPaid ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'} text-xs space-y-1">
            <div class="flex justify-between items-center">
                <span class="font-extrabold text-slate-800 truncate">${item.name.replace(" - ", " ")}</span>
                <svg class="ic ${item.isPaid ? 'text-emerald-600' : 'text-amber-500'}" aria-hidden="true"><use href="#${item.isPaid ? 'i-circle-check' : 'i-clock'}"></use></svg>
            </div>
            <div class="flex justify-between items-baseline pt-1">
                <span class="text-[10px] text-slate-400 font-bold">${formatINR(item.target)}</span>
                <span class="font-black ${item.isPaid ? 'text-emerald-800' : 'text-amber-800'}">${item.isPaid ? 'Paid' : 'Due'}</span>
            </div>
        </div>
    `).join("");
}

function renderMoMAndYtd(allExpenses) {
    const cur = getCurrentPeriod();
    const curYear = cur.yearStr;
    const ytdMode = getDashboardMode();
    const inScope = (i) => {
        if (ytdMode === 'combined') return true;
        return ytdMode === 'personal' ? isPersonalExpense(i) : !isPersonalExpense(i);
    };

    // YTD Calculations, restricted to the mode chosen in Master Settings
    const ytdItems = allExpenses.filter(i => i.date && new Date(i.date).getFullYear().toString() === curYear);
    const ytdSpend = ytdItems.filter(i => i.category !== "Accepted Payments (Income)" && inScope(i)).reduce((a, b) => a + Number(b.amount), 0);
    const ytdIncome = ytdItems.filter(i => i.category === "Accepted Payments (Income)").reduce((a, b) => a + Number(b.amount), 0);
    const ytdNet = ytdIncome - ytdSpend;

    const ytdSpendEl = document.getElementById("ytdTotalSpend");
    const ytdIncomeEl = document.getElementById("ytdTotalIncome");
    const ytdNetEl = document.getElementById("ytdNetFlow");

    if (ytdSpendEl) ytdSpendEl.textContent = formatINR(ytdSpend);
    if (ytdIncomeEl) ytdIncomeEl.textContent = formatINR(ytdIncome);
    if (ytdNetEl) ytdNetEl.textContent = formatINR(ytdNet);

    // MoM comparison for selected month (Household by default)
    if (dashboardFilters.month !== "all") {
        const curMIdx = MONTHS.indexOf(dashboardFilters.month);
        const prevMIdx = (curMIdx + 11) % 12;
        const prevYear = (prevMIdx === 11 ? Number(dashboardFilters.year) - 1 : Number(dashboardFilters.year)).toString();

        const curSpend = allExpenses.filter(i => {
            const d = new Date(i.date);
            return d.getMonth() === curMIdx && d.getFullYear().toString() === dashboardFilters.year && i.category !== "Accepted Payments (Income)" && inScope(i);
        }).reduce((a, b) => a + Number(b.amount), 0);

        const prevSpend = allExpenses.filter(i => {
            const d = new Date(i.date);
            return d.getMonth() === prevMIdx && d.getFullYear().toString() === prevYear && i.category !== "Accepted Payments (Income)" && inScope(i);
        }).reduce((a, b) => a + Number(b.amount), 0);

        const momDiff = curSpend - prevSpend;
        const momDiffEl = document.getElementById("statMoMComparison");
        if (momDiffEl) {
            if (prevSpend > 0) {
                const pct = ((momDiff / prevSpend) * 100).toFixed(1);
                const sign = momDiff > 0 ? "+" : "";
                momDiffEl.innerHTML = `${sign}${pct}% vs ${MONTHS[prevMIdx].substring(0, 3)}`;
                momDiffEl.className = momDiff > 0 ? "font-bold text-rose-500" : "font-bold text-emerald-500";
            } else {
                momDiffEl.textContent = "-";
            }
        }
    }
}

// ================= TOP & RECENT EXPENSES TABLES =================
function renderTopExpensesTable(expenseItems) {
    const tbody = document.getElementById("topExpensesTableBody");
    if (!tbody) return;

    const sorted = [...expenseItems].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 6);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No expenses recorded</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(i => `
        <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="openTransactionDetailModal(${escapeHtml(JSON.stringify(i.id))})">
            <td class="py-2.5 px-3 text-slate-500 text-[11px] whitespace-nowrap">${formatDisplayDate(i.date)}</td>
            <td class="py-2.5 px-3 font-bold text-slate-900">${escapeHtml(i.category)}</td>
            <td class="py-2.5 px-3 text-slate-600 truncate max-w-[130px]">${escapeHtml(i.paidTo || i.notes || '-')}</td>
            <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-black bg-violet-100 text-violet-800">${escapeHtml(i.paidBy || 'Not Specified')}</span>
            </td>
            <td class="py-2.5 px-3 text-right font-black text-slate-900">${formatINR(i.amount)}</td>
            <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
                <button onclick="editExpense(${escapeHtml(JSON.stringify(i.id))})" class="p-1 text-slate-400 hover:text-indigo-600" aria-label="Edit this expense"><svg class="ic text-xs" aria-hidden="true"><use href="#i-pen"></use></svg></button>
            </td>
        </tr>
    `).join("");
}

function renderRecentTransactionsTable(filteredData) {
    const tbody = document.getElementById("recentTransactionsTableBody");
    if (!tbody) return;

    const sorted = [...filteredData].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400 italic">No transactions recorded</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(i => {
        const isIncome = i.category === "Accepted Payments (Income)";
        return `
            <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="openTransactionDetailModal(${escapeHtml(JSON.stringify(i.id))})">
                <td class="py-2.5 px-3 text-slate-500 text-[11px] whitespace-nowrap">${formatDisplayDate(i.date)}</td>
                <td class="py-2.5 px-3 font-bold text-slate-900 truncate max-w-[120px]">${escapeHtml(i.category)}</td>
                <td class="py-2.5 px-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700">${escapeHtml(i.paidBy || 'Not Specified')}</span>
                </td>
                <td class="py-2.5 px-3 text-slate-500 text-[11px]">${escapeHtml(i.paymentMethod || 'UPI')}</td>
                <td class="py-2.5 px-3 text-right font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">${formatINR(i.amount)}</td>
                <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
                    ${i.receipt ? `<button onclick="viewReceiptFull(${escapeHtml(JSON.stringify(i.receipt))})" class="text-indigo-600 hover:text-indigo-800" aria-label="View the receipt"><svg class="ic" aria-hidden="true"><use href="#i-paperclip"></use></svg></button>` : '<span class="text-slate-300">-</span>'}
                </td>
            </tr>
        `;
    }).join("");
}

// ================= TAB 2: DAILY EXPENSES LOG TABLE =================
// ================= EXPENSE LEDGER VIEW SWITCHER =================
// "auto" means follow the screen size, which is what the app did before this
// existed. An explicit "table" or "timeline" overrides that at every width.
const EXPENSE_VIEW_KEY = "homeexpenses_expense_view";
const EXPENSE_VIEWS = ["auto", "timeline", "table"];

function getStoredExpenseView() {
    try {
        const v = localStorage.getItem(EXPENSE_VIEW_KEY);
        return EXPENSE_VIEWS.includes(v) ? v : "auto";
    } catch (e) {
        return "auto";   // private mode, or site data blocked
    }
}

function applyExpenseView(mode) {
    const container = document.getElementById("expenseLedgerContainer");
    if (!container) return;

    const resolved = EXPENSE_VIEWS.includes(mode) ? mode : "auto";
    container.dataset.expenseView = resolved;

    // With "auto" neither button is pressed - the layout is following the
    // screen, and claiming otherwise would be misleading.
    const effective = resolved === "auto"
        ? (window.matchMedia("(min-width: 768px)").matches ? "table" : "timeline")
        : resolved;

    const btnTimeline = document.getElementById("btnExpenseViewTimeline");
    const btnTable = document.getElementById("btnExpenseViewTable");
    if (btnTimeline) btnTimeline.setAttribute("aria-pressed", String(effective === "timeline"));
    if (btnTable) btnTable.setAttribute("aria-pressed", String(effective === "table"));
}

function setExpenseView(mode) {
    if (typeof triggerHaptic === "function") triggerHaptic("light");
    const resolved = EXPENSE_VIEWS.includes(mode) ? mode : "auto";
    try {
        localStorage.setItem(EXPENSE_VIEW_KEY, resolved);
    } catch (e) {
        // Not fatal: the view still switches for this session.
    }
    applyExpenseView(resolved);
}
window.setExpenseView = setExpenseView;
window.applyExpenseView = applyExpenseView;

// Keep the pressed state honest when "auto" is in effect and the window is
// resized or the phone is rotated across the breakpoint.
if (typeof window !== "undefined" && window.matchMedia) {
    try {
        window.matchMedia("(min-width: 768px)").addEventListener("change", () => {
            if (getStoredExpenseView() === "auto") applyExpenseView("auto");
        });
    } catch (e) {}
}

// Day grouping for the ledger. Keyed on the local calendar date so entries
// never drift across a day boundary the way an ISO-string compare can.
function dayGroupKey(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'unknown';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayGroupLabel(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Undated';
    const today = new Date();
    const key = dayGroupKey(dateStr);
    if (key === dayGroupKey(today)) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (key === dayGroupKey(yesterday)) return 'Yesterday';
    // Same year reads better without it: "18 March" rather than "18 March 2026".
    const sameYear = d.getFullYear() === today.getFullYear();
    return d.toLocaleDateString('en-IN', sameYear
        ? { day: 'numeric', month: 'long' }
        : { day: 'numeric', month: 'long', year: 'numeric' });
}
window.dayGroupLabel = dayGroupLabel;

// Chart colours that follow the theme. Chart.js paints to a canvas, so it
// cannot inherit CSS - the values have to be read out and handed to it.
function themeInk(step) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(step);
    return (v || '').trim() || '#0f172a';
}
function surfaceColor() { return themeInk('--surface-1'); }

// The hole in a doughnut is wasted unless it carries the total. Every
// reference design puts the figure there.
function donutCenterTotal(total) {
    return {
        id: 'donutCenterTotal',
        afterDraw(chart) {
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data.length) return;
            const { ctx } = chart;
            const { x, y } = meta.data[0];
            const r = meta.data[0].innerRadius || 0;
            if (r < 28) return;                      // too small to letter

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.fillStyle = themeInk('--ink-3');
            ctx.font = `700 ${Math.max(9, Math.round(r * 0.19))}px ${CHART_FONT}`;
            ctx.fillText('TOTAL', x, y - r * 0.34);

            ctx.fillStyle = themeInk('--ink-1');
            const size = Math.max(13, Math.round(r * 0.36));
            ctx.font = `800 ${size}px ${CHART_FONT}`;
            let label = formatINR(total);
            // Long totals get a compact form rather than spilling past the hole.
            if (ctx.measureText(label).width > r * 1.7) {
                label = total >= 1e7 ? `₹${(total / 1e7).toFixed(2)}Cr`
                      : total >= 1e5 ? `₹${(total / 1e5).toFixed(2)}L`
                      : `₹${Math.round(total / 1000)}k`;
                ctx.font = `800 ${Math.round(size * 0.95)}px ${CHART_FONT}`;
            }
            ctx.fillText(label, x, y + r * 0.08);
            ctx.restore();
        }
    };
}
const CHART_FONT = "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";

// Which bar the dashboard period maps to: a month index for the 12-month
// view, a quarter index for the quarterly one. "all" highlights nothing,
// because no single bucket is being reported on.
function isHighlightedBucket(idx, bucketCount) {
    if (dashboardFilters.month === 'all') return false;
    const monthIdx = MONTHS.indexOf(dashboardFilters.month);
    if (monthIdx < 0) return false;
    return bucketCount === 4 ? Math.floor(monthIdx / 3) === idx : monthIdx === idx;
}

function renderExpenseTable(filteredData) {
    applyExpenseView(getStoredExpenseView());

    const tbody = document.getElementById("expenseTableBody");
    const emptyState = document.getElementById("emptyExpenseState");
    const mobileCards = document.getElementById("mobileExpenseCardList");
    if (!tbody) return;

    const sorted = [...filteredData].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length === 0) {
        tbody.innerHTML = "";
        if (mobileCards) mobileCards.innerHTML = "";
        if (emptyState) emptyState.classList.remove("hidden");
        return;
    }

    if (emptyState) emptyState.classList.add("hidden");

    tbody.innerHTML = sorted.map(item => {
        const isIncome = item.category === "Accepted Payments (Income)";
        return `
            <tr class="hover:bg-indigo-50/40 transition">
                <td class="py-3 px-4 text-slate-600 text-xs font-semibold whitespace-nowrap">${formatDisplayDate(item.date)}</td>
                <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(item.category)}</td>
                <td class="py-3 px-4 text-slate-600 max-w-xs truncate text-xs">${escapeHtml(item.notes || item.description || '-')}</td>
                <td class="py-3 px-4">
                    <span class="px-2.5 py-1 rounded-full text-xs font-black bg-violet-100 text-violet-800">${escapeHtml(item.paidBy || 'Not Specified')}</span>
                </td>
                <td class="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap text-xs">${escapeHtml(item.paidTo || item.vendor || '-')}</td>
                <td class="py-3 px-4 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(item.paymentMethod || 'UPI')}</td>
                <td class="py-3 px-4 text-right font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">${formatINR(item.amount)}</td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center space-x-2">
                        <button onclick="openTransactionDetailModal(${escapeHtml(JSON.stringify(item.id))})" title="View details" class="p-1.5 text-slate-400 hover:text-indigo-600 transition" aria-label="View transaction details"><svg class="ic text-xs" aria-hidden="true"><use href="#i-eye"></use></svg></button>
                        <button onclick="editExpense(${escapeHtml(JSON.stringify(item.id))})" title="Edit" class="p-1.5 text-slate-400 hover:text-indigo-600 transition" aria-label="Edit this expense"><svg class="ic text-xs" aria-hidden="true"><use href="#i-pen"></use></svg></button>
                        <button onclick="confirmDeleteExpense(${escapeHtml(JSON.stringify(item.id))})" title="Delete" class="p-1.5 text-slate-400 hover:text-rose-600 transition" aria-label="Delete this expense"><svg class="ic text-xs" aria-hidden="true"><use href="#i-trash-2"></use></svg></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");

    // Mobile Card List Render (< md, min touch targets 44px, progressive disclosure)
    // Cards are grouped under a date heading carrying that day's total, so a
    // long ledger reads as days rather than one undifferentiated stream.
    if (mobileCards) {
        // Day totals in a single pass. Recomputing them with a filter each time
        // a group starts is O(groups x items): invisible at a hundred expenses,
        // and millions of Date constructions for a few thousand spread over a
        // few hundred days - on every ledger render.
        const dayTotals = new Map();
        for (const x of sorted) {
            if (x.category === "Accepted Payments (Income)") continue;
            const k = dayGroupKey(x.date);
            dayTotals.set(k, (dayTotals.get(k) || 0) + (Number(x.amount) || 0));
        }

        let lastGroupKey = null;
        mobileCards.innerHTML = sorted.map(item => {
            const isIncome = item.category === "Accepted Payments (Income)";
            const catIcon = getCategoryIcon(item.category);
            const notes = (item.notes || item.description || '').trim();
            const recipient = (item.paidTo || item.vendor || '').trim();

            let groupHeader = '';
            const groupKey = dayGroupKey(item.date);
            if (groupKey !== lastGroupKey) {
                lastGroupKey = groupKey;
                // A day of pure income has no expense total, which reads as 0.
                const dayNet = dayTotals.get(groupKey) || 0;
                groupHeader = `
                <div class="tx-group-head">
                    <span class="tx-group-label">${escapeHtml(dayGroupLabel(item.date))}</span>
                    <span class="tx-group-total">${formatINR(dayNet)}</span>
                </div>`;
            }

            return groupHeader + `
                <div class="bg-white rounded-2xl p-4 shadow-sm border border-slate-200/90 hover:shadow-md transition space-y-3">
                    <!-- Top Bar: Category & Date -->
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0 text-base">
                                ${catIcon}
                            </div>
                            <div class="min-w-0">
                                <h4 class="text-xs font-black text-slate-900 truncate">${escapeHtml(item.category)}</h4>
                                <p class="text-[11px] font-semibold text-slate-400">${formatDisplayDate(item.date)}</p>
                            </div>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-base font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">${isIncome ? '+' : ''}${formatINR(item.amount)}</span>
                        </div>
                    </div>

                    <!-- Details Bar: Notes & Vendor -->
                    ${(notes || recipient) ? `
                        <div class="bg-slate-50/80 rounded-xl p-2.5 text-xs text-slate-600 space-y-1 border border-slate-100">
                            ${notes ? `<p class="line-clamp-2"><span class="font-bold text-slate-700">Note:</span> ${escapeHtml(notes)}</p>` : ''}
                            ${recipient ? `<p><span class="font-bold text-slate-700">To:</span> ${escapeHtml(recipient)}</p>` : ''}
                        </div>
                    ` : ''}

                    <!-- Chips & Meta Row -->
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
                        <div class="flex items-center gap-1.5 flex-wrap">
                            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-black bg-indigo-50 text-indigo-700 border border-indigo-100">
                                <svg class="ic text-[9px] mr-1 text-indigo-400" aria-hidden="true"><use href="#i-user"></use></svg> ${escapeHtml(item.paidBy || 'Not Specified')}
                            </span>
                            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-600">
                                ${escapeHtml(item.paymentMethod || 'UPI')}
                            </span>
                        </div>

                        <!-- Action Buttons (Touch targets >= 44px) -->
                        <div class="flex items-center gap-1">
                            <button type="button" onclick="openTransactionDetailModal(${escapeHtml(JSON.stringify(item.id))})" class="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-indigo-50 transition" title="View details" aria-label="View transaction details">
                                <svg class="ic text-sm" aria-hidden="true"><use href="#i-eye"></use></svg>
                            </button>
                            <button type="button" onclick="editExpense(${escapeHtml(JSON.stringify(item.id))})" class="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-slate-400 hover:text-indigo-600 rounded-xl hover:bg-indigo-50 transition" title="Edit" aria-label="Edit this expense">
                                <svg class="ic text-sm" aria-hidden="true"><use href="#i-pen"></use></svg>
                            </button>
                            <button type="button" onclick="confirmDeleteExpense(${escapeHtml(JSON.stringify(item.id))})" class="min-w-[44px] min-h-[44px] w-11 h-11 flex items-center justify-center text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50 transition" title="Delete" aria-label="Delete this expense">
                                <svg class="ic text-sm" aria-hidden="true"><use href="#i-trash-2"></use></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join("");
    }
}

// ================= STAFF PAYROLL RENDERING (CONFIG DRIVEN) =================
// Accent colours cycle, so any number of staff members renders sensibly -
// there is nothing special about "the maid" and "the chef" any more.
const STAFF_ACCENTS = [
    { bg: 'bg-indigo-50/70', border: 'border-indigo-100', chip: 'bg-indigo-600', btn: 'bg-indigo-600 hover:bg-indigo-700', text: 'text-indigo-900', rule: 'border-indigo-100/80', edge: 'border-l-indigo-600', grad: 'from-indigo-500 to-indigo-700', pill: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
    { bg: 'bg-amber-50/70', border: 'border-amber-100', chip: 'bg-amber-500', btn: 'bg-amber-600 hover:bg-amber-700', text: 'text-amber-900', rule: 'border-amber-100/80', edge: 'border-l-amber-500', grad: 'from-amber-500 to-orange-600', pill: 'bg-amber-50 text-amber-800 border-amber-200' },
    { bg: 'bg-emerald-50/70', border: 'border-emerald-100', chip: 'bg-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-700', text: 'text-emerald-900', rule: 'border-emerald-100/80', edge: 'border-l-emerald-600', grad: 'from-emerald-500 to-teal-600', pill: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    { bg: 'bg-violet-50/70', border: 'border-violet-100', chip: 'bg-violet-600', btn: 'bg-violet-600 hover:bg-violet-700', text: 'text-violet-900', rule: 'border-violet-100/80', edge: 'border-l-violet-600', grad: 'from-violet-500 to-purple-700', pill: 'bg-violet-50 text-violet-800 border-violet-200' }
];

function staffCycleLabel(s) {
    const day = Number(s && s.billingCycleDay);
    if (!day) return 'Monthly cycle';
    return `${day}${day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th'} of month cycle`;
}

function staffPaidInPeriod(staffExpenses, s) {
    const cat = staffCategoryOf(s).toLowerCase();
    return staffExpenses
        .filter(i => String(i.category || '').trim().toLowerCase() === cat)
        .reduce((a, b) => a + Number(b.amount), 0);
}

function staffEmptyState(message) {
    return `<div class="col-span-full p-6 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-center">
        <svg class="ic text-slate-300 text-xl" aria-hidden="true"><use href="#i-user-plus"></use></svg>
        <p class="text-sm font-bold text-slate-600 mt-2">No staff configured</p>
        <p class="text-xs text-slate-500 font-medium mt-1">${escapeHtml(message)}</p>
    </div>`;
}

// Dashboard: compact payroll status card per staff member.
function renderStaffPayrollLedger(staffExpenses, configuredStaff) {
    const grid = document.getElementById("dashStaffLedgerGrid");
    if (!grid) return;
    const staff = configuredStaff || getConfiguredStaff();
    if (!staff.length) {
        grid.innerHTML = staffEmptyState('Add staff in Master Settings to track payroll here.');
        return;
    }

    grid.innerHTML = staff.map((s, idx) => {
        const a = STAFF_ACCENTS[idx % STAFF_ACCENTS.length];
        const paid = staffPaidInPeriod(staffExpenses, s);
        const due = Number(s.baseSalary) || 0;
        const isPaid = due > 0 ? paid >= due : paid > 0;
        const name = staffDisplayName(s);
        const category = staffCategoryOf(s);
        const badge = isPaid
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-amber-100 text-amber-800';
        return `
        <div class="p-4 rounded-xl ${a.bg} border ${a.border} space-y-2.5">
            <div class="flex justify-between items-start">
                <div class="flex items-center space-x-2 min-w-0">
                    <div class="w-8 h-8 rounded-lg ${a.chip} text-white flex items-center justify-center font-bold text-xs shrink-0">
                        <svg class="ic" aria-hidden="true"><use href="#i-user-round"></use></svg>
                    </div>
                    <div class="min-w-0">
                        <h4 class="text-xs font-extrabold text-slate-900 truncate">${escapeHtml(name)}${s.role ? ` (${escapeHtml(s.role)})` : ''}</h4>
                        <span class="text-[10px] text-slate-500 font-bold">${escapeHtml(staffCycleLabel(s))}</span>
                    </div>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-black ${badge} shrink-0 ml-1">${isPaid ? 'Paid' : 'Pending'}</span>
            </div>
            <div class="flex justify-between items-baseline pt-2 border-t ${a.rule} text-xs">
                <span class="text-slate-500">Paid in Period:</span>
                <span class="font-extrabold text-slate-900 text-sm">${formatINR(paid)}</span>
            </div>
            <button onclick="quickPayItem(${escapeHtml(JSON.stringify(category))}, ${due}, ${escapeHtml(JSON.stringify(name))})"
                class="w-full py-1.5 min-h-[36px] ${a.btn} text-white text-xs font-bold rounded-lg shadow-sm transition">
                Pay ${escapeHtml(name)}${due > 0 ? ` ${formatINR(due)}` : ''}
            </button>
        </div>`;
    }).join('');
}
window.renderStaffPayrollLedger = renderStaffPayrollLedger;

// ================= TAB 3: STAFF VIEW =================
function renderStaffView(filteredData) {
    const staffCategorySet = getStaffCategorySet();
    const configuredStaff = getConfiguredStaff();
    const staffExpenses = (filteredData || expenses).filter(i => isStaffExpense(i, staffCategorySet));
    const tbody = document.getElementById("staffTableBody");

    const overview = document.getElementById("staffOverviewGrid");
    if (overview) {
        if (!configuredStaff.length) {
            overview.innerHTML = staffEmptyState('Add staff in Master Settings and their payments will appear here.');
        } else {
            overview.innerHTML = configuredStaff.map((s, idx) => {
                const a = STAFF_ACCENTS[idx % STAFF_ACCENTS.length];
                const paid = staffPaidInPeriod(staffExpenses, s);
                const due = Number(s.baseSalary) || 0;
                const isPaid = due > 0 ? paid >= due : paid > 0;
                const name = staffDisplayName(s);
                const category = staffCategoryOf(s);
                return `
                <div class="glass-card p-6 rounded-2xl border border-slate-200/80 shadow-sm relative border-l-4 ${a.edge} hover-lift">
                    <div class="flex justify-between items-start gap-3">
                        <div class="flex items-center space-x-4 min-w-0">
                            <div class="w-14 h-14 rounded-2xl bg-gradient-to-br ${a.grad} text-white flex items-center justify-center text-2xl font-bold shadow-md shrink-0">
                                <svg class="ic" aria-hidden="true"><use href="#i-user-round"></use></svg>
                            </div>
                            <div class="min-w-0">
                                <h3 class="text-lg font-black text-slate-900 truncate">${escapeHtml(name)}</h3>
                                <p class="text-xs text-slate-500 font-semibold truncate">${escapeHtml(s.role || 'Household Staff')}</p>
                                <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${a.pill}">
                                        <svg class="ic mr-1" aria-hidden="true"><use href="#i-calendar-check"></use></svg>${escapeHtml(staffCycleLabel(s))}
                                    </span>
                                    ${Number.isFinite(Number(s.allowedPaidLeaves)) ? `<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                                        <svg class="ic mr-1" aria-hidden="true"><use href="#i-umbrella"></use></svg>${Number(s.allowedPaidLeaves)} paid leaves
                                    </span>` : ''}
                                </div>
                            </div>
                        </div>
                        <button onclick="quickPayItem(${escapeHtml(JSON.stringify(category))}, ${due}, ${escapeHtml(JSON.stringify(name))})"
                            class="${a.btn} text-white font-bold text-xs px-3.5 py-2 min-h-[44px] rounded-xl shadow-md transition shrink-0">
                            <svg class="ic mr-1" aria-hidden="true"><use href="#i-indian-rupee"></use></svg> Pay${due > 0 ? ` ${formatINR(due)}` : ''}
                        </button>
                    </div>
                    <div class="mt-6 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span class="text-[11px] text-slate-400 uppercase font-extrabold">Total Paid (Selected Period)</span>
                            <p class="text-xl font-black ${a.text} mt-0.5">${formatINR(paid)}</p>
                        </div>
                        <div>
                            <span class="text-[11px] text-slate-400 uppercase font-extrabold">Selected Month Status</span>
                            <p class="mt-1">
                                <span class="px-2.5 py-1 ${isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'} text-xs font-bold rounded-md">
                                    ${isPaid ? 'Paid (Completed)' : 'Pending (Due)'}
                                </span>
                            </p>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }
    }

    if (!tbody) return;
    const sorted = [...staffExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 italic">No staff payments found for this period</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(i => `
        <tr class="hover:bg-slate-50 transition">
            <td class="py-3 px-4 font-semibold text-xs text-slate-600 whitespace-nowrap">${formatDisplayDate(i.date)}</td>
            <td class="py-3 px-4 font-bold text-slate-900">${escapeHtml(i.category.replace(" - ", " "))}</td>
            <td class="py-3 px-4 text-xs text-slate-500">${i.billingCycle || 'Monthly Cycle'}</td>
            <td class="py-3 px-4 font-black text-xs text-violet-800">${escapeHtml(i.paidBy || 'Not Specified')}</td>
            <td class="py-3 px-4 text-xs text-slate-600">${escapeHtml(i.paymentMethod || 'UPI')}</td>
            <td class="py-3 px-4 text-xs text-slate-500">${escapeHtml(i.notes || i.description || '-')}</td>
            <td class="py-3 px-4 text-right font-black text-slate-900">${formatINR(i.amount)}</td>
        </tr>
    `).join("");

    if (window.renderAttendanceCalendar) {
        window.renderAttendanceCalendar();
    }
}

// ================= TAB 4: MONTHLY PIVOT MATRIX =================
function renderMonthlyMatrix() {
    const thead = document.getElementById("matrixThead");
    const tbody = document.getElementById("matrixTbody");
    if (!thead || !tbody) return;

    const live = expenses.filter(i => i && !i.isDeleted && i.date);

    // Totals first, so the columns can be chosen from what was actually spent.
    // Every configured category used to get a column whether or not it had ever
    // been used, which on a phone meant scrolling past a dozen empty ones.
    const monthLabel = {};
    const totals = {};            // monthKey -> category -> amount
    const perCategory = {};       // category -> amount
    live.forEach(item => {
        const d = new Date(item.date);
        if (isNaN(d)) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthLabel[key] = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        const cat = item.category || 'Uncategorised';
        const amount = Number(item.amount) || 0;
        totals[key] = totals[key] || {};
        totals[key][cat] = (totals[key][cat] || 0) + amount;
        perCategory[cat] = (perCategory[cat] || 0) + amount;
    });

    const months = Object.keys(monthLabel).sort().reverse();
    // Biggest spend first: the column that matters is the one you can see
    // without scrolling.
    const columns = Object.keys(perCategory)
        .filter(c => perCategory[c] !== 0)
        .sort((a, b) => Math.abs(perCategory[b]) - Math.abs(perCategory[a]));

    const summary = document.getElementById("matrixSummary");
    if (!months.length) {
        thead.innerHTML = '';
        tbody.innerHTML = `
            <tr><td class="p-8 text-center text-slate-400 font-medium text-xs">
                Nothing recorded yet. Add an expense and the months will appear here.
            </td></tr>`;
        if (summary) summary.textContent = '';
        return;
    }

    const isIncome = (cat) => cat === "Accepted Payments (Income)";
    const monthSpend = (key) => columns.reduce(
        (acc, c) => acc + (isIncome(c) ? 0 : (totals[key][c] || 0)), 0);

    if (summary) {
        const grand = months.reduce((acc, k) => acc + monthSpend(k), 0);
        const busiest = months.slice().sort((a, b) => monthSpend(b) - monthSpend(a))[0];
        summary.textContent =
            `${months.length} month${months.length === 1 ? '' : 's'} · `
            + `${columns.length} categor${columns.length === 1 ? 'y' : 'ies'} used · `
            + `${formatINR(grand)} spent · busiest ${monthLabel[busiest]}`;
    }

    thead.innerHTML = `
        <tr>
            <th class="matrix-corner py-2.5 px-3 text-left">Month</th>
            ${columns.map(cat => `
                <th class="py-2.5 px-3 text-right whitespace-nowrap" title="${escapeHtml(cat)}">
                    ${escapeHtml(cat)}
                </th>`).join("")}
            <th class="py-2.5 px-3 text-right bg-indigo-950 text-white font-black whitespace-nowrap">Total Spent</th>
        </tr>
    `;

    const rows = months.map(key => `
        <tr class="hover:bg-slate-50 transition">
            <th scope="row" class="matrix-rowhead py-2.5 px-3 text-left font-black text-slate-900 whitespace-nowrap">
                ${escapeHtml(monthLabel[key])}
            </th>
            ${columns.map(cat => {
                const sum = totals[key][cat] || 0;
                return `<td class="py-2.5 px-3 text-right ${sum ? 'text-slate-900 font-bold' : 'text-slate-300 font-normal'}">
                            ${sum ? formatINR(sum) : '-'}
                        </td>`;
            }).join("")}
            <td class="py-2.5 px-3 text-right font-black text-indigo-700 bg-indigo-50/50 whitespace-nowrap">
                ${formatINR(monthSpend(key))}
            </td>
        </tr>
    `).join("");

    // A column of figures with no total at the bottom makes the reader do the
    // adding, which is the one thing a pivot table exists to avoid.
    const footer = `
        <tr class="matrix-total-row">
            <th scope="row" class="matrix-rowhead py-2.5 px-3 text-left font-black whitespace-nowrap">All months</th>
            ${columns.map(cat => `
                <td class="py-2.5 px-3 text-right font-black whitespace-nowrap">${formatINR(perCategory[cat])}</td>
            `).join("")}
            <td class="py-2.5 px-3 text-right font-black bg-indigo-950 text-white whitespace-nowrap">
                ${formatINR(months.reduce((acc, k) => acc + monthSpend(k), 0))}
            </td>
        </tr>
    `;

    tbody.innerHTML = rows + footer;
}

// ================= TOAST NOTIFICATION SYSTEM =================
function showToast(type, title, message = "") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        document.body.appendChild(container);
    }
    // Phones: a thin strip under the header, centred, never over the bottom bar
    // or a form. Wider screens keep the top-right corner. Positioning lives in
    // one place so it is not re-decided per toast.
    container.className = "toast-stack pointer-events-none";
    // On a phone the header can be pushed down by the install banner, so a fixed
    // offset would land the toast ON the header. Measure where it ends.
    try {
        const hdr = document.querySelector('header');
        container.style.top = (window.innerWidth < 640 && hdr)
            ? Math.max(8, Math.round(hdr.getBoundingClientRect().bottom) + 8) + 'px'
            : '';
    } catch (e) {}

    // The same message twice in a moment is one message. Bursts of identical
    // saves used to pile up into a wall of cards.
    const key = type + '|' + title + '|' + message;
    const live = Array.from(container.querySelectorAll('.toast-item'));
    const twin = live.find(t => t.dataset.key === key);
    if (twin) {
        clearTimeout(twin._timer);
        twin._timer = setTimeout(() => dismissToast(twin), 3000);
        return;
    }
    // At most two on screen; the oldest makes way.
    while (live.length >= 2) {
        const oldest = live.shift();
        oldest.remove();
    }

    const tone = type === "success" ? "toast-success" : (type === "error" ? "toast-error" : "toast-info");
    const icon = type === "success" ? "i-check" : (type === "error" ? "i-triangle-alert" : "i-info");

    const toast = document.createElement("div");
    toast.className = `toast-item pointer-events-auto ${tone}`;
    toast.dataset.key = key;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    toast.innerHTML = `
        <svg class="ic toast-icon" aria-hidden="true"><use href="#${icon}"></use></svg>
        <span class="toast-text"><strong>${escapeHtml(title)}</strong>${message ? `<span class="toast-sub"> · ${escapeHtml(String(message).replace(/<[^>]*>/g, ''))}</span>` : ''}</span>
        <button type="button" class="toast-close" aria-label="Dismiss">
            <svg class="ic" aria-hidden="true"><use href="#i-x"></use></svg>
        </button>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    container.appendChild(toast);

    // Errors stay a little longer: they are the ones somebody has to read.
    toast._timer = setTimeout(() => dismissToast(toast), type === "error" ? 5000 : 3000);
}

function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 200);
}

// ================= CRUD: ADD, EDIT, DELETE EXPENSES =================
// The client operation id for the expense currently being added; see saveExpense.
let pendingExpenseOpId = null;

function openExpenseModal(editId = null) {
    // Opening the form afresh starts a new operation. Reopening after a failed
    // save deliberately does not clear it from saveExpense, only from here when
    // the person starts over.
    if (!editId) pendingExpenseOpId = null;
    triggerHaptic('tap');
    const modal = document.getElementById("expenseModal");
    const form = document.getElementById("expenseForm");
    const modalTitle = document.getElementById("modalTitle");
    const cur = getCurrentPeriod();

    if (!modal) return;
    if (window.clearAnomalyWarning) window.clearAnomalyWarning();

    // Synchronize fresh categories and members from household Master Settings
    if (typeof window.syncDropdownsWithConfig === 'function') {
        window.syncDropdownsWithConfig();
    }

    if (editId) {
        const targetId = String(editId).trim();
        const item = expenses.find(i => String(i.id).trim() === targetId);
        if (!item) {
            console.error("Expense record not found for edit ID:", editId);
            showToast("error", "Record Not Found", "Could not locate the requested expense to edit.");
            return;
        }

        modalTitle.innerHTML = `<svg class="ic text-indigo-400 mr-2" aria-hidden="true"><use href="#i-square-pen"></use></svg> Edit Household Expense`;
        document.getElementById("expenseId").value = item.id;
        document.getElementById("inputDate").value = item.date || cur.isoDate;
        document.getElementById("inputAmount").value = item.amount;

        // Controlled Category dropdown - guarantee option exists
        const catSelect = document.getElementById("inputCategory");
        const targetCategory = item.category || "Grocery & Vegetables";
        if (catSelect) {
            let hasOption = false;
            for (let i = 0; i < catSelect.options.length; i++) {
                if (catSelect.options[i].value === targetCategory) {
                    hasOption = true;
                    break;
                }
            }
            if (!hasOption) {
                const opt = document.createElement("option");
                opt.value = targetCategory;
                opt.textContent = `🏷️ ${targetCategory}`;
                // Insert before __NEW_CAT__ if present
                const newCatOpt = catSelect.querySelector('option[value="__NEW_CAT__"]');
                if (newCatOpt) {
                    catSelect.insertBefore(opt, newCatOpt);
                } else {
                    catSelect.appendChild(opt);
                }
            }
            catSelect.value = targetCategory;
        }

        // Controlled Paid By dropdown - preserve exact existing value
        const paidBySelect = document.getElementById("inputPaidBy");
        if (paidBySelect) {
            const targetPaidBy = item.paidBy || "Not Specified";
            let hasOption = false;
            for (let i = 0; i < paidBySelect.options.length; i++) {
                if (paidBySelect.options[i].value === targetPaidBy) {
                    hasOption = true;
                    break;
                }
            }
            if (!hasOption) {
                const opt = document.createElement("option");
                opt.value = targetPaidBy;
                opt.textContent = targetPaidBy;
                paidBySelect.appendChild(opt);
            }
            paidBySelect.value = targetPaidBy;
        }

        // Split Between
        const splitSelect = document.getElementById("inputSplitBetween");
        if (splitSelect) {
            splitSelect.value = item.splitBetween || (splitSelect.options.length > 0 ? splitSelect.options[0].value : "");
        }

        document.getElementById("inputPaidTo").value = item.paidTo || item.vendor || "";
        document.getElementById("inputPaymentMethod").value = item.paymentMethod || "UPI / GPay / PhonePe";
        document.getElementById("inputNotes").value = item.notes || item.description || "";

        // Preserve existing receipt attachment
        currentSelectedReceiptBase64 = item.receipt || null;
        const preview = document.getElementById("receiptUploadPreview");
        const img = document.getElementById("receiptPreviewImg");
        const placeholder = document.getElementById("receiptUploadPlaceholder");
        if (item.receipt && preview && img && placeholder) {
            img.src = item.receipt;
            preview.classList.remove("hidden");
            placeholder.classList.add("hidden");
        } else {
            removeReceiptInput();
        }

        // Cache original item for reference in saveExpense
        window.currentEditingItem = item;
    } else {
        modalTitle.innerHTML = `<svg class="ic text-indigo-400 mr-2" aria-hidden="true"><use href="#i-square-pen"></use></svg> Add Household Expense`;
        if (form) form.reset();
        document.getElementById("expenseId").value = "";
        document.getElementById("inputDate").value = cur.isoDate;
        
        const catSelect = document.getElementById("inputCategory");
        if (catSelect && catSelect.options.length > 0) {
            if (catSelect.options[0].value !== '__NEW_CAT__') {
                catSelect.selectedIndex = 0;
            } else if (catSelect.options.length > 1) {
                catSelect.selectedIndex = 1;
            }
        }
        
        const paidBySelect = document.getElementById("inputPaidBy");
        if (paidBySelect) {
            const preferredUser = (currentSessionUser && currentSessionUser.name) || (window.FAMILY_MEMBERS && window.FAMILY_MEMBERS[0]);
            let found = false;
            for (let i = 0; i < paidBySelect.options.length; i++) {
                if (paidBySelect.options[i].value.toLowerCase() === (preferredUser || '').toLowerCase()) {
                    paidBySelect.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            if (!found && paidBySelect.options.length > 0) {
                paidBySelect.selectedIndex = 0;
            }
        }
        
        const splitSelect = document.getElementById("inputSplitBetween");
        if (splitSelect && splitSelect.options.length > 0) {
            splitSelect.selectedIndex = 0;
        }
        
        document.getElementById("inputPaymentMethod").value = "UPI / GPay / PhonePe";
        document.getElementById("inputPaidTo").value = "";
        document.getElementById("inputNotes").value = "";
        currentSelectedReceiptBase64 = null;
        removeReceiptInput();
        window.currentEditingItem = null;
    }

    modal.classList.remove("hidden");
}

function closeExpenseModal() {
    const modal = document.getElementById("expenseModal");
    if (modal) modal.classList.add("hidden");
    window.currentEditingItem = null;
    currentSelectedReceiptBase64 = null;
}

function onCategoryChange() {
    const select = document.getElementById("inputCategory");
    if (!select) return;
    const cat = select.value;

    if (cat === '__NEW_CAT__') {
        if (window.promptNewCategoryForExpense) {
            window.promptNewCategoryForExpense();
        }
        return;
    }

    const paidTo = document.getElementById("inputPaidTo");
    if (!paidTo) return;

    if (window.masterConfig && window.masterConfig.categories) {
        const found = window.masterConfig.categories.find(c => c.name === cat);
        if (found && found.defaultPaidTo) {
            paidTo.value = found.defaultPaidTo;
            return;
        }
    }

    // A staff category pays that staff member, whoever this household hired.
    const staffMatch = getConfiguredStaff().find(st => staffCategoryOf(st) === cat);
    if (staffMatch) {
        paidTo.value = staffDisplayName(staffMatch);
        return;
    }

    if (cat === "Electricity Bill") paidTo.value = "MSCB / MSEDCL";
    else if (cat === "Flat Maintenance") paidTo.value = "Society Office";
    else if (cat === "Dish Bill (DTH)") paidTo.value = "Dish TV / Tata Play";
}

let isSavingExpense = false;

async function saveExpense(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (isSavingExpense) return;
    isSavingExpense = true;

    const idInput = document.getElementById("expenseId");
    const id = idInput ? idInput.value.trim() : "";
    const isEdit = !!id;

    const date = document.getElementById("inputDate").value;
    const amountVal = document.getElementById("inputAmount").value;
    const amount = parseFloat(amountVal);
    const categorySelect = document.getElementById("inputCategory");
    const category = categorySelect ? categorySelect.value : "";
    const paidBy = document.getElementById("inputPaidBy").value;
    const paidTo = document.getElementById("inputPaidTo").value.trim();
    const paymentMethod = document.getElementById("inputPaymentMethod").value;
    const splitEl = document.getElementById("inputSplitBetween");
    const splitBetween = splitEl ? splitEl.value : ((window.masterConfig && window.masterConfig.splitRules && window.masterConfig.splitRules[0]) || "Household Expense");
    const notesEl = document.getElementById("inputNotes");
    const notes = notesEl ? notesEl.value.trim() : "";

    // 1. Validation
    if (!date || isNaN(new Date(date).getTime())) {
        isSavingExpense = false;
        triggerHaptic('error');
        showToast("error", "Validation Error", "Please select a valid transaction date.");
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        isSavingExpense = false;
        triggerHaptic('error');
        showToast("error", "Validation Error", "Amount must be a positive number greater than zero.");
        return;
    }
    if (!category || category === '__NEW_CAT__') {
        isSavingExpense = false;
        triggerHaptic('error');
        showToast("error", "Validation Error", "Please select or add an expense category.");
        if (category === '__NEW_CAT__' && window.promptNewCategoryForExpense) {
            window.promptNewCategoryForExpense();
        }
        return;
    }

    // Retrieve original record if editing (Preserve record ID and hidden fields)
    let existingRecord = null;
    if (isEdit) {
        existingRecord = expenses.find(i => String(i.id).trim() === id) || window.currentEditingItem;
    }

    // 2. Build Updated / New Payload
    const payload = {
        ...(existingRecord || {}),
        id: isEdit ? (existingRecord ? existingRecord.id : id) : null,
        date: date,
        amount: amount,
        category: category,
        paidBy: paidBy || "Not Specified",
        splitBetween: splitBetween,
        paidTo: paidTo,
        vendor: paidTo,
        paymentMethod: paymentMethod,
        notes: notes,
        description: notes,
        receipt: currentSelectedReceiptBase64 !== undefined ? currentSelectedReceiptBase64 : (existingRecord ? existingRecord.receipt : null),
        clientUpdatedAt: new Date().toISOString()
    };

    // One id per logical "add this expense", kept until the server confirms it.
    // A retry after a timeout, a double tap, or the offline queue replaying the
    // same draft all carry the same id, so the server can recognise them as one
    // operation. The in-memory isSavingExpense flag alone could not: it dies with
    // the page, and the queue outlives it.
    if (!isEdit) {
        pendingExpenseOpId = pendingExpenseOpId
            || ('op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        payload.clientOpId = pendingExpenseOpId;
    }

    // 3. Double-Click & Rapid Save Protection
    const submitBtn = document.getElementById("btnSubmitExpense");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<svg class="ic animate-spin mr-1.5" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Saving...`;
    }

    // Check immediate offline state before network dispatch
    if (!navigator.onLine) {
        isSavingExpense = false;
        saveOfflineDraft(payload, isEdit, existingRecord, submitBtn);
        return;
    }

    try {
        const method = isEdit ? "PUT" : "POST";
        const res = await fetch("/api/expenses", {
            method: method,
            headers: getAuthHeaders({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }),
            cache: 'no-store',
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.status === 409 || data.conflict) {
            triggerHaptic('warning');
            handleExpenseConflict(payload, data.current);
            return;
        }

        if (res.ok && data.success && data.data) {
            const savedItem = {
                ...(existingRecord || {}),
                ...data.data,
                paidBy: data.data.paidBy || paidBy || "Not Specified"
            };

            // 4. Update In-Memory / Application State Immediately (Canonical Single Source of Truth)
            const targetId = String(savedItem.id).trim();
            if (isEdit) {
                const idx = expenses.findIndex(i => String(i.id).trim() === targetId);
                if (idx !== -1) {
                    expenses[idx] = savedItem;
                } else {
                    expenses.unshift(savedItem);
                }
            } else {
                expenses.unshift(savedItem);
            }

            // Keep sorted descending by date
            expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

            // Sync global references
            window.expenses = expenses;
            window.expensesData = expenses;

            // Automatically synchronize Master Settings categories if a new category was used
            if (window.masterConfig && window.masterConfig.categories) {
                const hasCat = window.masterConfig.categories.some(c => c.name.toLowerCase() === savedItem.category.toLowerCase());
                if (!hasCat) {
                    window.masterConfig.categories.push({
                        name: savedItem.category,
                        icon: '🏷️',
                        type: 'expense',
                        defaultPaidTo: savedItem.paidTo || ''
                    });
                    if (window.syncDropdownsWithConfig) window.syncDropdownsWithConfig();
                    if (window.renderAdminView) window.renderAdminView();
                }
            }

            // 5. Persist to Local Storage Cache
            saveLocalCacheData();

            // 6. Recalculate Filtered Data & All Dashboard Views Automatically
            renderAllViews();
            updateHeaderStatus();

            // Confirmed by the server: the next add is a new operation.
            pendingExpenseOpId = null;

            // 7. Close Modal
            closeExpenseModal();

            // 8. Haptic & Toast Feedback
            triggerHaptic('success');
            const actionTitle = isEdit ? "Expense Updated Successfully" : "Expense Added Successfully";
            const secondaryText = `${formatINR(savedItem.amount)} · ${savedItem.category} · ${savedItem.paidBy}`;
            showToast("success", actionTitle, secondaryText);

            // Immediate Mobile Notification Shade Alert (shows in phone notification bar like Snapchat/WhatsApp)
            if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => {
                    if (reg && reg.showNotification) {
                        reg.showNotification(
                            isEdit ? `✏️ Expense Updated: ${formatINR(savedItem.amount)}` : `💰 Expense Added: ${formatINR(savedItem.amount)}`,
                            {
                                body: `${savedItem.category} • Paid by ${savedItem.paidBy}${savedItem.note ? ` • "${savedItem.note}"` : ''}`,
                                icon: '/icon-192.png',
                                badge: '/icon-192.png',
                                tag: `expense-${savedItem.id}-${Date.now()}`,
                                renotify: true,
                                requireInteraction: true,
                                silent: false,
                                vibrate: [300, 100, 300, 100, 300],
                                data: { url: '/#tab-expenses' }
                            }
                        ).catch(e => console.warn('Local notify err:', e));
                    }
                }).catch(() => {});
            }

            // 9. Silent Background Sync to Verify Server Parity & Broadcast (Canonical read-after-write)
            await loadData(true);
            if (window.loadMasterConfig) window.loadMasterConfig();
            broadcastTransactionUpdate(isEdit ? 'UPDATE' : 'CREATE');
        } else {
            console.error("Save rejected by server:", data);
            triggerHaptic('error');
            showToast("error", "Unable to Update Expense", data.error || "Your changes were not saved. Please try again.");
        }
    } catch (err) {
        console.warn("Save network exception, saving safely to offline sync queue:", err);
        saveOfflineDraft(payload, isEdit, existingRecord, submitBtn);
    } finally {
        isSavingExpense = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = isEdit ? `Save Changes` : `Save Expense Record`;
        }
    }
}

// ---------------- CONCURRENCY CONFLICT RESOLUTION ----------------
let pendingConflictDraft = null;
let pendingConflictServer = null;

function handleExpenseConflict(draft, serverRecord) {
    pendingConflictDraft = draft;
    pendingConflictServer = serverRecord || expenses.find(i => String(i.id).trim() === String(draft.id).trim()) || {};

    const modal = document.getElementById("conflictModal");
    const container = document.getElementById("conflictDiffContainer");
    if (!modal || !container) {
        showToast("error", "Conflict Detected", "This expense was modified elsewhere. Please reload the latest record.");
        return;
    }

    const fields = [
        { label: "Amount", draft: formatINR(draft.amount), server: formatINR(pendingConflictServer.amount) },
        { label: "Date", draft: draft.date, server: pendingConflictServer.date },
        { label: "Category", draft: draft.category, server: pendingConflictServer.category },
        { label: "Paid By", draft: draft.paidBy, server: pendingConflictServer.paidBy },
        { label: "Paid To / Vendor", draft: draft.paidTo || draft.vendor || "-", server: pendingConflictServer.paidTo || pendingConflictServer.vendor || "-" },
        { label: "Notes / Description", draft: draft.notes || "-", server: pendingConflictServer.notes || "-" },
        { label: "Record Version", draft: `v${draft.version || 1}`, server: `v${pendingConflictServer.version || 1}` }
    ];

    container.innerHTML = `
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <th class="p-2">Field</th>
                    <th class="p-2 text-amber-700 bg-amber-50/50">Your Draft</th>
                    <th class="p-2 text-indigo-700 bg-indigo-50/50">Current Server</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${fields.map(f => {
                    const isDiff = String(f.draft).trim() !== String(f.server).trim();
                    return `
                        <tr class="${isDiff ? 'bg-amber-50/30 font-semibold' : ''}">
                            <td class="p-2 text-slate-500 font-medium">${escapeHtml(f.label)}</td>
                            <td class="p-2 text-slate-800 ${isDiff ? 'text-amber-800' : ''}">${escapeHtml(f.draft)}</td>
                            <td class="p-2 text-slate-800 ${isDiff ? 'text-indigo-800 font-bold' : ''}">${escapeHtml(f.server)}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    modal.classList.remove("hidden");
}

function resolveConflictKeepServer() {
    if (!pendingConflictServer) {
        closeConflictModal();
        return;
    }
    const targetId = pendingConflictServer.id;
    closeConflictModal();
    openExpenseModal(targetId);
    showToast("info", "Loaded Server Version", "The editing form has been populated with the latest server data.");
}

async function resolveConflictOverwrite() {
    if (!pendingConflictDraft || !pendingConflictServer) {
        closeConflictModal();
        return;
    }
    pendingConflictDraft.version = pendingConflictServer.version;
    closeConflictModal();

    showToast("info", "Retrying Save", "Overwriting with your latest draft...");

    const submitBtn = document.getElementById("btnSubmitExpense");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<svg class="ic animate-spin mr-1.5" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Overwriting...`;
    }

    try {
        const res = await fetch("/api/expenses", {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify(pendingConflictDraft)
        });
        const data = await res.json();
        if (res.ok && data.success && data.data) {
            const savedItem = { ...pendingConflictDraft, ...data.data };
            const idx = expenses.findIndex(i => String(i.id).trim() === String(savedItem.id).trim());
            if (idx !== -1) expenses[idx] = savedItem;
            else expenses.unshift(savedItem);

            expenses.sort((a, b) => new Date(b.date) - new Date(a.date));
            window.expenses = expenses;
            window.expensesData = expenses;
            saveLocalCacheData();
            renderAllViews();
            updateHeaderStatus();
            closeExpenseModal();
            showToast("success", "Expense Overwritten Successfully", `${formatINR(savedItem.amount)} · ${savedItem.category}`);
            loadData(true);
        } else {
            showToast("error", "Overwrite Failed", data.error || "Could not overwrite record.");
        }
    } catch (err) {
        showToast("error", "Network Error", "Could not connect to server.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Save Expense Record`;
        }
        pendingConflictDraft = null;
        pendingConflictServer = null;
    }
}

function closeConflictModal() {
    const modal = document.getElementById("conflictModal");
    if (modal) modal.classList.add("hidden");
}

function editExpense(id) {
    closeTransactionDetailModal();
    openExpenseModal(id);
}

// Delete Confirmation Modal Flow
function confirmDeleteExpense(id) {
    const item = expenses.find(i => i.id === id);
    if (!item) return;

    pendingDeleteExpenseId = id;
    const modal = document.getElementById("deleteConfirmModal");
    const detailsContainer = document.getElementById("deleteConfirmDetails");
    const confirmBtn = document.getElementById("btnConfirmDeleteAction");

    if (detailsContainer) {
        detailsContainer.innerHTML = `
            <p><strong>Category:</strong> ${escapeHtml(item.category)}</p>
            <p><strong>Amount:</strong> ${formatINR(item.amount)}</p>
            <p><strong>Date:</strong> ${formatDisplayDate(item.date)}</p>
            <p><strong>Paid By:</strong> ${escapeHtml(item.paidBy || 'Not Specified')}</p>
            <p><strong>Paid To:</strong> ${escapeHtml(item.paidTo || item.vendor || '-')}</p>
        `;
    }

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            await executeDeleteExpense(id);
            closeDeleteConfirmModal();
        };
    }

    if (modal) modal.classList.remove("hidden");
}

function closeDeleteConfirmModal() {
    const modal = document.getElementById("deleteConfirmModal");
    if (modal) modal.classList.add("hidden");
    pendingDeleteExpenseId = null;
}

async function executeDeleteExpense(id) {
    if (!id) return;
    const targetId = String(id).trim();

    const handleDeleteOffline = () => {
        // If created offline and pending sync, remove it from queue
        const queue = getOfflineQueue();
        const filteredQueue = queue.filter(item => {
            if (item.action === 'CREATE' && String(item.id).trim() === targetId) return false;
            if (item.action === 'UPDATE' && String(item.id).trim() === targetId) return false;
            return true;
        });

        // If not a purely local temp item, enqueue DELETE
        if (!targetId.startsWith('temp_')) {
            filteredQueue.push({
                queueId: 'queue_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                action: 'DELETE',
                id: targetId,
                timestamp: new Date().toISOString(),
                retryCount: 0
            });
        }
        setOfflineQueue(filteredQueue);

        expenses = expenses.filter(i => String(i.id).trim() !== targetId);
        window.expenses = expenses;
        window.expensesData = expenses;
        saveLocalCacheData();
        renderAllViews();
        updateHeaderStatus();
        closeDeleteConfirmModal();
        closeTransactionDetailModal();
        triggerHaptic('delete');
        showToast("warning", "Deleted in Offline Queue", "Record removed locally. Deletion will be synced with server when reconnected.");
    };

    if (!navigator.onLine) {
        handleDeleteOffline();
        return;
    }

    try {
        const res = await fetch(`/api/expenses?id=${encodeURIComponent(targetId)}&_t=${Date.now()}`, {
            method: "DELETE",
            headers: getAuthHeaders({
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }),
            cache: 'no-store'
        });
        const data = await res.json();
        if (res.ok && data.success) {
            // Remove from canonical state
            const deletedItem = expenses.find(i => String(i.id).trim() === targetId);
            expenses = expenses.filter(i => String(i.id).trim() !== targetId);
            window.expenses = expenses;
            window.expensesData = expenses;
            saveLocalCacheData();
            renderAllViews();
            updateHeaderStatus();
            closeDeleteConfirmModal();
            closeTransactionDetailModal();
            triggerHaptic('delete');
            showToast("success", "Expense Deleted Successfully");

            // Immediate Mobile Notification Shade Alert (shows in phone notification bar like Snapchat/WhatsApp)
            if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.ready.then(reg => {
                    if (reg && reg.showNotification) {
                        reg.showNotification(
                            '🗑️ Expense Deleted',
                            {
                                body: `${deletedItem?.category || 'Expense'} • ${formatINR(deletedItem?.amount || 0)} removed from ledger`,
                                icon: '/icon-192.png',
                                badge: '/icon-192.png',
                                tag: `expense-delete-${targetId}-${Date.now()}`,
                                renotify: true,
                                requireInteraction: true,
                                silent: false,
                                vibrate: [300, 100, 300, 100, 300],
                                data: { url: '/#tab-expenses' }
                            }
                        ).catch(e => console.warn('Local notify err:', e));
                    }
                }).catch(() => {});
            }

            loadData(true);
            broadcastTransactionUpdate('DELETE');
        } else {
            triggerHaptic('error');
            showToast("error", "Unable to Delete Expense", data.error || "Record could not be removed.");
        }
    } catch (err) {
        console.warn("Delete network exception, falling back to offline queue:", err);
        handleDeleteOffline();
    }
}

// Transaction Detail Modal
function openTransactionDetailModal(id) {
    const item = expenses.find(i => i.id === id);
    if (!item) return;

    const modal = document.getElementById("transactionDetailModal");
    if (!modal) return;

    const catBadge = document.getElementById("detailCategoryBadge");
    const amtEl = document.getElementById("detailAmount");
    const dateEl = document.getElementById("detailDate");
    const paidByBadge = document.getElementById("detailPaidByBadge");
    const paidToEl = document.getElementById("detailPaidTo");
    const methodEl = document.getElementById("detailPaymentMethod");
    const cycleEl = document.getElementById("detailBillingCycle");
    const notesEl = document.getElementById("detailNotes");
    const receiptContainer = document.getElementById("detailReceiptContainer");
    const receiptImg = document.getElementById("detailReceiptImg");
    const editBtn = document.getElementById("btnDetailEdit");
    const delBtn = document.getElementById("btnDetailDelete");

    if (catBadge) catBadge.textContent = item.category;
    if (amtEl) amtEl.textContent = formatINR(item.amount);
    if (dateEl) dateEl.textContent = formatDisplayDate(item.date);
    if (paidByBadge) paidByBadge.textContent = `Paid By: ${item.paidBy || 'Not Specified'}`;
    if (paidToEl) paidToEl.textContent = item.paidTo || item.vendor || '-';
    if (methodEl) methodEl.textContent = item.paymentMethod || 'UPI';
    if (cycleEl) cycleEl.textContent = item.billingCycle || 'Standard';
    if (notesEl) notesEl.textContent = item.notes || item.description || '-';

    if (receiptContainer && receiptImg) {
        if (item.receipt) {
            receiptImg.src = item.receipt;
            receiptContainer.classList.remove("hidden");
        } else {
            receiptContainer.classList.add("hidden");
        }
    }

    if (editBtn) editBtn.onclick = () => editExpense(item.id);
    if (delBtn) delBtn.onclick = () => confirmDeleteExpense(item.id);

    modal.classList.remove("hidden");
}

function closeTransactionDetailModal() {
    const modal = document.getElementById("transactionDetailModal");
    if (modal) modal.classList.add("hidden");
}

// Receipt File Dropzone Preview
function previewReceiptInput(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        currentSelectedReceiptBase64 = evt.target.result;
        const preview = document.getElementById("receiptUploadPreview");
        const img = document.getElementById("receiptPreviewImg");
        const placeholder = document.getElementById("receiptUploadPlaceholder");
        const nameEl = document.getElementById("receiptFileName");

        if (img) img.src = currentSelectedReceiptBase64;
        if (nameEl) nameEl.textContent = file.name;
        if (preview) preview.classList.remove("hidden");
        if (placeholder) placeholder.classList.add("hidden");
    };
    reader.readAsDataURL(file);
}

function removeReceiptInput(e) {
    if (e) e.stopPropagation();
    currentSelectedReceiptBase64 = null;
    const fileInput = document.getElementById("inputReceipt");
    if (fileInput) fileInput.value = "";
    const preview = document.getElementById("receiptUploadPreview");
    const placeholder = document.getElementById("receiptUploadPlaceholder");
    if (preview) preview.classList.add("hidden");
    if (placeholder) placeholder.classList.remove("hidden");
}

function viewReceiptFull(src) {
    const modal = document.getElementById("receiptModal");
    const img = document.getElementById("enlargedReceiptImg");
    if (modal && img) {
        img.src = src;
        modal.classList.remove("hidden");
    }
}

function closeReceiptModal() {
    const modal = document.getElementById("receiptModal");
    if (modal) modal.classList.add("hidden");
}

// ================= QUICK PAY CHECKLIST =================
function openQuickFillModal() {
    const modal = document.getElementById("quickFillModal");
    const container = document.getElementById("quickPayItemsContainer");
    if (!modal || !container) return;

    // Built from this household's own staff and recurring bills.
    const items = [
        ...getConfiguredStaff().map(st => ({
            name: staffCategoryOf(st),
            amount: Number(st.baseSalary) || 0,
            paidTo: staffDisplayName(st)
        })),
        ...getConfiguredBills().map(b => ({
            name: b.category || b.name,
            amount: Number(b.approxAmount !== undefined ? b.approxAmount : b.budgetedAmount) || 0,
            paidTo: b.paidTo || b.vendor || b.name || ''
        }))
    ].filter(i => i.name);

    if (items.length === 0) {
        container.innerHTML = `<div class="p-5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 text-center">
            <p class="text-sm font-bold text-slate-600">Nothing to quick-fill yet</p>
            <p class="text-xs text-slate-500 font-medium mt-1">Add staff or recurring bills in Master Settings.</p>
        </div>`;
        modal.classList.remove("hidden");
        return;
    }

    container.innerHTML = items.map(i => `
        <button onclick="quickPayItem(${escapeHtml(JSON.stringify(i.name))}, ${i.amount}, ${escapeHtml(JSON.stringify(i.paidTo))})" class="p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-left transition flex items-center justify-between">
            <div>
                <span class="block font-black text-slate-900">${escapeHtml(i.name)}</span>
                <span class="text-xs text-slate-500 font-semibold">${formatINR(i.amount)} &bull; ${escapeHtml(i.paidTo)}</span>
            </div>
            <svg class="ic text-indigo-600" aria-hidden="true"><use href="#i-arrow-right"></use></svg>
        </button>
    `).join("");

    modal.classList.remove("hidden");
}

function closeQuickFillModal() {
    const modal = document.getElementById("quickFillModal");
    if (modal) modal.classList.add("hidden");
}

function quickPayItem(catName, defaultAmount, defaultPaidTo) {
    closeQuickFillModal();
    openExpenseModal();
    document.getElementById("inputCategory").value = catName;
    document.getElementById("inputAmount").value = defaultAmount;
    document.getElementById("inputPaidTo").value = defaultPaidTo;
    const activeMember = (currentSessionUser && currentSessionUser.name) || (window.FAMILY_MEMBERS && window.FAMILY_MEMBERS[0]) || "Household Member";
    if (document.getElementById("inputPaidBy")) {
        document.getElementById("inputPaidBy").value = activeMember;
    }
    document.getElementById("inputNotes").value = `Monthly payment for ${catName}`;
}

// ================= EXCEL EXPORT & IMPORT ENGINE (Requirement 28, 29) =================
function toggleExportMenu() {
    const menu = document.getElementById("exportDropdownMenu");
    if (menu) menu.classList.toggle("hidden");
}

function exportToExcel(type = 'filtered') {
    if (typeof XLSX === 'undefined') {
        alert("SheetJS library is loading. Please check connection.");
        return;
    }

    const dataToExport = (type === 'filtered') ? getFilteredExpenses() : expenses;
    const sortedExpenses = [...dataToExport].sort((a, b) => new Date(b.date) - new Date(a.date));

    const workbook = XLSX.utils.book_new();

    // ---------------- Sheet 1: Daily Expenses Log ----------------
    const dailyLogsData = sortedExpenses.map(item => {
        const d = new Date(item.date);
        const isIncome = item.category === "Accepted Payments (Income)";
        return {
            "ID": item.id,
            "Date": item.date,
            "Month-Year": `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
            "Transaction Type": isIncome ? "Credit / Income" : "Expense / Debit",
            "Expense Category": item.category,
            "Amount (INR)": Number(item.amount),
            "Paid By": item.paidBy || "Not Specified",
            "Paid To / Vendor": item.paidTo || item.vendor || "",
            "Payment Method": item.paymentMethod || "UPI",
            "Billing Cycle": item.billingCycle || "",
            "Receipt Status": item.receipt ? "Yes (Attached)" : (item.receiptStatus || "No Receipt"),
            "Notes / Description": item.notes || item.description || ""
        };
    });

    const sheet1 = XLSX.utils.json_to_sheet(dailyLogsData);
    XLSX.utils.book_append_sheet(workbook, sheet1, "Daily Expenses Log");

    // ---------------- Sheet 2: Monthly Summary Matrix ----------------
    const monthYearMap = {};
    expenses.forEach(item => {
        if (!item.date) return;
        const d = new Date(item.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthYearMap[key] = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    });

    const sortedKeys = Object.keys(monthYearMap).sort().reverse();
    const matrixData = sortedKeys.map(mKey => {
        const [yearStr, monthNumStr] = mKey.split("-");
        const monthIdx = parseInt(monthNumStr, 10) - 1;
        const row = { "Month-Year": monthYearMap[mKey] };
        let total = 0;

        CATEGORIES.forEach(cat => {
            const sum = expenses.filter(i => {
                const d = new Date(i.date);
                return d.getFullYear().toString() === yearStr && d.getMonth() === monthIdx && i.category === cat;
            }).reduce((acc, i) => acc + Number(i.amount), 0);
            row[cat] = sum;
            if (cat !== "Accepted Payments (Income)") total += sum;
        });

        row["Total Spent (INR)"] = total;
        return row;
    });

    const sheet2 = XLSX.utils.json_to_sheet(matrixData);
    XLSX.utils.book_append_sheet(workbook, sheet2, "Monthly Summary Matrix");

    // ---------------- Sheet 3: Staff Payments Ledger ----------------
    const exportStaff = getConfiguredStaff();
    const exportStaffCats = getStaffCategorySet();
    const staffLabelFor = (category) => {
        const match = exportStaff.find(st => staffCategoryOf(st).toLowerCase() === String(category || '').trim().toLowerCase());
        if (!match) return category || "Staff";
        const role = match.role ? ` (${match.role})` : '';
        return `${staffDisplayName(match)}${role}`;
    };
    const staffRecords = sortedExpenses
        .filter(i => isStaffExpense(i, exportStaffCats))
        .map(item => {
            const d = new Date(item.date);
            return {
                "Payment Date": item.date,
                "Staff Member": staffLabelFor(item.category),
                "For Month": `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
                "Amount Paid (INR)": Number(item.amount),
                "Paid By": item.paidBy || "Not Specified",
                "Payment Method": item.paymentMethod || "UPI",
                "Remarks": item.notes || item.description || ""
            };
        });

    const sheet3 = XLSX.utils.json_to_sheet(staffRecords);
    XLSX.utils.book_append_sheet(workbook, sheet3, "Staff Payments Ledger");

    // ---------------- Sheet 4: Category Summary ----------------
    const categoryTotals = CATEGORIES.map(cat => {
        const catItems = dataToExport.filter(i => i.category === cat);
        const total = catItems.reduce((acc, i) => acc + Number(i.amount), 0);
        return {
            "Expense Category": cat,
            "Total Expenditure (INR)": total,
            "Total Transactions": catItems.length
        };
    });

    const sheet4 = XLSX.utils.json_to_sheet(categoryTotals);
    XLSX.utils.book_append_sheet(workbook, sheet4, "Category Summary");

    const cur = getCurrentPeriod();
    const filename = `HomeExpenses_${type === 'filtered' ? dashboardFilters.month + '_' + dashboardFilters.year : 'Complete_History'}_${cur.isoDate}.xlsx`;
    XLSX.writeFile(workbook, filename);
}

// Import Excel File
function importFromExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });

            let sheetName = workbook.SheetNames.find(s => s.includes("Daily") || s.includes("Log")) || workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const rawJson = XLSX.utils.sheet_to_json(worksheet);

            if (!rawJson || rawJson.length === 0) {
                alert("No expense records found in uploaded Excel file.");
                return;
            }

            const importedExpenses = [];
            const invalidPaidByValues = [];

            rawJson.forEach((row, idx) => {
                let rawDate = row["Date"] || row["date"];
                let dateStr = "";
                if (typeof rawDate === 'number' && typeof XLSX.SSF !== 'undefined') {
                    const parsed = XLSX.SSF.parse_date_code(rawDate);
                    dateStr = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
                } else if (rawDate) {
                    dateStr = String(rawDate).trim();
                } else {
                    dateStr = new Date().toISOString().split('T')[0];
                }

                const amount = parseFloat(row["Amount (INR)"] || row["Amount"] || row["amount"] || 0);
                const category = row["Expense Category"] || row["Category"] || row["category"] || "Shopping & Miscellaneous";
                const rawPaidBy = (row["Paid By"] || row["paidBy"] || "").trim();

                // Validate Paid By field
                let validatedPaidBy = "Not Specified";
                if (rawPaidBy) {
                    const match = FAMILY_MEMBERS.find(m => m.toLowerCase() === rawPaidBy.toLowerCase());
                    if (match) {
                        validatedPaidBy = match;
                    } else if (rawPaidBy.toLowerCase() === "not specified") {
                        validatedPaidBy = "Not Specified";
                    } else {
                        invalidPaidByValues.push(rawPaidBy);
                        validatedPaidBy = "Not Specified";
                    }
                }

                const paidTo = row["Paid To / Vendor"] || row["Paid To"] || row["paidTo"] || "";
                const paymentMethod = row["Payment Method"] || row["paymentMethod"] || "UPI";
                const notes = row["Notes / Description"] || row["Notes"] || row["notes"] || "";
                const billingCycle = row["Billing Cycle"] || row["billingCycle"] || null;
                const receiptStatus = row["Receipt Status"] || "No Receipt";

                if (amount > 0) {
                    importedExpenses.push({
                        id: row["ID"] || `exp-excel-${Date.now()}-${idx}`,
                        date: dateStr,
                        amount,
                        category,
                        paidBy: validatedPaidBy,
                        paidTo,
                        vendor: paidTo,
                        paymentMethod,
                        billingCycle,
                        notes,
                        description: notes,
                        receiptStatus
                    });
                }
            });

            if (invalidPaidByValues.length > 0) {
                const uniqueInvalid = Array.from(new Set(invalidPaidByValues));
                const supportedMembers = (window.masterConfig && window.masterConfig.familyMembers) || window.FAMILY_MEMBERS || ['Household Member'];
                alert(`Notice: Non-standard Paid By values detected: [${uniqueInvalid.join(', ')}]. Supported: ${supportedMembers.join(', ')}. These will be imported as 'Not Specified'.`);
            }

            if (importedExpenses.length > 0) {
                updateSyncBadge("Importing Excel Records...", "amber");
                const res = await fetch("/api/migrate", {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ records: importedExpenses })
                });
                const resData = await res.json();

                if (resData.success) {
                    await loadData();
                    alert(`Successfully imported Excel data! ${resData.summary.importedCount} new records saved directly to server JSON file.`);
                } else {
                    alert(`Import Failed: ${resData.error || "Server could not process records."}`);
                }
            } else {
                alert("Could not find valid expense records in the uploaded spreadsheet.");
            }
        } catch (err) {
            console.error("Failed to parse Excel file:", err);
            alert("Error parsing Excel file. Please ensure it is a valid .xlsx file.");
        }
    };

    reader.readAsArrayBuffer(file);
    event.target.value = "";
}

window.updateGlobalsFromConfig = function(config) {
    if (!config) return;
    if (config.categories && Array.isArray(config.categories)) {
        CATEGORIES = config.categories.map(c => c.name);
        window.CATEGORIES = CATEGORIES;
    }
    if (config.familyMembers && Array.isArray(config.familyMembers)) {
        FAMILY_MEMBERS = config.familyMembers;
        window.FAMILY_MEMBERS = FAMILY_MEMBERS;
    }
    if (config.monthlyBudgetLimit !== undefined) {
        monthlyBudgetLimit = Number(config.monthlyBudgetLimit) || 50000;
        window.monthlyBudgetLimit = monthlyBudgetLimit;
        const activeHId = (typeof getActiveHouseholdId === 'function') ? getActiveHouseholdId() : 'H001';
        try {
            localStorage.setItem(`household_budget_limit_${activeHId}`, String(monthlyBudgetLimit));
            localStorage.setItem('household_monthly_budget_limit', String(monthlyBudgetLimit));
        } catch (e) {}
    }

    // The dashboard view mode, and which sections exist at all, are household
    // settings - so they follow the config rather than a per-device toggle.
    applyDashboardModeFromConfig(false);
    renderDashboardModeControl();
};

// ============================================================
// YOUR PASSWORD (self-service, every role)
// ============================================================

// Show/hide toggle. Reveal is per-field and never sticky: leaving the tab or
// a successful save puts every field back to masked, so a password is not
// left legible on a screen someone walks away from.
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    if (btn) {
        btn.setAttribute('aria-pressed', String(reveal));
        btn.setAttribute('aria-label', (reveal ? 'Hide' : 'Show') + ' ' +
            (inputId === 'pwCurrent' ? 'current' : inputId === 'pwNew' ? 'new' : 'confirmation') + ' password');
        const icon = btn.querySelector('i');
        if (icon) icon.className = reveal ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

function resetPasswordFields() {
    ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.type = 'password'; }
        const err = document.getElementById(id + 'Error');
        if (err) { err.textContent = ''; err.classList.remove('is-visible'); }
    });
    document.querySelectorAll('.pw-eye').forEach(btn => {
        btn.setAttribute('aria-pressed', 'false');
        const icon = btn.querySelector('i');
        if (icon) icon.className = 'fa-solid fa-eye';
    });
}
window.resetPasswordFields = resetPasswordFields;

function setPasswordFieldError(fieldId, message) {
    const err = document.getElementById(fieldId + 'Error');
    if (!err) return;
    err.textContent = message || '';
    err.classList.toggle('is-visible', !!message);
}

function clearPasswordErrors() {
    ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => setPasswordFieldError(id, ''));
}

async function submitPasswordChange() {
    const btn = document.getElementById('btnChangePassword');
    const current = (document.getElementById('pwCurrent') || {}).value || '';
    const next = (document.getElementById('pwNew') || {}).value || '';
    const confirm = (document.getElementById('pwConfirm') || {}).value || '';

    clearPasswordErrors();

    // Check locally first so obvious mistakes never leave the device, then let
    // the server decide - it is the only side that can check the current one.
    let firstBad = null;
    if (!current) { setPasswordFieldError('pwCurrent', 'Enter your current password.'); firstBad = firstBad || 'pwCurrent'; }
    if (next.length < 8) { setPasswordFieldError('pwNew', 'At least 8 characters.'); firstBad = firstBad || 'pwNew'; }
    if (next && next === current) { setPasswordFieldError('pwNew', 'Choose a different password from the current one.'); firstBad = firstBad || 'pwNew'; }
    if (next !== confirm) { setPasswordFieldError('pwConfirm', 'The two new passwords do not match.'); firstBad = firstBad || 'pwConfirm'; }
    if (firstBad) {
        const el = document.getElementById(firstBad);
        if (el && el.focus) el.focus();
        return false;
    }

    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; }
    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken || localStorage.getItem('household_auth_token') || ''}`
            },
            body: JSON.stringify({
                action: 'change_password',
                currentPassword: current,
                newPassword: next,
                confirmPassword: confirm
            })
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok || !json.success) {
            // The server names the field it rejected, so the message lands next
            // to the box the owner has to fix.
            const field = json.field;
            const message = json.error || 'Could not update the password.';
            if (field === 'currentPassword') setPasswordFieldError('pwCurrent', message);
            else if (field === 'newPassword') setPasswordFieldError('pwNew', message);
            else if (field === 'confirmPassword') setPasswordFieldError('pwConfirm', message);
            else if (window.showToast) window.showToast('error', 'Password not changed', message);
            if (field && window.showToast) window.showToast('error', 'Password not changed', message);
            return false;
        }

        resetPasswordFields();
        if (window.showToast) {
            window.showToast('success', 'Password updated',
                'Use the new password next time you sign in. Sessions already open stay signed in until they expire.');
        }
        return true;
    } catch (err) {
        if (window.showToast) {
            window.showToast('error', 'Password not changed',
                'Could not reach the server. Your password is unchanged.');
        }
        return false;
    } finally {
        if (btn) { btn.disabled = false; delete btn.dataset.busy; }
    }
}
window.submitPasswordChange = submitPasswordChange;

// Name the account being changed, so an administrator who can also reset other
// people cannot mistake this card for one of them.
function renderPasswordCardIdentity() {
    const label = document.getElementById('pwAccountLabel');
    if (!label) return;
    const u = currentSessionUser;
    label.textContent = u && u.username ? `@${u.username}` : 'your account';
}
window.renderPasswordCardIdentity = renderPasswordCardIdentity;

// ============================================================
// ADMIN CONSOLE: MULTI-HOUSEHOLD & USER DIRECTORY ENGINE
// ============================================================
// The seeded system administrator has the role SYSTEM_ADMIN, but several UI
// checks tested only for 'ADMIN'. That hid the tenant-management card and its
// row actions from the one account allowed to use them. This mirrors what the
// server enforces on /api/auth?action=admin_overview.
function isAdminRole(role) {
    return role === 'ADMIN' || role === 'SYSTEM_ADMIN';
}
window.isAdminRole = isAdminRole;

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

let adminDirectoryData = { households: [], users: [], activeHouseholdId: '' };
window.adminDirectoryData = adminDirectoryData;

async function loadAdminConsoleData(showFeedback = false) {
    const card = syncAdminTenantCard();
    // Must match what /api/auth?action=admin_overview actually allows:
    // ADMIN or SYSTEM_ADMIN. This used to test for ADMIN or OWNER, which hid
    // the whole tenant-management card from SYSTEM_ADMIN - the one account that
    // can use it - while showing it to OWNER, who the server then refuses.
    const canManage = currentSessionUser &&
        (currentSessionUser.role === 'ADMIN' || currentSessionUser.role === 'SYSTEM_ADMIN');
    if (!authToken || !canManage) {
        if (card) card.classList.add("hidden");
        return;
    }
    if (card) card.classList.remove("hidden");

    try {
        const res = await fetch('/api/auth?action=admin_overview', {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!res.ok) {
            if (card) card.classList.add("hidden");
            return;
        }

        const data = await res.json();
        if (data.success) {
            adminDirectoryData = data;
            // A top-level `let` is not a property of window, so anything
            // outside this file - including the audit - could not see it.
            window.adminDirectoryData = adminDirectoryData;
            renderAdminDirectoryUI();
            if (showFeedback && typeof showToast === 'function') {
                showToast('success', 'Directory Refreshed', `Loaded ${data.households.length} household(s) and ${data.users.length} user(s).`);
            }
        }
    } catch (err) {
        console.warn("Failed to load admin directory:", err);
    }
}
window.loadAdminConsoleData = loadAdminConsoleData;

function renderAdminDirectoryUI() {
    const households = adminDirectoryData.households || [];
    const users = adminDirectoryData.users || [];
    const activeHId = currentSessionUser?.householdId || 'H001';
    const userRole = currentSessionUser?.role || 'MEMBER';

    // 1. Role Badge & Active Household Display
    const roleBadge = document.getElementById("adminRoleBadge");
    if (roleBadge) {
        roleBadge.textContent = isAdminRole(userRole) ? "SYSTEM ADMINISTRATOR" : "HOUSEHOLD OWNER";
        roleBadge.className = isAdminRole(userRole)
            ? "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200"
            : "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200";
    }

    const activeDisplay = document.getElementById("adminActiveHouseholdDisplay");
    const activeH = households.find(h => h.householdId === activeHId);
    if (activeDisplay) {
        activeDisplay.textContent = activeH ? `${activeH.householdName} (${activeH.householdId})` : `${currentSessionUser?.householdName || activeHId} (${activeHId})`;
    }

    // 2. Household Switcher Dropdown (Only switchable for ADMIN or members of multiple households)
    const switchSelect = document.getElementById("adminHouseholdQuickSwitch");
    const switcherBar = document.getElementById("adminHouseholdSwitcherBar");
    if (switchSelect) {
        switchSelect.innerHTML = households.map(h => 
            `<option value="${h.householdId}" ${h.householdId === activeHId ? 'selected' : ''}>${escapeHtml(h.householdName)} (${h.householdId})</option>`
        ).join('');

        if (userRole !== 'ADMIN' && households.length <= 1) {
            if (switcherBar) switcherBar.classList.add("hidden");
        } else {
            if (switcherBar) switcherBar.classList.remove("hidden");
        }
    }

    // 3. Populate Household Dropdown in Create User Modal
    const userModalHSelect = document.getElementById("createUserHouseholdSelect");
    if (userModalHSelect) {
        const selectableHouseholds = isAdminRole(userRole) ? households : households.filter(h => h.householdId === activeHId);
        userModalHSelect.innerHTML = selectableHouseholds.map(h =>
            `<option value="${h.householdId}" ${h.householdId === activeHId ? 'selected' : ''}>${escapeHtml(h.householdName)} (${h.householdId})</option>`
        ).join('');
    }

    // 4. Update Counts
    const hCountBadge = document.getElementById("adminHouseholdCountBadge");
    if (hCountBadge) hCountBadge.textContent = `${households.length} Total`;

    const uCountBadge = document.getElementById("adminUserCountBadge");
    if (uCountBadge) uCountBadge.textContent = `${users.length} Total`;

    // 5. Render Households Table
    const hTableBody = document.getElementById("adminHouseholdsTableBody");
    if (hTableBody) {
        if (households.length === 0) {
            hTableBody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-400 text-xs">No households registered.</td></tr>`;
        } else {
            hTableBody.innerHTML = households.map(h => {
                const isActive = h.householdId === activeHId;
                return `
                <tr class="hover:bg-slate-50 transition ${isActive ? 'bg-indigo-50/50' : ''}">
                    <td class="py-2.5 px-2.5">
                        <span class="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">${h.householdId}</span>
                    </td>
                    <td class="py-2.5 px-2.5">
                        <div class="font-black text-slate-900 flex items-center space-x-1.5">
                            <span>${escapeHtml(h.householdName)}</span>
                            ${isActive ? '<span class="text-[9px] font-black uppercase px-1.5 py-0.2 rounded-full bg-indigo-600 text-white">Active</span>' : ''}
                        </div>
                    </td>
                    <td class="py-2.5 px-2.5 text-center">
                        <span class="text-xs font-bold text-slate-600">${h.memberCount || 1}</span>
                    </td>
                    <td class="py-2.5 px-2.5 text-right">
                        <div class="flex items-center justify-end gap-1.5">
                            ${!isActive && isAdminRole(userRole) ? `
                                <button onclick="switchActiveHousehold(${escapeHtml(JSON.stringify(h.householdId))})" class="px-2 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-[11px] font-black rounded-lg transition" title="Switch active workspace to this household" aria-label="Switch active workspace to this household">
                                    Switch
                                </button>
                            ` : ''}
                            ${isActive ? `
                                <span class="text-[11px] font-bold text-emerald-600 mr-1 hidden sm:inline-flex items-center gap-1">
                                    <svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg> Current
                                </span>
                            ` : ''}
                            ${isAdminRole(userRole) || (userRole === 'OWNER' && isActive) ? `
                                <button onclick="openEditHouseholdModal(${escapeHtml(JSON.stringify(h.householdId))})" class="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="Edit Household Details" aria-label="Edit this household">
                                    <svg class="ic text-xs" aria-hidden="true"><use href="#i-square-pen"></use></svg>
                                </button>
                            ` : ''}
                            ${isAdminRole(userRole) && h.householdId !== 'H001' ? `
                                <button onclick="confirmDeleteHousehold(${escapeHtml(JSON.stringify(h.householdId))}, ${escapeHtml(JSON.stringify(h.householdName))})" class="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Delete Household" aria-label="Delete this household">
                                    <svg class="ic text-xs" aria-hidden="true"><use href="#i-trash-2"></use></svg>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
                `;
            }).join('');
        }
    }

    // 6. Render Users Table
    const uTableBody = document.getElementById("adminUsersTableBody");
    if (uTableBody) {
        if (users.length === 0) {
            uTableBody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400 text-xs">No users registered.</td></tr>`;
        } else {
            uTableBody.innerHTML = users.map(u => {
                const isCurrent = currentSessionUser && currentSessionUser.userId === u.userId;
                const canEditUser = isAdminRole(userRole) || (userRole === 'OWNER' && u.householdId === activeHId);
                const canDeleteUser = (isAdminRole(userRole) || (userRole === 'OWNER' && u.householdId === activeHId)) && u.userId !== 'U000' && u.userId !== 'U001' && (!currentSessionUser || u.userId !== currentSessionUser.userId) && (isAdminRole(userRole) || u.role !== 'OWNER');
                const roleBadgeClass = u.role === 'ADMIN' 
                    ? 'bg-purple-100 text-purple-800 border-purple-200'
                    : (u.role === 'OWNER' 
                        ? 'bg-indigo-100 text-indigo-800 border-indigo-200' 
                        : 'bg-slate-100 text-slate-700 border-slate-200');
                return `
                <tr class="hover:bg-slate-50 transition ${isCurrent ? 'bg-emerald-50/40' : ''}">
                    <td class="py-2 px-2.5">
                        <div class="flex items-center space-x-2">
                            <div class="w-6 h-6 rounded-md bg-slate-200 text-slate-700 font-black text-[10px] flex items-center justify-center shrink-0">
                                ${escapeHtml((u.name || u.username).charAt(0).toUpperCase())}
                            </div>
                            <div>
                                <span class="font-bold text-slate-900 block truncate max-w-[100px] sm:max-w-[120px]">${escapeHtml(u.name)}</span>
                                <span class="text-[10px] text-slate-400 font-semibold block">@${escapeHtml(u.username)}</span>
                            </div>
                        </div>
                    </td>
                    <td class="py-2 px-2.5">
                        <span class="text-[11px] font-medium text-slate-600 block truncate max-w-[110px]">${escapeHtml(u.householdName || u.householdId)}</span>
                    </td>
                    <td class="py-2 px-2.5 text-center">
                        <span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${roleBadgeClass}">${escapeHtml(u.role)}</span>
                    </td>
                    <td class="py-2 px-2.5 text-center">
                        <span class="text-[10px] font-bold ${u.status === 'disabled' ? 'text-rose-500' : 'text-emerald-600'}">${u.status === 'disabled' ? 'Disabled' : 'Active'}</span>
                    </td>
                    <td class="py-2 px-2.5 text-right">
                        <div class="flex items-center justify-end gap-1.5">
                            ${canEditUser ? `
                                <button onclick="openEditUserModal(${escapeHtml(JSON.stringify(u.userId))})" class="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Edit User & Permissions" aria-label="Edit this user">
                                    <svg class="ic text-xs" aria-hidden="true"><use href="#i-user-pen"></use></svg>
                                </button>
                            ` : ''}
                            ${canDeleteUser ? `
                                <button onclick="confirmDeleteUser(${escapeHtml(JSON.stringify(u.userId))}, ${escapeHtml(JSON.stringify(u.username))})" class="p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Delete User Account" aria-label="Delete this user">
                                    <svg class="ic text-xs" aria-hidden="true"><use href="#i-trash-2"></use></svg>
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
                `;
            }).join('');
        }
    }
}
window.renderAdminDirectoryUI = renderAdminDirectoryUI;

function openCreateHouseholdModal() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const modal = document.getElementById("modalCreateHousehold");
    const err = document.getElementById("createHouseholdError");
    if (err) err.classList.add("hidden");
    const nameInput = document.getElementById("createHouseholdName");
    if (nameInput) nameInput.value = "";
    if (modal) {
        modal.classList.remove("hidden");
        if (nameInput) setTimeout(() => nameInput.focus(), 100);
    }
}
window.openCreateHouseholdModal = openCreateHouseholdModal;

function closeCreateHouseholdModal() {
    const modal = document.getElementById("modalCreateHousehold");
    if (modal) modal.classList.add("hidden");
}
window.closeCreateHouseholdModal = closeCreateHouseholdModal;

async function submitCreateHousehold() {
    const nameInput = document.getElementById("createHouseholdName");
    const budgetInput = document.getElementById("createHouseholdBudget");
    const errEl = document.getElementById("createHouseholdError");
    const btn = document.getElementById("btnSubmitCreateHousehold");

    const householdName = (nameInput?.value || '').trim();
    const rawBudget = (budgetInput?.value || '').trim();

    if (!householdName || householdName.length < 2) {
        if (errEl) {
            errEl.textContent = "Please provide a valid household name (at least 2 characters).";
            errEl.classList.remove("hidden");
        }
        return;
    }

    // Blank falls back to the documented default; a typed value must be real
    // rather than quietly replaced by 50000.
    let initialBudget = 50000;
    if (rawBudget !== '') {
        initialBudget = Number(rawBudget);
        if (!Number.isFinite(initialBudget) || initialBudget < 0) {
            if (errEl) {
                errEl.textContent = "Enter a starting budget of 0 or more, or leave it blank for the default.";
                errEl.classList.remove("hidden");
            }
            return;
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="ic animate-spin mr-1" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Creating...`;
    }

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'create_household',
                householdName: householdName,
                initialBudget: initialBudget
            })
        });
        const result = await res.json();
        if (result.success) {
            closeCreateHouseholdModal();
            if (typeof showToast === 'function') {
                showToast('success', 'Household Created', result.message || `Household '${householdName}' created successfully.`);
            }
            await loadAdminConsoleData();
        } else {
            if (errEl) {
                errEl.textContent = result.error || "Failed to create household.";
                errEl.classList.remove("hidden");
            }
        }
    } catch (e) {
        if (errEl) {
            errEl.textContent = "Network error creating household.";
            errEl.classList.remove("hidden");
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-plus"></use></svg> <span>Create Household</span>`;
        }
    }
}
window.submitCreateHousehold = submitCreateHousehold;

function openCreateUserModal() {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const modal = document.getElementById("modalCreateUser");
    const err = document.getElementById("createUserError");
    if (err) err.classList.add("hidden");
    const nameInput = document.getElementById("createUserName");
    const uInput = document.getElementById("createUserUsername");
    const pInput = document.getElementById("createUserPassword");
    const eInput = document.getElementById("createUserEmail");
    if (nameInput) nameInput.value = "";
    if (uInput) uInput.value = "";
    if (pInput) pInput.value = "";
    if (eInput) eInput.value = "";
    if (modal) {
        modal.classList.remove("hidden");
        if (nameInput) setTimeout(() => nameInput.focus(), 100);
    }
}
window.openCreateUserModal = openCreateUserModal;

function closeCreateUserModal() {
    const modal = document.getElementById("modalCreateUser");
    if (modal) modal.classList.add("hidden");
}
window.closeCreateUserModal = closeCreateUserModal;

async function submitCreateUser() {
    const nameInput = document.getElementById("createUserName");
    const uInput = document.getElementById("createUserUsername");
    const pInput = document.getElementById("createUserPassword");
    const eInput = document.getElementById("createUserEmail");
    const hSelect = document.getElementById("createUserHouseholdSelect");
    const rSelect = document.getElementById("createUserRoleSelect");
    const errEl = document.getElementById("createUserError");
    const btn = document.getElementById("btnSubmitCreateUser");

    const name = (nameInput?.value || '').trim();
    const username = (uInput?.value || '').trim().toLowerCase();
    const password = (pInput?.value || '').trim();
    const email = (eInput?.value || '').trim().toLowerCase();
    const householdId = hSelect?.value;
    const role = rSelect?.value || 'MEMBER';

    if (!name || !username || !password || !householdId) {
        if (errEl) {
            errEl.textContent = "Please fill in all required fields.";
            errEl.classList.remove("hidden");
        }
        return;
    }

    if (password.length < 6) {
        if (errEl) {
            errEl.textContent = "Password must be at least 6 characters long.";
            errEl.classList.remove("hidden");
        }
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="ic animate-spin mr-1" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Creating User...`;
    }

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'create_user',
                name,
                username,
                password,
                email: email || `${username}@homeexpenses.local`,
                householdId,
                role
            })
        });
        const result = await res.json();
        if (result.success) {
            closeCreateUserModal();
            if (typeof showToast === 'function') {
                showToast('success', 'User Account Created', `User @${username} created with initial password.`);
            }
            await loadAdminConsoleData();
        } else {
            if (errEl) {
                errEl.textContent = result.error || "Failed to create user.";
                errEl.classList.remove("hidden");
            }
        }
    } catch (e) {
        if (errEl) {
            errEl.textContent = "Network error creating user.";
            errEl.classList.remove("hidden");
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-user-plus"></use></svg> <span>Create User</span>`;
        }
    }
}
window.submitCreateUser = submitCreateUser;

async function onAdminSelectHouseholdSwitch(targetHId) {
    if (!targetHId || targetHId === currentSessionUser?.householdId) return;
    await switchActiveHousehold(targetHId);
}
window.onAdminSelectHouseholdSwitch = onAdminSelectHouseholdSwitch;

async function switchActiveHousehold(targetHId) {
    if (!targetHId) return;
    if (typeof triggerHaptic === 'function') triggerHaptic('medium');

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'switch_household',
                householdId: targetHId
            })
        });
        const result = await res.json();
        if (result.success && result.token) {
            authToken = result.token;
            currentSessionUser = result.user;
            localStorage.setItem("household_auth_token", authToken);
            localStorage.setItem("household_session_user", JSON.stringify(currentSessionUser));

            // Reset expenses array to guarantee clean isolation
            expenses = [];
            window.expenses = [];
            window.expensesData = [];

            updateUserProfileUI();
            await loadData();
            if (window.loadMasterConfig) await window.loadMasterConfig();
            if (window.renderAdminView) window.renderAdminView();
            await loadAdminConsoleData();
            if (typeof showToast === 'function') {
                showToast('info', 'Workspace Switched', `Active Household: ${result.user.householdName}`);
            }
            if (window.syncPushSubscriptionSilently) window.syncPushSubscriptionSilently();
        } else {
            alert(`Unable to switch household: ${result.error || 'Access denied'}`);
        }
    } catch (e) {
        console.error("Error switching household:", e);
    }
}
window.switchActiveHousehold = switchActiveHousehold;

// ==========================================
// EDIT & DELETE HOUSEHOLD HANDLERS
// ==========================================
async function openEditHouseholdModal(householdId) {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');

    let h = adminDirectoryData.households.find(x => x.householdId === householdId);
    if (!h) {
        // The directory can be stale straight after a household is created.
        // Refreshing beats returning silently, which looked like a dead button.
        try {
            await loadAdminConsoleData();
            h = adminDirectoryData.households.find(x => x.householdId === householdId);
        } catch (e) { /* fall through to the message below */ }
    }
    if (!h) {
        if (typeof showToast === 'function') {
            showToast('error', 'Household not found',
                'Could not load that household. Refresh and try again.');
        }
        return;
    }

    const modal = document.getElementById("modalEditHousehold");
    const err = document.getElementById("editHouseholdError");
    if (err) err.classList.add("hidden");

    document.getElementById("editHouseholdId").value = h.householdId;
    document.getElementById("editHouseholdIdBadge").textContent = h.householdId;
    document.getElementById("editHouseholdName").value = h.householdName;
    document.getElementById("editHouseholdStatus").value = h.status || 'active';

    // Load the budget of the household being edited, not of whichever household
    // happens to be active. Saving sends this value to the target household, so
    // pre-filling it from window.masterConfig meant renaming household B quietly
    // overwrote B's budget with A's.
    const budgetInput = document.getElementById("editHouseholdBudget");
    if (budgetInput) {
        budgetInput.value = '';
        budgetInput.disabled = true;
        try {
            const res = await fetch(
                `/api/config?householdId=${encodeURIComponent(h.householdId)}&_t=${Date.now()}`,
                { headers: getAuthHeaders(), cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const cfg = json.data || json.config || {};
            if (cfg.monthlyBudgetLimit === undefined || cfg.monthlyBudgetLimit === null) {
                throw new Error('no budget on the household config');
            }
            budgetInput.value = cfg.monthlyBudgetLimit;
        } catch (e) {
            // Better to show the field empty and say so than to prefill a number
            // from somewhere else that Save would then write to this household.
            budgetInput.value = '';
            if (err) {
                err.textContent =
                    "Could not load this household's current budget. " +
                    "Leave the field blank to keep it unchanged.";
                err.classList.remove("hidden");
            }
        } finally {
            budgetInput.disabled = false;
        }
    }

    if (modal) modal.classList.remove("hidden");
}
window.openEditHouseholdModal = openEditHouseholdModal;

function closeEditHouseholdModal() {
    const modal = document.getElementById("modalEditHousehold");
    if (modal) modal.classList.add("hidden");
}
window.closeEditHouseholdModal = closeEditHouseholdModal;

async function submitEditHousehold() {
    const householdId = document.getElementById("editHouseholdId")?.value;
    const householdName = (document.getElementById("editHouseholdName")?.value || '').trim();
    const rawBudget = (document.getElementById("editHouseholdBudget")?.value || '').trim();
    const status = document.getElementById("editHouseholdStatus")?.value || 'active';
    const errEl = document.getElementById("editHouseholdError");
    const btn = document.getElementById("btnSubmitEditHousehold");

    if (!householdName || householdName.length < 2) {
        if (errEl) {
            errEl.textContent = "Please provide a valid household name.";
            errEl.classList.remove("hidden");
        }
        return;
    }

    // A blank budget means "leave it alone", not "set it to 50000". A value
    // that is present must be a real number - never silently substituted.
    let monthlyBudgetLimit;
    if (rawBudget !== '') {
        monthlyBudgetLimit = Number(rawBudget);
        if (!Number.isFinite(monthlyBudgetLimit) || monthlyBudgetLimit < 0) {
            if (errEl) {
                errEl.textContent = "Enter a monthly budget of 0 or more, or leave it blank to keep the current one.";
                errEl.classList.remove("hidden");
            }
            return;
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="ic animate-spin mr-1" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Saving...`;
    }

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'edit_household',
                householdId,
                householdName,
                // omitted entirely when left blank, so the server keeps the
                // household's existing budget
                ...(monthlyBudgetLimit === undefined ? {} : { monthlyBudgetLimit }),
                status
            })
        });
        const result = await res.json();
        if (result.success) {
            closeEditHouseholdModal();
            if (typeof showToast === 'function') {
                showToast('success', 'Household Updated', result.message || 'Household details saved successfully.');
            }
            if (currentSessionUser && currentSessionUser.householdId === householdId) {
                currentSessionUser.householdName = householdName;
                localStorage.setItem("household_session_user", JSON.stringify(currentSessionUser));
                updateUserProfileUI();
            }
            await loadAdminConsoleData();
        } else {
            if (errEl) {
                errEl.textContent = result.error || "Failed to update household.";
                errEl.classList.remove("hidden");
            }
        }
    } catch (e) {
        if (errEl) {
            errEl.textContent = "Network error updating household.";
            errEl.classList.remove("hidden");
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-save"></use></svg> <span>Save Changes</span>`;
        }
    }
}
window.submitEditHousehold = submitEditHousehold;

async function confirmDeleteHousehold(householdId, householdName) {
    if (householdId === 'H001') {
        alert('Action Forbidden: Primary household H001 is protected and cannot be deleted.');
        return;
    }

    const confirmed = confirm(`Are you sure you want to delete household "${householdName}" (${householdId})?\n\nAny users assigned to this household will be safely reassigned to the primary household.`);
    if (!confirmed) return;

    if (typeof triggerHaptic === 'function') triggerHaptic('heavy');

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'delete_household',
                householdId
            })
        });
        const result = await res.json();
        if (result.success) {
            if (typeof showToast === 'function') {
                showToast('success', 'Household Deleted', result.message || `Household '${householdName}' deleted.`);
            }
            if (currentSessionUser && currentSessionUser.householdId === householdId) {
                await switchActiveHousehold('H001');
            } else {
                await loadAdminConsoleData();
            }
        } else {
            alert(`Delete failed: ${result.error || 'Server error'}`);
        }
    } catch (e) {
        alert('Network error while deleting household.');
    }
}
window.confirmDeleteHousehold = confirmDeleteHousehold;

// ==========================================
// EDIT & DELETE USER HANDLERS
// ==========================================
// ============================================================================
// PER-USER PERMISSION EDITOR
// ----------------------------------------------------------------------------
// The role select above assigns defaults. This editor pins an explicit list on
// one person; the API treats that list as authoritative, so what is ticked here
// is exactly what the endpoints will allow. The catalogue, the presets and the
// role defaults all arrive from /api/auth with the admin overview, from the
// same registry the server enforces - nothing here re-states the rules.
// ============================================================================

// Human wording and grouping for the permission codes. Presentation only: a
// code with no entry here is shown as itself rather than hidden, so a
// permission added on the server can never silently disappear from this list.
const PERMISSION_LABELS = {
    'dashboard.view':   ['Dashboard', 'See the dashboard'],
    'expense.view':     ['Expenses', 'See expenses'],
    'expense.create':   ['Expenses', 'Add expenses'],
    'expense.edit':     ['Expenses', 'Edit expenses'],
    'expense.delete':   ['Expenses', 'Delete expenses'],
    'bill.view':        ['Bills', 'See recurring bills'],
    'bill.manage':      ['Bills', 'Add and edit recurring bills'],
    'personal.view':    ['Reports', 'See personal spending'],
    'reports.view':     ['Reports', 'See reports'],
    'matrix.view':      ['Reports', 'See the spending matrix'],
    'settlement.view':  ['Reports', 'See who owes whom'],
    'staff.view':       ['Staff', 'See staff'],
    'attendance.manage':['Staff', 'Record attendance and leave'],
    'payroll.view':     ['Staff', 'See payroll figures'],
    'excel.import':     ['Data', 'Import from Excel'],
    'excel.export':     ['Data', 'Export to Excel'],
    'backup.manage':    ['Data', 'Create backups'],
    'restore.manage':   ['Data', 'Restore from a backup'],
    'audit.view':       ['Administration', 'Read the audit trail'],
    'users.view':       ['Administration', 'See the user list'],
    'users.manage':     ['Administration', 'Add, edit and remove users'],
    'household.view':   ['Administration', 'See household details'],
    'household.manage': ['Administration', 'Add, edit and remove households'],
    'settings.view':    ['Administration', 'See master settings'],
    'settings.manage':  ['Administration', 'Change master settings']
};

const PERMISSION_GROUP_ORDER = [
    'Dashboard', 'Expenses', 'Bills', 'Reports', 'Staff', 'Data', 'Administration'
];

function permissionCatalog() {
    const c = adminDirectoryData && adminDirectoryData.permissionCatalog;
    return Array.isArray(c) ? c : [];
}

function rolePermissionDefaults(role) {
    const map = (adminDirectoryData && adminDirectoryData.rolePermissions) || {};
    return map[String(role || '').toUpperCase()] || [];
}

// What the signed-in administrator holds. A box for something they do not hold
// is disabled rather than hidden, so the limit is visible instead of mysterious
// - and the API refuses it regardless, because UI hiding is not security.
function grantablePermissions() {
    const mine = (adminDirectoryData && adminDirectoryData.myPermissions);
    return Array.isArray(mine) ? mine : currentPermissions();
}

function renderUserPermissionEditor(user) {
    const grid = document.getElementById('editUserPermissionGrid');
    const presetWrap = document.getElementById('editUserPermissionPresets');
    if (!grid) return;

    const catalog = permissionCatalog();
    if (!catalog.length) {
        grid.innerHTML = '<p class="text-xs text-slate-400 font-medium">' +
            'Permission catalogue unavailable. Reload the admin console to edit individual permissions.</p>';
        if (presetWrap) presetWrap.innerHTML = '';
        return;
    }

    const held = new Set(Array.isArray(user.permissions) ? user.permissions : []);
    const grantable = new Set(grantablePermissions());

    const groups = {};
    catalog.forEach(code => {
        const meta = PERMISSION_LABELS[code] || ['Other', code];
        (groups[meta[0]] = groups[meta[0]] || []).push([code, meta[1]]);
    });

    const order = PERMISSION_GROUP_ORDER
        .filter(g => groups[g])
        .concat(Object.keys(groups).filter(g => PERMISSION_GROUP_ORDER.indexOf(g) === -1));

    grid.innerHTML = order.map(group => `
        <fieldset class="space-y-1">
            <legend class="text-xs font-bold text-slate-400 uppercase tracking-wider">${escapeHtml(group)}</legend>
            ${groups[group].map(([code, label]) => {
                const allowed = grantable.has(code);
                return `
                <label class="flex items-start gap-2 py-1.5 min-h-[44px] sm:min-h-0 cursor-pointer ${allowed ? '' : 'opacity-50 cursor-not-allowed'}">
                    <input type="checkbox" class="user-perm-box mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                           value="${escapeHtml(code)}"
                           ${held.has(code) ? 'checked' : ''}
                           ${allowed ? '' : 'disabled'}
                           onchange="markUserPermissionsTouched()">
                    <span class="min-w-0">
                        <span class="block text-xs font-semibold text-slate-800">${escapeHtml(label)}</span>
                        <span class="block text-xs font-mono text-slate-400">${escapeHtml(code)}</span>
                    </span>
                </label>`;
            }).join('')}
        </fieldset>
    `).join('');

    const presets = (adminDirectoryData && adminDirectoryData.permissionPresets) || {};
    if (presetWrap) {
        presetWrap.innerHTML = Object.keys(presets).map(key => {
            const pr = presets[key];
            return `<button type="button" onclick="applyPermissionPreset(${escapeHtml(JSON.stringify(key))})"
                        title="${escapeHtml(pr.description || '')}"
                        aria-label="${escapeHtml(pr.label || key)}: ${escapeHtml(pr.description || '')}"
                        class="px-2.5 py-1.5 min-h-[44px] sm:min-h-0 sm:py-1 bg-white border border-slate-300 hover:border-emerald-400 hover:bg-emerald-50 text-slate-700 rounded-lg text-xs font-semibold transition">
                        ${escapeHtml(pr.label || key)}
                    </button>`;
        }).join('');
    }

    updateUserPermissionSummary();
}

// Whether the administrator has touched the permission boxes during this edit.
// Without this, opening the editor and saving would pin whatever happened to be
// displayed, turning every role change into a permanent override.
let userPermissionsTouched = false;

function markUserPermissionsTouched() {
    userPermissionsTouched = true;
    updateUserPermissionSummary();
}
window.markUserPermissionsTouched = markUserPermissionsTouched;

function collectUserPermissions() {
    return Array.from(document.querySelectorAll('.user-perm-box:checked'))
        .map(b => b.value);
}

function updateUserPermissionSummary() {
    const el = document.getElementById('editUserPermissionSummary');
    if (!el) return;
    const chosen = collectUserPermissions();
    const total = document.querySelectorAll('.user-perm-box').length;
    const role = (document.getElementById('editUserRoleSelect') || {}).value || '';
    const defaults = rolePermissionDefaults(role);
    const sameAsRole = chosen.length === defaults.length
        && chosen.every(p => defaults.indexOf(p) !== -1);
    el.textContent = (!userPermissionsTouched || chosen.length === 0 || sameAsRole)
        ? 'role defaults'
        : chosen.length + ' of ' + total;
}
window.updateUserPermissionSummary = updateUserPermissionSummary;

function toggleUserPermissionEditor() {
    const body = document.getElementById('editUserPermissionsBody');
    const btn = document.getElementById('btnToggleUserPermissions');
    const chevron = document.getElementById('editUserPermissionChevron');
    if (!body) return;
    const open = body.classList.toggle('hidden') === false;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (chevron) chevron.classList.toggle('rotate-180', open);
}
window.toggleUserPermissionEditor = toggleUserPermissionEditor;

function setUserPermissionBoxes(codes, touched) {
    const wanted = new Set(codes || []);
    document.querySelectorAll('.user-perm-box').forEach(box => {
        if (box.disabled) return;      // cannot grant what the admin lacks
        box.checked = wanted.has(box.value);
    });
    if (touched === false) {
        updateUserPermissionSummary();
    } else {
        markUserPermissionsTouched();
    }
}

function setAllUserPermissions(on) {
    document.querySelectorAll('.user-perm-box').forEach(box => {
        if (box.disabled) return;
        box.checked = !!on;
    });
    markUserPermissionsTouched();
}
window.setAllUserPermissions = setAllUserPermissions;

function applyPermissionPreset(key) {
    const presets = (adminDirectoryData && adminDirectoryData.permissionPresets) || {};
    const preset = presets[key];
    if (!preset) return;
    setUserPermissionBoxes(preset.permissions || []);
}
window.applyPermissionPreset = applyPermissionPreset;

// Clearing every box is how the override is removed; the save sends an empty
// list and the server deletes the stored field.
function resetUserPermissionsToRole() {
    setAllUserPermissions(false);
    if (window.showToast) {
        window.showToast('info', 'Role defaults',
            'Saving now removes the individual overrides for this user.');
    }
}
window.resetUserPermissionsToRole = resetUserPermissionsToRole;

function openEditUserModal(userId) {
    if (typeof triggerHaptic === 'function') triggerHaptic('light');
    const u = adminDirectoryData.users.find(x => x.userId === userId);
    if (!u) return;

    const modal = document.getElementById("modalEditUser");
    const err = document.getElementById("editUserError");
    if (err) err.classList.add("hidden");

    document.getElementById("editUserId").value = u.userId;
    document.getElementById("editUserIdBadge").textContent = u.userId;
    document.getElementById("editUserName").value = u.name;
    document.getElementById("editUserUsername").value = u.username;
    document.getElementById("editUserEmail").value = u.email || '';
    document.getElementById("editUserPassword").value = '';

    const hSelect = document.getElementById("editUserHouseholdSelect");
    const userRole = currentSessionUser?.role || 'MEMBER';
    if (hSelect) {
        const households = adminDirectoryData.households || [];
        const selectableHouseholds = isAdminRole(userRole) ? households : households.filter(h => h.householdId === currentSessionUser.householdId);
        hSelect.innerHTML = selectableHouseholds.map(h =>
            `<option value="${h.householdId}" ${h.householdId === u.householdId ? 'selected' : ''}>${escapeHtml(h.householdName)} (${h.householdId})</option>`
        ).join('');
    }

    const rSelect = document.getElementById("editUserRoleSelect");
    if (rSelect) {
        rSelect.value = u.role || 'MEMBER';
        rSelect.disabled = (u.userId === 'U000');
        // Picking a different role shows that role's defaults straight away, so
        // the boxes never contradict the role sitting above them.
        rSelect.onchange = function () {
            if (userPermissionsTouched) return;   // the admin's own choices win
            setUserPermissionBoxes(rolePermissionDefaults(rSelect.value), false);
        };
    }

    const sSelect = document.getElementById("editUserStatusSelect");
    if (sSelect) {
        sSelect.value = u.status || 'active';
        sSelect.disabled = (u.userId === 'U000');
    }

    userPermissionsTouched = false;
    renderUserPermissionEditor(u);
    // Collapsed by default: most edits are a name or a role, and 25 checkboxes
    // in front of them would make the common case the awkward one.
    const permBody = document.getElementById("editUserPermissionsBody");
    if (permBody) permBody.classList.add("hidden");
    const permBtn = document.getElementById("btnToggleUserPermissions");
    if (permBtn) permBtn.setAttribute("aria-expanded", "false");

    if (modal) modal.classList.remove("hidden");
}
window.openEditUserModal = openEditUserModal;

function closeEditUserModal() {
    const modal = document.getElementById("modalEditUser");
    if (modal) modal.classList.add("hidden");
}
window.closeEditUserModal = closeEditUserModal;

async function submitEditUser() {
    const userId = document.getElementById("editUserId")?.value;
    const name = (document.getElementById("editUserName")?.value || '').trim();
    const username = (document.getElementById("editUserUsername")?.value || '').trim().toLowerCase();
    const email = (document.getElementById("editUserEmail")?.value || '').trim().toLowerCase();
    const householdId = document.getElementById("editUserHouseholdSelect")?.value;
    const role = document.getElementById("editUserRoleSelect")?.value;
    const status = document.getElementById("editUserStatusSelect")?.value || 'active';
    const password = (document.getElementById("editUserPassword")?.value || '').trim();
    const errEl = document.getElementById("editUserError");
    const btn = document.getElementById("btnSubmitEditUser");

    if (!name || !username || !householdId) {
        if (errEl) {
            errEl.textContent = "Full name, username, and household are required.";
            errEl.classList.remove("hidden");
        }
        return;
    }

    if (password && password.length < 6) {
        if (errEl) {
            errEl.textContent = "New password must be at least 6 characters long.";
            errEl.classList.remove("hidden");
        }
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<svg class="ic animate-spin mr-1" aria-hidden="true"><use href="#i-loader-circle"></use></svg> Saving...`;
    }

    try {
        const payload = {
            action: 'edit_user',
            userId,
            name,
            username,
            email,
            householdId,
            role,
            status
        };
        // Sent only when the boxes were actually touched. Sending them every
        // time pinned whatever was on screen as an override, which quietly
        // cancelled role changes. When they were touched, an empty list is
        // meaningful - it tells the server to drop the override.
        if (userPermissionsTouched) {
            payload.permissions = collectUserPermissions();
        }
        if (password) payload.password = password;

        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
            closeEditUserModal();
            if (typeof showToast === 'function') {
                showToast('success', 'User Updated', result.message || `User @${username} updated successfully.`);
            }
            if (currentSessionUser && currentSessionUser.userId === userId) {
                currentSessionUser = {
                    ...currentSessionUser,
                    ...result.user
                };
                localStorage.setItem("household_session_user", JSON.stringify(currentSessionUser));
                updateUserProfileUI();
            }
            await loadAdminConsoleData();
        } else {
            if (errEl) {
                errEl.textContent = result.error || "Failed to update user.";
                errEl.classList.remove("hidden");
            }
        }
    } catch (e) {
        if (errEl) {
            errEl.textContent = "Network error updating user.";
            errEl.classList.remove("hidden");
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#i-save"></use></svg> <span>Save Changes</span>`;
        }
    }
}
window.submitEditUser = submitEditUser;

async function confirmDeleteUser(userId, username) {
    if (userId === 'U000' || userId === 'U001') {
        alert('Action Forbidden: System Administrator and Primary Owner accounts are protected and cannot be deleted.');
        return;
    }
    if (currentSessionUser && currentSessionUser.userId === userId) {
        alert('Action Forbidden: You cannot delete your own active account.');
        return;
    }

    const confirmed = confirm(`Are you sure you want to delete user @${username} (${userId})?\n\nThis will permanently delete this user account and revoke their access.`);
    if (!confirmed) return;

    if (typeof triggerHaptic === 'function') triggerHaptic('heavy');

    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                action: 'delete_user',
                userId
            })
        });
        const result = await res.json();
        if (result.success) {
            if (typeof showToast === 'function') {
                showToast('success', 'User Deleted', result.message || `User @${username} deleted.`);
            }
            await loadAdminConsoleData();
        } else {
            alert(`Delete failed: ${result.error || 'Server error'}`);
        }
    } catch (e) {
        alert('Network error while deleting user.');
    }
}
window.confirmDeleteUser = confirmDeleteUser;


