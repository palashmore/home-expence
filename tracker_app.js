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
    "Maid - Madhuri",
    "Chef - Nilima Nikose",
    "Gas & Water",
    "Wifi & Internet",
    "Accepted Payments (Income)",
    "Shopping & Miscellaneous"
];

let FAMILY_MEMBERS = _win.FAMILY_MEMBERS || ["Palash", "Pallavi", "Mom", "Dad"];
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
let authToken = localStorage.getItem("household_auth_token") || "direct_access";
let currentSelectedReceiptBase64 = null;
let trendGranularity = "monthly"; // "monthly" or "quarterly"
let pendingDeleteExpenseId = null;
let monthlyBudgetLimit = 50000; // Configurable budget limit

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
    dateFrom: null,
    dateTo: null,
    searchVal: ""
};

// ================= INITIALIZATION =================
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setDefaultDateToToday();
    
    // Set dynamic default filter state (Current Month + Current Year)
    const cur = getCurrentPeriod();
    dashboardFilters.month = cur.monthName;
    dashboardFilters.year = cur.yearStr;
    
    populateFilterMonthDropdown();
    
    // Auto-sync listeners for multi-device concurrency
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) loadData(true);
    });
    window.addEventListener("focus", () => {
        loadData(true);
    });
    setInterval(() => {
        if (!document.hidden) loadData(true);
    }, 12000);

    // Initial Data Fetch
    loadData();
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
    if (render) renderAllViews();
}

function setDefaultDateToToday() {
    const cur = getCurrentPeriod();
    const dateInput = document.getElementById("inputDate");
    if (dateInput) dateInput.value = cur.isoDate;
}

// Navigation Tab Switching
function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.classList.remove("active");
        btn.classList.add("text-slate-600");
    });
    document.querySelectorAll(".tab-view").forEach(view => {
        view.classList.add("hidden");
    });

    const activeBtn = document.getElementById(`tab-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add("active");
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
    }

    const activeView = document.getElementById(`view-${tabId}`);
    if (activeView) {
        activeView.classList.remove("hidden");
    }

    if (tabId === 'admin' && window.renderAdminView) {
        window.renderAdminView();
    }

    // Scroll to top when switching views on mobile/desktop
    try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {}

    // When navigating between views, render all charts/tables
    renderAllViews();
}

function getAuthHeaders() {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken || "direct_access"}`
    };
}

// ================= DATA LOADING & SYNC =================
async function loadData(silent = false) {
    if (!silent) updateSyncBadge("Syncing...", "amber");

    try {
        const res = await fetch("/api/expenses", {
            method: "GET",
            headers: getAuthHeaders()
        });

        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
            expenses = result.data.map(item => ({
                ...item,
                paidBy: item.paidBy || inferPaidBy(item)
            }));
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
    if (text.includes("pallavi")) return "Pallavi";
    if (text.includes("palash")) return "Palash";
    if (text.includes("mom")) return "Mom";
    if (text.includes("dad")) return "Dad";
    return "Not Specified";
}

function updateSyncBadge(text, color) {
    const badge = document.getElementById("recordCountBadge");
    if (!badge) return;
    const dotColor = color === "emerald" ? "text-emerald-500" : (color === "amber" ? "text-amber-500" : "text-rose-500");
    badge.innerHTML = `<i class="fa-solid fa-circle-check ${dotColor} mr-1"></i> Status: ${text} (${expenses.length} records)`;
}

function updateHeaderStatus() {
    const countEl = document.getElementById("hdrTxCount");
    const updatedEl = document.getElementById("hdrLastUpdated");
    if (countEl) countEl.textContent = `${expenses.length} Transactions`;
    if (updatedEl) {
        const d = new Date();
        const hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        updatedEl.textContent = `${displayHours}:${mins} ${ampm}`;
    }
}

function saveLocalCacheData() {
    localStorage.setItem("household_expenses_online_cache", JSON.stringify(expenses));
}

function loadLocalFallbackData() {
    const cached = localStorage.getItem("household_expenses_online_cache") || localStorage.getItem("household_expenses_db");
    if (cached) {
        try {
            expenses = JSON.parse(cached).map(item => ({
                ...item,
                paidBy: item.paidBy || inferPaidBy(item)
            }));
            populateFilterYearDropdown();
            renderAllViews();
        } catch (e) {}
    }
}

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
}

// Called on any dropdown filter change
function onFilterChange() {
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

    renderAllViews();
}

function applyFilters() {
    const searchInput = document.getElementById("searchExpenses");
    if (searchInput) dashboardFilters.searchVal = searchInput.value.toLowerCase().trim();
    renderAllViews();
}

// Reset specifically to Current Month + Current Year (Requirement 1, 2, 49)
function resetToCurrentMonth() {
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

    syncFilterControlsToState();
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

    const drawer = document.getElementById("customDateDrawer");
    if (drawer) drawer.classList.add("hidden");
}

