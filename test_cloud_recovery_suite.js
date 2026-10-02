// Cloud recovery suite.
//
// On a serverless host the only writable location is /tmp, and it is wiped when
// the instance goes cold. The GitHub Gist is the durable copy. Anything written
// to the Gist must therefore also be READ back from it, or the data silently
// reverts to whatever is committed in data/.
//
// Attendance and the audit log were write-only: saved to the Gist, never read
// from it. Marking leave in September and coming back later showed every day as
// Present again. This suite pins that behaviour down.
//
// The Gist is never contacted: cloudSync is stubbed through require.cache, so
// these tests are offline, deterministic, and cannot touch the real gist.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function check(cond, msg) {
    if (cond) {
        console.log(`  ✅ PASS: ${msg}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${msg}`);
        failed++;
    }
}

// Load a fresh copy of the storage module with its cloudSync dependency
// replaced by an in-memory stand-in for the Gist.
function freshStorage(cloudFiles, dataDir, tmpDir) {
    const storagePath = require.resolve('./api/_storage.js');
    const cloudPath = require.resolve('./api/_cloud_sync.js');
    const storePath = require.resolve('./api/_cloud_store.js');
    const pathsPath = require.resolve('./api/_paths.js');

    delete require.cache[storagePath];
    delete require.cache[cloudPath];
    delete require.cache[storePath];
    delete require.cache[pathsPath];

    process.env.HOMEEXPENSES_DATA_DIR = dataDir;
    process.env.HOMEEXPENSES_TMP_DIR = tmpDir;
    process.env.CLOUD_SYNC_DISABLED = '1';

    require(cloudPath);
    require.cache[cloudPath].exports = {
        readJson: async (name) => (name in cloudFiles ? cloudFiles[name] : null),
        writeJson: async (name, data) => { cloudFiles[name] = data; return true; },
        logAudit: async () => ({}),
        getAuditLogs: async () => []
    };

    delete require.cache[storagePath];
    delete require.cache[storePath];
    return require(storagePath);
}

// Everything now lives in one document; these read a slice out of the stub.
const STORE = 'gharkhata.json';
const slice = (cloud, hid, key) =>
    (((cloud[STORE] || {}).data || {})[hid] || {})[key];
const directory = (cloud, key) => (cloud[STORE] || {})[key];

/**
 * Simulate an instance going cold on a serverless host.
 *
 * /tmp is wiped, and anything the run wrote into data/ is removed too: on the
 * real host data/ is read-only, so a runtime write never lands there. Only the
 * committed baseline files survive, which is precisely the state in which the
 * marks appeared to vanish.
 */
