#!/usr/bin/env node
/**
 * Build the consolidated gharkhata.json from a directory of the old Gist files,
 * validate it exhaustively, and only write it if nothing was lost.
 *
 *   node scripts/build_gharkhata.js <source-dir> <output-file>
 *
 * The source files are read only; they are never written to or deleted.
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];

if (!SRC || !OUT) {
    console.error('usage: node scripts/build_gharkhata.js <source-dir> <output-file>');
    process.exit(1);
}

// Point the cloud layer at the local source files instead of the network.
const cloudPath = require.resolve('../api/_cloud_sync.js');
require(cloudPath);
const files = {};
for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.json')) continue;
    files[f] = JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));
}
const original = JSON.parse(JSON.stringify(files));
require.cache[cloudPath].exports = {
    readJson: async (n) => (n in files ? files[n] : null),
    writeJson: async () => true,
    logAudit: async () => ({}),
    getAuditLogs: async () => []
};

const store = require('../api/_cloud_store.js');
const log = (s) => console.log(s);

function duplicates(arr, key) {
    const seen = new Set();
    const dupes = [];
    for (const item of arr || []) {
        const v = item && item[key];
        if (v === undefined) continue;
        if (seen.has(v)) dupes.push(v);
        seen.add(v);
    }
    return dupes;
}

(async () => {
    const doc = await store.migrateFromLegacy();
    if (!doc) {
        console.error('MIGRATION REJECTED - nothing was written.');
        process.exit(1);
    }

    const problems = store.validateStore(doc);

    const srcUsers = original['directory_users.json'].users;
    const srcHh = original['directory_households.json'].households;
    const srcSubs = original['push_subscriptions.json'];
    const srcExp = original['expenses.json'];
    const srcAudit = original['audit_log.json'];
    const srcAtt = original['staff_attendance.json'];
    const srcCfg = original['config.json'];

    log('============================================================');
    log(' MIGRATION VALIDATION REPORT');
    log('============================================================');
    log('Source files        : ' + Object.keys(original).length);
    log('Output              : gharkhata.json');
    log('');
    log('Users               : source ' + srcUsers.length + '  ->  migrated ' + doc.users.length);
    log('Households          : source ' + srcHh.length + '  ->  migrated ' + doc.households.length);
    log('Push subscriptions  : source ' + srcSubs.length + '  ->  migrated ' + doc.pushSubscriptions.length);
    log('');
    log('Per household:');
    log('  ID      members  masterCfg/cats/budgets/settings  expenses  staff  records  audit');
    for (const id of Object.keys(doc.data).sort()) {
        const s = doc.data[id];
        const c = s.config || {};
        const cfg = Object.keys(c.masterConfig || {}).length + '/' +
                    (c.categories || []).length + '/' +
                    (c.budgets || []).length + '/' +
                    Object.keys(c.settings || {}).length;
        log('  ' + id.padEnd(6) +
            String((s.users || []).length).padStart(7) + '  ' +
            cfg.padEnd(32) +
            String((s.expenses || []).length).padStart(8) +
            String((s.attendance.staff || []).length).padStart(7) +
            String((s.attendance.records || []).length).padStart(9) +
            String((s.auditLog || []).length).padStart(7));
    }
    log('');
    log('SYSTEM data slice   : ' + (doc.data.SYSTEM === undefined ? 'NO (correct)' : 'YES (WRONG)'));

    const dupUsers = duplicates(doc.users, 'userId');
    const dupHh = duplicates(doc.households, 'householdId');
    let dupExp = 0;
    let dupAud = 0;
    for (const id of Object.keys(doc.data)) {
        dupExp += duplicates(doc.data[id].expenses, 'id').length;
        dupAud += duplicates(doc.data[id].auditLog, 'id').length;
    }
    log('Duplicate IDs       : users ' + dupUsers.length + ', households ' + dupHh.length +
        ', expenses ' + dupExp + ', audit ' + dupAud);

    const known = new Set(doc.households.map(h => h.householdId));
    const missingRefs = doc.users.filter(
        u => u.householdId && u.householdId !== 'SYSTEM' && !known.has(u.householdId));
    log('Missing household refs: ' + missingRefs.length);

    log('');
    log('Data-count comparison:');
    const checks = [];
    const eq = (label, a, b) => {
        const ok = a === b;
        checks.push(ok);
        log('  ' + (ok ? 'OK  ' : 'LOSS') + ' ' + label.padEnd(32) + a + '  ->  ' + b);
    };
    eq('users', srcUsers.length, doc.users.length);
    eq('households', srcHh.length, doc.households.length);
    eq('pushSubscriptions', srcSubs.length, doc.pushSubscriptions.length);
    eq('H001 expenses', srcExp.length, doc.data.H001.expenses.length);
    eq('H001 auditLog', srcAudit.length, doc.data.H001.auditLog.length);
    eq('H001 attendance staff', Object.keys(srcAtt).length, doc.data.H001.attendance.staff.length);
    const srcRecords = Object.values(srcAtt)
        .reduce((a, s) => a + Object.keys(s.months || {}).length, 0);
    eq('H001 attendance records', srcRecords, doc.data.H001.attendance.records.length);

    const cfgBack = store.fromStoredConfig(doc.data.H001.config);
    eq('H001 config keys', Object.keys(srcCfg).length, Object.keys(cfgBack).length);

    const same = (label, a, b) => {
        const ok = JSON.stringify(a) === JSON.stringify(b);
        checks.push(ok);
        log('  ' + (ok ? 'OK  ' : 'LOSS') + ' ' + label);
        return ok;
    };
    const sortedPairs = (o) => Object.keys(o).sort().map(k => [k, o[k]]);
    same('H001 config values identical after round-trip', sortedPairs(srcCfg), sortedPairs(cfgBack));
    same('H001 attendance identical after round-trip',
        store.fromStoredAttendance(doc.data.H001.attendance), srcAtt);
    same('H001 expense objects byte-identical', doc.data.H001.expenses, srcExp);
    same('H001 audit objects byte-identical', doc.data.H001.auditLog, srcAudit);
    same('push subscriptions byte-identical', doc.pushSubscriptions, srcSubs);
    same('user records byte-identical', doc.users, srcUsers);
    same('household records byte-identical', doc.households, srcHh);

    log('');
    log('Household membership (derived from the user directory):');
    for (const id of Object.keys(doc.data).sort()) {
        const members = (doc.data[id].users || []).map(u => u.userId + ':' + u.role);
        log('  ' + id + ': ' + (members.join(', ') || '(none)'));
    }

    const allOk = problems.length === 0 &&
        checks.every(Boolean) &&
        dupUsers.length === 0 && dupHh.length === 0 && dupExp === 0 && dupAud === 0 &&
        missingRefs.length === 0 && doc.data.SYSTEM === undefined;

    log('');
    log('Validation          : ' + (problems.length ? 'FAIL - ' + problems.join('; ') : 'PASS'));
    log('Data loss           : ' + (allOk ? 'NO' : 'YES - SEE ABOVE'));

    const untouched = Object.keys(original).every(f =>
        JSON.stringify(original[f]) ===
        JSON.stringify(JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))));
    log('Original files      : ' + (untouched ? 'untouched' : 'MODIFIED (!)'));

    if (!allOk) {
        console.error('\nREFUSING TO WRITE: validation did not fully pass.');
        process.exit(1);
    }

    fs.writeFileSync(OUT, JSON.stringify(doc, null, 2), 'utf8');
    JSON.parse(fs.readFileSync(OUT, 'utf8'));      // prove the output parses
    log('');
    log('Written             : ' + OUT +
        '  (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB, valid JSON)');
})();
