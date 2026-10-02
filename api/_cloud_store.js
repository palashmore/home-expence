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

function emptyStore() {
    return {
        updatedAt: new Date().toISOString(),
        users: [],
        households: [],
        pushSubscriptions: [],
        data: {}
    };
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
 * One-time migration from the old per-file layout, so an existing Gist keeps
 * its data. Only ever runs when the single document is absent.
 */
async function migrateFromLegacy() {
    const store = emptyStore();
    let found = false;

    try {
        const users = await cloudSync.readJson('directory_users.json');
        if (users && Array.isArray(users.users)) { store.users = users.users; found = true; }
        const households = await cloudSync.readJson('directory_households.json');
        if (households && Array.isArray(households.households)) {
            store.households = households.households; found = true;
        }
        const subs = await cloudSync.readJson('push_subscriptions.json');
        if (Array.isArray(subs)) { store.pushSubscriptions = subs; found = true; }
    } catch (e) {}

    // H001 used unprefixed names; later households used an <id>_ prefix.
    const ids = new Set(['H001', ...store.households.map(h => h && h.householdId).filter(Boolean)]);
    for (const id of ids) {
        const slice = {};
        for (const [key, base] of Object.entries(LEGACY_FILES)) {
            const name = id === 'H001' ? base : `${id}_${base}`;
            try {
                const value = await cloudSync.readJson(name);
                if (value !== null && value !== undefined) { slice[key] = value; found = true; }
            } catch (e) {}
        }
        if (Object.keys(slice).length) store.data[id] = slice;
    }

    return found ? store : null;
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

/** Read one household's `key` ("expenses" | "config" | "attendance" | "auditLog"). */
async function readHouseholdSlice(householdId, key) {
    const doc = await readStore();
    const slice = sliceOf(doc, householdId);
    return slice ? (slice[key] === undefined ? null : slice[key]) : null;
}

/** Replace one household's `key`, leaving every other household untouched. */
async function writeHouseholdSlice(householdId, key, value) {
    return updateStore((doc) => {
        if (!doc.data[householdId] || typeof doc.data[householdId] !== 'object') {
            doc.data[householdId] = {};
        }
        doc.data[householdId][key] = value;
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
    migrateFromLegacy,
    _resetMigrationFlag: () => { migrationAttempted = false; }
};
