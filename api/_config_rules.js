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
function validateConfigPayload(body) {
    const errors = [];

    if (body.monthlyBudgetLimit !== undefined) {
        const n = parseAmount(body.monthlyBudgetLimit);
        if (n === null) {
            errors.push({ field: 'monthlyBudgetLimit', message: 'Monthly budget must be a number.' });
        } else if (n < 0) {
            errors.push({ field: 'monthlyBudgetLimit', message: 'Monthly budget cannot be negative.' });
        }
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
    parseAmount,
    parseDay,
    validateConfigPayload,
    entitySpec,
    countReferences,
    ENTITY_FIELDS
};
