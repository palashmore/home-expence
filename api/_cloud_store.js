// Single-document cloud store.
//
// Everything this app persists lives in ONE JSON file in the Gist:
//
//   {
//     "updatedAt": "2026-10-02T...",
//     "users":      [ ... ],            // every account, all households
//     "households": [ ... ],            // every household
//     "pushSubscriptions": [ ... ],
//     "data": {
//       "H001": { "config": {...}, "expenses": [...], "attendance": {...}, "auditLog": [...] },
//       "H002": { "config": {...}, "expenses": [...], "attendance": {...}, "auditLog": [...] }
//     }
//   }
//
// One file keeps every household's settings, ledger, attendance and history in
// a single place, so adding a household never means adding Gist files.
//
// Writes are read-modify-write against the freshest copy: the whole document is
// re-read, the one slice is replaced, and the result is written back. That keeps
// a save from clobbering a different household's concurrent change.
const cloudSync = require('./_cloud_sync');

const STORE_FILE = 'gharkhata.json';

// Legacy layout, kept only so an existing Gist is migrated rather than lost.
const LEGACY_FILES = {
    expenses: 'expenses.json',
    config: 'config.json',
    attendance: 'staff_attendance.json',
    auditLog: 'audit_log.json'
};

// The five keys every household slice carries. These mirror what the app
// already stores per household - the shapes are unchanged, only their location.
const HOUSEHOLD_KEYS = ['config', 'users', 'expenses', 'attendance', 'auditLog'];

// ---------------------------------------------------------------------------
// SCHEMA ADAPTERS
//
// The document stores config and attendance in an organised shape, while the
// application keeps using the shapes it always has. These translate between the
// two and are exactly reversible, so no value, key or record is ever lost.
//
//   config    native: flat { staff, categories, recurringBills, familyMembers,
//                            paymentMethods, householdCycle, monthlyBudgetLimit,
//                            splitRules, ...anything else }
//             stored: { masterConfig, categories, budgets, settings }
//
//   attendance native: { "<staff name>": { baseSalary, billingCycleDay,
//                                          months: { "YYYY-MM": {...} } } }
//              stored: { staff: [...], records: [...] }
// ---------------------------------------------------------------------------

const CONFIG_CATEGORY_KEY = 'categories';
const CONFIG_SETTINGS_KEYS = ['householdCycle', 'householdId', 'updatedAt'];

function toStoredConfig(native) {
    if (!native || typeof native !== 'object' || Array.isArray(native)) {
        return { masterConfig: {}, categories: [], budgets: [], settings: {} };
    }
    // Already in the stored shape - leave it be.
    if (native.masterConfig && !native.staff && !native.splitRules) return native;

    const stored = { masterConfig: {}, categories: [], budgets: [], settings: {} };
    for (const [key, value] of Object.entries(native)) {
        if (key === CONFIG_CATEGORY_KEY) {
            stored.categories = Array.isArray(value) ? value : [];
        } else if (key === 'monthlyBudgetLimit') {
            if (value !== undefined && value !== null) {
                stored.budgets.push({ period: 'monthly', limit: value });
            }
        } else if (CONFIG_SETTINGS_KEYS.includes(key)) {
            stored.settings[key] = value;
        } else {
            // staff, recurringBills, familyMembers, paymentMethods, splitRules,
            // staffConfig and anything this app grows later.
            stored.masterConfig[key] = value;
        }
    }
    return stored;
}

function fromStoredConfig(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    // A config still in the native flat shape passes straight through.
    if (!stored.masterConfig && !stored.settings && !Array.isArray(stored.budgets)) {
        return stored;
    }

    const native = { ...(stored.masterConfig || {}) };
    if (Array.isArray(stored.categories)) native.categories = stored.categories;
    for (const budget of (stored.budgets || [])) {
        if (budget && budget.period === 'monthly' && budget.limit !== undefined) {
            native.monthlyBudgetLimit = budget.limit;
        }
    }
    Object.assign(native, stored.settings || {});
    return native;
}

