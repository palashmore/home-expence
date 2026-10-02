// Authentication and self-service password change.
//
// Two things are pinned here:
//
//   1. The login bypass is gone. The handler used to accept "Household123!"
//      for ANY account in ANY household, plus "<display name>@123", plus two
//      account-specific strings. That was a complete authentication bypass on
//      a deployment holding several households' financial records, and it made
//      changing a password pointless - a strong password could still be walked
//      past with the fallback.
//
//   2. change_password only ever changes the caller's own password, and only
//      with their current one.
//
// Run through ./run_tests.sh, which points the server at a scratch copy of
// data/ and disables cloud sync. These tests change passwords, so every one of
// them restores what it changed.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';

// Real passwords, i.e. the ones the stored scrypt hashes actually verify.
const ADMIN = { username: 'admin', password: 'Admin@123' };
const OWNER = { username: 'palash', password: 'Palash@123' };
const MEMBER = { username: 'pallavi', password: 'Pallavi@123' };

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

async function rawLogin(username, password) {
    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password })
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function login(username, password) {
    const { json } = await rawLogin(username, password);
    if (!json.token) throw new Error(`login failed for ${username}`);
    return json.token;
}

async function changePassword(token, body) {
    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'change_password', ...body })
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------

async function testNoLoginBypass() {
    console.log('\n--- TEST 1: the universal login bypass is gone ---');

    // Each of these opened every account before.
    const bypasses = [
        ['palash', 'Household123!', 'the universal fallback'],
        ['pallavi', 'Household123!', 'the universal fallback on another account'],
        ['admin', 'Household123!', 'the universal fallback on the administrator'],
        ['sanjay', 'Household123!', 'the universal fallback across a household boundary']
    ];
    for (const [user, pw, label] of bypasses) {
        const { status, json } = await rawLogin(user, pw);
        assert(status === 401 && !json.token, `${user}: ${label} is rejected (got ${status})`);
    }

    // The guessable "<display name>@123" shape. Pallavi's real password happens
    // to be Pallavi@123, so the one that proves the pattern is gone is a user
    // whose real password differs - checked after a change, in TEST 5.
    const real = await rawLogin(OWNER.username, OWNER.password);
    assert(real.status === 200 && !!real.json.token,
        'the real password still works, so nobody was locked out');
}

async function testSelfServiceChange() {
    console.log('\n--- TEST 2: a member can change their own password ---');
    const token = await login(MEMBER.username, MEMBER.password);
    const temp = 'Temp#Member99';

    const ok = await changePassword(token, {
        currentPassword: MEMBER.password, newPassword: temp, confirmPassword: temp
    });
    assert(ok.status === 200 && ok.json.success,
        `a MEMBER - not an admin or owner - can change their own password (got ${ok.status})`);

    const withNew = await rawLogin(MEMBER.username, temp);
    assert(withNew.status === 200 && !!withNew.json.token, 'the new password works');

    const withOld = await rawLogin(MEMBER.username, MEMBER.password);
    assert(withOld.status === 401, 'the old password stops working');

    // Put it back.
    const back = await changePassword(withNew.json.token, {
        currentPassword: temp, newPassword: MEMBER.password, confirmPassword: MEMBER.password
    });
    assert(back.status === 200, 'restored the original password');
    const restored = await rawLogin(MEMBER.username, MEMBER.password);
    assert(restored.status === 200, 'the original password works again');
}

async function testCurrentPasswordRequired() {
    console.log('\n--- TEST 3: the current password is required and verified ---');
    const token = await login(OWNER.username, OWNER.password);

    const wrong = await changePassword(token, {
        currentPassword: 'NotMyPassword1', newPassword: 'Whatever#123', confirmPassword: 'Whatever#123'
    });
    assert(wrong.status === 403 && wrong.json.field === 'currentPassword',
        `a wrong current password is refused (got ${wrong.status})`);

    const missing = await changePassword(token, {
        newPassword: 'Whatever#123', confirmPassword: 'Whatever#123'
    });
    assert(missing.status === 422 && missing.json.field === 'currentPassword',
        `omitting the current password is refused (got ${missing.status})`);

    const stillWorks = await rawLogin(OWNER.username, OWNER.password);
    assert(stillWorks.status === 200, 'the password was not changed by either refused attempt');
}