function coldStart(dataDir, tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const householdDir = path.join(dataDir, 'households', 'H001');
    if (fs.existsSync(householdDir)) {
        fs.rmSync(householdDir, { recursive: true, force: true });
        fs.mkdirSync(householdDir, { recursive: true });
    }
    // Reset the committed baseline to what the repo actually ships.
    fs.writeFileSync(path.join(dataDir, 'staff_attendance.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'audit_log.json'), '[]', 'utf8');
}

function makeScratch() {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'he_cloud_'));
    const dataDir = path.join(scratch, 'data');
    const tmpDir = path.join(scratch, 'tmp');
    fs.mkdirSync(path.join(dataDir, 'households', 'H001'), { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    // The committed baseline: what data/ holds in the repo.
    fs.writeFileSync(path.join(dataDir, 'staff_attendance.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'audit_log.json'), '[]', 'utf8');
    return { scratch, dataDir, tmpDir };
}

async function run() {
    console.log('====================================================');
    console.log('☁️  Cloud Recovery Suite (attendance & audit log)');
    console.log('====================================================\n');

    // ---------------------------------------------------------------
    console.log('--- TEST 1: attendance survives a cold start ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = {};
        const staff = 'Chef - Nilima Nikose';

        let storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.saveHouseholdAttendance('H001', {
            [staff]: {
                baseSalary: 4500,
                months: {
                    '2026-09': {
                        days: { 17: 'HD', 18: 'L', 19: 'L' },
                        bonus: 0, notes: '',
                        updatedAt: '2026-09-30T10:00:00.000Z'
                    }
                }
            }
        }, 'test');

        check(slice(cloud, 'H001', 'attendance') !== undefined,
            'saving attendance pushes it into the single cloud document');

        const sameInstance = await storage.getHouseholdAttendance('H001', true);
        check((sameInstance[staff].months['2026-09'].days || {})['18'] === 'L',
            'the marks read back on the same instance');

        coldStart(dataDir, tmpDir);
        storage = freshStorage(cloud, dataDir, tmpDir);

        const afterCold = await storage.getHouseholdAttendance('H001', true);
        const days = ((afterCold[staff] || {}).months || {})['2026-09'] || {};
        check(Object.keys(days.days || {}).length === 3,
            `all three marks survive the cold start (got ${JSON.stringify(days.days || {})})`);
        check((days.days || {})['17'] === 'HD' && (days.days || {})['18'] === 'L',
            'the exact statuses are restored, not reset to Present');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 2: a newer local edit is not overwritten by the cloud ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const staff = 'Chef - Nilima Nikose';
        const cloud = { [STORE]: { data: { H001: { attendance: {
            [staff]: {
                months: {
                    '2026-09': { days: { 1: 'L' }, updatedAt: '2026-09-01T00:00:00.000Z' }  // older
                }
            }
        } } } } };

        const storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.saveHouseholdAttendance('H001', {
            [staff]: {
                months: {
                    '2026-09': {
                        days: { 1: 'P', 2: 'HD' },
                        updatedAt: '2026-09-30T00:00:00.000Z'       // newer
                    }
                }
            }
        }, 'test');

        const merged = await storage.getHouseholdAttendance('H001', true);
        const sept = merged[staff].months['2026-09'];
        check(sept.days['2'] === 'HD' && sept.days['1'] === 'P',
            `the newer local edit wins (got ${JSON.stringify(sept.days)})`);

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 3: months present only in the cloud are recovered ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const staff = 'Chef - Nilima Nikose';
        const cloud = { [STORE]: { data: { H001: { attendance: {
            [staff]: {
                months: {
                    '2026-08': { days: { 5: 'L' }, updatedAt: '2026-08-31T00:00:00.000Z' },
                    '2026-09': { days: { 9: 'HD' }, updatedAt: '2026-09-30T00:00:00.000Z' }
                }
            }
        } } } } };

        // This is exactly what /api/attendance saveMonth does: read the current
        // state first, add the new month, then save the whole object back. The
        // read is what pulls the cloud months in, so nothing is overwritten.
        const storage = freshStorage(cloud, dataDir, tmpDir);
        const current = await storage.getHouseholdAttendance('H001', true);
        if (!current[staff]) current[staff] = { months: {} };
        if (!current[staff].months) current[staff].months = {};
        current[staff].months['2026-10'] = {
            days: { 1: 'L' }, bonus: 0, notes: '',
            updatedAt: '2026-10-01T00:00:00.000Z'
        };
        await storage.saveHouseholdAttendance('H001', current, 'test');

        const merged = await storage.getHouseholdAttendance('H001', true);
        const months = Object.keys(merged[staff].months).sort();
        check(months.join(',') === '2026-08,2026-09,2026-10',
            `all three months are present (got ${months.join(',')})`);
        check(merged[staff].months['2026-08'].days['5'] === 'L',
            'an older month that exists only in the cloud is recovered');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 4: audit history survives a cold start ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = {};

        let storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.logHouseholdAudit('H001', 'TEST_ACTION', 'rec-1', {}, {}, 'tester');
        const before = await storage.getHouseholdAuditLogs('H001', 50);
        check(before.length >= 1, 'an audit entry is recorded');

        coldStart(dataDir, tmpDir);
        storage = freshStorage(cloud, dataDir, tmpDir);

        const after = await storage.getHouseholdAuditLogs('H001', 50);
        check(after.some(e => e.action === 'TEST_ACTION'),
            `the audit entry survives the cold start (${after.length} entries back)`);

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 5: an empty or broken cloud copy destroys nothing ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const staff = 'Chef - Nilima Nikose';
        const cloud = { [STORE]: { data: { H001: { attendance: null } } } };

        const storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.saveHouseholdAttendance('H001', {
            [staff]: { months: { '2026-09': { days: { 3: 'L' }, updatedAt: '2026-09-03T00:00:00.000Z' } } }
        }, 'test');

        // saveHouseholdAttendance stores the stub's value; force the cloud to a
        // junk shape to prove a bad response cannot wipe local marks.
        cloud[STORE].data.H001.attendance = 'not an object';
        const merged = await storage.getHouseholdAttendance('H001', true);
        check((((merged[staff] || {}).months || {})['2026-09'] || {}).days['3'] === 'L',
            'local marks survive a malformed cloud payload');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 6: new households and users survive a cold start ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = {};

        let storage = freshStorage(cloud, dataDir, tmpDir);
        const h2 = storage.createHousehold({ householdName: 'Vaibhavi', initialBudget: 10000 }, 'admin');
        const h3 = storage.createHousehold({ householdName: 'Second Home', initialBudget: 25000 }, 'admin');
        const u1 = storage.createUser({
            username: 'vaibhavi', name: 'Vaibhavi', passwordHash: 'salt1:hash1',
            householdId: h2.householdId, role: 'OWNER'
        }, 'admin');
        const u2 = storage.createUser({
            username: 'second', name: 'Second User', passwordHash: 'salt2:hash2',
            householdId: h3.householdId, role: 'MEMBER'
        }, 'admin');

        // createHousehold/createUser are synchronous; their cloud writes are
        // tracked and drained by the request handler. Do the same here.
        await storage.flushPendingCloudWrites();

        check(Array.isArray(directory(cloud, 'households')) && directory(cloud, 'households').length > 0,
            'creating a household pushes the directory into the document');
        check(Array.isArray(directory(cloud, 'users')) && directory(cloud, 'users').length > 0,
            'creating a user pushes the directory into the document');

        const seededHouseholds = storage.getAllHouseholds().length;
        const seededUsers = storage.getAllUsers().length;

        coldStart(dataDir, tmpDir);
        // The committed baseline knows nothing about any of this.
        fs.writeFileSync(path.join(dataDir, 'households.json'), '[]', 'utf8');
        fs.writeFileSync(path.join(dataDir, 'users.json'), '[]', 'utf8');
        fs.rmSync(path.join(dataDir, 'directory_meta.json'), { force: true });

        storage = freshStorage(cloud, dataDir, tmpDir);
        check(storage.getAllHouseholds().length === 0,
            'before hydrating, the cold instance sees an empty directory');

        await storage.hydrateDirectoryFromCloud();

        const households = storage.getAllHouseholds();
        const users = storage.getAllUsers();
        check(households.length === seededHouseholds,
            `both new households are restored (${households.length} of ${seededHouseholds})`);
        check(households.some(h => h.householdName === 'Vaibhavi'),
            'the household named "Vaibhavi" is back');
        check(users.length === seededUsers,
            `both new users are restored (${users.length} of ${seededUsers})`);
        check(users.some(u => u.username === 'vaibhavi') && users.some(u => u.username === 'second'),
            'both usernames are back');

        const restored = users.find(u => u.username === 'vaibhavi');
        check(restored && restored.householdId === h2.householdId,
            'a restored user still points at the right household');
        check(restored && typeof restored.passwordHash === 'string' && restored.passwordHash.includes(':'),
            'the password hash survives, so the user can still sign in');
        check(u1.userId !== u2.userId, 'the two users were given distinct ids');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 7: a deleted user is not resurrected by the cloud ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = {};
        fs.writeFileSync(path.join(dataDir, 'users.json'), '[]', 'utf8');
        fs.writeFileSync(path.join(dataDir, 'households.json'), '[]', 'utf8');

        const storage = freshStorage(cloud, dataDir, tmpDir);
        const h = storage.createHousehold({ householdName: 'Temp', initialBudget: 1000 }, 'admin');
        // U000 and U001 are protected from deletion, so make a third account.
        storage.createUser({ username: 'keep1', name: 'Keep One', passwordHash: 's:h',
            householdId: h.householdId, role: 'OWNER' }, 'admin');
        storage.createUser({ username: 'keep2', name: 'Keep Two', passwordHash: 's:h',
            householdId: h.householdId, role: 'MEMBER' }, 'admin');
        const doomed = storage.createUser({
            username: 'doomed', name: 'Doomed', passwordHash: 's:h',
            householdId: h.householdId, role: 'MEMBER'
        }, 'admin');

        storage.deleteUser(doomed.userId, 'admin');
        await storage.flushPendingCloudWrites();

        // Hydration must not undo the delete: the local copy is the newer one.
        await storage.hydrateDirectoryFromCloud();
        const users = storage.getAllUsers();
        check(!users.some(u => u.username === 'doomed'),
            'the deleted user stays deleted after a cloud refresh');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 8: an empty cloud directory cannot wipe local users ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = { [STORE]: {
            updatedAt: '2099-01-01T00:00:00.000Z', users: [], households: [], data: {}
        } };
        fs.writeFileSync(path.join(dataDir, 'users.json'),
            JSON.stringify([{ userId: 'U000', username: 'admin' }]), 'utf8');

        const storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.hydrateDirectoryFromCloud();
        check(storage.getAllUsers().length === 1,
            'an empty cloud snapshot, even a newer one, does not erase the local directory');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 9: every household lives in the one document ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();
        const cloud = {};
        let storage = freshStorage(cloud, dataDir, tmpDir);

        await storage.saveHouseholdConfig('H001', { categories: [{ name: 'H1 Cat' }], marker: 'one' }, 'test');
        await storage.saveHouseholdConfig('H002', { categories: [{ name: 'H2 Cat' }], marker: 'two' }, 'test');
        await storage.saveHouseholdExpense('H002', {
            date: '2026-09-15', amount: 250.75, category: 'H2 Cat', paidBy: 'Vaibhavi'
        }, 'test');
        await storage.saveHouseholdAttendance('H002', {
            'Helper': { months: { '2026-09': { days: { 4: 'L' }, updatedAt: '2026-09-04T00:00:00.000Z' } } }
        }, 'test');

        check(Object.keys(cloud).length === 1 && cloud[STORE] !== undefined,
            `everything is in one Gist file (files: ${Object.keys(cloud).join(', ')})`);
        check(slice(cloud, 'H001', 'config') !== undefined,
            "H001's config is a slice of the document");
        check(slice(cloud, 'H002', 'config') !== undefined,
            "H002's config is a slice of the same document");
        check(slice(cloud, 'H002', 'expenses') !== undefined,
            "H002's ledger is in the document");
        check(slice(cloud, 'H002', 'attendance') !== undefined,
            "H002's attendance is in the document");
        check(slice(cloud, 'H001', 'config').marker === 'one'
              && slice(cloud, 'H002', 'config').marker === 'two',
            'the two households do not overwrite each other');

        coldStart(dataDir, tmpDir);
        fs.rmSync(path.join(dataDir, 'households'), { recursive: true, force: true });
        fs.writeFileSync(path.join(dataDir, 'config.json'), '{}', 'utf8');
        fs.writeFileSync(path.join(dataDir, 'expenses.json'), '[]', 'utf8');
        storage = freshStorage(cloud, dataDir, tmpDir);

        const h2cfg = await storage.getHouseholdConfig('H002', true);
        check(h2cfg && h2cfg.marker === 'two',
            `H002's settings survive a cold start (marker: ${h2cfg && h2cfg.marker})`);

        const h2exp = await storage.getHouseholdExpenses('H002', false, true);
        check(h2exp.length === 1 && h2exp[0].amount === 250.75,
            `H002's ledger survives a cold start (${h2exp.length} records)`);

        const h2att = await storage.getHouseholdAttendance('H002', true);
        check((((h2att['Helper'] || {}).months || {})['2026-09'] || {}).days['4'] === 'L',
            "H002's attendance survives a cold start");

        const h1cfg = await storage.getHouseholdConfig('H001', true);
        check(h1cfg && h1cfg.marker === 'one',
            "H001's settings are untouched by H002's sync");

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 10: the old multi-file gist migrates without loss ---');
    {
        const { scratch, dataDir, tmpDir } = makeScratch();

        // Mirrors the real exported gist: wrapped directory files, a flat H001
        // config, attendance keyed by staff name, and households that never had
        // files of their own.
        const cloud = {
            'directory_users.json': { updatedAt: '2026-09-29T00:00:00.000Z', users: [
                { userId: 'U000', username: 'admin', householdId: 'SYSTEM', role: 'SYSTEM_ADMIN', passwordHash: 's:h' },
                { userId: 'U001', username: 'owner1', householdId: 'H001', role: 'OWNER', passwordHash: 's:h' },
                { userId: 'U002', username: 'member1', householdId: 'H001', role: 'MEMBER', passwordHash: 's:h' },
                { userId: 'U003', username: 'owner2', householdId: 'H002', role: 'OWNER', passwordHash: 's:h' }
            ]},
            'directory_households.json': { updatedAt: '2026-09-29T00:00:00.000Z', households: [
                { householdId: 'H001', householdName: 'First' },
                { householdId: 'H002', householdName: 'Second' }
            ]},
            'config.json': { categories: [{ name: 'Groceries' }], monthlyBudgetLimit: 50000, householdId: 'H001' },
            'expenses.json': [
                { id: 'e1', amount: 100, householdId: 'H001' },
                { id: 'e2', amount: 250.5, householdId: '' }
            ],
            'staff_attendance.json': { 'Chef - X': { months: { '2026-09': { days: { 3: 'L' } } } } },
            'audit_log.json': [{ id: 'a1', action: 'X', timestamp: '2026-09-01T00:00:00.000Z' }],
            'push_subscriptions.json': [{ userId: 'U001', subscription: {} }]
        };

        freshStorage(cloud, dataDir, tmpDir);
        const cloudStore = require('./api/_cloud_store.js');
        const doc = await cloudStore.migrateFromLegacy();

        check(doc !== null, 'the legacy layout migrates');
        if (doc) {
            const problems = cloudStore.validateStore(doc);
            check(problems.length === 0,
                'the migrated document validates (' + (problems.join('; ') || 'clean') + ')');
            check(doc.users.length === 4 && doc.households.length === 2,
                'every user and household carries over (' + doc.users.length + ' users, ' + doc.households.length + ' households)');
            check(doc.pushSubscriptions.length === 1,
                'push subscriptions carry over and stay global');
            check((doc.data.H001.expenses || []).length === 2,
                'H001 keeps both expenses (' + (doc.data.H001.expenses || []).length + ')');
            check(doc.data.H001.config.monthlyBudgetLimit === 50000,
                "H001's master config carries over unchanged");
            check(Object.keys(doc.data.H001.attendance || {}).length === 1,
                "H001's attendance carries over keyed by staff name");
            check((doc.data.H001.auditLog || []).length === 1,
                "H001's audit history carries over");

            const h1 = (doc.data.H001.users || []).map(u => u.userId + ':' + u.role).sort().join(',');
            check(h1 === 'U001:OWNER,U002:MEMBER', 'H001 membership is preserved (' + h1 + ')');
            const h2 = (doc.data.H002.users || []).map(u => u.userId + ':' + u.role).join(',');
            check(h2 === 'U003:OWNER', 'H002 membership is preserved (' + h2 + ')');

            check(['config', 'users', 'expenses', 'attendance', 'auditLog']
                    .every(k => doc.data.H002[k] !== undefined),
                'a household with no legacy files still gets all five keys');
            check(doc.data.SYSTEM === undefined,
                'the SYSTEM pseudo-household is not given a data slice');
        }

        check(['expenses.json', 'config.json', 'directory_users.json', 'audit_log.json']
                .every(f => cloud[f] !== undefined),
            'the original files are left in place, untouched');

        const broken = cloudStore.emptyStore();
        broken.households = [{ householdId: 'H009', householdName: 'Ghost' }];
        check(cloudStore.validateStore(broken).some(p => p.indexOf('H009') !== -1),
            'validation rejects a household with no data slice');

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    if (failed > 0) process.exit(1);
}

run().catch((e) => {
    console.error('SUITE ERROR:', e);
    process.exit(1);
});
