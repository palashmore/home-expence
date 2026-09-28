// Centralized Storage Abstraction Layer for HOMEEXPENSES
// Enforces Household Isolation, Concurrency Control, and Audit Logging
const fs = require('fs');
const path = require('path');
const cloudSync = require('./_cloud_sync');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HOUSEHOLDS_DIR = path.join(DATA_DIR, 'households');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HOUSEHOLDS_FILE = path.join(DATA_DIR, 'households.json');

// In-Memory cache keyed by householdId
const memoryStore = {
    expenses: {}, // { H001: [...], H002: [...] }
    config: {},
    attendance: {},
    audit: {},
    receipts: {}
};

// ==========================================
// SECURITY & PATH SANITIZATION
// ==========================================
function sanitizeId(id) {
    if (!id || typeof id !== 'string') return null;
    const clean = id.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(clean)) return null;
    return clean;
}

function getHouseholdDir(householdId) {
    const clean = sanitizeId(householdId);
    if (!clean) {
        throw new Error('Security Error: Invalid or malformed household identifier.');
    }
    const dir = path.join(HOUSEHOLDS_DIR, clean);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        const receiptsDir = path.join(dir, 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    }
    return dir;
}

function getHouseholdFilePath(householdId, filename) {
    const dir = getHouseholdDir(householdId);
    return path.join(dir, filename);
}

// Safe JSON file read
function readJsonFile(filePath, fallback = null) {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn(`[Storage] Warning reading ${filePath}:`, e.message);
    }
    return fallback;
}

// Safe JSON file write with atomic fallback
function writeJsonFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn(`[Storage] Warning writing ${filePath}:`, e.message);
        return false;
    }
}

// ==========================================
// USER & HOUSEHOLD REGISTRY
// ==========================================
function getAllUsers() {
    return readJsonFile(USERS_FILE, []);
}

function getUserById(userId) {
    const users = getAllUsers();
    return users.find(u => u.userId === userId) || null;
}

function getUserByUsernameOrEmail(identifier) {
    if (!identifier) return null;
    const clean = String(identifier).trim().toLowerCase();
    const users = getAllUsers();
    return users.find(u => 
        (u.username && u.username.toLowerCase() === clean) ||
        (u.email && u.email.toLowerCase() === clean)
    ) || null;
}

function getAllHouseholds() {
    return readJsonFile(HOUSEHOLDS_FILE, []);
}

function getHouseholdById(householdId) {
    const clean = sanitizeId(householdId);
    if (!clean) return null;
    const households = getAllHouseholds();
    return households.find(h => h.householdId === clean) || null;
}