function toStoredAttendance(native) {
    if (!native || typeof native !== 'object' || Array.isArray(native)) {
        return { staff: [], records: [] };
    }
    // Already stored shape.
    if (Array.isArray(native.staff) && Array.isArray(native.records)) return native;

    const stored = { staff: [], records: [] };
    for (const [name, entry] of Object.entries(native)) {
        if (!entry || typeof entry !== 'object') continue;
        const { months, ...rest } = entry;
        stored.staff.push({ name, ...rest });
        for (const [month, record] of Object.entries(months || {})) {
            stored.records.push({ staffName: name, month, ...(record || {}) });
        }
    }
    return stored;
}

function fromStoredAttendance(stored) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    // Native keyed shape passes straight through.
    if (!Array.isArray(stored.staff) || !Array.isArray(stored.records)) return stored;

    const native = {};
    for (const member of stored.staff) {
        if (!member || !member.name) continue;
        const { name, ...rest } = member;
        native[name] = { ...rest, months: {} };
    }
    for (const record of stored.records) {
        if (!record || !record.staffName || !record.month) continue;
        const { staffName, month, ...rest } = record;
        if (!native[staffName]) native[staffName] = { months: {} };
        if (!native[staffName].months) native[staffName].months = {};
        native[staffName].months[month] = rest;
    }
    return native;
}

function emptyStore() {
    return {
        updatedAt: new Date().toISOString(),
        users: [],
        households: [],
        pushSubscriptions: [],
        data: {}
    };
}

function emptySlice() {
    return {
        users: [],
        config: { masterConfig: {}, categories: [], budgets: [], settings: {} },
        expenses: [],
        attendance: { staff: [], records: [] },
        auditLog: []
    };
}

/**
 * Keep the household membership lists in step with the global user directory.
 *
 * `data.<id>.users` is a derived index: who belongs to this household and in
 * what role. The user records themselves remain the single source of truth -
 * nothing is renamed or moved - so this cannot drift out of sync and no
 * application code has to maintain it.
 */
function deriveHouseholdMembership(doc) {
    const byHousehold = {};
    for (const u of (doc.users || [])) {
        if (!u || !u.householdId || !u.userId) continue;
        (byHousehold[u.householdId] = byHousehold[u.householdId] || []).push({
            userId: u.userId,
            role: u.role || 'MEMBER'
        });
    }

    // A slice exists for every known household, and for any household that
    // already has data, so nothing is ever orphaned.
    // SYSTEM is a pseudo-household for the administrator account; it owns no
    // data and must never be given a slice.
    const ids = new Set([
        ...Object.keys(doc.data || {}),
        ...(doc.households || []).map(h => h && h.householdId).filter(Boolean)
    ].filter(id => id && id !== 'SYSTEM'));
    delete doc.data.SYSTEM;

    for (const id of ids) {
        const slice = (doc.data[id] && typeof doc.data[id] === 'object') ? doc.data[id] : emptySlice();
        for (const key of HOUSEHOLD_KEYS) {
            if (slice[key] === undefined) slice[key] = emptySlice()[key];
        }
        slice.users = byHousehold[id] || [];
        doc.data[id] = slice;
    }
    return doc;
}

function normalise(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return {
        updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
        users: Array.isArray(doc.users) ? doc.users : [],
        households: Array.isArray(doc.households) ? doc.households : [],
        pushSubscriptions: Array.isArray(doc.pushSubscriptions) ? doc.pushSubscriptions : [],
        data: (doc.data && typeof doc.data === 'object' && !Array.isArray(doc.data)) ? doc.data : {}
    };
}

/**
 * Read the whole document. Returns null when the cloud has nothing usable, so
 * callers can tell "no cloud copy" from "an empty one".
 */
async function readStore() {
    try {
        const doc = normalise(await cloudSync.readJson(STORE_FILE));
        if (doc) return doc;
    } catch (e) {
        return null;
    }
    return null;
}

/**
 * One-time migration from the old per-file layout.
 *
 * Reads the existing Gist files, rebuilds them as one document preserving every
 * id and relationship, and validates the result before it is considered usable.
 * The original files are never read destructively and never deleted - they stay
 * as a rollback source.
 */
