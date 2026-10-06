// Permission model, and the authorization gaps closed alongside it.
//
// Three endpoints shipped with no role check. The worst, /api/migrate, defined
// its own authenticateRequest that returned `true` unconditionally, shadowing
// the real one imported from ./auth - so an anonymous POST wrote records
// straight into a household's ledger. Verified by curl before the fix: no
// token, and the response was importedCount: 1.
//
// Run through ./run_tests.sh.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';

const ADMIN = { username: 'admin', password: 'Admin@123' };
const OWNER = { username: 'palash', password: 'Palash@123' };
const MEMBER = { username: 'pallavi', password: 'Pallavi@123' };

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log(`  PASS: ${msg}`);
        passed++;
    } else {
        console.log(`  FAIL: ${msg}`);
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
    if (!json.token) throw new Error(`login failed for ${username}`);
    return json;
}

function authed(token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------

function testRegistry() {
    console.log('\n--- TEST 1: the permission registry ---');
    const p = require('./api/_permissions.js');

    assert(Object.keys(p.PERMISSIONS).length >= 20,
        `a real registry exists (${Object.keys(p.PERMISSIONS).length} codes)`);

    // Fail closed: a role nobody defined gets nothing, not everything.
    assert(p.permissionsFor('TYPO_ROLE').length === 0,
        'an unknown role gets no permissions');
    assert(p.permissionsFor('').length === 0 && p.permissionsFor(null).length === 0,
        'a missing role gets no permissions');

    const sizes = ['VIEWER', 'MEMBER', 'OWNER', 'ADMIN'].map(r => p.permissionsFor(r).length);
    assert(sizes[0] < sizes[1] && sizes[1] < sizes[2] && sizes[2] <= sizes[3],
        `capability increases with role (${sizes.join(' < ')})`);

    const viewerWrites = ['expense.create', 'expense.edit', 'expense.delete',
                          'bill.manage', 'users.manage', 'backup.manage'];
    assert(viewerWrites.every(c => !p.roleHas('VIEWER', c)),
        'a VIEWER holds no write permission');

    assert(!p.roleHas('MEMBER', 'audit.view'), 'a MEMBER cannot view the audit trail');
    assert(!p.roleHas('MEMBER', 'users.manage'), 'a MEMBER cannot manage users');
    assert(p.roleHas('OWNER', 'audit.view'), 'an OWNER can view the audit trail');
    assert(p.roleHas('ADMIN', 'users.manage'), 'an ADMIN can manage users');

    assert(p.roleHasAny('MEMBER', ['users.manage', 'expense.create']),
        'roleHasAny matches when one is held');
    assert(!p.roleHasAll('MEMBER', ['expense.create', 'users.manage']),
        'roleHasAll fails when one is missing');
}

async function testMigrateNoLongerOpen() {
    console.log('\n--- TEST 2: /api/migrate is no longer an open write ---');

    const payload = JSON.stringify([
        { date: '2026-10-05', amount: 99999, category: 'INJECTED', paidBy: 'attacker' }
    ]);

    const anon = await fetch(`${BASE_URL}/api/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
    });
    assert(anon.status === 401,
        `an anonymous bulk write is refused (got ${anon.status})`);

    const member = await login(MEMBER.username, MEMBER.password);
    const asMember = await fetch(`${BASE_URL}/api/migrate`, {
        method: 'POST',
        headers: authed(member.token),
        body: payload
    });
    assert(asMember.status === 403,
        `a MEMBER cannot bulk-migrate over the ledger (got ${asMember.status})`);

    const owner = await login(OWNER.username, OWNER.password);
    const list = await fetch(`${BASE_URL}/api/expenses?_t=${Date.now()}`, {
        headers: authed(owner.token)
    });
    const rows = (await list.json()).data || [];
    assert(!rows.some(r => r.category === 'INJECTED'),
        'no injected record reached the ledger');
}

async function testAuditIsAdministrative() {
    console.log('\n--- TEST 3: the audit trail is administrative ---');

    const anon = await fetch(`${BASE_URL}/api/audit?format=json`);
    assert(anon.status === 401, `anonymous is refused (got ${anon.status})`);

    const member = await login(MEMBER.username, MEMBER.password);
    const asMember = await fetch(`${BASE_URL}/api/audit?format=json`, {
        headers: authed(member.token)
    });
    assert(asMember.status === 403,
        `a MEMBER can no longer read the whole audit trail (got ${asMember.status})`);

    const owner = await login(OWNER.username, OWNER.password);
    const asOwner = await fetch(`${BASE_URL}/api/audit?format=json`, {
        headers: authed(owner.token)
    });
    assert(asOwner.status === 200, `an OWNER still can (got ${asOwner.status})`);
}

async function testViewerCannotUploadReceipts() {
    console.log('\n--- TEST 4: a VIEWER is read-only for receipts too ---');
    const admin = await login(ADMIN.username, ADMIN.password);
    const name = `viewer_${Date.now().toString().slice(-6)}`;

    const made = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({
            action: 'create_user', username: name, password: 'Viewer@12345',
            name: 'Receipt Viewer', role: 'VIEWER', householdId: 'H001'
        })
    });
    assert(made.status === 200 || made.status === 201, `created a VIEWER (got ${made.status})`);

    const viewer = await login(name, 'Viewer@12345');
    const upload = await fetch(`${BASE_URL}/api/receipts`, {
        method: 'POST',
        headers: authed(viewer.token),
        body: JSON.stringify({ receiptData: 'data:image/png;base64,iVBORw0KGgo=' })
    });
    assert(upload.status === 403, `a VIEWER cannot upload a receipt (got ${upload.status})`);
}

async function testSessionCarriesPermissions() {
    console.log('\n--- TEST 5: the session tells the client what it may do ---');
    const perms = require('./api/_permissions.js');

    for (const who of [MEMBER, OWNER, ADMIN]) {
        const res = await login(who.username, who.password);
        const sent = res.user && res.user.permissions;
        assert(Array.isArray(sent) && sent.length > 0,
            `${who.username} receives a permission list (${sent ? sent.length : 0})`);
        const expected = perms.permissionsFor(res.user.role);
        assert(sent.length === expected.length,
            `${who.username}'s list matches the registry for ${res.user.role}`);
    }

    const member = await login(MEMBER.username, MEMBER.password);
    assert(member.user.permissions.indexOf('audit.view') === -1,
        'a MEMBER is not told they may view the audit trail');
}

function testClientMirrorsServer() {
    console.log('\n--- TEST 6: the client mirrors the server registry ---');
    const fs = require('fs');
    const perms = require('./api/_permissions.js');
    const src = fs.readFileSync(require.resolve('./tracker_app.js'), 'utf8');

    assert(/function hasPermission\(/.test(src) &&
           /function hasAnyPermission\(/.test(src) &&
           /function hasAllPermissions\(/.test(src),
        'the client exposes a permission service');
    assert(/function canOpenTab\(/.test(src) && /if \(!canOpenTab\(tabId\)\)/.test(src),
        'switchTab refuses a tab the role cannot open');
    assert(/const NAV_ITEMS = \[/.test(src),
        'navigation is declared once, with a permission per item');
    assert(/function applyNavPermissions\(/.test(src),
        'the nav surfaces are trimmed from that one declaration');

    // The fallback exists for sessions minted before the server sent a list. It
    // has to agree with the registry, or the two drift apart in silence.
    const m = src.match(/VIEWER: \[([\s\S]*?)\]/);
    assert(!!m, 'a VIEWER fallback is declared for older sessions');
    if (m) {
        const viewerCodes = (m[1].match(/'[a-z.]+'/g) || []).length;
        const serverViewer = perms.permissionsFor('VIEWER').length;
        assert(viewerCodes === serverViewer,
            `the VIEWER fallback matches the server (${viewerCodes} vs ${serverViewer})`);
    }
}

// ---------------------------------------------------------------------------
// Per-user overrides.
//
// The registry derived everything from the role, so an administrator could
// only move a person between four buckets. A user record may now carry its own
// `permissions` list; that list wins. These checks care about the API, not the
// checkboxes - UI hiding is not security, so the endpoint is what gets asked.

function testOverrideRegistry() {
    console.log('\n--- TEST 7: the registry honours a per-user list ---');
    const p = require('./api/_permissions.js');

    assert(p.permissionsFor({ role: 'VIEWER' }).length === p.permissionsFor('VIEWER').length,
        'a user with no list falls back to the role defaults');

    const custom = p.permissionsFor({ role: 'VIEWER', permissions: ['expense.create'] });
    assert(custom.length === 1 && custom[0] === 'expense.create',
        'an explicit list wins over the role');

    // A list is not a free-text field. Anything unrecognised is dropped rather
    // than stored, so a tampered request cannot park a string in the record.
    const dirty = p.sanitizePermissions(['expense.create', 'not.a.real.permission', '']);
    assert(dirty.length === 1 && dirty[0] === 'expense.create',
        'unknown permission codes are discarded, not stored');

    assert(p.sanitizePermissions('expense.create') === null,
        'a non-array is rejected outright');

    assert(p.permissionsFor({ role: 'OWNER', permissions: [] }).length === p.permissionsFor('OWNER').length,
        'an empty list means "no override", not "no permissions"');

    assert(!p.hasExplicitPermissions({ role: 'OWNER' }) &&
            p.hasExplicitPermissions({ role: 'OWNER', permissions: ['expense.view'] }),
        'an override is distinguishable from inherited defaults');

    const presets = p.ROLE_PRESETS;
    assert(['MEMBER', 'FINANCE_MANAGER', 'STAFF_MANAGER', 'ADMINISTRATOR']
            .every(k => presets[k] && Array.isArray(presets[k].permissions) && presets[k].label),
        'the four named presets exist and carry real lists');
    assert(presets.ADMINISTRATOR.permissions.length === p.ALL_PERMISSIONS.length,
        'the Administrator preset covers every permission');
    assert(presets.STAFF_MANAGER.permissions.includes('attendance.manage') &&
           !presets.STAFF_MANAGER.permissions.includes('household.manage'),
        'Staff Manager gets attendance but not household administration');
}

async function testOverrideIsEnforcedByTheAPI() {
    console.log('\n--- TEST 8: an override changes what the API allows ---');
    const admin = await login(ADMIN.username, ADMIN.password);

    // A throwaway VIEWER in the owner's household.
    const uname = 'permtest' + Date.now().toString(36).slice(-6);
    const created = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({
            action: 'create_user',
            name: 'Permission Override Probe',
            username: uname,
            password: 'Probe@12345',
            email: uname + '@test.local',
            householdId: 'H001',
            role: 'VIEWER'
        })
    }).then(r => r.json());
    assert(created.success === true, 'a VIEWER was created to test against');
    if (!created.success) return;
    const probeId = created.user.userId;

    const asProbe = async () => (await login(uname, 'Probe@12345')).token;

    // 1. As a plain VIEWER the write is refused.
    let token = await asProbe();
    let res = await fetch(`${BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify({ date: '2026-10-05', amount: 11, category: 'Grocery & Vegetables', paidBy: 'Palash' })
    });
    assert(res.status === 403, `a VIEWER cannot create an expense (got ${res.status})`);

    // 2. Grant exactly the permissions needed, nothing else.
    const grant = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({
            action: 'edit_user',
            userId: probeId,
            permissions: ['dashboard.view', 'expense.view', 'expense.create']
        })
    }).then(r => r.json());
    assert(grant.success === true, 'the override was accepted');

    token = await asProbe();
    res = await fetch(`${BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify({ date: '2026-10-05', amount: 11, category: 'Grocery & Vegetables', paidBy: 'Palash' })
    });
    const createdExpense = res.status === 200 ? await res.json() : null;
    assert(res.status === 200,
        `the same VIEWER can now create an expense (got ${res.status})`);

    // 3. And still cannot do what was not granted. This is the half that
    //    matters: an override must not quietly widen into the role's defaults.
    res = await fetch(`${BASE_URL}/api/expenses?id=${encodeURIComponent((createdExpense && createdExpense.expense && createdExpense.expense.id) || 'exp-none')}`, {
        method: 'DELETE',
        headers: authed(token)
    });
    assert(res.status === 403,
        `deleting is still refused, because it was not granted (got ${res.status})`);

    res = await fetch(`${BASE_URL}/api/audit?action=logs`, { headers: authed(token) });
    assert(res.status === 403,
        `the audit trail is still refused (got ${res.status})`);

    // 4. The session payload tells the client the same story the API enforces.
    const verify = await fetch(`${BASE_URL}/api/auth?action=verify`, { headers: authed(token) })
        .then(r => r.json());
    assert(Array.isArray(verify.user.permissions) &&
           verify.user.permissions.length === 3 &&
           verify.user.permissions.includes('expense.create') &&
           !verify.user.permissions.includes('expense.delete'),
        'the session reports the overridden list, not the role defaults');
    assert(verify.user.permissionsAreCustom === true,
        'the session says the list is an override');

    // 5. Clearing it restores the role.
    const cleared = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({ action: 'edit_user', userId: probeId, permissions: [] })
    }).then(r => r.json());
    assert(cleared.success === true, 'the override was cleared');

    token = await asProbe();
    res = await fetch(`${BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify({ date: '2026-10-05', amount: 12, category: 'Grocery & Vegetables', paidBy: 'Palash' })
    });
    assert(res.status === 403,
        `with the override gone the VIEWER is read-only again (got ${res.status})`);

    // 6. Nobody may grant what they do not hold. The household OWNER has no
    //    household.manage, so they must not be able to hand it out.
    const owner = await login(OWNER.username, OWNER.password);
    const escalate = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(owner.token),
        body: JSON.stringify({
            action: 'edit_user',
            userId: probeId,
            permissions: ['expense.view', 'household.manage']
        })
    });
    assert(escalate.status === 403,
        `an owner cannot grant a permission they do not hold (got ${escalate.status})`);

    // And the refusal actually prevented the write.
    token = await asProbe();
    const after = await fetch(`${BASE_URL}/api/auth?action=verify`, { headers: authed(token) })
        .then(r => r.json());
    assert(!after.user.permissions.includes('household.manage'),
        'the refused escalation was not stored');

    // 7. An administrator cannot strip their own user-management rights.
    const selfLock = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({
            action: 'edit_user',
            userId: admin.user.userId,
            permissions: ['dashboard.view', 'expense.view']
        })
    });
    assert(selfLock.status === 400,
        `an admin cannot lock themselves out of user management (got ${selfLock.status})`);

    // Tidy up. The expense the probe created is removed as well, so this
    // suite leaves the ledger exactly as it found it and the baseline counts
    // other suites assert against stay true whatever order they run in.
    if (createdExpense && createdExpense.expense && createdExpense.expense.id) {
        await fetch(`${BASE_URL}/api/expenses?id=${encodeURIComponent(createdExpense.expense.id)}`, {
            method: 'DELETE',
            headers: authed(admin.token)
        });
    }
    await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: authed(admin.token),
        body: JSON.stringify({ action: 'delete_user', userId: probeId })
    });
}

function testOverrideEditorExists() {
    console.log('\n--- TEST 9: the admin UI can actually set them ---');
    const fs = require('fs');
    const html = fs.readFileSync(require.resolve('./index.html'), 'utf8');
    const src = fs.readFileSync(require.resolve('./tracker_app.js'), 'utf8');
    const perms = require('./api/_permissions.js');

    assert(/id="editUserPermissionGrid"/.test(html),
        'the edit-user modal has a permission grid');
    // The handlers moved out of the markup into the generated registry, so
    // the markup proves the buttons are there and the registry proves they
    // do something. Asserting on the old inline onclick would now fail while
    // the buttons work perfectly.
    const actions = fs.readFileSync(require.resolve('./ui_actions.js'), 'utf8');
    assert(/setAllUserPermissions\(true\)/.test(actions) &&
           /setAllUserPermissions\(false\)/.test(actions),
        'Select all and Clear all are both present');
    const panel = html.slice(html.indexOf('id="editUserPermissionsBody"'),
                             html.indexOf('id="editUserPermissionGrid"'));
    assert((panel.match(/data-click="a\d+"/g) || []).length >= 3,
        'the panel wires up Select all, Clear all and Use role defaults');
    assert(/id="editUserPermissionPresets"/.test(html),
        'the preset row is present');
    assert(/function applyPermissionPreset\(/.test(src),
        'presets are applied by a real handler');
    // Sent only when the boxes were touched. Sending them on every save pinned
    // whatever happened to be on screen as an override, so changing a user's
    // role silently did nothing - the audit caught a demoted VIEWER still
    // writing expenses.
    assert(/payload\.permissions = collectUserPermissions\(\)/.test(src),
        'the save sends the ticked list');
    assert(/if \(userPermissionsTouched\) \{/.test(src),
        'and only when the administrator actually set them');
    assert(src.includes('userPermissionsTouched = false;') &&
           src.indexOf('userPermissionsTouched = false;') < src.indexOf('renderUserPermissionEditor(u);'),
        'opening the editor starts from untouched');

    // Every code the server enforces has wording in the editor; otherwise a
    // permission exists that an administrator can never find.
    const labelled = (src.match(/^\s*'[a-z.]+':\s*\[/gm) || [])
        .map(l => (l.match(/'([a-z.]+)'/) || [])[1]);
    const missing = perms.ALL_PERMISSIONS.filter(c => labelled.indexOf(c) === -1);
    assert(missing.length === 0,
        `every permission the API enforces is shown in the editor (missing: ${missing.join(', ') || 'none'})`);
}

(async () => {
    console.log('====================================================');
    console.log(' PERMISSIONS & AUTHORIZATION SUITE');
    console.log('====================================================');

    testRegistry();
    await testMigrateNoLongerOpen();
    await testAuditIsAdministrative();
    await testViewerCannotUploadReceipts();
    await testSessionCarriesPermissions();
    testClientMirrorsServer();
    testOverrideRegistry();
    await testOverrideIsEnforcedByTheAPI();
    testOverrideEditorExists();

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\nSUITE ERROR:', e);
    process.exit(1);
});
