const fs = require('fs');
const permsRegistry = require('./_permissions');
const path = require('path');
const cloudSync = require('./_cloud_sync');
const cloudStore = require('./_cloud_store');
const paths = require('./_paths');

const DATA_DIR = paths.DATA_DIR;
const HOUSEHOLDS_DIR = paths.HOUSEHOLDS_DIR;
const USERS_FILE = paths.USERS_FILE;
const HOUSEHOLDS_FILE = paths.HOUSEHOLDS_FILE;

// Writable overlay directory for serverless (Vercel / AWS Lambda) and cross-platform temp storage
const TMP_BASE_DIR = paths.TMP_DIR;
const TMP_HOUSEHOLDS_DIR = paths.TMP_HOUSEHOLDS_DIR;
const TMP_USERS_FILE = paths.TMP_USERS_FILE;
const TMP_HOUSEHOLDS_FILE = paths.TMP_HOUSEHOLDS_FILE;

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

    // Always ensure TMP writable directory exists
    const tmpDir = path.join(TMP_HOUSEHOLDS_DIR, clean);
    try {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpReceiptsDir = path.join(tmpDir, 'receipts');
        if (!fs.existsSync(tmpReceiptsDir)) fs.mkdirSync(tmpReceiptsDir, { recursive: true });
    } catch (e) {}

    // Also attempt local filesystem directory
    const dir = path.join(HOUSEHOLDS_DIR, clean);
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const receiptsDir = path.join(dir, 'receipts');
        if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    } catch (e) {}

    return dir;
}

function getHouseholdFilePath(householdId, filename) {
    const dir = getHouseholdDir(householdId);
    return path.join(dir, filename);
}

// Safe JSON file read with TMP overlay fallback priority
function readJsonFile(filePath, fallback = null) {
    // 1. Check TMP overlay first (contains recent updates in serverless environments)
    try {
        const relative = path.relative(DATA_DIR, filePath);
        if (!relative.startsWith('..')) {
            const tmpPath = path.join(TMP_BASE_DIR, relative);
            if (fs.existsSync(tmpPath)) {
                const raw = fs.readFileSync(tmpPath, 'utf8');
                return JSON.parse(raw);
            }
        }
    } catch (e) {}

    // 2. Read from local filesystem
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

// Safe JSON file write with dual persistence (TMP overlay + local filesystem)
function writeJsonFile(filePath, data) {
    let success = false;
    const content = JSON.stringify(data, null, 2);

    // 1. Always write to TMP overlay (guaranteed writable on Vercel / serverless)
    try {
        const relative = path.relative(DATA_DIR, filePath);
        if (!relative.startsWith('..')) {
            const tmpPath = path.join(TMP_BASE_DIR, relative);
            const tmpDir = path.dirname(tmpPath);
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            fs.writeFileSync(tmpPath, content, 'utf8');
            success = true;
        }
    } catch (e) {
        console.warn(`[Storage] Warning writing to tmp for ${filePath}:`, e.message);
    }

    // 2. Attempt write to primary filesystem (works on local server / Docker / VPS)
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        success = true;
    } catch (e) {
        // Read-only filesystem in serverless environments (expected on Vercel)
    }

    return success;
}

// ==========================================
// USER & HOUSEHOLD REGISTRY
// ==========================================
// ==========================================
// DIRECTORY (USERS & HOUSEHOLDS) CLOUD PERSISTENCE
//
// users.json and households.json were the only state never pushed to the Gist.
// On a serverless host they therefore lived solely in /tmp, which is wiped when
// the instance goes cold - so a household or user created through the admin
// console disappeared a few minutes later and the directory reverted to the
// copy committed in data/.
//
// These two files are snapshots rather than append-only logs, and they support
// deletion, so merging record-by-record would resurrect deleted users. Instead
// the whole file is versioned: whichever side was written last wins. The local
// stamp lives in directory_meta.json, which is itself written through the /tmp
// overlay - so after a cold start there is no local stamp, the cloud copy is
// newer by definition, and the directory is restored.
// ==========================================
const DIRECTORY_META_FILE = path.join(DATA_DIR, 'directory_meta.json');


