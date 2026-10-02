// Master-configuration-driven dashboard suite.
//
// The dashboard used to be hardwired to one household: two named staff members
// and a fixed list of utility bills. These tests pin the replacement behaviour:
//
//   - dashboardMode is a validated household setting that survives a round trip
//   - a brand new household starts in 'household' mode with no staff, no bills
//   - staff billing cycles come from the household's own staff configuration
//   - no other household's staff or bills are hardcoded anywhere in the source
//
// Run through ./run_tests.sh, which points the server at a scratch copy of
// data/ and disables cloud sync.
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';
const REPO = __dirname;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log(`  ✅ PASS: ${msg}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${msg}`);
        failed++;
    }
}

async function login(username, password) {
    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password })
    });
    const json = await res.json();
    if (!json.token) throw new Error(`login failed for ${username}: ${JSON.stringify(json)}`);
    return json.token;
}

function authed(token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function getConfig(token, householdId) {
    const q = householdId ? `householdId=${householdId}&` : '';
    const res = await fetch(`${BASE_URL}/api/config?${q}_t=${Date.now()}`, { headers: authed(token) });
    const json = await res.json();
    return json.data;
}

async function postConfig(token, payload, householdId) {
    const q = householdId ? `?householdId=${householdId}` : '';
    const res = await fetch(`${BASE_URL}/api/config${q}`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify(payload)
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------

async function testValidation(token) {
    console.log('\n--- TEST 1: dashboardMode is validated, not stored blindly ---');

    const before = await getConfig(token);
    const original = before.dashboardMode;

    for (const bad of ['everything', 'HOUSEHOLD', '', 1, null]) {
        const { status } = await postConfig(token, { dashboardMode: bad });
        assert(status === 422 || status === 400,
            `rejects dashboardMode ${JSON.stringify(bad)} (got ${status})`);
    }

    const after = await getConfig(token);
    assert(after.dashboardMode === original,
        'a rejected value did not overwrite the stored mode');

    for (const good of ['household', 'personal', 'combined']) {
        const { status } = await postConfig(token, { dashboardMode: good });
        const stored = await getConfig(token);
        assert(status === 200 && stored.dashboardMode === good,
            `accepts and stores dashboardMode '${good}' (got ${status}/${stored.dashboardMode})`);
    }

    // Leave the household as we found it.
    if (original) await postConfig(token, { dashboardMode: original });
}

async function testRoundTrip() {
    console.log('\n--- TEST 2: dashboardMode survives the cloud document round trip ---');
    const store = require('./api/_cloud_store.js');

    const native = {
        dashboardMode: 'personal',
        staff: [{ id: 's1', name: 'Cook - A', shortName: 'A', baseSalary: 100, billingCycleDay: 5 }],
        recurringBills: [{ id: 'b1', name: 'Power', category: 'Electricity Bill', dueDay: 9 }],
        categories: [{ name: 'Electricity Bill' }],
        monthlyBudgetLimit: 1234,
        householdCycle: { type: 'calendar' }
    };

    const stored = store.toStoredConfig(native);
    const back = store.fromStoredConfig(stored);

    assert(stored.masterConfig.dashboardMode === 'personal',
        'dashboardMode is stored under masterConfig');
    assert(back.dashboardMode === 'personal', 'dashboardMode comes back unchanged');
    assert(JSON.stringify(Object.keys(native).sort()) === JSON.stringify(Object.keys(back).sort()),
        'no config key is lost in the round trip');
    assert(JSON.stringify(back.staff) === JSON.stringify(native.staff),
        'staff records are byte-identical after the round trip');
}

async function testNewHouseholdStartsEmpty(admin) {
    console.log('\n--- TEST 3: a new household starts with no staff and no bills ---');

    const suffix = Date.now().toString().slice(-6);

    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin),
        body: JSON.stringify({
            action: 'create_household',
            householdName: `Dash Test ${suffix}`,
            ownerName: `Owner ${suffix}`,
            initialBudget: 25000
        })
    });
    const created = await res.json();
    if (!created.success) {
        console.log(`  ❌ FAIL: could not create household: ${JSON.stringify(created).slice(0, 200)}`);
        failed++;
        return;
    }

    const newHid = created.household?.householdId || created.householdId;
    const cfg = await getConfig(admin, newHid);

    assert(cfg.dashboardMode === 'household',
        `new household defaults to household mode (got ${cfg.dashboardMode})`);
    assert(Array.isArray(cfg.staff) && cfg.staff.length === 0,
        `new household has no staff (got ${(cfg.staff || []).length})`);
    assert(Array.isArray(cfg.recurringBills) && cfg.recurringBills.length === 0,
        `new household has no recurring bills (got ${(cfg.recurringBills || []).length})`);

    const names = JSON.stringify(cfg);
    assert(!/Madhuri|Nilima/i.test(names),
        'no other household\'s staff names leak into the new config');
}