async function testValidation() {
    console.log('\n--- TEST 4: new password rules ---');
    const token = await login(OWNER.username, OWNER.password);

    const short = await changePassword(token, {
        currentPassword: OWNER.password, newPassword: 'Ab#1', confirmPassword: 'Ab#1'
    });
    assert(short.status === 422 && short.json.field === 'newPassword',
        `under 8 characters is refused (got ${short.status})`);

    const mismatch = await changePassword(token, {
        currentPassword: OWNER.password, newPassword: 'LongEnough#1', confirmPassword: 'LongEnough#2'
    });
    assert(mismatch.status === 422 && mismatch.json.field === 'confirmPassword',
        `a mismatched confirmation is refused (got ${mismatch.status})`);

    const same = await changePassword(token, {
        currentPassword: OWNER.password, newPassword: OWNER.password, confirmPassword: OWNER.password
    });
    assert(same.status === 422 && same.json.field === 'newPassword',
        `reusing the current password is refused (got ${same.status})`);

    const unchanged = await rawLogin(OWNER.username, OWNER.password);
    assert(unchanged.status === 200, 'none of the refused attempts changed anything');
}

async function testCannotTargetAnotherAccount() {
    console.log('\n--- TEST 5: change_password cannot be aimed at anyone else ---');

    const memberToken = await login(MEMBER.username, MEMBER.password);
    const temp = 'Member#Only77';

    // A userId in the body must be ignored: the session decides the target.
    const attempt = await changePassword(memberToken, {
        userId: 'U001',
        username: 'palash',
        currentPassword: MEMBER.password,
        newPassword: temp,
        confirmPassword: temp
    });
    assert(attempt.status === 200,
        'the call succeeds, because a userId in the body is simply ignored');

    const ownerIntact = await rawLogin(OWNER.username, OWNER.password);
    assert(ownerIntact.status === 200,
        "the other account's password was NOT changed");

    const victimWithTemp = await rawLogin(OWNER.username, temp);
    assert(victimWithTemp.status === 401,
        'the other account did not take the attacker-supplied password');

    // And the name-pattern bypass is gone: pallavi's password is no longer
    // Pallavi@123, so "<display name>@123" must now fail.
    const namePattern = await rawLogin(MEMBER.username, 'Pallavi@123');
    assert(namePattern.status === 401,
        'the "<display name>@123" pattern no longer opens the account');

    // Restore.
    const back = await changePassword(await login(MEMBER.username, temp), {
        currentPassword: temp, newPassword: MEMBER.password, confirmPassword: MEMBER.password
    });
    assert(back.status === 200, 'restored the member password');
}

async function testUnauthenticated() {
    console.log('\n--- TEST 6: an unauthenticated caller cannot change anything ---');
    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'change_password',
            currentPassword: OWNER.password,
            newPassword: 'Hijacked#123',
            confirmPassword: 'Hijacked#123'
        })
    });
    assert(res.status === 401, `no token is refused with 401 (got ${res.status})`);
    const unchanged = await rawLogin(OWNER.username, OWNER.password);
    assert(unchanged.status === 200, 'the password is unchanged');
}

async function testAdminStillHasFullAccess() {
    console.log('\n--- TEST 7: an administrator can still reset any user ---');
    const adminToken = await login(ADMIN.username, ADMIN.password);
    const temp = 'AdminSet#2024';

    const res = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'edit_user', userId: 'U002', password: temp })
    });
    assert(res.status === 200, `the admin reset is accepted (got ${res.status})`);

    const asUser = await rawLogin(MEMBER.username, temp);
    assert(asUser.status === 200, 'the user can sign in with the admin-set password');
    assert(!!asUser.json.token, 'and receives a session');

    // The admin reset does not need the user's current password - that is the
    // point of it - but it still must not be reachable without admin rights.
    const memberToken = asUser.json.token;
    const asMember = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
        body: JSON.stringify({ action: 'edit_user', userId: 'U001', password: 'Nope#12345' })
    });
    assert(asMember.status === 403,
        `a MEMBER cannot use the admin reset path (got ${asMember.status})`);

    const ownerIntact = await rawLogin(OWNER.username, OWNER.password);
    assert(ownerIntact.status === 200, "the owner's password survived the attempt");

    // Restore.
    await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'edit_user', userId: 'U002', password: MEMBER.password })
    });
    const restored = await rawLogin(MEMBER.username, MEMBER.password);
    assert(restored.status === 200, 'restored the member password');
}

(async () => {
    console.log('====================================================');
    console.log(' AUTHENTICATION & PASSWORD SUITE');
    console.log('====================================================');

    await testNoLoginBypass();
    await testSelfServiceChange();
    await testCurrentPasswordRequired();
    await testValidation();
    await testCannotTargetAnotherAccount();
    await testUnauthenticated();
    await testAdminStillHasFullAccess();

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\nSUITE ERROR:', e);
    process.exit(1);
});
