// Server-side JSON Database Layer for Household Expense Tracker
// Maintains complete expense records directly in a server JSON file (data/expenses.json)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'expenses.json');
const FALLBACK_FILE = path.join(__dirname, '..', 'initial_expenses.json');
const EXCEL_IMPORT_PATH = 'C:\\Users\\lenovo\\Downloads\\DOC-20260924-WA0001.xlsx';

// Receipts store in memory / tmp
let receiptStore = {};

// Helper: Calculate Staff Billing Cycle
function calculateStaffBillingCycle(category, dateStr) {
    if (!dateStr) return 'Standard';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Standard';

    const year = d.getFullYear();
    const month = d.getMonth(); // 0-11

    if (category === 'Maid - Madhuri') {
        return `${year}-${String(month + 1).padStart(2, '0')}-21`;
    } else if (category === 'Chef - Nilima Nikose') {
        const lastDay = new Date(year, month + 1, 0).getDate();
        const targetDay = Math.min(30, lastDay);
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    }
    return 'Standard';
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

    // 2. Also update initial_expenses.json for redundancy
    try {
        fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
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

async function getAllExpenses() {
    try {
        const fileData = readExpensesFromFile();
        if (fileData && fileData.length > 0) {
            memoryStore = fileData;
        }
    } catch (e) {}

    return [...memoryStore].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getExpenseById(id) {
    return memoryStore.find(i => i.id === id) || null;
}

async function saveExpense(record) {
    if (!record.date || isNaN(new Date(record.date).getTime())) {
        throw new Error('Invalid or missing transaction date.');
    }
    if (isNaN(record.amount) || Number(record.amount) <= 0) {
        throw new Error('Amount must be a positive number.');
    }

    // Refresh memoryStore from persistent disk file before matching
    const fileData = readExpensesFromFile();
    if (fileData && fileData.length > 0) {
        memoryStore = fileData;
    }

    const now = new Date().toISOString();
    const cleanId = record.id ? String(record.id).trim() : null;
    const existingIdx = cleanId ? memoryStore.findIndex(i => String(i.id).trim() === cleanId) : -1;
    const existing = existingIdx !== -1 ? memoryStore[existingIdx] : null;

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
        createdAt: existing?.createdAt || existing?.updatedAt || now,
        updatedAt: now,
        version: (existing?.version || 0) + 1
    };

    if (existingIdx !== -1) {
        memoryStore[existingIdx] = formatted;
    } else {
        memoryStore.unshift(formatted);
    }

    // Persist immediately to Server JSON file
    writeExpensesToFile(memoryStore);

    return formatted;
}

async function deleteExpense(id) {
    if (!id) return false;
    const cleanId = String(id).trim();

    // Refresh memoryStore from persistent disk file before deleting
    const fileData = readExpensesFromFile();
    if (fileData && fileData.length > 0) {
        memoryStore = fileData;
    }

    const existingIdx = memoryStore.findIndex(i => String(i.id).trim() === cleanId);
    if (existingIdx === -1) return false;

    memoryStore.splice(existingIdx, 1);

    // Persist immediately to Server JSON file
    writeExpensesToFile(memoryStore);

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