// Everything lives in one Gist document; see api/_cloud_store.js. There is no
// per-household file any more, so adding a household never adds a Gist file.

// createHousehold and createUser are synchronous, so their cloud writes cannot
// be awaited inline. Track them instead and let the request handler flush before
// it responds - on serverless the instance can otherwise be frozen before a
// fire-and-forget write ever reaches the Gist.
const pendingCloudWrites = new Set();

function trackCloudWrite(promise) {
    pendingCloudWrites.add(promise);
    promise.catch(() => {}).finally(() => pendingCloudWrites.delete(promise));
    return promise;
}

async function flushPendingCloudWrites() {
    while (pendingCloudWrites.size) {
        await Promise.allSettled([...pendingCloudWrites]);
    }
}

function readDirectoryMeta() {
    const meta = readJsonFile(DIRECTORY_META_FILE, {});
    return (meta && typeof meta === 'object' && !Array.isArray(meta)) ? meta : {};
}

function stampDirectory(kind) {
    const at = new Date().toISOString();
    const meta = readDirectoryMeta();
    meta[kind] = at;
    writeJsonFile(DIRECTORY_META_FILE, meta);
    return at;
}

function persistUsers(users) {
    writeJsonFile(USERS_FILE, users);
    const at = stampDirectory('users');
    trackCloudWrite(cloudStore.writeUsers(users)).catch(err => {
        console.warn('[CloudStore] users write notice:', err.message);
    });
}

function persistHouseholds(households) {
    writeJsonFile(HOUSEHOLDS_FILE, households);
    const at = stampDirectory('households');
    trackCloudWrite(cloudStore.writeHouseholds(households)).catch(err => {
        console.warn('[CloudStore] households write notice:', err.message);
    });
}


/**
 * Pull users and households back from the cloud when that copy is newer.
 *
 * Call this before reading the directory in an async request handler; the
 * getters themselves are synchronous and used all over, so they stay as they
 * are and simply see refreshed files.
 */