function testBillingCycleIsConfigDriven() {
    console.log('\n--- TEST 4: staff billing cycle follows the household config ---');

    for (const mod of ['./api/_storage.js', './api/_db.js']) {
        const m = require(mod);
        const fn = m.calculateStaffBillingCycle;
        if (typeof fn !== 'function') {
            // _storage does not export it; read it off the module under test below.
            continue;
        }
        assert(fn('Maid - Madhuri', '2026-03-15') === 'Standard',
            `${mod}: an unconfigured category gets no invented cycle`);
        assert(fn('Cook - A', '2026-03-15', [{ name: 'Cook - A', billingCycleDay: 7 }]) === '2026-03-07',
            `${mod}: the configured cycle day is used`);
        assert(fn('Cook - A', '2026-02-15', [{ name: 'Cook - A', billingCycleDay: 31 }]) === '2026-02-28',
            `${mod}: a cycle day past month end is clamped`);
    }
}

function testNoHardcodedTenantData() {
    console.log('\n--- TEST 5: no household-specific staff or bills remain in the source ---');

    // Files that render or compute per-household data. data/ holds the real
    // records and is deliberately excluded; so are the test files themselves.
    const files = [
        'index.html',
        'tracker_app.js',
        'advance_modules.js',
        'api/_storage.js',
        'api/_db.js',
        'api/notifications.js',
        'api/attendance.js',
        'api/config.js'
    ];

    const NAMES = /Madhuri|Nilima/;

    for (const rel of files) {
        const full = path.join(REPO, rel);
        if (!fs.existsSync(full)) continue;
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);

        const offenders = [];
        lines.forEach((line, i) => {
            if (!NAMES.test(line)) return;
            // Comments explaining the old behaviour are fine; code is not.
            const t = line.trim();
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
            offenders.push(`${rel}:${i + 1}`);
        });

        assert(offenders.length === 0,
            `${rel} contains no hardcoded staff names${offenders.length ? ' (found ' + offenders.join(', ') + ')' : ''}`);
    }

    // The same for the bill defaults that used to be baked into the radar.
    const adv = fs.readFileSync(path.join(REPO, 'advance_modules.js'), 'utf8');
    assert(!/const RADAR_BILLS\s*=/.test(adv),
        'the built-in RADAR_BILLS fallback list is gone');

    const tracker = fs.readFileSync(path.join(REPO, 'tracker_app.js'), 'utf8');
    assert(!/checklistConfig = \[\s*\{/.test(tracker),
        'the recurring checklist no longer falls back to a built-in bill list');
    assert(/checklistConfig = \[\];/.test(tracker),
        'the recurring checklist starts empty and is filled from the config');
}

function testDashboardModeConstants() {
    console.log('\n--- TEST 6: client and server agree on the allowed modes ---');

    const rules = require('./api/_config_rules.js');
    assert(Array.isArray(rules.DASHBOARD_MODES) &&
           rules.DASHBOARD_MODES.join(',') === 'household,personal,combined',
        `server allows exactly household, personal, combined (got ${rules.DASHBOARD_MODES})`);

    const tracker = fs.readFileSync(path.join(REPO, 'tracker_app.js'), 'utf8');
    const m = tracker.match(/const DASHBOARD_MODES = \[([^\]]+)\]/);
    assert(!!m, 'the client declares DASHBOARD_MODES');
    if (m) {
        const clientModes = m[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
        assert(clientModes.join(',') === 'household,personal,combined',
            `client allows the same three modes (got ${clientModes})`);
    }

    const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
    assert(html.includes('id="adminDashboardModeOptions"'),
        'Master Settings hosts the dashboard mode selector');
    assert(!html.includes('id="btnScopeCombined"'),
        'the per-device dashboard scope toggle is gone - the mode is a household setting');
    assert(html.includes('id="dashStaffLedgerSection"') &&
           html.includes('id="dashBillsRadarSection"') &&
           html.includes('id="kpiStaffPayroll"'),
        'the gated dashboard sections are addressable');
    assert(html.includes('id="dashStaffLedgerGrid"') && html.includes('id="staffOverviewGrid"'),
        'staff cards are rendered into containers rather than written out by hand');
}

(async () => {
    console.log('====================================================');
    console.log(' DASHBOARD / MASTER CONFIGURATION SUITE');
    console.log('====================================================');

    const token = await login('admin', 'Admin@123');

    await testValidation(token);
    await testRoundTrip();
    await testNewHouseholdStartsEmpty(token);
    testBillingCycleIsConfigDriven();
    testNoHardcodedTenantData();
    testDashboardModeConstants();

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\nSUITE ERROR:', e);
    process.exit(1);
});
