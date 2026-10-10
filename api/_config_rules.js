// Server-side validation and rename rules for the household master config.
//
// The client validates too, but the client can be bypassed. Before this module
// the server quietly coerced whatever it received:
//     dueDay: parseInt(b.dueDay, 10) || 1
//     monthlyBudgetLimit: Number(...) || 50000
//     baseSalary: Number(...) || 0
//     name: String(b.name || 'Recurring Bill')
// A blank or malformed field therefore became a plausible-looking number that
// nobody chose, written straight into the household's records.
//
// Rules here return 422 with a per-field message instead.

// Accepts 2805, "2805", "2,805.50", "  12.5 ". Rejects "", null, "abc", NaN.
function parseAmount(raw) {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === '') return null;
    const cleaned = s.replace(/[,\s₹]/g, '');
    if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function parseDay(raw) {
    const n = parseAmount(raw);
    if (n === null) return null;
    return Number.isInteger(n) ? n : null;
}

/**
 * Validate a config update. Returns an array of { field, message } - empty when
 * the payload is acceptable. Only validates keys actually present in the body,
 * so a partial update is not forced to resend everything.
 */
// Dashboard UI preferences: a small closed shape. Unknown keys and values are
// refused rather than stored, so the field cannot become a dumping ground. An
// empty object clears the preference. Used for the household default (config)
// and for the per-user preference an administrator assigns (edit_user).
const DASHBOARD_SECTIONS = ['kpi', 'insights', 'chart-category', 'chart-family', 'chart-trend', 'chart-payment',
    'bills', 'reimbursement', 'staff', 'top', 'recent', 'timeline'];
function dashboardUiErrors(ui) {
    const out = [];
    const bad = (msg) => out.push(msg);
    if (ui === null || typeof ui !== 'object' || Array.isArray(ui)) {
        bad('Dashboard UI preferences must be an object.');
        return out;
    }
    const allowed = ['design', 'layout', 'kpiDensity', 'mobileDensity', 'heroBudget', 'defaultTheme', 'sections'];
    Object.keys(ui).forEach(k => { if (!allowed.includes(k)) bad('Unknown dashboard UI setting: ' + k + '.'); });
    if (ui.design !== undefined && !['classic', 'new', 'minimal', 'analytics', 'timeline'].includes(ui.design)) bad('Design must be classic, new, minimal, analytics or timeline.');
    if (ui.layout !== undefined && !['default', 'compact', 'focus'].includes(ui.layout)) bad('Layout must be default, compact or focus.');
    if (ui.kpiDensity !== undefined && !['comfortable', 'compact'].includes(ui.kpiDensity)) bad('KPI density must be comfortable or compact.');
    if (ui.mobileDensity !== undefined && !['comfortable', 'compact'].includes(ui.mobileDensity)) bad('Mobile density must be comfortable or compact.');
    if (ui.heroBudget !== undefined && !['remaining', 'spent', 'hidden'].includes(ui.heroBudget)) bad('Hero budget must be remaining, spent or hidden.');
    if (ui.defaultTheme !== undefined && !(typeof ui.defaultTheme === 'string' && /^[a-z0-9_-]{0,24}$/i.test(ui.defaultTheme))) bad('Default theme is not valid.');
    if (ui.sections !== undefined) {
        if (!ui.sections || typeof ui.sections !== 'object' || Array.isArray(ui.sections)) {
            bad('Sections must be an object of true/false values.');
        } else {
            Object.keys(ui.sections).forEach(k => {
                if (!DASHBOARD_SECTIONS.includes(k)) bad('Unknown dashboard section: ' + k + '.');
                else if (typeof ui.sections[k] !== 'boolean') bad('Section ' + k + ' must be true or false.');
            });
        }
    }
    return out;
}

const DASHBOARD_MODES = ['household', 'personal', 'combined'];