async function hydrateDirectoryFromCloud() {
    try {
        const directory = await cloudStore.readDirectory();
        if (!directory) return;

        const meta = readDirectoryMeta();
        const cloudAt = Date.parse(directory.updatedAt || '') || 0;

        const restore = (list, targetFile, metaKey) => {
            if (!Array.isArray(list) || list.length === 0) return;   // never wipe
            const localAt = Date.parse(meta[metaKey] || '') || 0;
            if (cloudAt <= localAt) return;                          // local is newer
            writeJsonFile(targetFile, list);
            const next = readDirectoryMeta();
            next[metaKey] = new Date(cloudAt).toISOString();
            writeJsonFile(DIRECTORY_META_FILE, next);
        };

        restore(directory.users, USERS_FILE, 'users');
        restore(directory.households, HOUSEHOLDS_FILE, 'households');
    } catch (e) {
        // A cloud failure must never block a request; the local copy stands.
    }
}

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

    let ownerName = data.ownerName;
    if (!ownerName && data.ownerUserId) {
        const u = getUserById(data.ownerUserId);
        if (u) ownerName = u.name;
    }
    
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
    persistHouseholds(households);
    
    try {
        // Initialize household directory structure recursively.
        //
        // getHouseholdDir has already created the writable /tmp overlay and made
        // a best-effort attempt at the repo-side directory. Repeating that mkdir
        // here without a guard made household creation fail outright on a
        // read-only filesystem:
        //   ENOENT: no such file or directory, mkdir '/var/task/data/households/H003'
        // Every writeJsonFile below tolerates that already - it writes to /tmp
        // first - so a failure to create the repo-side directory must not abort
        // the whole operation.
        const dir = getHouseholdDir(nextId);
        try {
            fs.mkdirSync(dir, { recursive: true });
            const receiptsDir = path.join(dir, 'receipts');
            if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
        } catch (e) {
            console.warn(`[Storage] Read-only filesystem for ${dir}; using the tmp overlay instead.`);
        }

        // Zero records initially copied - clean independent ledger
        writeJsonFile(path.join(dir, 'expenses.json'), []);
        
        // The key names here must match what the app reads, or the new
        // household silently starts with pieces missing. `staffMembers` and
        // `paymentModes` were never read by anything - the app looks for
        // `staff` and `paymentMethods` - so Master Settings showed an empty
        // staff table while the Staff tab still displayed the hardcoded
        // placeholder names from index.html. The cycle was stored as three
        // loose keys while the app reads `householdCycle`.
        const memberLabel = ownerName || 'Family Member';
        const cycleStartDay = Number(data.cycleStartDay) || 1;
        const cycleEndDay = Number(data.cycleEndDay) || 31;

        const initialConfig = {
            monthlyBudgetLimit: Number(data.initialBudget) || 50000,
            // What the dashboard reports on: 'household', 'personal' or
            // 'combined'. Owners change it in Master Settings.
            dashboardMode: 'household',
            householdCycle: {
                type: data.cycleType || 'calendar',
                cycleStartDay: cycleStartDay,
                cycleEndDay: cycleEndDay,
                description: (data.cycleType === 'custom')
                    ? `${cycleStartDay}th of current month to ${cycleEndDay}th of next month`
                    : 'Standard Calendar Month (1st to month end)'
            },
            familyMembers: [memberLabel],
            paymentMethods: ["UPI / GPay / PhonePe", "Credit Card", "Debit Card", "Net Banking", "Cash"],
            // Named after this household's own member, never after whoever
            // happened to own the first household.
            splitRules: [
                "Household Expense",
                `Personal Expense (${memberLabel})`,
                "Equal (50/50)"
            ],
            staff: [],
            recurringBills: [],
            categories: [
                { "name": "Grocery & Vegetables", "icon": "🛒", "type": "expense", "defaultPaidTo": "Blinkit" },
                { "name": "Electricity Bill", "icon": "⚡", "type": "expense", "defaultPaidTo": "MSCB / MSEDCL" },
                { "name": "Flat Maintenance", "icon": "🏢", "type": "expense", "defaultPaidTo": "Society Office" },
                { "name": "Wifi & Internet", "icon": "📶", "type": "expense", "defaultPaidTo": "Airtel" },
                { "name": "Dish Bill (DTH)", "icon": "📺", "type": "expense", "defaultPaidTo": "Tata Play" },
                { "name": "Shopping & Miscellaneous", "icon": "🛍️", "type": "expense", "defaultPaidTo": "Amazon" },
                { "name": "Accepted Payments (Income)", "icon": "💰", "type": "income", "defaultPaidTo": "" },
                { "name": "Settlement / Transfer", "icon": "🤝", "type": "transfer", "defaultPaidTo": "" }
            ],
            updatedAt: new Date().toISOString()
        };
        writeJsonFile(path.join(dir, 'config.json'), initialConfig);
        writeJsonFile(path.join(dir, 'attendance.json'), {});
        writeJsonFile(path.join(dir, 'notifications.json'), []);
        writeJsonFile(path.join(dir, 'audit_log.json'), [{
            id: `AUD-${Date.now()}-INIT`,
            timestamp: new Date().toISOString(),
            action: 'CREATE_HOUSEHOLD',
            actor: actor,
            details: `Household ${newHousehold.householdName} (${nextId}) created`
        }]);

        return newHousehold;
    } catch (err) {
        // Transactional rollback on failure
        const rollbackList = getAllHouseholds().filter(h => h.householdId !== nextId);
        persistHouseholds(rollbackList);
        const dir = path.join(HOUSEHOLDS_DIR, nextId);
        if (fs.existsSync(dir)) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
        }
        throw new Error(`Household creation failed: ${err.message}`);
    }
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
    persistUsers(users);

    // Link user to household memberUserIds
    if (!targetHousehold.memberUserIds) targetHousehold.memberUserIds = [];
    if (!targetHousehold.memberUserIds.includes(nextId)) {
        targetHousehold.memberUserIds.push(nextId);
        targetHousehold.updatedAt = new Date().toISOString();
        persistHouseholds(households);
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

function updateHousehold(householdId, updates, actor = 'System') {
    const cleanId = sanitizeId(householdId);
    if (!cleanId) throw new Error('Invalid household ID.');
    const households = getAllHouseholds();
    const idx = households.findIndex(h => h.householdId === cleanId);
    if (idx === -1) throw new Error('Household not found.');

    const current = households[idx];
    const newName = updates.householdName ? String(updates.householdName).trim() : current.householdName;
    const newStatus = updates.status ? String(updates.status).trim().toLowerCase() : (current.status || 'active');

    households[idx] = {
        ...current,
        householdName: newName,
        status: newStatus,
        updatedAt: new Date().toISOString()
    };
    persistHouseholds(households);

    // If monthly budget limit updated, update household config
    if (updates.monthlyBudgetLimit != null) {
        try {
            const configPath = getHouseholdFilePath(cleanId, 'config.json');
            const cfg = readJsonFile(configPath, {});
            cfg.monthlyBudgetLimit = Number(updates.monthlyBudgetLimit) || 50000;
            cfg.updatedAt = new Date().toISOString();
            writeJsonFile(configPath, cfg);
        } catch (e) {}
    }

    logHouseholdAudit(cleanId, {
        id: `AUD-${Date.now()}-EDIT-H`,
        action: 'UPDATE_HOUSEHOLD',
        actor: actor,
        details: `Updated household '${newName}' (${cleanId})`
    }).catch(() => {});

    return households[idx];
}

function deleteHousehold(householdId, actor = 'System') {
    const cleanId = sanitizeId(householdId);
    if (!cleanId) throw new Error('Invalid household ID.');
    if (cleanId === 'H001') {
        throw new Error('Action Forbidden: Primary household H001 is protected and cannot be deleted.');
    }

    const households = getAllHouseholds();
    const idx = households.findIndex(h => h.householdId === cleanId);
    if (idx === -1) throw new Error('Household not found.');

    const targetH = households[idx];

    // Remove from households list
    households.splice(idx, 1);
    persistHouseholds(households);

    // Reassign any users belonging to this household to H001
    const users = getAllUsers();
    let usersModified = false;
    users.forEach(u => {
        if (u.householdId === cleanId) {
            u.householdId = 'H001';
            u.role = 'MEMBER';
            u.updatedAt = new Date().toISOString();
            usersModified = true;
        }
    });
    if (usersModified) {
        persistUsers(users);
    }

    // Safely archive the physical folder if exists
    try {
        const hDir = path.join(HOUSEHOLDS_DIR, cleanId);
        if (fs.existsSync(hDir)) {
            const archiveDir = path.join(HOUSEHOLDS_DIR, `_archived_${cleanId}_${Date.now()}`);
            fs.renameSync(hDir, archiveDir);
        }
    } catch (e) {
        console.warn(`[Storage] Could not archive directory for ${cleanId}:`, e.message);
    }

    logHouseholdAudit('H001', {
        id: `AUD-${Date.now()}-DEL-H`,
        action: 'DELETE_HOUSEHOLD',
        actor: actor,
        details: `Deleted household '${targetH.householdName}' (${cleanId})`
    }).catch(() => {});

    return { success: true, deletedHouseholdId: cleanId, householdName: targetH.householdName };
}

function updateUser(userId, updates, actor = 'System') {
    const cleanUId = sanitizeId(userId);
    if (!cleanUId) throw new Error('Invalid user ID.');

    const users = getAllUsers();
    const idx = users.findIndex(u => u.userId === cleanUId);
    if (idx === -1) throw new Error('User not found.');

    const current = users[idx];

    // Protected: U000 (System Admin) cannot have role changed away from ADMIN or disabled
    if (cleanUId === 'U000') {
        if (updates.role && updates.role !== 'ADMIN') {
            throw new Error('Action Forbidden: System Administrator role cannot be changed.');
        }
        if (updates.status && updates.status !== 'active') {
            throw new Error('Action Forbidden: System Administrator account cannot be disabled.');
        }
    }

    // Check username uniqueness if changed
    if (updates.username) {
        const cleanUsername = String(updates.username).trim().toLowerCase();
        if (cleanUsername !== current.username) {
            if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
                throw new Error('Username must be 3-30 alphanumeric characters.');
            }
            const existing = users.find(u => u.username === cleanUsername && u.userId !== cleanUId);
            if (existing) throw new Error(`Username '@${cleanUsername}' is already taken.`);
            current.username = cleanUsername;
        }
    }

    // Check email uniqueness if changed
    if (updates.email) {
        const cleanEmail = String(updates.email).trim().toLowerCase();
        if (cleanEmail !== current.email) {
            const existing = users.find(u => u.email === cleanEmail && u.userId !== cleanUId);
            if (existing) throw new Error(`Email '${cleanEmail}' is already registered.`);
            current.email = cleanEmail;
        }
    }

    if (updates.name) current.name = String(updates.name).trim();
    if (updates.role) current.role = String(updates.role).trim().toUpperCase();
    if (updates.status) current.status = String(updates.status).trim().toLowerCase();

    // A per-user permission list. An empty array is meaningful - it means
    // "stop overriding, go back to whatever the role allows" - so it is stored
    // by deleting the field rather than by writing []. Passing undefined leaves
    // any existing override alone; this whitelist silently drops fields it does
    // not name, which is how passwordChangedAt once went missing.
    if (updates.permissions !== undefined) {
        const list = permsRegistry.sanitizePermissions(updates.permissions);
        if (list && list.length) {
            current.permissions = list;
        } else {
            delete current.permissions;
        }
    }

    // Check household transfer
    if (updates.householdId && updates.householdId !== current.householdId) {
        const newHId = sanitizeId(updates.householdId);
        const households = getAllHouseholds();
        const targetH = households.find(h => h.householdId === newHId);
        if (!targetH) throw new Error(`Target household '${newHId}' does not exist.`);

        const oldHId = current.householdId;
        const oldH = households.find(h => h.householdId === oldHId);
        if (oldH && oldH.memberUserIds) {
            oldH.memberUserIds = oldH.memberUserIds.filter(id => id !== cleanUId);
            oldH.updatedAt = new Date().toISOString();
        }

        if (!targetH.memberUserIds) targetH.memberUserIds = [];
        if (!targetH.memberUserIds.includes(cleanUId)) {
            targetH.memberUserIds.push(cleanUId);
            targetH.updatedAt = new Date().toISOString();
        }

        persistHouseholds(households);
        current.householdId = newHId;

        // Add to new household's config.json familyMembers if not present
        try {
            const configPath = getHouseholdFilePath(newHId, 'config.json');
            const cfg = readJsonFile(configPath, {});
            if (cfg && Array.isArray(cfg.familyMembers) && !cfg.familyMembers.includes(current.name)) {
                cfg.familyMembers.push(current.name);
                writeJsonFile(configPath, cfg);
            }
        } catch (e) {}
    }

    // Update password if provided
    if (updates.passwordHash) {
        current.passwordHash = updates.passwordHash;
    }

    // The credential generation. Tokens carry the value they were issued
    // against, so moving this forward ends every session opened beforehand.
    // updateUser copies named fields only, so without this the stamp would be
    // dropped silently and sessions would survive a password change.
    if (updates.passwordChangedAt) {
        current.passwordChangedAt = Number(updates.passwordChangedAt);
    }

    current.updatedAt = new Date().toISOString();
    users[idx] = current;
    persistUsers(users);

    logHouseholdAudit(current.householdId, {
        id: `AUD-${Date.now()}-EDIT-U`,
        action: 'UPDATE_USER',
        actor: actor,
        details: `Updated user '${current.name}' (@${current.username}, ${current.role})`
    }).catch(() => {});

    return {
        userId: current.userId,
        username: current.username,
        email: current.email,
        name: current.name,
        householdId: current.householdId,
        role: current.role,
        status: current.status,
        updatedAt: current.updatedAt
    };
}

