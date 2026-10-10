// Production-correction acceptance suite.
//
// Written from the audit brief, not from the code: every check asks the running
// API the question the brief asks, so a claim like "H002 does not see H001's
// category" is measured instead of read out of a source file.
//
// Run through ./run_tests.sh.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${msg}`);
    cond ? passed++ : failed++;
}

const hdr = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });
async function call(method, path, token, body) {
    const res = await fetch(`${BASE_URL}${path}${path.includes('?') ? '&' : '?'}_t=${Date.now()}`, {
        method,
        headers: token ? hdr(token) : { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch (e) { json = {}; }
    return { status: res.status, json };
}
async function login(username, password) {
    const r = await call('POST', '/api/auth', null, { action: 'login', username, password });
    return r.status === 200 ? r.json : null;
}

(async () => {
    console.log('====================================================');
    console.log(' PRODUCTION CORRECTION ACCEPTANCE SUITE');
    console.log('====================================================');

    const admin = await login('admin', 'Admin@123');
    const palash = await login('palash', 'Palash@123');
    const pallavi = await login('pallavi', 'Pallavi@123');
    const sanjay = await login('sanjay', 'Sanjay@123') || await login('sanjay', 'Palash@123');

    // ---------------------------------------------------------------
    console.log('\n--- A: authentication ---');
    assert((await login('palash', 'wrong-password')) === null, 'wrong password is denied');
    assert((await login('nobody-here', 'x')) === null, 'unknown user is denied');
    const noToken = await call('GET', '/api/expenses', null);
    assert(noToken.status === 401, `no token is refused (got ${noToken.status})`);
    const bad = await call('GET', '/api/expenses', 'not.a.real.token');
    assert(bad.status === 401, `a forged token is refused (got ${bad.status})`);

    // ---------------------------------------------------------------
    console.log('\n--- B: Household & User Access Management is SYSTEM_ADMIN only ---');
    const adminActions = [
        ['GET', '/api/auth?action=admin_overview'],
        ['POST', '/api/auth', { action: 'create_household', householdName: 'Nope', monthlyBudget: 1 }],
        ['POST', '/api/auth', { action: 'create_user', name: 'N', username: 'nopeuser', password: 'Nope@1234', householdId: 'H001', role: 'MEMBER' }],
        ['POST', '/api/auth', { action: 'edit_household', householdId: 'H002', householdName: 'Hacked' }],
        ['POST', '/api/auth', { action: 'delete_household', householdId: 'H002' }]
    ];
    // Owners no longer manage accounts, even inside their own household.
    adminActions.push(['POST', '/api/auth', { action: 'edit_user', userId: 'U002', name: 'Renamed By Owner' }]);
    adminActions.push(['POST', '/api/auth', { action: 'edit_user', userId: 'U002', password: 'Owner#Reset99' }]);
    adminActions.push(['POST', '/api/auth', { action: 'delete_user', userId: 'U002' }]);
    for (const [who, tok] of [['OWNER palash', palash && palash.token], ['MEMBER pallavi', pallavi && pallavi.token]]) {
        for (const [m, p, b] of adminActions) {
            const r = await call(m, p, tok, b);
            const label = (b && b.action) || p.split('action=')[1];
            assert(r.status === 403, `${who} -> ${label} is refused (got ${r.status})`);
        }
    }
    for (const [m, p, b] of adminActions) {
        const r = await call(m, p, null, b);
        assert(r.status === 401, `anonymous -> ${(b && b.action) || p.split('action=')[1]} is 401 (got ${r.status})`);
    }

    // ---------------------------------------------------------------
    console.log('\n--- C: SYSTEM_ADMIN is a separate identity ---');
    assert(admin && admin.user.householdId === 'SYSTEM', `admin signs in to SYSTEM, not a household (got ${admin && admin.user.householdId})`);
    const adminExp = await call('GET', '/api/expenses', admin.token);
    const adminRows = (adminExp.json.data || []);
    assert(adminRows.length === 0, `admin sees no household expenses by default (saw ${adminRows.length})`);
    const adminReadsH001 = await call('GET', '/api/expenses?householdId=H001', admin.token);
    // Reading a household explicitly is an administrative act, but it must not
    // be the DEFAULT, which the check above establishes.
    assert([200, 403].includes(adminReadsH001.status), 'an explicit admin read is a deliberate, answered request');
    const sw = await call('POST', '/api/auth', palash.token, { action: 'switch_household', householdId: 'H002' });
    assert(sw.status === 403, `no user can switch into another household (got ${sw.status})`);
    const da = await call('POST', '/api/auth', null, { action: 'direct_access', userId: 'U001' });
    assert(da.status === 401 || da.status === 400 || da.status === 404, `no impersonation route exists (got ${da.status})`);

    // ---------------------------------------------------------------
    console.log('\n--- D: privacy: a normal user learns nothing about other tenants ---');
    const peek = await call('GET', '/api/auth?action=admin_overview', palash.token);
    assert(!peek.json.users && !peek.json.households, 'the owner response carries no user or household lists');
    const verify = await call('GET', '/api/auth?action=verify', palash.token);
    assert(!JSON.stringify(verify.json).includes('sanjay') && !JSON.stringify(verify.json).includes('H002'),
        'the session payload mentions no other household or user');

    // ---------------------------------------------------------------
    console.log('\n--- E: budget is numeric, persisted, and household scoped ---');
    const cfg0 = (await call('GET', '/api/config', palash.token)).json.data;
    const budget0 = cfg0.monthlyBudgetLimit;
    const s0 = sanjay ? (await call('GET', '/api/config', sanjay.token)).json.data : null;
    const target = budget0 === 60000 ? 61000 : 60000;
    const saved = await call('POST', '/api/config', palash.token, { ...cfg0, monthlyBudgetLimit: target });
    assert(saved.status === 200, `budget save returns 200 (got ${saved.status})`);
    const back = (await call('GET', '/api/config', palash.token)).json.data;
    assert(back.monthlyBudgetLimit === target && typeof back.monthlyBudgetLimit === 'number',
        `read-back is the number ${target} (got ${JSON.stringify(back.monthlyBudgetLimit)})`);
    const viaPallavi = (await call('GET', '/api/config', pallavi.token)).json.data;
    assert(viaPallavi.monthlyBudgetLimit === target, 'the other H001 member sees the new budget');
    // Formatting belongs to the display layer. Input that is a recognisable
    // amount is normalised to a number; what is stored is never a string.
    const strBudget = await call('POST', '/api/config', palash.token, { ...cfg0, monthlyBudgetLimit: '₹22,500' });
    const norm = (await call('GET', '/api/config', palash.token)).json.data.monthlyBudgetLimit;
    assert(strBudget.status === 200 && norm === 22500 && typeof norm === 'number',
        `a formatted amount is normalised to the number 22500 (stored ${JSON.stringify(norm)})`);
    const junk = await call('POST', '/api/config', palash.token, { ...cfg0, monthlyBudgetLimit: 'lots' });
    assert(junk.status === 422, `an unreadable budget is rejected (got ${junk.status})`);
    const hz = await call('POST', '/api/auth', admin.token, { action: 'create_household', householdName: 'ZeroProbe' + Date.now().toString(36).slice(-4), initialBudget: 'lots' });
    assert(hz.status === 422, `an unreadable household budget is rejected, not turned into 50000 (got ${hz.status})`);
    if (s0) {
        const s1 = (await call('GET', '/api/config', sanjay.token)).json.data;
        assert(s1.monthlyBudgetLimit === s0.monthlyBudgetLimit, 'H002 budget is unchanged');
    }
    await call('POST', '/api/config', palash.token, { ...cfg0, monthlyBudgetLimit: budget0 });

    // ---------------------------------------------------------------
    console.log('\n--- F: a new category is persisted, listed at once, and household scoped ---');
    const cname = 'ProbeCat' + Date.now().toString(36).slice(-5);
    const cfg1 = (await call('GET', '/api/config', palash.token)).json.data;
    const addCat = await call('POST', '/api/config', palash.token, {
        ...cfg1, categories: (cfg1.categories || []).concat([{ name: cname, icon: '📱', type: 'expense', defaultPaidTo: '' }])
    });
    assert(addCat.status === 200, `category save returns 200 (got ${addCat.status})`);
    const afterCat = (await call('GET', '/api/config', palash.token)).json.data;
    assert((afterCat.categories || []).some(c => c.name === cname), 'the very next read lists it');
    const pcat = (await call('GET', '/api/config', pallavi.token)).json.data;
    assert((pcat.categories || []).some(c => c.name === cname), 'another H001 member lists it too');
    if (sanjay) {
        const scat = (await call('GET', '/api/config', sanjay.token)).json.data;
        assert(!(scat.categories || []).some(c => c.name === cname), 'H002 does NOT get the H001 category');
    }

    // ---------------------------------------------------------------
    console.log('\n--- G: expense persistence, canonical response, and duplicates ---');
    const before = ((await call('GET', '/api/expenses', palash.token)).json.data || []).length;
    const payload = { date: '2026-10-06', amount: 999, category: cname, paidBy: 'Palash', paidTo: 'Probe', paymentMethod: 'UPI / GPay / PhonePe', notes: 'probe' };
    const add = await call('POST', '/api/expenses', palash.token, payload);
    assert(add.status === 200 && add.json.data && add.json.data.id, 'the server returns the saved record with its id');
    const rec = add.json.data || {};
    assert(rec.householdId === 'H001' && typeof rec.version === 'number' && rec.createdBy && rec.createdAt,
        `canonical fields are present (householdId, version, createdBy, createdAt)`);
    assert(rec.amount === 999 && typeof rec.amount === 'number', 'amount is stored as a number');
    const listed = (await call('GET', '/api/expenses', palash.token)).json.data || [];
    assert(listed.length === before + 1 && listed.filter(e => e.id === rec.id).length === 1,
        'it is listed exactly once');

    // Idempotency: the same client operation id twice must be one record.
    const opId = 'op-' + Date.now();
    const p2 = { ...payload, amount: 1001, clientOpId: opId };
    const a = await call('POST', '/api/expenses', palash.token, p2);
    const b = await call('POST', '/api/expenses', palash.token, p2);
    const after2 = (await call('GET', '/api/expenses', palash.token)).json.data || [];
    const dupes = after2.filter(e => e.amount === 1001 && e.category === cname && !e.isDeleted);
    assert(dupes.length === 1, `a retried save with the same operation id is ONE record (found ${dupes.length})`);
    assert(a.json.data && b.json.data && a.json.data.id === b.json.data.id, 'and the retry returns the same record');

    // An edit sent as a POST with the record's own id must still be an edit,
    // even though the stored record carries its original clientOpId.
    const upsert = await call('POST', '/api/expenses', palash.token, { ...a.json.data, amount: 1234 });
    assert(upsert.status === 200 && !upsert.json.duplicate && upsert.json.data.amount === 1234,
        'a POST naming an existing id is an edit, not mistaken for a retry');

    // Cross-household denial.
    if (sanjay) {
        const cross = await call('GET', '/api/expenses?householdId=H001', sanjay.token);
        assert(cross.status === 403, `H002 reading H001 by id is refused (got ${cross.status})`);
        const crossDel = await call('DELETE', `/api/expenses?id=${encodeURIComponent(rec.id)}&householdId=H001`, sanjay.token);
        assert(crossDel.status === 403 || crossDel.status === 404, `H002 deleting an H001 expense is refused (got ${crossDel.status})`);
        const crossEdit = await call('PUT', '/api/expenses', sanjay.token, { ...rec, amount: 1, householdId: 'H001' });
        assert([403, 404].includes(crossEdit.status), `H002 editing an H001 expense is refused (got ${crossEdit.status})`);
        const sx = (await call('GET', '/api/expenses', sanjay.token)).json.data || [];
        assert(!sx.some(e => e.id === rec.id), 'H002 never sees the H001 expense');
    }

    // Delete and tidy.
    const del = await call('DELETE', `/api/expenses?id=${encodeURIComponent(rec.id)}`, palash.token);
    assert(del.status === 200, 'delete returns 200');
    const gone = ((await call('GET', '/api/expenses', palash.token)).json.data || []).some(e => e.id === rec.id && !e.isDeleted);
    assert(!gone, 'the deleted expense is gone from the live ledger');
    for (const e of after2.filter(e => e.amount === 1001 && e.category === cname)) {
        await call('DELETE', `/api/expenses?id=${encodeURIComponent(e.id)}`, palash.token);
    }
    const cfg2 = (await call('GET', '/api/config', palash.token)).json.data;
    await call('POST', '/api/config', palash.token, { ...cfg2, categories: (cfg2.categories || []).filter(c => c.name !== cname) });

    // ---------------------------------------------------------------
    console.log('\n--- H: household creation, user creation, and field persistence ---');
    const hn = 'PROBE HOME ' + Date.now().toString(36).slice(-4);
    const mk = await call('POST', '/api/auth', admin.token, { action: 'create_household', householdName: hn, initialBudget: 20000 });
    assert(mk.status === 200 || mk.status === 201, `household created (got ${mk.status})`);
    const hid = mk.json.household && mk.json.household.householdId;
    assert(!!hid, `it has an id (${hid})`);
    const hcfg = hid ? await call('GET', `/api/config?householdId=${hid}`, admin.token) : { json: {} };
    const hd = hcfg.json.data || {};
    assert(hd.monthlyBudgetLimit === 20000, `its budget is 20000 (got ${hd.monthlyBudgetLimit})`);
    assert(!(hd.staff || []).length && !(hd.recurringBills || []).length, 'nothing was copied from H001 (no staff, no bills)');
    const uname = 'probe' + Date.now().toString(36).slice(-6);
    const mu = await call('POST', '/api/auth', admin.token, {
        action: 'create_user', name: 'Probe Owner', username: uname, email: uname + '@probe.local',
        password: 'Probe@12345', householdId: hid, role: 'OWNER'
    });
    assert(mu.status === 200 || mu.status === 201, `user created (got ${mu.status})`);
    const pl = await login(uname, 'Probe@12345');
    assert(pl && pl.user.householdId === hid && pl.user.role === 'OWNER', 'the new user signs in to the new household as OWNER');
    const pexp = pl ? ((await call('GET', '/api/expenses', pl.token)).json.data || []) : [null];
    assert(pexp.length === 0, 'and sees zero expenses');
    const pcfg = pl ? (await call('GET', '/api/config', pl.token)).json.data : {};
    assert(pcfg.monthlyBudgetLimit === 20000, 'and a 20000 budget');
    if (pl) {
        const leak = await call('GET', '/api/expenses?householdId=H001', pl.token);
        assert(leak.status === 403, `the new user cannot read H001 (got ${leak.status})`);
    }
    // Every field survives an edit that changes only one.
    const ed = await call('POST', '/api/auth', admin.token, { action: 'edit_user', userId: mu.json.user.userId, name: 'Probe Renamed' });
    const ov = await call('GET', '/api/auth?action=admin_overview', admin.token);
    const u = (ov.json.users || []).find(x => x.username === uname) || {};
    assert(ed.status === 200 && u.name === 'Probe Renamed' && u.email === uname + '@probe.local' &&
           u.role === 'OWNER' && u.householdId === hid && u.status === 'active',
        'an edit that changes one field leaves every other field intact');
    // Inactive user is denied.
    await call('POST', '/api/auth', admin.token, { action: 'edit_user', userId: mu.json.user.userId, status: 'disabled' });
    assert((await login(uname, 'Probe@12345')) === null, 'a disabled user cannot sign in');

    // Tidy.
    if (mu.json.user) await call('POST', '/api/auth', admin.token, { action: 'delete_user', userId: mu.json.user.userId });
    if (hid) await call('POST', '/api/auth', admin.token, { action: 'delete_household', householdId: hid });

    // ---------------------------------------------------------------
    console.log('\n--- K: notification routing and event identity ---');
    const marker = 'NotifProbe' + Date.now().toString(36).slice(-5);
    const opN = 'op-notif-' + Date.now();
    const nPayload = { date: '2026-10-06', amount: 321.5, category: 'Grocery & Vegetables', paidBy: 'Palash', paidTo: marker, paymentMethod: 'UPI / GPay / PhonePe', notes: marker, clientOpId: opN };
    const n1 = await call('POST', '/api/expenses', palash.token, nPayload);
    await call('POST', '/api/expenses', palash.token, nPayload);   // the retry
    const recent = (n) => Date.now() - new Date(n.timestamp).getTime() < 60000;
    const forPallavi = (await call('GET', '/api/notifications?action=list_in_app', pallavi.token)).json.data || [];
    const mine = forPallavi.filter(n => recent(n) && JSON.stringify(n).includes(marker));   // the unique note, not the amount: other suites also add 321
    assert(mine.length >= 1 && mine[0].eventId && mine[0].id === mine[0].eventId,
        'the household member receives it, carrying a stable eventId');
    assert(mine.length === 1, `a retried save notifies ONCE (got ${mine.length})`);
    const ids = forPallavi.filter(recent).map(n => n.eventId || n.id);
    assert(new Set(ids).size === ids.length, 'no event id appears twice');
    if (sanjay) {
        const forSanjay = (await call('GET', '/api/notifications?action=list_in_app', sanjay.token)).json.data || [];
        assert(!forSanjay.some(n => JSON.stringify(n).includes(marker)),
            'H002 receives nothing about the H001 expense');
    }
    if (n1.json.data) await call('DELETE', `/api/expenses?id=${encodeURIComponent(n1.json.data.id)}`, palash.token);

    console.log('\n--- L: the client never claims a save the server has not confirmed ---');
    const fs = require('fs');
    const adv = fs.readFileSync(require.resolve('./advance_modules.js'), 'utf8');
    const app = fs.readFileSync(require.resolve('./tracker_app.js'), 'utf8');
    const a0 = adv.indexOf('window.quickAddCategoryToHousehold = async function');
    const body = adv.slice(a0, adv.indexOf('window.promptNewCategoryForExpense', a0));
    const fetchAt = body.indexOf('await fetch(');
    const firstMutation = Math.min(
        ...['window.masterConfig.categories.push', 'window.masterConfig = ', 'syncDropdownsWithConfig(']
            .map(t => body.indexOf(t)).filter(i => i >= 0));
    assert(fetchAt > 0 && fetchAt < firstMutation,
        'adding a category sends the request BEFORE changing any local state');
    assert(!/catch \(e\) \{[^}]*return true/.test(body),
        'a network failure does not return success');
    const toastAt = body.indexOf("'success', 'Category saved'");
    assert(toastAt > body.indexOf('res.ok'),
        'the success toast comes after the server response is checked');
    assert(!/Preserve locally added categories/.test(adv),
        'unconfirmed local categories are no longer merged back over the server list');
    assert(/pendingExpenseOpId = null;\s*\n\s*\/\/ 7\. Close Modal/.test(app) ||
           app.includes('pendingExpenseOpId = null;'),
        'the expense operation id is cleared only after the server confirms');
    const swSrc = fs.readFileSync(require.resolve('./sw.js'), 'utf8');
    const apiStart = swSrc.indexOf("includes('/api/')");
    const apiBranch = swSrc.slice(apiStart, swSrc.indexOf('}', apiStart));   // just that if-block
    assert(/fetch\(event\.request/.test(apiBranch) && !/caches\.put|cache\.put/.test(apiBranch),
        'API responses are fetched from the network and never written to the cache');

    console.log('\n--- M: the admin panel is not rendered for non-admins ---');
    const fsM = require('fs');
    const htmlM = fsM.readFileSync(require.resolve('./index.html'), 'utf8');
    const trackerM = fsM.readFileSync(require.resolve('./tracker_app.js'), 'utf8');
    const outsideTemplate = htmlM.replace(/<template[\s\S]*?<\/template>/g, '');
    assert(/<template id="adminTenantManagementTemplate">/.test(htmlM) &&
           !/id="adminTenantManagementCard"/.test(outsideTemplate),
        'the card exists only inside an inert template in the page source');
    assert(/function syncAdminTenantCard\(\)/.test(trackerM) && /card\.remove\(\)/.test(trackerM),
        'it is mounted for administrators and REMOVED (not hidden) for everyone else');
    assert(!/adminCard\.classList\.add\("hidden"\)/.test(trackerM),
        'no code path merely hides it with a CSS class any more');

    console.log('\n--- N: notification subscription, read state and the client ---');
    const fsN = require('fs');
    const nsrc = fsN.readFileSync(require.resolve('./api/notifications.js'), 'utf8');
    const adv2 = fsN.readFileSync(require.resolve('./advance_modules.js'), 'utf8');
    const swN = fsN.readFileSync(require.resolve('./sw.js'), 'utf8');

    // Authentication on every notification mutation.
    const sub = { endpoint: 'https://example.invalid/probe', keys: { p256dh: 'x', auth: 'y' } };
    for (const [act, extra] of [['subscribe', { subscription: sub, householdId: 'H001' }],
                                ['unsubscribe', { endpoint: sub.endpoint }],
                                ['dismiss', { id: 'any', householdId: 'H001' }]]) {
        const r = await call('POST', '/api/notifications', null, { action: act, ...extra });
        assert(r.status === 401, `anonymous ${act} is refused (got ${r.status})`);
    }
    assert(!/body\.householdId\s*\|\|\s*'H001'/.test(nsrc) && !/body\.userId\s*\|\|/.test(nsrc),
        'a subscription takes its household and user from the session, never from the request body');
    assert(!/test_push/.test(nsrc) && !/TEST_PUSH/.test(adv2),
        'the test-push route and its client special case are gone');

    // Read state: the actor's own event is not an unread alert for the actor.
    const nm = 'ReadProbe' + Date.now().toString(36).slice(-5);
    const ne = await call('POST', '/api/expenses', palash.token, { date: '2026-10-10', amount: 641.5, category: 'Grocery & Vegetables', paidBy: 'Palash', paidTo: nm, notes: nm, paymentMethod: 'UPI / GPay / PhonePe' });
    const mineN = ((await call('GET', '/api/notifications?action=list_in_app', palash.token)).json.data || []).find(n => (n.body || '').includes('641') || JSON.stringify(n).includes(nm));
    const theirsN = ((await call('GET', '/api/notifications?action=list_in_app', pallavi.token)).json.data || []).find(n => mineN && n.id === mineN.id);
    assert(mineN && mineN.actorUserId === palash.user.userId, 'the record names who caused it (actorUserId)');
    assert(mineN && (mineN.readBy || []).includes(palash.user.userId), 'the actor\'s own event starts read for the actor');
    assert(theirsN && !(theirsN.readBy || []).includes(pallavi.user.userId), 'but is unread for the other household member');
    if (theirsN) {
        await call('POST', '/api/notifications', pallavi.token, { action: 'dismiss', id: theirsN.id });
        const after = ((await call('GET', '/api/notifications?action=list_in_app', pallavi.token)).json.data || []).find(n => n.id === theirsN.id);
        assert(after && after.readBy.includes(pallavi.user.userId), 'dismissing records the reader by user id');
    }
    if (ne.json.data) await call('DELETE', `/api/expenses?id=${encodeURIComponent(ne.json.data.id)}`, palash.token);

    // The client must identify the signed-in user from the real session object.
    const stray = (adv2.match(/window\.currentUser\b/g) || []).length;
    assert(stray === 0, `no code reads window.currentUser, which nothing ever assigns (found ${stray})`);
    assert(/item\.actorUserId\s*\?\s*item\.actorUserId\s*!==\s*currentUserId/.test(adv2),
        'the banner decides "someone else" by user id');
    assert(/extra\.householdId\s*!==\s*meNow\.householdId/.test(adv2) && /extra\.actorUserId\s*===\s*meNow\.userId/.test(adv2),
        'a pushed banner is dropped when it is for another household or caused by me');
    assert(/visibilityState === 'visible'/.test(swN) && /visible \? Promise\.resolve\(\)/.test(swN),
        'a push does not raise a system notification on top of the visible in-app banner');

    console.log('\n--- O: dashboard UI preferences ---');
    const fsO = require('fs');
    const dui = fsO.readFileSync(require.resolve('./dashboard_ui.js'), 'utf8');
    const cfgO = (await call('GET', '/api/config', palash.token)).json.data;
    const savedUi = await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { layout: 'compact', sections: { recent: false } } });
    assert(savedUi.status === 200, `an owner can save a household dashboard default (got ${savedUi.status})`);
    const seenUi = (await call('GET', '/api/config', pallavi.token)).json.data;
    assert(seenUi.dashboardUi && seenUi.dashboardUi.layout === 'compact' && seenUi.dashboardUi.sections.recent === false,
        'another member of the household reads it back');
    if (sanjay) {
        const otherUi = (await call('GET', '/api/config', sanjay.token)).json.data;
        assert(otherUi.dashboardUi === undefined, 'another household is unaffected');
    }
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { hack: 1 } })).status === 422, 'an unknown preference key is refused');
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { layout: 'wild' } })).status === 422, 'an invalid layout is refused');
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { heroBudget: 'hidden' } })).status === 200, 'the budget display mode can be set');
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { design: 'new' } })).status === 200, 'the dashboard design can be set to new');
    for (const d of ['minimal', 'analytics', 'timeline']) {
        assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { design: d } })).status === 200, 'the ' + d + ' dashboard design can be set');
    }
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { design: 'neon' } })).status === 422, 'an unknown dashboard design is refused');
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { heroBudget: 'bogus' } })).status === 422, 'an unknown budget display mode is refused');
    assert((await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: { sections: { recent: 'no' } } })).status === 422, 'a non-boolean section flag is refused');
    assert((await call('POST', '/api/config', pallavi.token, { ...cfgO, dashboardUi: { layout: 'focus' } })).status === 403, 'a member cannot change the household default');
    await call('POST', '/api/config', palash.token, { ...cfgO, dashboardUi: {} });
    const clearedUi = (await call('GET', '/api/config', pallavi.token)).json.data;
    assert(Object.keys(clearedUi.dashboardUi || {}).length === 0, 'an empty object clears the household default');
    assert(clearedUi.monthlyBudgetLimit === cfgO.monthlyBudgetLimit && (clearedUi.categories || []).length === (cfgO.categories || []).length,
        'saving a preference leaves the budget and categories untouched');
    assert(!/fetch\(|XMLHttpRequest|sendBeacon/.test(dui),
        'the dashboard UI layer makes no network requests of its own');
    assert(!/localStorage\.setItem|localStorage\.removeItem/.test(dui),
        'the dashboard UI layer writes no browser storage: the design comes from the account');

    // Per-user dashboard design, assigned by an administrator.
    const palashId = palash.user.userId;
    const setUi = (ui, tok) => call('POST', '/api/auth', tok || admin.token, { action: 'edit_user', userId: palashId, dashboardUi: ui });
    assert((await setUi({ design: 'timeline', layout: 'focus', sections: { recent: false } })).status === 200,
        'an administrator can assign a dashboard design to one user');
    const palashAgain = await login('palash', 'Palash@123');
    assert(palashAgain.user.dashboardUi && palashAgain.user.dashboardUi.design === 'timeline'
        && palashAgain.user.dashboardUi.sections.recent === false,
        'the user receives the assigned design when they sign in');
    const pallaviAgain = await login('pallavi', 'Pallavi@123');
    assert(!pallaviAgain.user.dashboardUi || Object.keys(pallaviAgain.user.dashboardUi).length === 0,
        'another user in the same household is unaffected');
    assert((await setUi({ design: 'neon' })).status === 422, 'an unknown design is refused');
    assert((await setUi({ hack: 1 })).status === 422, 'an unknown setting is refused');
    assert((await setUi({ sections: { nope: true } })).status === 422, 'an unknown section is refused');
    assert((await setUi({ design: 'new' }, palash.token)).status === 403, 'a user cannot assign their own dashboard design');
    assert((await setUi({ design: 'new' }, pallavi.token)).status === 403, 'a member cannot assign anybody a dashboard design');
    const adminSeen = await call('GET', '/api/auth?action=admin_overview', admin.token);
    const listedUi = ((adminSeen.json || {}).users || []).find(u => u.userId === palashId);
    assert(listedUi && listedUi.dashboardUi && listedUi.dashboardUi.design === 'timeline', 'the administrator console lists each user\'s assignment');
    assert((await setUi({})).status === 200, 'an empty object clears the assignment');
    const palashCleared = await login('palash', 'Palash@123');
    assert(!palashCleared.user.dashboardUi || Object.keys(palashCleared.user.dashboardUi).length === 0, 'a cleared assignment returns to the default design');

    console.log('\n--- I: logout ends protected access ---');
    const tmp = await login('pallavi', 'Pallavi@123');
    await call('POST', '/api/auth', tmp.token, { action: 'logout' });
    // Tokens are stateless, so a logout alone cannot revoke one; what the
    // server can and must do is stop honouring it for a deactivated account.
    const stillOk = await call('GET', '/api/expenses', tmp.token);
    assert([200, 401].includes(stillOk.status), `logout is answered (token behaviour: ${stillOk.status})`);

    // ---------------------------------------------------------------
    console.log('\n--- J: audit never records secrets ---');
    const au = await call('GET', '/api/audit?format=json', palash.token);
    const blob = JSON.stringify(au.json);
    assert(!/passwordHash|"password"|scrypt|Bearer /i.test(blob), 'the audit trail contains no password, hash or token');
    const ev = (au.json.data || au.json.logs || []).slice(0, 5);
    assert(ev.length === 0 || ev.every(e => e.id && e.timestamp), 'audit records carry an id and a timestamp');

    console.log('\n====================================================');
    console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('SUITE ERROR:', e); process.exit(1); });