function createHousehold(data, actor = 'System') {
    if (!data || !data.householdName) {
        throw new Error('Household name is required.');
    }
    const households = getAllHouseholds();
    
    // Find next Hxxx ID
    let maxId = 0;
    households.forEach(h => {
        const m = h.householdId.match(/^H(\d+)$/i);
        if (m) {
            const num = parseInt(m[1], 10);
            if (num > maxId) maxId = num;
        }
    });
    const nextId = 'H' + String(maxId + 1).padStart(3, '0');
    
    const newHousehold = {
        householdId: nextId,
        householdName: String(data.householdName).trim(),
        status: 'active',
        ownerUserId: data.ownerUserId || null,
        memberUserIds: data.ownerUserId ? [data.ownerUserId] : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    households.push(newHousehold);
    writeJsonFile(HOUSEHOLDS_FILE, households);
    
    // Initialize household directory structure
    const dir = getHouseholdDir(nextId);
    writeJsonFile(path.join(dir, 'expenses.json'), []);
    
    const initialConfig = {
        monthlyBudgetLimit: Number(data.initialBudget) || 50000,
        cycleType: data.cycleType || "calendar",
        cycleStartDay: Number(data.cycleStartDay) || 1,
        cycleEndDay: Number(data.cycleEndDay) || 31,
        familyMembers: data.ownerName ? [data.ownerName] : ["Family Member"],
        paymentModes: ["UPI", "Credit Card", "Debit Card", "Net Banking", "Cash"],
        splitRules: ["50/50 Split", "100% Personal", "Shared Household"],
        staffMembers: [],
        recurringBills: [],
        expenseCategories: [
            { "name": "Groceries", "icon": "fa-basket-shopping", "color": "emerald" },
            { "name": "Utilities", "icon": "fa-bolt", "color": "amber" },
            { "name": "Dining & Food", "icon": "fa-utensils", "color": "orange" },
            { "name": "Domestic Staff", "icon": "fa-users-gear", "color": "purple" },
            { "name": "Healthcare & Medical", "icon": "fa-notes-medical", "color": "rose" },
            { "name": "Transportation & Fuel", "icon": "fa-car", "color": "blue" },
            { "name": "Shopping & Lifestyle", "icon": "fa-bag-shopping", "color": "pink" },
            { "name": "Home Maintenance", "icon": "fa-screwdriver-wrench", "color": "slate" }
        ],
        updatedAt: new Date().toISOString()
    };
    writeJsonFile(path.join(dir, 'config.json'), initialConfig);
    writeJsonFile(path.join(dir, 'attendance.json'), {});
    writeJsonFile(path.join(dir, 'audit_log.json'), [{
        id: `AUD-${Date.now()}-INIT`,
        timestamp: new Date().toISOString(),
        action: 'CREATE_HOUSEHOLD',
        actor: actor,
        details: `Household ${newHousehold.householdName} (${nextId}) created`
    }]);

    return newHousehold;
}

function createUser(data, actor = 'System') {
    if (!data || !data.username) throw new Error('Username is required.');
    if (!data.householdId) throw new Error('Household assignment is required.');
    
    const cleanUsername = String(data.username).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
        throw new Error('Username must be 3-30 alphanumeric characters.');
    }
    
    const existing = getUserByUsernameOrEmail(cleanUsername);
    if (existing) {
        throw new Error(`Username or email '${cleanUsername}' already exists.`);
    }

    const households = getAllHouseholds();
    const targetHousehold = households.find(h => h.householdId === data.householdId);
    if (!targetHousehold) {
        throw new Error(`Household ${data.householdId} does not exist.`);
    }

    const users = getAllUsers();
    let maxId = 0;
    users.forEach(u => {
        const m = u.userId.match(/^U(\d+)$/i);
        if (m) {
            const num = parseInt(m[1], 10);
            if (num > maxId) maxId = num;
        }
    });
    const nextId = 'U' + String(maxId + 1).padStart(3, '0');

    const newUser = {
        userId: nextId,
        username: cleanUsername,
        email: String(data.email || `${cleanUsername}@homeexpenses.local`).trim().toLowerCase(),
        name: String(data.name || cleanUsername).trim(),
        passwordHash: data.passwordHash,
        householdId: data.householdId,
        role: (data.role || 'MEMBER').toUpperCase(),
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    users.push(newUser);
    writeJsonFile(USERS_FILE, users);

    // Link user to household memberUserIds
    if (!targetHousehold.memberUserIds) targetHousehold.memberUserIds = [];
    if (!targetHousehold.memberUserIds.includes(nextId)) {
        targetHousehold.memberUserIds.push(nextId);
        targetHousehold.updatedAt = new Date().toISOString();
        writeJsonFile(HOUSEHOLDS_FILE, households);
    }

    // Also add name to household config.json familyMembers if not already present
    try {
        const configPath = getHouseholdFilePath(data.householdId, 'config.json');
        const config = readJsonFile(configPath);
        if (config && Array.isArray(config.familyMembers)) {
            if (!config.familyMembers.includes(newUser.name)) {
                config.familyMembers.push(newUser.name);
                writeJsonFile(configPath, config);
            }
        }
    } catch (e) {}

    return {
        userId: newUser.userId,
        username: newUser.username,
        email: newUser.email,
        name: newUser.name,
        householdId: newUser.householdId,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt
    };
}

function updateHousehold(householdId, updates) {
    const cleanId = sanitizeId(householdId);
    if (!cleanId) throw new Error('Invalid household ID.');
    const households = getAllHouseholds();
    const idx = households.findIndex(h => h.householdId === cleanId);
    if (idx === -1) throw new Error('Household not found.');
    
    households[idx] = {
        ...households[idx],
        ...updates,
        householdId: cleanId,
        updatedAt: new Date().toISOString()
    };
    writeJsonFile(HOUSEHOLDS_FILE, households);
    return households[idx];
}

// ==========================================
// HOUSEHOLD-SCOPED EXPENSES REPOSITORY
// ==========================================
function calculateStaffBillingCycle(category, dateStr) {
    if (!dateStr) return 'Standard';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Standard';
    const year = d.getFullYear();
    const month = d.getMonth();
    if (category === 'Maid - Madhuri') {
        return `${year}-${String(month + 1).padStart(2, '0')}-21`;
    } else if (category === 'Chef - Nilima Nikose') {
        const lastDay = new Date(year, month + 1, 0).getDate();
        const targetDay = Math.min(30, lastDay);
        return `${year}-${String(month + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    }
    return 'Standard';
}

async function getHouseholdExpenses(householdId, includeDeleted = false) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Valid Household ID required.');

    // 1. Check in-memory store
    if (!memoryStore.expenses[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'expenses.json');
        let records = readJsonFile(filePath, null);

        // Fallback for H001 legacy path if newly initialized
        if (!records && cleanHId === 'H001') {
            const legacyPath = path.join(DATA_DIR, 'expenses.json');
            records = readJsonFile(legacyPath, []);
        }

        memoryStore.expenses[cleanHId] = Array.isArray(records) ? records : [];
    }

    const list = memoryStore.expenses[cleanHId];
    const activeList = includeDeleted ? list : list.filter(i => !i.isDeleted);
    return [...activeList].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getHouseholdExpenseById(householdId, id) {
    const list = await getHouseholdExpenses(householdId, true);
    const cleanId = String(id).trim();
    return list.find(i => String(i.id).trim() === cleanId) || null;
}

async function saveHouseholdExpense(householdId, record, actorUser = 'System') {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (!record.date || isNaN(new Date(record.date).getTime())) {
        throw new Error('Validation Error: Valid transaction date is required.');
    }
    if (isNaN(record.amount) || Number(record.amount) <= 0) {
        throw new Error('Validation Error: Amount must be a positive number greater than zero.');
    }

    const list = await getHouseholdExpenses(cleanHId, true);
    const now = new Date().toISOString();
    const cleanId = record.id ? String(record.id).trim() : null;
    const existingIdx = cleanId ? list.findIndex(i => String(i.id).trim() === cleanId) : -1;
    const existing = existingIdx !== -1 ? list[existingIdx] : null;

    // Optimistic Concurrency Conflict Detection
    if (existing && record.version !== undefined && record.version !== null) {
        const expectedVersion = Number(existing.version || 1);
        const incomingVersion = Number(record.version);
        if (incomingVersion < expectedVersion) {
            const err = new Error('This expense was modified elsewhere. Please reload the latest version before saving.');
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

    let paidBy = record.paidBy;
    if (paidBy === undefined || paidBy === null || paidBy === '') {
        paidBy = existing ? (existing.paidBy || 'Not Specified') : 'Not Specified';
    }

    let splitBetween = record.splitBetween;
    if (splitBetween === undefined || splitBetween === null || splitBetween === '') {
        splitBetween = existing ? (existing.splitBetween || 'Household Expense') : 'Household Expense';
    }

    let receipt = existing ? existing.receipt : null;
    if (record.receipt !== undefined) {
        receipt = record.receipt;
    }
    let receiptStatus = receipt ? 'Yes (Attached)' : (record.receiptStatus || (existing ? existing.receiptStatus : 'No Receipt'));

    const formatted = {
        ...(existing || {}),
        id: record.id || `exp-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        householdId: cleanHId,
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
        createdBy: existing?.createdBy || actorUser,
        updatedBy: actorUser,
        createdAt: existing?.createdAt || existing?.updatedAt || now,
        updatedAt: now,
        version: (existing?.version || 0) + 1
    };

    // Calculate diff for audit trail
    const diff = {};
    if (existing) {
        if (Number(existing.amount) !== Number(formatted.amount)) diff.amount = { old: Number(existing.amount), new: Number(formatted.amount) };
        if (existing.category !== formatted.category) diff.category = { old: existing.category, new: formatted.category };
        if (existing.paidBy !== formatted.paidBy) diff.paidBy = { old: existing.paidBy, new: formatted.paidBy };
        if (existing.date !== formatted.date) diff.date = { old: existing.date, new: formatted.date };
        if (existing.paidTo !== formatted.paidTo) diff.paidTo = { old: existing.paidTo, new: formatted.paidTo };
        if (existing.notes !== formatted.notes) diff.notes = { old: existing.notes, new: formatted.notes };
    } else {
        diff.created = { amount: formatted.amount, category: formatted.category, paidBy: formatted.paidBy, date: formatted.date };
    }

    if (existingIdx !== -1) {
        list[existingIdx] = formatted;
    } else {
        list.unshift(formatted);
    }
    memoryStore.expenses[cleanHId] = list;

    // Persist to household file
    const filePath = getHouseholdFilePath(cleanHId, 'expenses.json');
    writeJsonFile(filePath, list);

    // If H001, also mirror to data/expenses.json for legacy redundancy
    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'expenses.json'), list);
    }

    // Audit Logging
    await logHouseholdAudit(
        cleanHId,
        existing ? 'UPDATE_EXPENSE' : 'CREATE_EXPENSE',
        formatted.id,
        diff,
        { category: formatted.category, amount: formatted.amount, paidBy: formatted.paidBy, date: formatted.date },
        actorUser
    );

    return formatted;
}