async function migrateFromLegacy() {
    const store = emptyStore();
    let found = false;

    const unwrap = (payload, key) => {
        if (!payload) return null;
        if (Array.isArray(payload)) return payload;
        if (Array.isArray(payload[key])) return payload[key];
        return null;
    };

    try {
        const users = unwrap(await cloudSync.readJson('directory_users.json'), 'users');
        if (users) { store.users = users; found = true; }

        const households = unwrap(await cloudSync.readJson('directory_households.json'), 'households');
        if (households) { store.households = households; found = true; }

        const subs = unwrap(await cloudSync.readJson('push_subscriptions.json'), 'subscriptions');
        if (subs) { store.pushSubscriptions = subs; found = true; }
    } catch (e) {}

    // H001 used the unprefixed names; any later household used an <id>_ prefix.
    const ids = new Set([
        'H001',
        ...store.households.map(h => h && h.householdId).filter(Boolean)
    ]);

    for (const id of ids) {
        if (id === 'SYSTEM') continue;          // pseudo-household, owns no data
        const slice = emptySlice();
        for (const [key, base] of Object.entries(LEGACY_FILES)) {
            const name = id === 'H001' ? base : `${id}_${base}`;
            try {
                const value = await cloudSync.readJson(name);
                if (value === null || value === undefined) continue;
                found = true;
                // Store config and attendance organised; everything else as-is.
                if (key === 'config') slice.config = toStoredConfig(value);
                else if (key === 'attendance') slice.attendance = toStoredAttendance(value);
                else slice[key] = value;
            } catch (e) {}
        }
        store.data[id] = slice;
    }

    if (!found) return null;

    deriveHouseholdMembership(store);

    const problems = validateStore(store);
    if (problems.length) {
        console.warn('[CloudStore] Migration rejected, leaving the old files in place:',
            problems.join('; '));
        return null;
    }
    return store;
}

/**
 * Structural checks that must hold before a migrated document replaces the old
 * layout. Deliberately conservative: a migration that cannot be verified is
 * abandoned rather than written.
 */
function validateStore(doc) {
    const problems = [];
    if (!doc || typeof doc !== 'object') return ['document is not an object'];
    if (!Array.isArray(doc.users)) problems.push('users is not an array');
    if (!Array.isArray(doc.households)) problems.push('households is not an array');
    if (!Array.isArray(doc.pushSubscriptions)) problems.push('pushSubscriptions is not an array');
    if (!doc.data || typeof doc.data !== 'object') problems.push('data is not an object');
    if (problems.length) return problems;

    // Every household in the directory must have a slice with all five keys.
    for (const h of doc.households) {
        const id = h && h.householdId;
        if (!id) { problems.push('a household has no householdId'); continue; }
        const slice = doc.data[id];
        if (!slice) { problems.push(`no data slice for ${id}`); continue; }
        for (const key of HOUSEHOLD_KEYS) {
            if (slice[key] === undefined) problems.push(`${id} is missing ${key}`);
        }
    }

    // Every user must still point at a household that exists, or at SYSTEM.
    const knownHouseholds = new Set(doc.households.map(h => h && h.householdId));
    const seenUserIds = new Set();
    for (const u of doc.users) {
        if (!u || !u.userId) { problems.push('a user has no userId'); continue; }
        if (seenUserIds.has(u.userId)) problems.push(`duplicate user id ${u.userId}`);
        seenUserIds.add(u.userId);
        if (u.householdId && u.householdId !== 'SYSTEM' && !knownHouseholds.has(u.householdId)) {
            problems.push(`user ${u.userId} points at unknown household ${u.householdId}`);
        }
    }

    // The SYSTEM pseudo-household must never own data.
    if (doc.data.SYSTEM !== undefined) problems.push('data.SYSTEM must not exist');

    // Membership entries must reference real users, with no duplicates.
    for (const [id, slice] of Object.entries(doc.data)) {
        const seen = new Set();
        for (const m of (slice.users || [])) {
            if (!m || !m.userId) { problems.push(`${id} has a membership entry with no userId`); continue; }
            if (!seenUserIds.has(m.userId)) problems.push(`${id} references unknown user ${m.userId}`);
            if (seen.has(m.userId)) problems.push(`${id} lists ${m.userId} twice`);
            seen.add(m.userId);
        }
    }

    // No duplicate expense or audit ids within a household.
    for (const [id, slice] of Object.entries(doc.data)) {
        for (const [key, label] of [['expenses', 'expense'], ['auditLog', 'audit entry']]) {
            const ids = new Set();
            for (const rec of (slice[key] || [])) {
                if (!rec || rec.id === undefined) continue;
                if (ids.has(rec.id)) problems.push(`${id} has a duplicate ${label} id ${rec.id}`);
                ids.add(rec.id);
            }
        }
    }
    return problems;
}


