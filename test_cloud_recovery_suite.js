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
    const pathsPath = require.resolve('./api/_paths.js');

    delete require.cache[storagePath];
    delete require.cache[cloudPath];
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
    return require(storagePath);
}

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

        check(cloud['staff_attendance.json'] !== undefined,
            'saving attendance pushes it to the cloud copy');

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
        const cloud = {
            'staff_attendance.json': {
                [staff]: {
                    months: {
                        '2026-09': {
                            days: { 1: 'L' },
                            updatedAt: '2026-09-01T00:00:00.000Z'   // older
                        }
                    }
                }
            }
        };

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
        const cloud = {
            'staff_attendance.json': {
                [staff]: {
                    months: {
                        '2026-08': { days: { 5: 'L' }, updatedAt: '2026-08-31T00:00:00.000Z' },
                        '2026-09': { days: { 9: 'HD' }, updatedAt: '2026-09-30T00:00:00.000Z' }
                    }
                }
            }
        };

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
        const cloud = { 'staff_attendance.json': null };

        const storage = freshStorage(cloud, dataDir, tmpDir);
        await storage.saveHouseholdAttendance('H001', {
            [staff]: { months: { '2026-09': { days: { 3: 'L' }, updatedAt: '2026-09-03T00:00:00.000Z' } } }
        }, 'test');

        // saveHouseholdAttendance stores the stub's value; force the cloud to a
        // junk shape to prove a bad response cannot wipe local marks.
        cloud['staff_attendance.json'] = 'not an object';
        const merged = await storage.getHouseholdAttendance('H001', true);
        check((((merged[staff] || {}).months || {})['2026-09'] || {}).days['3'] === 'L',
            'local marks survive a malformed cloud payload');

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