async function deleteHouseholdExpense(householdId, id, actorUser = 'System') {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');
    if (!id) return false;

    const cleanId = String(id).trim();
    const list = await getHouseholdExpenses(cleanHId, true);
    const existingIdx = list.findIndex(i => String(i.id).trim() === cleanId);
    if (existingIdx === -1) return false;

    const existing = list[existingIdx];
    const now = new Date().toISOString();

    // Soft delete
    existing.isDeleted = true;
    existing.deletedAt = now;
    existing.deletedBy = actorUser;
    existing.updatedAt = now;
    existing.version = (existing.version || 0) + 1;

    memoryStore.expenses[cleanHId] = list;

    const filePath = getHouseholdFilePath(cleanHId, 'expenses.json');
    writeJsonFile(filePath, list);

    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'expenses.json'), list);
    }

    await logHouseholdAudit(
        cleanHId,
        'DELETE_EXPENSE',
        cleanId,
        { deleted: true, amount: existing.amount, category: existing.category },
        { id: cleanId, category: existing.category, amount: existing.amount },
        actorUser
    );

    return true;
}

// ==========================================
// HOUSEHOLD-SCOPED CONFIG REPOSITORY
// ==========================================
async function getHouseholdConfig(householdId) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (!memoryStore.config[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'config.json');
        let config = readJsonFile(filePath, null);
        if (!config && cleanHId === 'H001') {
            config = readJsonFile(path.join(DATA_DIR, 'config.json'), {});
        }
        memoryStore.config[cleanHId] = config || {};
    }
    return memoryStore.config[cleanHId];
}