function deleteUser(userId, actor = 'System') {
    const cleanUId = sanitizeId(userId);
    if (!cleanUId) throw new Error('Invalid user ID.');

    if (cleanUId === 'U000' || cleanUId === 'U001') {
        throw new Error('Action Forbidden: System Administrator and Primary Owner accounts are protected and cannot be deleted.');
    }

    const users = getAllUsers();
    const idx = users.findIndex(u => u.userId === cleanUId);
    if (idx === -1) throw new Error('User not found.');

    const targetUser = users[idx];

    // Remove user from users list
    users.splice(idx, 1);
    persistUsers(users);

    // Remove user ID from all households memberUserIds
    const households = getAllHouseholds();
    let householdsModified = false;
    households.forEach(h => {
        if (h.memberUserIds && h.memberUserIds.includes(cleanUId)) {
            h.memberUserIds = h.memberUserIds.filter(id => id !== cleanUId);
            h.updatedAt = new Date().toISOString();
            householdsModified = true;
        }
        if (h.ownerUserId === cleanUId) {
            h.ownerUserId = null;
            h.updatedAt = new Date().toISOString();
            householdsModified = true;
        }
    });
    if (householdsModified) {
        persistHouseholds(households);
    }

    logHouseholdAudit(targetUser.householdId, {
        id: `AUD-${Date.now()}-DEL-U`,
        action: 'DELETE_USER',
        actor: actor,
        details: `Deleted user '${targetUser.name}' (@${targetUser.username})`
    }).catch(() => {});

    return { success: true, deletedUserId: cleanUId, username: targetUser.username };
}