// Quick Filter Chips handlers
function quickFilterPeriod(period) {
    const cur = getCurrentPeriod();
    if (period === 'this-month') {
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
    dashboardFilters.dateFrom = null;
    dashboardFilters.dateTo = null;
    syncFilterControlsToState();
    renderAllViews();
}

function quickFilterPaidBy(member) {
    dashboardFilters.paidBy = (dashboardFilters.paidBy === member) ? "all" : member;
    syncFilterControlsToState();
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

    renderAllViews();
}

function clearCustomDateRange() {
    dashboardFilters.dateFrom = null;
    dashboardFilters.dateTo = null;
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
    renderMonthlyMatrix();
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
                <span>${t.label}</span>
                <button type="button" onclick="activeTagRemove(${idx})" title="Remove filter">&times;</button>
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
        periodTitleStr += ` &bull; <span class="text-violet-300 font-extrabold">${dashboardFilters.paidBy}</span>`;
    }
    if (dashboardFilters.category !== "all") {
        periodTitleStr += ` &bull; <span class="text-emerald-300 font-extrabold">${dashboardFilters.category}</span>`;
    }

    const titleEl = document.getElementById("dashboardPeriodTitle");
    if (titleEl) titleEl.innerHTML = periodTitleStr;

    const hdrBadge = document.getElementById("hdrPeriodBadge");
    if (hdrBadge) {
        hdrBadge.textContent = dashboardFilters.month === "all" ? "All Time" : `${dashboardFilters.month} ${dashboardFilters.year}`;
    }

    // 2. Derive Financial Metrics strictly from filtered dataset
    const expenseItems = filtered.filter(i => i.category !== "Accepted Payments (Income)");
    const incomeItems = filtered.filter(i => i.category === "Accepted Payments (Income)");

    const totalSpent = expenseItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const totalIncome = incomeItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const netCashFlow = totalIncome - totalSpent;
    const expenseCount = expenseItems.length;
    const incomeCount = incomeItems.length;

    // Days in period for burn rate
    let daysInPeriod = 30;
    if (dashboardFilters.month !== "all") {
        const mIdx = MONTHS.indexOf(dashboardFilters.month);
        const yNum = dashboardFilters.year !== "all" ? Number(dashboardFilters.year) : cur.year;
        daysInPeriod = new Date(yNum, mIdx + 1, 0).getDate();
    }
    const avgDaily = Math.round(totalSpent / (daysInPeriod || 1));

    // Highest single expense
    let highestExpenseItem = null;
    expenseItems.forEach(i => {
        if (!highestExpenseItem || Number(i.amount) > Number(highestExpenseItem.amount)) {
            highestExpenseItem = i;
        }
    });

    // Staff Payments
    const staffExpenses = expenseItems.filter(i => i.category === "Maid - Madhuri" || i.category === "Chef - Nilima Nikose");
    const staffTotal = staffExpenses.reduce((acc, i) => acc + Number(i.amount), 0);

    const madhuriPaid = staffExpenses.filter(i => i.category === "Maid - Madhuri").reduce((acc, i) => acc + Number(i.amount), 0);
    const nilimaPaid = staffExpenses.filter(i => i.category === "Chef - Nilima Nikose").reduce((acc, i) => acc + Number(i.amount), 0);

    // Groceries
    const groceryItems = expenseItems.filter(i => i.category === "Grocery & Vegetables");
    const groceryTotal = groceryItems.reduce((acc, i) => acc + Number(i.amount), 0);
    const groceryShare = totalSpent > 0 ? ((groceryTotal / totalSpent) * 100).toFixed(1) : 0;

    // Recurring Bills Checklist Status
    const checklistStatus = calculateRecurringChecklist(filtered);

    // 3. Update KPI Elements in DOM
    const spentEl = document.getElementById("statTotalSpent");
    if (spentEl) spentEl.textContent = formatINR(totalSpent);

    const spentCountEl = document.getElementById("statSpentCount");
    if (spentCountEl) spentCountEl.textContent = `${expenseCount} expenses`;

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
            netBadgeEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up mr-1"></i> Surplus +${formatINR(netCashFlow)}`;
            netIconEl.className = "w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold";
        } else if (netCashFlow < 0) {
            netBadgeEl.className = "font-black text-rose-600";
            netBadgeEl.innerHTML = `<i class="fa-solid fa-arrow-trend-down mr-1"></i> Deficit -${formatINR(Math.abs(netCashFlow))}`;
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
    if (dailyDaysEl) dailyDaysEl.textContent = `${daysInPeriod} days in cycle`;

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
        const bothPaid = madhuriPaid >= 800 && nilimaPaid >= 4500;
        staffSummaryEl.textContent = bothPaid ? "Fully Paid" : "Pending Action";
        staffSummaryEl.className = bothPaid ? "font-bold text-emerald-600" : "font-bold text-amber-600";
    }

    const groceryTotalEl = document.getElementById("statGroceryTotal");
    if (groceryTotalEl) groceryTotalEl.textContent = formatINR(groceryTotal);
    const groceryCountEl = document.getElementById("statGroceryCount");
    if (groceryCountEl) groceryCountEl.textContent = `${groceryItems.length} orders`;
    const groceryShareEl = document.getElementById("statGroceryShare");
    if (groceryShareEl) groceryShareEl.textContent = `${groceryShare}% of total`;

    const txCountEl = document.getElementById("statTxCountTotal");
    if (txCountEl) txCountEl.textContent = filtered.length;

    // Staff Card Badges
    const madhuriBadge = document.getElementById("statMadhuriStatusBadge");
    const madhuriPaidEl = document.getElementById("statMadhuriPaid");
    if (madhuriPaidEl) madhuriPaidEl.textContent = formatINR(madhuriPaid);
    if (madhuriBadge) {
        const isPaid = madhuriPaid >= 800;
        madhuriBadge.className = isPaid ? "px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800" : "px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800";
        madhuriBadge.textContent = isPaid ? "Paid" : "Pending";
    }

    const nilimaBadge = document.getElementById("statNilimaStatusBadge");
    const nilimaPaidEl = document.getElementById("statNilimaPaid");
    if (nilimaPaidEl) nilimaPaidEl.textContent = formatINR(nilimaPaid);
    if (nilimaBadge) {
        const isPaid = nilimaPaid >= 4500;
        nilimaBadge.className = isPaid ? "px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800" : "px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800";
        nilimaBadge.textContent = isPaid ? "Paid" : "Pending";
    }

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
    renderFinancialInsights(filtered, totalSpent, totalIncome, netCashFlow);

    // 6. Visualizations
    renderCategoryPieChart(filtered);
    renderPaidByChart(filtered);
    renderMonthlyTrendChart(expenses);
    renderPaymentMethodChart(filtered);

    // 7. Spending Matrix
    renderHouseholdSpendingMatrix(filtered);

    // 8. Budget & Checklist & Tables
    renderBudgetProgress(totalSpent);
    renderChecklistUI(checklistStatus.items);
    renderTopExpensesTable(expenseItems);
    renderRecentTransactionsTable(filtered);
    renderMoMAndYtd(expenses);

    // Advance Modules Dashboard Bridge
    window.expensesData = expenses;
    if (window.renderAdvanceDashboard) {
        window.renderAdvanceDashboard(filtered);
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
            icon: "fa-chart-pie",
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
            icon: "fa-user-check",
            text: `<strong>${topMember[0]}</strong> has funded the majority of expenses (<strong>${formatINR(topMember[1])}</strong> &bull; ${pct}% share).`
        });
    }

    // Staff Payment Insight
    const staffExpenses = filtered.filter(i => i.category === "Maid - Madhuri" || i.category === "Chef - Nilima Nikose");
    const madhuriPaid = staffExpenses.filter(i => i.category === "Maid - Madhuri").reduce((acc, i) => acc + Number(i.amount), 0);
    const nilimaPaid = staffExpenses.filter(i => i.category === "Chef - Nilima Nikose").reduce((acc, i) => acc + Number(i.amount), 0);
    
    if (madhuriPaid >= 800 && nilimaPaid >= 4500) {
        insights.push({
            type: "success",
            icon: "fa-circle-check",
            text: `Staff payments for Maid (Madhuri ₹800) and Chef (Nilima ₹4,500) are fully paid.`
        });
    } else {
        const pendingNames = [];
        if (madhuriPaid < 800) pendingNames.push("Madhuri (Maid ₹800)");
        if (nilimaPaid < 4500) pendingNames.push("Nilima Nikose (Chef ₹4,500)");
        insights.push({
            type: "warning",
            icon: "fa-triangle-exclamation",
            text: `Staff payment pending: <strong>${pendingNames.join(", ")}</strong> for this billing cycle.`
        });
    }

    container.innerHTML = insights.map(ins => {
        const colorClass = ins.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
            : (ins.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-indigo-50 border-indigo-200 text-indigo-900');
        const iconColor = ins.type === 'success' ? 'text-emerald-600' : (ins.type === 'warning' ? 'text-amber-600' : 'text-indigo-600');
        return `
            <div class="p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${colorClass}">
                <div class="flex items-center space-x-2">
                    <i class="fa-solid ${ins.icon} ${iconColor} text-sm"></i>
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
            legendContainer.innerHTML = labels.map((cat, idx) => {
                const amt = catTotals[cat];
                const pct = totalSpent > 0 ? ((amt / totalSpent) * 100).toFixed(1) : 0;
                return `
                    <div onclick="filterByCategory('${cat}')" class="flex items-center space-x-1.5 cursor-pointer hover:bg-slate-100 p-1 rounded-lg transition" title="Click to filter by ${cat}">
                        <span class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style="background-color: ${colors[idx % colors.length]}"></span>
                        <span class="truncate font-semibold text-slate-700">${cat}:</span>
                        <span class="font-bold text-slate-900">${pct}%</span>
                    </div>
                `;
            }).join("");
        }
    }

    if (labels.length === 0) return;

    categoryPieChartInstance = new Chart(canvas.getContext('2d'), {
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
                <div onclick="quickFilterPaidBy('${m}')" class="p-2 rounded-xl border ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'} cursor-pointer transition text-center">
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
                    backgroundColor: '#ef4444',
                    borderRadius: 6
                },
                {
                    label: `Income / Inflow`,
                    data: incomeData,
                    backgroundColor: '#10b981',
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

    const matrixCategories = [
        "Grocery & Vegetables",
        "Electricity Bill",
        "Flat Maintenance",
        "Maid - Madhuri",
        "Chef - Nilima Nikose",
        "Dish Bill (DTH)",
        "Wifi & Internet",
        "Shopping & Miscellaneous"
    ];

    const members = ["Palash", "Pallavi", "Mom", "Dad", "Not Specified"];

    // Compute sums: member -> category -> sum
    const matrix = {};
    const colTotals = {};
    matrixCategories.forEach(c => colTotals[c] = 0);

    members.forEach(m => {
        matrix[m] = {};
        matrixCategories.forEach(c => matrix[m][c] = 0);
    });

    filteredData.filter(i => i.category !== "Accepted Payments (Income)").forEach(i => {
        const m = i.paidBy || "Not Specified";
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
                    <span class="cursor-pointer hover:text-indigo-600" onclick="quickFilterPaidBy('${m}')">
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

// ================= BUDGET, RECURRING & YTD =================
function renderBudgetProgress(totalSpent) {
    const progressBar = document.getElementById("budgetProgressBar");
    const spentVal = document.getElementById("budgetSpentVal");
    const capVal = document.getElementById("budgetCapVal");
    const remText = document.getElementById("budgetRemainingText");
    const pctText = document.getElementById("budgetPercentText");
    const pill = document.getElementById("budgetAlertPill");

    if (spentVal) spentVal.textContent = formatINR(totalSpent);
    if (capVal) capVal.textContent = formatINR(monthlyBudgetLimit);

    const pct = Math.min(100, Math.round((totalSpent / monthlyBudgetLimit) * 100));
    const remaining = Math.max(0, monthlyBudgetLimit - totalSpent);

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
    if (pctText) pctText.textContent = `${pct}% utilized`;

    if (pill) {
        if (pct > 100) {
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
    const checklistConfig = [
        { name: "Electricity Bill", target: 2800, paidTo: "MSEDCL" },
        { name: "Flat Maintenance", target: 1500, paidTo: "Society Office" },
        { name: "Dish Bill (DTH)", target: 300, paidTo: "Dish TV / DTH" },
        { name: "Maid - Madhuri", target: 800, paidTo: "Madhuri" },
        { name: "Chef - Nilima Nikose", target: 4500, paidTo: "Nilima Nikose" },
        { name: "Wifi & Internet", target: 1000, paidTo: "Broadband" }
    ];

    let paidCount = 0;
    const items = checklistConfig.map(cfg => {
        const matching = filteredData.filter(i => i.category === cfg.name);
        const total = matching.reduce((a, b) => a + Number(b.amount), 0);
        const isPaid = total >= cfg.target || (total > 0 && total >= cfg.target * 0.8);
        if (isPaid) paidCount++;
        return {
            ...cfg,
            actual: total,
            isPaid: isPaid
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
                <i class="fa-solid ${item.isPaid ? 'fa-circle-check text-emerald-600' : 'fa-clock text-amber-500'}"></i>
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

    // YTD Calculations
    const ytdItems = allExpenses.filter(i => i.date && new Date(i.date).getFullYear().toString() === curYear);
    const ytdSpend = ytdItems.filter(i => i.category !== "Accepted Payments (Income)").reduce((a, b) => a + Number(b.amount), 0);
    const ytdIncome = ytdItems.filter(i => i.category === "Accepted Payments (Income)").reduce((a, b) => a + Number(b.amount), 0);
    const ytdNet = ytdIncome - ytdSpend;

    const ytdSpendEl = document.getElementById("ytdTotalSpend");
    const ytdIncomeEl = document.getElementById("ytdTotalIncome");
    const ytdNetEl = document.getElementById("ytdNetFlow");

    if (ytdSpendEl) ytdSpendEl.textContent = formatINR(ytdSpend);
    if (ytdIncomeEl) ytdIncomeEl.textContent = formatINR(ytdIncome);
    if (ytdNetEl) ytdNetEl.textContent = formatINR(ytdNet);

    // MoM comparison for selected month
    if (dashboardFilters.month !== "all") {
        const curMIdx = MONTHS.indexOf(dashboardFilters.month);
        const prevMIdx = (curMIdx + 11) % 12;
        const prevYear = (prevMIdx === 11 ? Number(dashboardFilters.year) - 1 : Number(dashboardFilters.year)).toString();

        const curSpend = allExpenses.filter(i => {
            const d = new Date(i.date);
            return d.getMonth() === curMIdx && d.getFullYear().toString() === dashboardFilters.year && i.category !== "Accepted Payments (Income)";
        }).reduce((a, b) => a + Number(b.amount), 0);

        const prevSpend = allExpenses.filter(i => {
            const d = new Date(i.date);
            return d.getMonth() === prevMIdx && d.getFullYear().toString() === prevYear && i.category !== "Accepted Payments (Income)";
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
        <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="openTransactionDetailModal('${i.id}')">
            <td class="py-2.5 px-3 text-slate-500 text-[11px] whitespace-nowrap">${formatDisplayDate(i.date)}</td>
            <td class="py-2.5 px-3 font-bold text-slate-900">${i.category}</td>
            <td class="py-2.5 px-3 text-slate-600 truncate max-w-[130px]">${i.paidTo || i.notes || '-'}</td>
            <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-black bg-violet-100 text-violet-800">${i.paidBy || 'Not Specified'}</span>
            </td>
            <td class="py-2.5 px-3 text-right font-black text-slate-900">${formatINR(i.amount)}</td>
            <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
                <button onclick="editExpense('${i.id}')" class="p-1 text-slate-400 hover:text-indigo-600"><i class="fa-solid fa-pen text-xs"></i></button>
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
            <tr class="hover:bg-slate-50 transition cursor-pointer" onclick="openTransactionDetailModal('${i.id}')">
                <td class="py-2.5 px-3 text-slate-500 text-[11px] whitespace-nowrap">${formatDisplayDate(i.date)}</td>
                <td class="py-2.5 px-3 font-bold text-slate-900 truncate max-w-[120px]">${i.category}</td>
                <td class="py-2.5 px-3">
                    <span class="px-2 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700">${i.paidBy || 'Not Specified'}</span>
                </td>
                <td class="py-2.5 px-3 text-slate-500 text-[11px]">${i.paymentMethod || 'UPI'}</td>
                <td class="py-2.5 px-3 text-right font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">${formatINR(i.amount)}</td>
                <td class="py-2.5 px-3 text-center" onclick="event.stopPropagation()">
                    ${i.receipt ? `<button onclick="viewReceiptFull('${i.receipt}')" class="text-indigo-600 hover:text-indigo-800"><i class="fa-solid fa-paperclip"></i></button>` : '<span class="text-slate-300">-</span>'}
                </td>
            </tr>
        `;
    }).join("");
}