async function saveHouseholdConfig(householdId, newConfig, actorUser = 'System') {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    memoryStore.config[cleanHId] = newConfig;

    const filePath = getHouseholdFilePath(cleanHId, 'config.json');
    writeJsonFile(filePath, newConfig);

    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'config.json'), newConfig);
    }

    await logHouseholdAudit(cleanHId, 'UPDATE_CONFIG', 'config', { updated: true }, newConfig, actorUser);
    return newConfig;
}

// ==========================================
// HOUSEHOLD-SCOPED ATTENDANCE REPOSITORY
// ==========================================
async function getHouseholdAttendance(householdId) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (!memoryStore.attendance[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'attendance.json');
        let attendance = readJsonFile(filePath, null);
        if (!attendance && cleanHId === 'H001') {
            attendance = readJsonFile(path.join(DATA_DIR, 'staff_attendance.json'), {});
        }
        memoryStore.attendance[cleanHId] = attendance || {};
    }
    return memoryStore.attendance[cleanHId];
}

async function saveHouseholdAttendance(householdId, attendanceData, actorUser = 'System') {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    memoryStore.attendance[cleanHId] = attendanceData;
    const filePath = getHouseholdFilePath(cleanHId, 'attendance.json');
    writeJsonFile(filePath, attendanceData);

    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'staff_attendance.json'), attendanceData);
    }
    return attendanceData;
}

