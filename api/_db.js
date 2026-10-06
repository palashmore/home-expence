// Server-side JSON Database Layer for Household Expense Tracker
// Maintains complete expense records directly in a server JSON file (data/expenses.json)
const fs = require('fs');
const path = require('path');
const cloudSync = require('./_cloud_sync');
const paths = require('./_paths');

const DATA_DIR = paths.DATA_DIR;
const DATA_FILE = path.join(DATA_DIR, 'expenses.json');
// Read-only seed that ships with the repository. It is never written to:
// see SEED_MIRROR below.
const FALLBACK_FILE = path.join(__dirname, '..', 'initial_expenses.json');
// The mirror copy follows DATA_DIR. It used to be FALLBACK_FILE itself, so
// every save wrote into the repository working tree regardless of
// HOMEEXPENSES_DATA_DIR - which meant a test run, or an API probe, silently
// edited a tracked file. The suites only asserted that data/ was unchanged, so
// nothing caught it.
const SEED_MIRROR = path.join(DATA_DIR, 'initial_expenses.json');
const EXCEL_IMPORT_PATH = 'C:\\Users\\lenovo\\Downloads\\DOC-20260924-WA0001.xlsx';

// Receipts store in memory / tmp
let receiptStore = {};

// Helper: Calculate Staff Billing Cycle
function calculateStaffBillingCycle(category, dateStr, staffList) {
    if (!dateStr) return 'Standard';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Standard';

    // The cycle day comes from the household's own staff configuration. It used
    // to be hardcoded to two named staff members, which was wrong for every
    // other household.
    const staff = Array.isArray(staffList) ? staffList : [];
    const target = String(category || '').trim().toLowerCase();
    const match = staff.find(s => {
        if (!s) return false;
        const cat = String(s.category || s.name || '').trim().toLowerCase();
        return cat && cat === target;
    });
    const cycleDay = match ? Number(match.billingCycleDay) : 0;
    if (!cycleDay || cycleDay < 1) return 'Standard';

    const year = d.getFullYear();
    const month = d.getMonth();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(cycleDay, lastDay);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Helper: Read records from the Server JSON file
function readExpensesFromFile() {
    // 0. Check /tmp on Vercel or serverless environments first
    const tmpFile = path.join('/tmp', 'expenses.json');
    try {
        if ((process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) && fs.existsSync(tmpFile)) {
            const raw = fs.readFileSync(tmpFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {}

    // 1. Try reading data/expenses.json
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('Notice: Error reading data/expenses.json:', err.message);
    }

    // Fallback: Check /tmp even outside Vercel
    try {
        if (fs.existsSync(tmpFile)) {
            const raw = fs.readFileSync(tmpFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {}

    // 2. Try reading fallback initial_expenses.json
    try {
        if (fs.existsSync(FALLBACK_FILE)) {
            const raw = fs.readFileSync(FALLBACK_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('Notice: Error reading fallback initial_expenses.json:', err.message);
    }

    // 3. Try reading directly from Excel if available
    try {
        if (fs.existsSync(EXCEL_IMPORT_PATH)) {
            const xlsx = require('xlsx');
            const wb = xlsx.readFile(EXCEL_IMPORT_PATH);
            const sheet = wb.Sheets['Daily Expenses Log'] || wb.Sheets[wb.SheetNames[0]];
            const rows = xlsx.utils.sheet_to_json(sheet);
            if (rows.length > 0) {
                const records = rows.map((r, i) => {
                    const dateStr = r['Date'];
                    const cat = r['Expense Category'] || 'Shopping & Miscellaneous';
                    const paidTo = r['Paid To / Vendor'] || '';
                    const notes = r['Notes / Description'] || '';
                    return {
                        id: `exp-${String(i + 1).padStart(3, '0')}`,
                        date: dateStr,
                        category: cat,
                        amount: Number(r['Amount (INR)'] || 0),
                        paidTo: paidTo,
                        vendor: paidTo,
                        paymentMethod: r['Payment Method'] || 'UPI',
                        notes: notes,
                        description: notes,
                        billingCycle: calculateStaffBillingCycle(cat, dateStr),
                        receipt: null,
                        receiptStatus: r['Receipt Status'] || 'No Receipt',
                        updatedAt: new Date().toISOString(),
                        version: 1
                    };
                });
                writeExpensesToFile(records);
                return records;
            }
        }
    } catch (err) {
        console.warn('Notice: Error reading from Excel sync file:', err.message);
    }

    return [];
}

// Helper: Write records to the Server JSON file
function writeExpensesToFile(data) {
    if (!Array.isArray(data)) return false;

    // 1. Write to data/expenses.json
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.warn('Warning: Could not write to data/expenses.json (serverless filesystem may be read-only):', err.message);
    }

    // 2. Mirror alongside the active data directory, not into the repository.
    try {
        fs.writeFileSync(SEED_MIRROR, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {}

    // 3. Fallback for Vercel /tmp environment
    try {
        const tmpDir = '/tmp';
        if (fs.existsSync(tmpDir)) {
            fs.writeFileSync(path.join(tmpDir, 'expenses.json'), JSON.stringify(data, null, 2), 'utf8');
        }
    } catch (err) {}

    return true;
}

// In-Memory cache synchronized with Server JSON file
let memoryStore = readExpensesFromFile();

// ---------------- SERVER-SIDE DATA ACCESS METHODS ----------------

async function getAllExpenses(includeDeleted = false) {
    try {
        const cloudData = await cloudSync.readJson('expenses.json');
        if (Array.isArray(cloudData) && cloudData.length > 0) {
            memoryStore = cloudData;
        } else {
            const fileData = readExpensesFromFile();
            if (fileData && fileData.length > 0) {
                memoryStore = fileData;
            }
        }
    } catch (e) {
        try {
            const fileData = readExpensesFromFile();
            if (fileData && fileData.length > 0) memoryStore = fileData;
        } catch (err) {}
    }

    const activeList = includeDeleted ? memoryStore : memoryStore.filter(i => !i.isDeleted);
    return [...activeList].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getExpenseById(id) {
    if (!memoryStore || memoryStore.length === 0) {
        await getAllExpenses();
    }
    return memoryStore.find(i => String(i.id).trim() === String(id).trim()) || null;
}

async function saveExpense(record) {
    if (!record.date || isNaN(new Date(record.date).getTime())) {
        throw new Error('Invalid or missing transaction date.');
    }
    if (isNaN(record.amount) || Number(record.amount) <= 0) {
        throw new Error('Amount must be a positive number.');
    }

    // Always refresh latest authoritative data from Cloud before mutating
    try {
        const cloudData = await cloudSync.readJson('expenses.json');
        if (Array.isArray(cloudData) && cloudData.length > 0) {
            memoryStore = cloudData;
        } else {
            const fileData = readExpensesFromFile();
            if (fileData && fileData.length > 0) memoryStore = fileData;
        }
    } catch (e) {}

    const now = new Date().toISOString();
    const cleanId = record.id ? String(record.id).trim() : null;
    const existingIdx = cleanId ? memoryStore.findIndex(i => String(i.id).trim() === cleanId) : -1;
    const existing = existingIdx !== -1 ? memoryStore[existingIdx] : null;

    // Optimistic Concurrency Conflict Detection
    if (existing && record.version !== undefined && record.version !== null) {
        const expectedVersion = Number(existing.version || 1);
        const incomingVersion = Number(record.version);
        if (incomingVersion < expectedVersion) {
            const err = new Error("This expense was modified elsewhere. Please reload the latest version before saving.");
            err.code = 'ERR_CONFLICT';
            err.status = 409;
            err.currentRecord = existing;
            throw err;
        }
    }

    const category = record.category || (existing ? existing.category : 'Shopping & Miscellaneous');
    const billingCycle = record.billingCycle || calculateStaffBillingCycle(category, record.date);
    const paidTo = record.paidTo !== undefined ? record.paidTo : (record.vendor !== undefined ? record.vendor : (existing ? (existing.paidTo || existing.vendor || '') : ''));
    const notes = record.notes !== undefined ? record.notes : (record.description !== undefined ? record.description : (existing ? (existing.notes || existing.description || '') : ''));

    // Handle Paid By accurately (support Palash, Pallavi, Mom, Dad, Not Specified)
    let paidBy = record.paidBy;
    if (paidBy === undefined || paidBy === null || paidBy === "") {
        paidBy = existing ? (existing.paidBy || "Not Specified") : "Not Specified";
    }

    // Split Between (support Household Expense, Personal, etc.)
    let splitBetween = record.splitBetween;
    if (splitBetween === undefined || splitBetween === null || splitBetween === "") {
        splitBetween = existing ? (existing.splitBetween || "Household Expense (Palash Reimburses Pallavi 100%)") : "Household Expense (Palash Reimburses Pallavi 100%)";
    }

    // Receipt handling - preserve existing receipt if new one isn't passed and hasn't been explicitly cleared
    let receipt = existing ? existing.receipt : null;
    if (record.receipt !== undefined) {
        receipt = record.receipt;
    }
    let receiptStatus = receipt ? 'Yes (Attached)' : (record.receiptStatus || (existing ? existing.receiptStatus : 'No Receipt'));

    const formatted = {
        ...(existing || {}),
        id: record.id || `exp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        date: record.date,
        amount: Number(record.amount),
        category: category,
        paidBy: paidBy,
        splitBetween: splitBetween,
        paidTo: paidTo,
        vendor: paidTo,
        paymentMethod: record.paymentMethod || (existing ? existing.paymentMethod : 'UPI'),
        notes: notes,
        description: notes,
        billingCycle: billingCycle,
        receipt: receipt,
        receiptStatus: receiptStatus,
        isDeleted: false,
        createdAt: existing?.createdAt || existing?.updatedAt || now,
        updatedAt: now,
        version: (existing?.version || 0) + 1
    };

    // Calculate detailed diff for Audit Logging
    const diff = {};
    if (existing) {
        if (Number(existing.amount) !== Number(formatted.amount)) {
            diff.amount = { old: Number(existing.amount), new: Number(formatted.amount) };
        }
        if (existing.splitBetween !== formatted.splitBetween) {
            diff.splitBetween = { old: existing.splitBetween, new: formatted.splitBetween };
        }
        if (existing.paidBy !== formatted.paidBy) {
            diff.paidBy = { old: existing.paidBy, new: formatted.paidBy };
        }
        if (existing.category !== formatted.category) {
            diff.category = { old: existing.category, new: formatted.category };
        }
        if (existing.date !== formatted.date) {
            diff.date = { old: existing.date, new: formatted.date };
        }
        if ((existing.paidTo || existing.vendor) !== formatted.paidTo) {
            diff.paidTo = { old: existing.paidTo || existing.vendor, new: formatted.paidTo };
        }
        if ((existing.notes || existing.description) !== formatted.notes) {
            diff.notes = { old: existing.notes || existing.description, new: formatted.notes };
        }
        if (existing.paymentMethod !== formatted.paymentMethod) {
            diff.paymentMethod = { old: existing.paymentMethod, new: formatted.paymentMethod };
        }
    } else {
        diff.created = {
            amount: formatted.amount,
            category: formatted.category,
            paidBy: formatted.paidBy,
            splitBetween: formatted.splitBetween,
            date: formatted.date
        };
    }

    if (existingIdx !== -1) {
        memoryStore[existingIdx] = formatted;
    } else {
        memoryStore.unshift(formatted);
    }

    // 1. Persist to Cloud Sync (Gist) for instant cross-device updates
    await cloudSync.writeJson('expenses.json', memoryStore);

    // 2. Persist to local disk files
    writeExpensesToFile(memoryStore);

    // 3. Log Audit Trail & Stream to Vercel Logs
    await cloudSync.logAudit(
        existing ? 'UPDATE_EXPENSE' : 'CREATE_EXPENSE',
        formatted.id,
        diff,
        {
            category: formatted.category,
            amount: formatted.amount,
            paidBy: formatted.paidBy,
            splitBetween: formatted.splitBetween,
            date: formatted.date
        }
    );

    return formatted;
}

async function deleteExpense(id, deletedBy = 'User') {
    if (!id) return false;
    const cleanId = String(id).trim();

    try {
        const cloudData = await cloudSync.readJson('expenses.json');
        if (Array.isArray(cloudData) && cloudData.length > 0) memoryStore = cloudData;
    } catch (e) {}

    const existingIdx = memoryStore.findIndex(i => String(i.id).trim() === cleanId);
    if (existingIdx === -1) return false;

    const existing = memoryStore[existingIdx];
    const now = new Date().toISOString();

    // Soft delete: flag record so financial history is never accidentally lost
    const softDeleted = {
        ...existing,
        isDeleted: true,
        deletedAt: now,
        deletedBy: deletedBy || 'User',
        updatedAt: now,
        version: (existing.version || 0) + 1
    };

    memoryStore[existingIdx] = softDeleted;

    // Persist to Cloud and local disk
    await cloudSync.writeJson('expenses.json', memoryStore);
    writeExpensesToFile(memoryStore);

    // Log Audit Trail
    await cloudSync.logAudit('DELETE_EXPENSE', cleanId, {
        deleted: {
            id: existing.id,
            category: existing.category,
            amount: existing.amount,
            paidBy: existing.paidBy,
            date: existing.date,
            deletedAt: now,
            deletedBy: deletedBy
        }
    });

    return true;
}

async function batchMigrateExpenses(records) {
    if (!Array.isArray(records)) throw new Error('Invalid migration array.');

    let importedCount = 0;
    let skippedCount = 0;
    const now = new Date().toISOString();

    records.forEach(rec => {
        if (!rec.date || isNaN(Number(rec.amount)) || Number(rec.amount) <= 0) {
            skippedCount++;
            return;
        }

        const idMatch = memoryStore.find(i => i.id === rec.id);
        const paidTo = rec.paidTo || rec.vendor || '';
        const notes = rec.notes || rec.description || '';
        
        const fingerprintMatch = memoryStore.find(i => 
            i.date === rec.date && 
            Number(i.amount) === Number(rec.amount) && 
            i.category === rec.category && 
            (i.notes === notes || (!i.notes && !notes))
        );

        if (idMatch || fingerprintMatch) {
            skippedCount++;
        } else {
            const cat = rec.category || 'Shopping & Miscellaneous';
            const billingCycle = rec.billingCycle || calculateStaffBillingCycle(cat, rec.date);
            const paidBy = rec.paidBy || (notes && notes.toLowerCase().includes('pallavi') ? 'Pallavi' : (notes && notes.toLowerCase().includes('palash') ? 'Palash' : 'Not Specified'));
            memoryStore.push({
                id: rec.id || `exp-excel-${Date.now()}-${importedCount}`,
                date: rec.date,
                amount: Number(rec.amount),
                category: cat,
                paidBy: paidBy,
                paidTo: paidTo,
                vendor: paidTo,
                paymentMethod: rec.paymentMethod || 'UPI',
                notes: notes,
                description: notes,
                billingCycle: billingCycle,
                receipt: rec.receipt || null,
                receiptStatus: rec.receipt ? 'Yes (Attached)' : 'No Receipt',
                updatedAt: now,
                version: 1
            });
            importedCount++;
        }
    });

    // Persist immediately to Server JSON file
    writeExpensesToFile(memoryStore);

    return { importedCount, skippedCount, totalOnlineRecords: memoryStore.length };
}

async function saveReceiptImage(receiptId, base64Data) {
    receiptStore[receiptId] = base64Data;
    return true;
}

async function getReceiptImage(receiptId) {
    return receiptStore[receiptId] || null;
}

module.exports = {
    getAllExpenses,
    getExpenseById,
    saveExpense,
    deleteExpense,
    batchMigrateExpenses,
    saveReceiptImage,
    getReceiptImage,
    calculateStaffBillingCycle,
    writeExpensesToFile,
    readExpensesFromFile
};