let migrationAttempted = false;

/**
 * The document to build on: the cloud copy, a one-time migration of the old
 * layout, or a fresh empty one.
 */
async function currentStore() {
    const existing = await readStore();
    if (existing) return existing;

    if (!migrationAttempted) {
        migrationAttempted = true;
        const migrated = await migrateFromLegacy();
        if (migrated) {
            console.log('[CloudStore] Migrated the old per-file Gist layout into gharkhata.json.');
            try { await cloudSync.writeJson(STORE_FILE, migrated); } catch (e) {}
            return migrated;
        }
    }
    return emptyStore();
}

// Every update is a read-modify-write of the whole document, so two of them
// running at once would each start from the same copy and the second would
// discard the first. Creating a household and a user in quick succession did
// exactly that - the user vanished. Updates are therefore serialised: each one
// waits for the previous to finish before reading.
let writeChain = Promise.resolve();

/**
 * Apply `mutate` to the freshest document and write the whole thing back.
 * `mutate` receives the document and changes it in place.
 */
function updateStore(mutate) {
    const run = writeChain.then(async () => {
        try {
            const doc = await currentStore();
            if (!doc.data || typeof doc.data !== 'object') doc.data = {};
            mutate(doc);
            deriveHouseholdMembership(doc);
            doc.updatedAt = new Date().toISOString();
            await cloudSync.writeJson(STORE_FILE, doc);
            return doc;
        } catch (e) {
            console.warn('[CloudStore] write notice:', e.message);
            return null;
        }
    });
    // Keep the chain alive even if one update throws.
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}

// ---- per-household slices -------------------------------------------------

function sliceOf(doc, householdId) {
    if (!doc || !doc.data) return null;
    const slice = doc.data[householdId];
    return (slice && typeof slice === 'object') ? slice : null;
}

/**
 * Read one household's `key` ("expenses" | "config" | "attendance" | "auditLog")
 * in the shape the application expects.
 */
async function readHouseholdSlice(householdId, key) {
    const doc = await readStore();
    const slice = sliceOf(doc, householdId);
    if (!slice || slice[key] === undefined) return null;

    if (key === 'config') return fromStoredConfig(slice.config);
    if (key === 'attendance') return fromStoredAttendance(slice.attendance);
    return slice[key];
}

/**
 * Replace one household's `key`, leaving every other household untouched.
 * The value arrives in the application's native shape and is stored organised.
 */
async function writeHouseholdSlice(householdId, key, value) {
    return updateStore((doc) => {
        if (!doc.data[householdId] || typeof doc.data[householdId] !== 'object') {
            doc.data[householdId] = emptySlice();
        }
        if (key === 'config') {
            doc.data[householdId].config = toStoredConfig(value);
        } else if (key === 'attendance') {
            doc.data[householdId].attendance = toStoredAttendance(value);
        } else {
            doc.data[householdId][key] = value;
        }
    });
}

// ---- directory ------------------------------------------------------------

async function readDirectory() {
    const doc = await readStore();
    if (!doc) return null;
    return { updatedAt: doc.updatedAt, users: doc.users, households: doc.households };
}

async function writeUsers(users) {
    return updateStore((doc) => { doc.users = users; });
}

async function writeHouseholds(households) {
    return updateStore((doc) => { doc.households = households; });
}

async function readPushSubscriptions() {
    const doc = await readStore();
    return doc ? doc.pushSubscriptions : null;
}

async function writePushSubscriptions(subs) {
    return updateStore((doc) => { doc.pushSubscriptions = subs; });
}

module.exports = {
    STORE_FILE,
    readStore,
    updateStore,
    readHouseholdSlice,
    writeHouseholdSlice,
    readDirectory,
    writeUsers,
    writeHouseholds,
    readPushSubscriptions,
    writePushSubscriptions,
    // exported for tests
    emptyStore,
    emptySlice,
    toStoredConfig,
    fromStoredConfig,
    toStoredAttendance,
    fromStoredAttendance,
    migrateFromLegacy,
    validateStore,
    deriveHouseholdMembership,
    _resetMigrationFlag: () => { migrationAttempted = false; }
};