// ==========================================
// HOUSEHOLD-SCOPED EXPENSES REPOSITORY
// ==========================================
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

async function getHouseholdExpenses(householdId, includeDeleted = false, forceFresh = true) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Valid Household ID required.');

    // Always reload fresh from disk by default to guarantee zero-cache live sync across all users
    if (forceFresh || !memoryStore.expenses[cleanHId]) {
        let records = null;
        const filePath = getHouseholdFilePath(cleanHId, 'expenses.json');
        records = readJsonFile(filePath, null);

        // Fallback for H001 legacy path if newly initialized
        if (!records && cleanHId === 'H001') {
            const legacyPath = path.join(DATA_DIR, 'expenses.json');
            records = readJsonFile(legacyPath, []);
        }

        // Pull this household's slice out of the single cloud document.
        try {
            const cloudRecords = await cloudStore.readHouseholdSlice(cleanHId, 'expenses');
            if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
                if (!records || cloudRecords.length >= records.length) {
                    records = cloudRecords;
                }
            }
        } catch (e) {}

        memoryStore.expenses[cleanHId] = Array.isArray(records) ? records : [];
    }

    const list = memoryStore.expenses[cleanHId];
    const activeList = includeDeleted ? list : list.filter(i => !i.isDeleted);
    return [...activeList].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getHouseholdExpenseById(householdId, id, forceFresh = true) {
    const list = await getHouseholdExpenses(householdId, true, forceFresh);
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

    // If H001, also mirror to data/expenses.json and CloudSync (Gist)
    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'expenses.json'), list);
    }
    await cloudStore.writeHouseholdSlice(cleanHId, 'expenses', list).catch(err => {
        console.warn('[CloudStore] expenses write notice:', err.message);
    });

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