function validateConfigPayload(body) {
    const errors = [];

    if (body.dashboardUi !== undefined) {
        dashboardUiErrors(body.dashboardUi).forEach(message => errors.push({ field: 'dashboardUi', message }));
    }

    if (body.dashboardMode !== undefined && !DASHBOARD_MODES.includes(body.dashboardMode)) {
        errors.push({
            field: 'dashboardMode',
            message: `Dashboard mode must be one of: ${DASHBOARD_MODES.join(', ')}.`
        });
    }

    if (body.monthlyBudgetLimit !== undefined) {
        const n = parseAmount(body.monthlyBudgetLimit);
        if (n === null) {
            errors.push({ field: 'monthlyBudgetLimit', message: 'Monthly budget must be a number.' });
        } else if (n < 0) {
            errors.push({ field: 'monthlyBudgetLimit', message: 'Monthly budget cannot be negative.' });
        }
    }

    if (Array.isArray(body.categories)) {
        body.categories.forEach((cat, i) => {
            if (!cat || cat.monthlyBudget === undefined || cat.monthlyBudget === null) return;
            const n = parseAmount(cat.monthlyBudget);
            if (n === null) {
                errors.push({
                    field: `categories[${i}].monthlyBudget`,
                    message: `Budget for '${cat.name || 'category'}' must be a number.`
                });
            } else if (n < 0) {
                errors.push({
                    field: `categories[${i}].monthlyBudget`,
                    message: `Budget for '${cat.name || 'category'}' cannot be negative.`
                });
            }
        });
    }

    if (Array.isArray(body.staff)) {
        body.staff.forEach((s, i) => {
            const where = `staff[${i}]`;
            if (!s || typeof s !== 'object') {
                errors.push({ field: where, message: 'Staff entry is malformed.' });
                return;
            }
            if (!String(s.name || '').trim()) {
                errors.push({ field: `${where}.name`, message: 'Staff name is required.' });
            }
            const salary = parseAmount(s.baseSalary !== undefined ? s.baseSalary : s.salary);
            if (salary === null) {
                errors.push({ field: `${where}.baseSalary`, message: 'Salary must be a number.' });
            } else if (salary < 0) {
                errors.push({ field: `${where}.baseSalary`, message: 'Salary cannot be negative.' });
            }
            if (s.allowedPaidLeaves !== undefined && s.allowedPaidLeaves !== null) {
                const leaves = parseDay(s.allowedPaidLeaves);
                if (leaves === null || leaves < 0 || leaves > 31) {
                    errors.push({ field: `${where}.allowedPaidLeaves`, message: 'Allowed leaves must be a whole number between 0 and 31.' });
                }
            }
            if (s.billingCycleDay !== undefined && s.billingCycleDay !== null) {
                const day = parseDay(s.billingCycleDay);
                if (day === null || day < 1 || day > 31) {
                    errors.push({ field: `${where}.billingCycleDay`, message: 'Payday must be a whole number between 1 and 31.' });
                }
            }
        });
    }

    if (Array.isArray(body.recurringBills)) {
        body.recurringBills.forEach((b, i) => {
            const where = `recurringBills[${i}]`;
            if (!b || typeof b !== 'object') {
                errors.push({ field: where, message: 'Bill entry is malformed.' });
                return;
            }
            if (!String(b.name || '').trim()) {
                errors.push({ field: `${where}.name`, message: 'Bill name is required.' });
            }
            const raw = b.approxAmount !== undefined ? b.approxAmount
                : (b.budgetedAmount !== undefined ? b.budgetedAmount : b.amount);
            const amount = parseAmount(raw);
            if (amount === null) {
                errors.push({ field: `${where}.approxAmount`, message: 'Bill amount must be a number.' });
            } else if (amount < 0) {
                errors.push({ field: `${where}.approxAmount`, message: 'Bill amount cannot be negative.' });
            }
            const day = parseDay(b.dueDay);
            if (day === null || day < 1 || day > 31) {
                errors.push({ field: `${where}.dueDay`, message: 'Due day must be a whole number between 1 and 31.' });
            }
        });
    }

    if (body.householdCycle && typeof body.householdCycle === 'object') {
        ['cycleStartDay', 'cycleEndDay'].forEach((key) => {
            const v = body.householdCycle[key];
            if (v === undefined || v === null) return;
            const day = parseDay(v);
            if (day === null || day < 1 || day > 31) {
                errors.push({ field: `householdCycle.${key}`, message: 'Cycle day must be a whole number between 1 and 31.' });
            }
        });
    }

    return errors;
}

// Which expense field each renameable entity is referenced by. `category` is
// also stored on recurring bills.
const ENTITY_FIELDS = {
    category: { list: 'categories', objects: true, expenseFields: ['category'] },
    familyMember: { list: 'familyMembers', objects: false, expenseFields: ['paidBy'] },
    paymentMethod: { list: 'paymentMethods', objects: false, expenseFields: ['paymentMethod'] },
    splitRule: { list: 'splitRules', objects: false, expenseFields: ['splitBetween'] }
};

function entitySpec(entity) {
    return ENTITY_FIELDS[entity] || null;
}

// How many live (non-deleted) expenses reference this value.
function countReferences(expenses, spec, value) {
    const needle = String(value).trim().toLowerCase();
    let n = 0;
    for (const e of expenses || []) {
        if (!e || e.isDeleted) continue;
        for (const f of spec.expenseFields) {
            if (String(e[f] == null ? '' : e[f]).trim().toLowerCase() === needle) {
                n += 1;
                break;
            }
        }
    }
    return n;
}

module.exports = {
    DASHBOARD_MODES,
    parseAmount,
    parseDay,
    validateConfigPayload,
    dashboardUiErrors,
    DASHBOARD_SECTIONS,
    entitySpec,
    countReferences,
    ENTITY_FIELDS
};