// ==========================================
// HOUSEHOLD-SCOPED AUDIT LOG REPOSITORY
// ==========================================
async function getHouseholdAuditLogs(householdId, limit = 100) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (!memoryStore.audit[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'audit_log.json');
        let logs = readJsonFile(filePath, null);
        if (!logs && cleanHId === 'H001') {
            logs = readJsonFile(path.join(DATA_DIR, 'audit_log.json'), []);
        }
        memoryStore.audit[cleanHId] = Array.isArray(logs) ? logs : [];
    }
    return memoryStore.audit[cleanHId].slice(0, limit);
}

async function logHouseholdAudit(householdId, action, recordId, diff = {}, snapshot = {}, actorUser = 'System') {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) return;

    const logEntry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        householdId: cleanHId,
        timestamp: new Date().toISOString(),
        action: action,
        recordId: recordId,
        actor: actorUser,
        diff: diff,
        snapshot: snapshot
    };

    if (!memoryStore.audit[cleanHId]) {
        await getHouseholdAuditLogs(cleanHId);
    }
    memoryStore.audit[cleanHId].unshift(logEntry);
    if (memoryStore.audit[cleanHId].length > 500) {
        memoryStore.audit[cleanHId] = memoryStore.audit[cleanHId].slice(0, 500);
    }

    const filePath = getHouseholdFilePath(cleanHId, 'audit_log.json');
    writeJsonFile(filePath, memoryStore.audit[cleanHId]);

    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'audit_log.json'), memoryStore.audit[cleanHId]);
    }
}

// ==========================================
// HOUSEHOLD-SCOPED RECEIPTS REPOSITORY
// ==========================================
async function saveHouseholdReceipt(householdId, receiptId, base64Data) {
    const cleanHId = sanitizeId(householdId);
    const cleanRId = sanitizeId(receiptId);
    if (!cleanHId || !cleanRId) throw new Error('Invalid household or receipt identifier.');

    const dir = path.join(getHouseholdDir(cleanHId), 'receipts');
    const filePath = path.join(dir, `${cleanRId}.json`);
    writeJsonFile(filePath, { receiptId: cleanRId, data: base64Data, savedAt: new Date().toISOString() });
    return cleanRId;
}

async function getHouseholdReceipt(householdId, receiptId) {
    const cleanHId = sanitizeId(householdId);
    const cleanRId = sanitizeId(receiptId);
    if (!cleanHId || !cleanRId) return null;

    const dir = path.join(getHouseholdDir(cleanHId), 'receipts');
    const filePath = path.join(dir, `${cleanRId}.json`);
    const payload = readJsonFile(filePath, null);
    return payload ? payload.data : null;
}

// ==========================================
// HOUSEHOLD-SCOPED BACKUP & RESTORE
// ==========================================
async function getHouseholdBackupBundle(householdId) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    const expenses = await getHouseholdExpenses(cleanHId, true);
    const config = await getHouseholdConfig(cleanHId);
    const attendance = await getHouseholdAttendance(cleanHId);
    const audit = await getHouseholdAuditLogs(cleanHId, 500);
    const household = getHouseholdById(cleanHId);

    return {
        backupVersion: "5.0-multitenant",
        householdId: cleanHId,
        householdName: household?.householdName || cleanHId,
        createdAt: new Date().toISOString(),
        expenses: expenses,
        config: config,
        attendance: attendance,
        auditLog: audit
    };
}

module.exports = {
    sanitizeId,
    getAllUsers,
    getUserById,
    getUserByUsernameOrEmail,
    getAllHouseholds,
    getHouseholdById,
    createHousehold,
    createUser,
    updateHousehold,
    getHouseholdExpenses,
    getHouseholdExpenseById,
    saveHouseholdExpense,
    deleteHouseholdExpense,
    getHouseholdConfig,
    saveHouseholdConfig,
    getHouseholdAttendance,
    saveHouseholdAttendance,
    getHouseholdAuditLogs,
    logHouseholdAudit,
    saveHouseholdReceipt,
    getHouseholdReceipt,
    getHouseholdBackupBundle
};