/**
 * Apply one server-driven change across many expenses in a single pass.
 *
 * Calling saveHouseholdExpense in a loop rewrites the whole ledger (twice, for
 * H001) and appends an audit row per record, so renaming a category used by 35
 * expenses meant ~105 file writes and 35 opaque UPDATE_EXPENSE entries. This
 * reads once, mutates in memory, writes once, and logs the operation as the
 * single action it actually was.
 *
 * `mutate(record)` returns a changed record, or null/undefined to leave it be.
 * Returns the number of records changed.
 */
async function bulkUpdateHouseholdExpenses(householdId, mutate, actorUser = 'System', auditMeta = {}) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');
    if (typeof mutate !== 'function') throw new Error('bulkUpdateHouseholdExpenses requires a mutate function.');

    const list = await getHouseholdExpenses(cleanHId, true);
    const now = new Date().toISOString();
    const changedIds = [];

    for (let i = 0; i < list.length; i++) {
        const record = list[i];
        if (!record || record.isDeleted) continue;
        const next = mutate({ ...record });
        if (!next) continue;
        list[i] = {
            ...next,
            version: Number(record.version || 1) + 1,
            updatedAt: now,
            updatedBy: actorUser
        };
        changedIds.push(record.id);
    }

    if (changedIds.length === 0) return 0;

    memoryStore.expenses[cleanHId] = list;
    writeJsonFile(getHouseholdFilePath(cleanHId, 'expenses.json'), list);

    if (cleanHId === 'H001') {
        writeJsonFile(path.join(DATA_DIR, 'expenses.json'), list);
    }
    await cloudStore.writeHouseholdSlice(cleanHId, 'expenses', list).catch(err => {
        console.warn('[CloudStore] bulk expenses write notice:', err.message);
    });

    await logHouseholdAudit(
        cleanHId,
        auditMeta.action || 'BULK_UPDATE_EXPENSES',
        auditMeta.recordId || `bulk-${changedIds.length}`,
        auditMeta.diff || {},
        { ...auditMeta.snapshot, affectedCount: changedIds.length, affectedIds: changedIds.slice(0, 50) },
        actorUser
    );

    return changedIds.length;
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
    await cloudStore.writeHouseholdSlice(cleanHId, 'expenses', list).catch(err => {
        console.warn('[CloudStore] expenses delete notice:', err.message);
    });

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
async function getHouseholdConfig(householdId, forceFresh = true) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (forceFresh || !memoryStore.config[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'config.json');
        let config = readJsonFile(filePath, null);
        if (!config && cleanHId === 'H001') {
            config = readJsonFile(path.join(DATA_DIR, 'config.json'), {});
        }

        // Every household syncs, each to its own Gist file.
        {
            try {
                const cloudConfig = await cloudStore.readHouseholdSlice(cleanHId, 'config');
                if (cloudConfig && typeof cloudConfig === 'object' && Array.isArray(cloudConfig.categories)) {
                    if (config) {
                        config = { ...config, ...cloudConfig };
                    } else {
                        config = cloudConfig;
                    }
                }
            } catch (e) {}
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
    await cloudStore.writeHouseholdSlice(cleanHId, 'config', newConfig).catch(err => {
        console.warn('[CloudStore] config write notice:', err.message);
    });

    await logHouseholdAudit(cleanHId, 'UPDATE_CONFIG', 'config', { updated: true }, newConfig, actorUser);
    return newConfig;
}

// ==========================================
// HOUSEHOLD-SCOPED ATTENDANCE REPOSITORY
// ==========================================
/**
 * Combine two attendance objects, month by month, keeping whichever copy was
 * written last.
 *
 * Attendance is shaped { staffName: { months: { "2026-09": { days, updatedAt } } } }.
 * A plain object spread would drop whole months, so this merges at the month
 * level and uses the updatedAt stamp that /api/attendance writes on every save.
 * When neither side has a stamp, a month that has marks beats an empty one, and
 * local wins ties - local is where the most recent write landed first.
 */
function mergeAttendance(local, cloud) {
    const base = (local && typeof local === 'object') ? local : {};
    const other = (cloud && typeof cloud === 'object') ? cloud : {};
    const out = {};

    for (const staff of new Set([...Object.keys(base), ...Object.keys(other)])) {
        const a = base[staff] || {};
        const b = other[staff] || {};
        const months = {};

        const aMonths = (a.months && typeof a.months === 'object') ? a.months : {};
        const bMonths = (b.months && typeof b.months === 'object') ? b.months : {};

        for (const key of new Set([...Object.keys(aMonths), ...Object.keys(bMonths)])) {
            const mA = aMonths[key];
            const mB = bMonths[key];
            if (!mA) { months[key] = mB; continue; }
            if (!mB) { months[key] = mA; continue; }

            const tA = Date.parse(mA.updatedAt || '');
            const tB = Date.parse(mB.updatedAt || '');
            if (Number.isFinite(tA) && Number.isFinite(tB)) {
                months[key] = tB > tA ? mB : mA;
            } else {
                const aHasMarks = Object.keys(mA.days || {}).length > 0;
                const bHasMarks = Object.keys(mB.days || {}).length > 0;
                months[key] = (!aHasMarks && bHasMarks) ? mB : mA;
            }
        }

        out[staff] = { ...b, ...a, months };
    }
    return out;
}

async function getHouseholdAttendance(householdId, forceFresh = true) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (forceFresh || !memoryStore.attendance[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'attendance.json');
        let attendance = readJsonFile(filePath, null);
        if (!attendance && cleanHId === 'H001') {
            attendance = readJsonFile(path.join(DATA_DIR, 'staff_attendance.json'), {});
        }

        // Attendance was written to the Gist but never read back from it. On a
        // serverless host /tmp is wiped when the instance goes cold, so a read
        // then fell through to the committed baseline in data/ and every mark
        // made since appeared to have been lost. The Gist is the durable copy,
        // so it has to be consulted here the same way expenses and config are.
        {
            try {
                const cloudAttendance = await cloudStore.readHouseholdSlice(cleanHId, 'attendance');
                if (cloudAttendance && typeof cloudAttendance === 'object') {
                    attendance = mergeAttendance(attendance, cloudAttendance);
                }
            } catch (e) {}
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
    await cloudStore.writeHouseholdSlice(cleanHId, 'attendance', attendanceData).catch(() => {});
    return attendanceData;
}

// ==========================================
// HOUSEHOLD-SCOPED AUDIT LOG REPOSITORY
// ==========================================
async function getHouseholdAuditLogs(householdId, limit = 100, forceFresh = true) {
    const cleanHId = sanitizeId(householdId);
    if (!cleanHId) throw new Error('Unauthorized: Invalid Household context.');

    if (forceFresh || !memoryStore.audit[cleanHId]) {
        const filePath = getHouseholdFilePath(cleanHId, 'audit_log.json');
        let logs = readJsonFile(filePath, null);
        if (!logs && cleanHId === 'H001') {
            logs = readJsonFile(path.join(DATA_DIR, 'audit_log.json'), []);
        }

        // Same write-only gap as attendance had: entries were pushed to the Gist
        // but never read back, so history recorded since the last cold start
        // disappeared from the Audit tab. Union by entry id, newest first.
        {
            try {
                const cloudLogs = await cloudStore.readHouseholdSlice(cleanHId, 'auditLog');
                if (Array.isArray(cloudLogs) && cloudLogs.length) {
                    const byId = new Map();
                    for (const entry of [...(Array.isArray(logs) ? logs : []), ...cloudLogs]) {
                        if (entry && entry.id && !byId.has(entry.id)) byId.set(entry.id, entry);
                    }
                    logs = [...byId.values()].sort(
                        (a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
                    );
                }
            } catch (e) {}
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
    await cloudStore.writeHouseholdSlice(cleanHId, 'auditLog', memoryStore.audit[cleanHId]).catch(() => {});
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
    hydrateDirectoryFromCloud,
    flushPendingCloudWrites,
    getAllUsers,
    getUserById,
    getUserByUsernameOrEmail,
    getAllHouseholds,
    getHouseholdById,
    createHousehold,
    createUser,
    updateHousehold,
    deleteHousehold,
    updateUser,
    deleteUser,
    getHouseholdExpenses,
    getHouseholdExpenseById,
    saveHouseholdExpense,
    bulkUpdateHouseholdExpenses,
    deleteHouseholdExpense,
    calculateStaffBillingCycle,
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