// ================= TAB 2: DAILY EXPENSES LOG TABLE =================
function renderExpenseTable(filteredData) {
    const tbody = document.getElementById("expenseTableBody");
    const emptyState = document.getElementById("emptyExpenseState");
    if (!tbody) return;

    const sorted = [...filteredData].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (sorted.length === 0) {
        tbody.innerHTML = "";
        if (emptyState) emptyState.classList.remove("hidden");
        return;
    }

    if (emptyState) emptyState.classList.add("hidden");

    tbody.innerHTML = sorted.map(item => {
        const isIncome = item.category === "Accepted Payments (Income)";
        return `
            <tr class="hover:bg-indigo-50/40 transition">
                <td class="py-3 px-4 text-slate-600 text-xs font-semibold whitespace-nowrap">${formatDisplayDate(item.date)}</td>
                <td class="py-3 px-4 font-bold text-slate-900">${item.category}</td>
                <td class="py-3 px-4 text-slate-600 max-w-xs truncate text-xs">${item.notes || item.description || '-'}</td>
                <td class="py-3 px-4">
                    <span class="px-2.5 py-1 rounded-full text-xs font-black bg-violet-100 text-violet-800">${item.paidBy || 'Not Specified'}</span>
                </td>
                <td class="py-3 px-4 font-semibold text-slate-800 whitespace-nowrap text-xs">${item.paidTo || item.vendor || '-'}</td>
                <td class="py-3 px-4 text-slate-500 text-xs whitespace-nowrap">${item.paymentMethod || 'UPI'}</td>
                <td class="py-3 px-4 text-right font-black ${isIncome ? 'text-emerald-600' : 'text-slate-900'}">${formatINR(item.amount)}</td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    <div class="flex items-center justify-center space-x-2">
                        <button onclick="openTransactionDetailModal('${item.id}')" title="View details" class="p-1.5 text-slate-400 hover:text-indigo-600 transition"><i class="fa-solid fa-eye text-xs"></i></button>
                        <button onclick="editExpense('${item.id}')" title="Edit" class="p-1.5 text-slate-400 hover:text-indigo-600 transition"><i class="fa-solid fa-pen text-xs"></i></button>
                        <button onclick="confirmDeleteExpense('${item.id}')" title="Delete" class="p-1.5 text-slate-400 hover:text-rose-600 transition"><i class="fa-solid fa-trash text-xs"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join("");
}

// ================= TAB 3: STAFF VIEW =================
function renderStaffView(filteredData) {
    const staffExpenses = (filteredData || expenses).filter(i => i.category === "Maid - Madhuri" || i.category === "Chef - Nilima Nikose");
    const tbody = document.getElementById("staffTableBody");

    const madhuriPaid = staffExpenses.filter(i => i.category === "Maid - Madhuri").reduce((a, b) => a + Number(b.amount), 0);
    const nilimaPaid = staffExpenses.filter(i => i.category === "Chef - Nilima Nikose").reduce((a, b) => a + Number(b.amount), 0);

    const mTotal = document.getElementById("staffMadhuriPeriodTotal");
    const mBadge = document.getElementById("staffMadhuriBadge");
    if (mTotal) mTotal.textContent = formatINR(madhuriPaid);
    if (mBadge) {
        const isPaid = madhuriPaid >= 800;
        mBadge.innerHTML = isPaid 
            ? `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-md">Paid (Completed)</span>`
            : `<span class="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-md">Pending (Due)</span>`;
    }

    const nTotal = document.getElementById("staffNilimaPeriodTotal");
    const nBadge = document.getElementById("staffNilimaBadge");
    if (nTotal) nTotal.textContent = formatINR(nilimaPaid);
    if (nBadge) {
        const isPaid = nilimaPaid >= 4500;
        nBadge.innerHTML = isPaid 
            ? `<span class="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-md">Paid (Completed)</span>`
            : `<span class="px-2.5 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-md">Pending (Due)</span>`;
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
            <td class="py-3 px-4 font-bold text-slate-900">${i.category.replace(" - ", " ")}</td>
            <td class="py-3 px-4 text-xs text-slate-500">${i.billingCycle || 'Monthly Cycle'}</td>
            <td class="py-3 px-4 font-black text-xs text-violet-800">${i.paidBy || 'Not Specified'}</td>
            <td class="py-3 px-4 text-xs text-slate-600">${i.paymentMethod || 'UPI'}</td>
            <td class="py-3 px-4 text-xs text-slate-500">${i.notes || i.description || '-'}</td>
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

    // Extract all unique month-years in dataset
    const monthYearMap = {};
    expenses.forEach(item => {
        if (!item.date) return;
        const d = new Date(item.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthYearMap[key] = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    });

    const sortedKeys = Object.keys(monthYearMap).sort().reverse();

    thead.innerHTML = `
        <tr>
            <th class="py-2.5 px-3">Month-Year</th>
            ${CATEGORIES.map(cat => `<th class="py-2.5 px-3 text-right max-w-[120px] truncate">${cat}</th>`).join("")}
            <th class="py-2.5 px-3 text-right bg-indigo-950 text-white font-black">Total Spent</th>
        </tr>
    `;

    tbody.innerHTML = sortedKeys.map(mKey => {
        const [yearStr, monthNumStr] = mKey.split("-");
        const monthIdx = parseInt(monthNumStr, 10) - 1;

        let totalSpent = 0;
        const catSums = CATEGORIES.map(cat => {
            const sum = expenses.filter(i => {
                const d = new Date(i.date);
                return d.getFullYear().toString() === yearStr && d.getMonth() === monthIdx && i.category === cat;
            }).reduce((acc, i) => acc + Number(i.amount), 0);

            if (cat !== "Accepted Payments (Income)") totalSpent += sum;
            return sum;
        });

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-2.5 px-3 font-black text-slate-900 whitespace-nowrap">${monthYearMap[mKey]}</td>
                ${catSums.map(sum => `
                    <td class="py-2.5 px-3 text-right ${sum > 0 ? 'text-slate-900 font-bold' : 'text-slate-300 font-normal'}">
                        ${sum > 0 ? formatINR(sum) : '-'}
                    </td>
                `).join("")}
                <td class="py-2.5 px-3 text-right font-black text-indigo-700 bg-indigo-50/50">${formatINR(totalSpent)}</td>
            </tr>
        `;
    }).join("");
}

// ================= TOAST NOTIFICATION SYSTEM =================
function showToast(type, title, message = "") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "fixed top-5 right-5 z-50 flex flex-col space-y-3 pointer-events-none max-w-sm w-full";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    const isSuccess = type === "success";
    const isError = type === "error";

    toast.className = `toast-item pointer-events-auto flex items-start space-x-3 p-4 rounded-2xl shadow-2xl border backdrop-blur-md transition-all duration-300 ${
        isSuccess 
            ? "bg-slate-900/95 text-white border-emerald-500/50 shadow-emerald-950/30" 
            : (isError ? "bg-slate-900/95 text-white border-rose-500/50 shadow-rose-950/30" : "bg-slate-900/95 text-white border-indigo-500/50 shadow-indigo-950/30")
    }`;

    const iconHtml = isSuccess 
        ? `<div class="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 text-base font-black"><i class="fa-solid fa-check"></i></div>`
        : (isError 
            ? `<div class="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 text-base font-black"><i class="fa-solid fa-triangle-exclamation"></i></div>`
            : `<div class="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 text-base font-black"><i class="fa-solid fa-info"></i></div>`);

    toast.innerHTML = `
        ${iconHtml}
        <div class="flex-1 min-w-0 pt-0.5">
            <h4 class="text-xs font-black tracking-wide text-white leading-tight">${title}</h4>
            ${message ? `<p class="text-[11px] text-slate-300 font-bold mt-0.5 truncate">${message}</p>` : ''}
        </div>
        <button onclick="this.parentElement.remove()" class="text-slate-400 hover:text-white transition p-1 text-xs">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add("toast-out");
        setTimeout(() => toast.remove(), 350);
    }, 3800);
}

// ================= CRUD: ADD, EDIT, DELETE EXPENSES =================
function openExpenseModal(editId = null) {
    const modal = document.getElementById("expenseModal");
    const form = document.getElementById("expenseForm");
    const modalTitle = document.getElementById("modalTitle");
    const cur = getCurrentPeriod();

    if (!modal) return;
    if (window.clearAnomalyWarning) window.clearAnomalyWarning();

    if (editId) {
        const targetId = String(editId).trim();
        const item = expenses.find(i => String(i.id).trim() === targetId);
        if (!item) {
            console.error("Expense record not found for edit ID:", editId);
            showToast("error", "Record Not Found", "Could not locate the requested expense to edit.");
            return;
        }

        modalTitle.innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-400 mr-2"></i> Edit Household Expense`;
        document.getElementById("expenseId").value = item.id;
        document.getElementById("inputDate").value = item.date || cur.isoDate;
        document.getElementById("inputAmount").value = item.amount;
        document.getElementById("inputCategory").value = item.category || "Grocery & Vegetables";

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
            splitSelect.value = item.splitBetween || "Household Expense (Palash Reimburses Pallavi 100%)";
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
        modalTitle.innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-400 mr-2"></i> Add Household Expense`;
        if (form) form.reset();
        document.getElementById("expenseId").value = "";
        document.getElementById("inputDate").value = cur.isoDate;
        document.getElementById("inputCategory").value = "Grocery & Vegetables";
        
        const paidBySelect = document.getElementById("inputPaidBy");
        if (paidBySelect) paidBySelect.value = "Palash";
        
        const splitSelect = document.getElementById("inputSplitBetween");
        if (splitSelect) {
            splitSelect.value = "Household Expense (Palash Reimburses Pallavi 100%)";
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
    const cat = document.getElementById("inputCategory").value;
    const paidTo = document.getElementById("inputPaidTo");
    if (!paidTo) return;

    if (window.masterConfig && window.masterConfig.categories) {
        const found = window.masterConfig.categories.find(c => c.name === cat);
        if (found && found.defaultPaidTo) {
            paidTo.value = found.defaultPaidTo;
            return;
        }
    }

    if (cat === "Maid - Madhuri") paidTo.value = "Madhuri";
    else if (cat === "Chef - Nilima Nikose") paidTo.value = "Nilima Nikose";
    else if (cat === "Electricity Bill") paidTo.value = "MSCB / MSEDCL";
    else if (cat === "Flat Maintenance") paidTo.value = "Society Office";
    else if (cat === "Dish Bill (DTH)") paidTo.value = "Dish TV / Tata Play";
}

async function saveExpense(e) {
    if (e && e.preventDefault) e.preventDefault();

    const idInput = document.getElementById("expenseId");
    const id = idInput ? idInput.value.trim() : "";
    const isEdit = !!id;

    const date = document.getElementById("inputDate").value;
    const amountVal = document.getElementById("inputAmount").value;
    const amount = parseFloat(amountVal);
    const category = document.getElementById("inputCategory").value;
    const paidBy = document.getElementById("inputPaidBy").value;
    const paidTo = document.getElementById("inputPaidTo").value.trim();
    const paymentMethod = document.getElementById("inputPaymentMethod").value;
    const notes = document.getElementById("inputNotes").value.trim();
    const splitBetween = document.getElementById("inputSplitBetween") ? document.getElementById("inputSplitBetween").value : "Household Expense (Palash Reimburses Pallavi 100%)";

    // 1. Validation
    if (!date || isNaN(new Date(date).getTime())) {
        showToast("error", "Validation Error", "Please select a valid transaction date.");
        return;
    }
    if (isNaN(amount) || amount <= 0) {
        showToast("error", "Validation Error", "Amount must be a positive number greater than zero.");
        return;
    }
    if (!category) {
        showToast("error", "Validation Error", "Please select an expense category.");
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

    // 3. Double-Click & Rapid Save Protection
    const submitBtn = document.getElementById("btnSubmitExpense");
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-1.5"></i> Saving...`;
    }

    try {
        const method = isEdit ? "PUT" : "POST";
        const res = await fetch("/api/expenses", {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });

        const data = await res.json();

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

            // 5. Persist to Local Storage Cache
            saveLocalCacheData();

            // 6. Recalculate Filtered Data & All Dashboard Views Automatically
            renderAllViews();
            updateHeaderStatus();

            // 7. Close Modal
            closeExpenseModal();

            // 8. Show Professional Confirmation Toast ONLY AFTER verified persistence
            const actionTitle = isEdit ? "Expense Updated Successfully" : "Expense Added Successfully";
            const secondaryText = `${formatINR(savedItem.amount)} · ${savedItem.category} · ${savedItem.paidBy}`;
            showToast("success", actionTitle, secondaryText);

            // 9. Silent Background Sync to Verify Server Parity
            loadData(true);
        } else {
            console.error("Save rejected by server:", data);
            showToast("error", "Unable to Update Expense", data.error || "Your changes were not saved. Please try again.");
        }
    } catch (err) {
        console.error("Save network or runtime error:", err);
        showToast("error", "Unable to Update Expense", "Could not connect to server. Your changes were not saved.");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `Save Expense Record`;
        }
    }
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
            <p><strong>Category:</strong> ${item.category}</p>
            <p><strong>Amount:</strong> ${formatINR(item.amount)}</p>
            <p><strong>Date:</strong> ${formatDisplayDate(item.date)}</p>
            <p><strong>Paid By:</strong> ${item.paidBy || 'Not Specified'}</p>
            <p><strong>Paid To:</strong> ${item.paidTo || item.vendor || '-'}</p>
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
    try {
        const res = await fetch(`/api/expenses?id=${encodeURIComponent(targetId)}`, {
            method: "DELETE",
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (res.ok && data.success) {
            // Remove from canonical state
            expenses = expenses.filter(i => String(i.id).trim() !== targetId);
            window.expenses = expenses;
            window.expensesData = expenses;
            saveLocalCacheData();
            renderAllViews();
            updateHeaderStatus();
            closeDeleteConfirmModal();
            closeTransactionDetailModal();
            showToast("success", "Expense Deleted Successfully");
            loadData(true);
        } else {
            showToast("error", "Unable to Delete Expense", data.error || "Record could not be removed.");
        }
    } catch (err) {
        console.error("Delete failed:", err);
        showToast("error", "Server Error", "Could not reach server to delete record.");
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

    const items = [
        { name: "Maid - Madhuri", amount: 800, paidTo: "Madhuri" },
        { name: "Chef - Nilima Nikose", amount: 4500, paidTo: "Nilima Nikose" },
        { name: "Flat Maintenance", amount: 1500, paidTo: "Society Office" },
        { name: "Electricity Bill", amount: 2800, paidTo: "MSEDCL" },
        { name: "Dish Bill (DTH)", amount: 300, paidTo: "Dish TV / Tata Play" },
        { name: "Wifi & Internet", amount: 1000, paidTo: "Broadband Provider" }
    ];

    container.innerHTML = items.map(i => `
        <button onclick="quickPayItem('${i.name}', ${i.amount}, '${i.paidTo}')" class="p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-left transition flex items-center justify-between">
            <div>
                <span class="block font-black text-slate-900">${i.name}</span>
                <span class="text-xs text-slate-500 font-semibold">${formatINR(i.amount)} &bull; ${i.paidTo}</span>
            </div>
            <i class="fa-solid fa-arrow-right text-indigo-600"></i>
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
    document.getElementById("inputPaidBy").value = "Palash";
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
    const staffRecords = sortedExpenses
        .filter(i => i.category === "Maid - Madhuri" || i.category === "Chef - Nilima Nikose")
        .map(item => {
            const d = new Date(item.date);
            return {
                "Payment Date": item.date,
                "Staff Member": item.category === "Maid - Madhuri" ? "Madhuri (Maid)" : "Nilima Nikose (Chef)",
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
                alert(`Notice: Non-standard Paid By values detected: [${uniqueInvalid.join(', ')}]. Supported: Palash, Pallavi, Mom, Dad. These will be imported as 'Not Specified'.`);
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
};
