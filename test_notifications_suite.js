// Household notifications and recurring-bill reminders.
//
// Two features, and the defects found while building them:
//
//   1. Adding an expense notifies the other members of that household, and
//      nobody outside it.
//
//   2. Recurring bills and staff paydays produce reminders daily from
//      REMINDER_LEAD_DAYS before the due date, on the day, and while overdue -
//      stopping as soon as a payment is recorded.
//
// The reminder scan previously read one global config and all expenses, then
// dispatched through sendPushToAll, which reaches EVERY subscriber on the
// system - so one household's bills would have been pushed to every other
// household's phones. Its trigger was also unauthenticated. Both are pinned
// here.
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
    return json;
}

function authed(token) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------

function testReminderWindow() {
    console.log('\n--- TEST 1: the reminder window ---');
    const notifications = require('./api/notifications.js');
    const build = notifications.buildHouseholdReminders;
    const LEAD = notifications.REMINDER_LEAD_DAYS;

    assert(LEAD === 5, `reminders start 5 days before the due date (got ${LEAD})`);

    const config = {
        recurringBills: [
            { id: 'b1', name: 'Electricity Bill', category: 'Electricity Bill', dueDay: 10, approxAmount: 2200 }
        ],
        staff: []
    };
    const on = (day) => new Date(2026, 5, day);   // June 2026

    const at = (day, expenses = []) => build({ config, expenses, today: on(day) });

    assert(at(4).length === 0, 'six days out: silent (outside the window)');
    assert(at(5).length === 1, 'five days out: reminds');
    assert(at(9).length === 1, 'one day out: reminds');
    assert(at(10).length === 1, 'on the due day: reminds');
    assert(at(12).length === 1, 'two days overdue: still reminds');
    assert(at(25).length === 0, 'far past the overdue window: stops');

    // Every day in the window produces exactly one reminder - the "daily" part.
    const daily = [5, 6, 7, 8, 9, 10].map(d => at(d).length);
    assert(daily.every(n => n === 1),
        `one reminder per day across the window (got ${daily.join(',')})`);

    // And each day's tag differs, so a day's reminder is distinct.
    const tags = new Set([5, 6, 7, 8, 9, 10].map(d => at(d)[0].tag));
    assert(tags.size === 6, `each day carries its own tag (got ${tags.size} distinct)`);

    const wording = at(10)[0];
    assert(/due today/i.test(wording.title), `the due-day wording is clear (got "${wording.title}")`);
    assert(/overdue/i.test(at(13)[0].title), 'overdue wording is clear');
}

function testPaidBillsGoQuiet() {
    console.log('\n--- TEST 2: a paid bill stops reminding ---');
    const { buildHouseholdReminders: build } = require('./api/notifications.js');
    const config = {
        recurringBills: [
            { id: 'b1', name: 'Electricity Bill', category: 'Electricity Bill', dueDay: 10, approxAmount: 2200 }
        ],
        staff: []
    };
    const today = new Date(2026, 5, 8);

    assert(build({ config, expenses: [], today }).length === 1, 'unpaid: reminds');

    const paid = [{ id: 'e1', date: '2026-06-03', category: 'Electricity Bill', amount: 2150 }];
    assert(build({ config, expenses: paid, today }).length === 0,
        'once recorded this month: goes quiet');

    const lastMonth = [{ id: 'e2', date: '2026-05-03', category: 'Electricity Bill', amount: 2150 }];
    assert(build({ config, expenses: lastMonth, today }).length === 1,
        "last month's payment does not silence this month");

    const deleted = [{ id: 'e3', date: '2026-06-03', category: 'Electricity Bill', amount: 2150, isDeleted: true }];
    assert(build({ config, expenses: deleted, today }).length === 1,
        'a deleted expense does not count as paid');
}

function testNothingConfiguredNothingSent() {
    console.log('\n--- TEST 3: nothing configured means nothing sent ---');
    const { buildHouseholdReminders: build } = require('./api/notifications.js');
    const today = new Date(2026, 5, 8);

    assert(build({ config: {}, expenses: [], today }).length === 0,
        'a household with no bills and no staff gets no reminders');
    assert(build({ config: null, expenses: [], today }).length === 0,
        'a missing config is handled without inventing reminders');
    assert(build({ config: { recurringBills: [{ id: 'b', name: 'X', category: 'X', dueDay: 8, active: false }] },
                   expenses: [], today }).length === 0,
        'an inactive bill is skipped');
}

function testStaffPaydayReminders() {
    console.log('\n--- TEST 4: staff payday reminders ---');
    const { buildHouseholdReminders: build } = require('./api/notifications.js');
    const config = {
        recurringBills: [],
        staff: [{ id: 's1', name: 'Cook - A', shortName: 'A', baseSalary: 4500, billingCycleDay: 30 }]
    };
    // February: a cycle day of 30 has to clamp to the last day of the month.
    const feb = build({ config, expenses: [], today: new Date(2026, 1, 26) });
    assert(feb.length === 1, 'a 30th payday still reminds in February');
    assert(/day 28/.test(feb[0].body), `the payday is clamped to month end (got "${feb[0].body}")`);

    const paid = [{ id: 'p1', date: '2026-02-26', category: 'Cook - A', amount: 4500 }];
    assert(build({ config, expenses: paid, today: new Date(2026, 1, 26) }).length === 0,
        'a recorded salary payment silences it');
}

async function testTriggerRequiresCredential() {
    console.log('\n--- TEST 5: the reminder trigger is not open to the world ---');

    const anon = await fetch(`${BASE_URL}/api/notifications?action=check_and_send`);
    assert(anon.status === 401,
        `an anonymous caller cannot fan out notifications (got ${anon.status})`);

    const member = await login(MEMBER.username, MEMBER.password);
    const asMember = await fetch(`${BASE_URL}/api/notifications?action=check_and_send`, {
        headers: authed(member.token)
    });
    assert(asMember.status === 403,
        `an ordinary member cannot trigger it either (got ${asMember.status})`);

    const admin = await login(ADMIN.username, ADMIN.password);
    const asAdmin = await fetch(`${BASE_URL}/api/notifications?action=check_and_send`, {
        headers: authed(admin.token)
    });
    assert(asAdmin.status === 200,
        `an administrator can trigger it (got ${asAdmin.status})`);

    const body = await asAdmin.json().catch(() => ({}));
    assert(body.success === true && body.result,
        'and gets a report back of what was evaluated');
}

async function testExpenseNotifiesHouseholdOnly() {
    console.log('\n--- TEST 6: an expense notifies the household, and only it ---');

    const owner = await login(OWNER.username, OWNER.password);
    const before = await fetch(`${BASE_URL}/api/notifications?action=list_in_app&_t=${Date.now()}`, {
        headers: authed(owner.token)
    });
    const beforeJson = await before.json();
    const beforeCount = (beforeJson.data || []).length;

    const marker = `notif-test-${Date.now()}`;
    const save = await fetch(`${BASE_URL}/api/expenses`, {
        method: 'POST',
        headers: authed(owner.token),
        body: JSON.stringify({
            date: new Date().toISOString().slice(0, 10),
            category: 'Grocery & Vegetables',
            amount: 321,
            paidBy: 'Palash',
            notes: marker
        })
    });
    assert(save.status === 200, `the expense was recorded (got ${save.status})`);
    const saved = await save.json().catch(() => ({}));

    // The other member of the same household sees it.
    const member = await login(MEMBER.username, MEMBER.password);
    assert(member.user.householdId === owner.user.householdId,
        'the two users really are in the same household');

    const forMember = await fetch(`${BASE_URL}/api/notifications?action=list_in_app&_t=${Date.now()}`, {
        headers: authed(member.token)
    });
    const memberJson = await forMember.json();
    const memberList = memberJson.data || [];
    assert(memberList.length > beforeCount || memberList.some(n => (n.body || '').includes(marker)),
        `the other household member receives the notification (${memberList.length} entries)`);

    const hit = memberList.find(n => (n.body || '').includes(marker));
    assert(!!hit, 'the notification names the expense that was added');
    assert(hit && /palash/i.test(hit.title || hit.actor || ''),
        `it says who added it (got "${hit && hit.title}")`);

    // Nobody in another household sees it.
    const outsider = await login('sanjay', 'Sanjay@123');
    assert(outsider.user.householdId !== owner.user.householdId,
        'the outsider is in a different household');
    const forOutsider = await fetch(`${BASE_URL}/api/notifications?action=list_in_app&_t=${Date.now()}`, {
        headers: authed(outsider.token)
    });
    const outsiderList = (await forOutsider.json()).data || [];
    assert(!outsiderList.some(n => (n.body || '').includes(marker)),
        'a user in another household does NOT receive it');

    // Clean up.
    if (saved.data && saved.data.id) {
        await fetch(`${BASE_URL}/api/expenses?id=${encodeURIComponent(saved.data.id)}`, {
            method: 'DELETE', headers: authed(owner.token)
        });
    }
}

async function testScanIsHouseholdScoped() {
    console.log('\n--- TEST 7: the scan dispatches per household, never globally ---');
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./api/notifications.js'), 'utf8');

    const scan = src.slice(src.indexOf('async function checkAndSendScheduledReminders'));
    const body = scan.slice(0, scan.indexOf('\nmodule.exports'));

    assert(!/sendPushToAll\s*\(/.test(body),
        'the scan no longer fans out through sendPushToAll, which reaches every subscriber');
    assert(/sendPushToHouseholdMembers\s*\(/.test(body),
        'it dispatches through the household-scoped sender');
    assert(/getAllHouseholds\s*\(/.test(body),
        'it walks households rather than reading one global config');
    assert(/getHouseholdConfig\s*\(/.test(body) && /getHouseholdExpenses\s*\(/.test(body),
        "it reads each household's own config and expenses");

    // And the scheduler is actually wired, since a setInterval never fires on
    // a serverless host.
    const vercel = JSON.parse(fs.readFileSync(require.resolve('./vercel.json'), 'utf8'));
    const crons = vercel.crons || [];
    assert(crons.length > 0 && /check_and_send/.test(crons[0].path),
        'vercel.json schedules the scan, so it actually runs in production');
    assert(/^\S+ \S+ \S+ \S+ \S+$/.test(crons[0].schedule || ''),
        `the schedule is a valid cron expression (got "${crons[0] && crons[0].schedule}")`);
}

function testCategoryBudgets() {
    console.log('\n--- TEST 8: per-category budgets ---');
    const rules = require('./api/_config_rules.js');

    const bad = rules.validateConfigPayload({
        categories: [{ name: 'Groceries', monthlyBudget: 'lots' }]
    });
    assert(bad.some(e => /monthlyBudget/.test(e.field)),
        'a non-numeric category budget is rejected');

    const negative = rules.validateConfigPayload({
        categories: [{ name: 'Groceries', monthlyBudget: -5 }]
    });
    assert(negative.some(e => /monthlyBudget/.test(e.field)),
        'a negative category budget is rejected');

    const good = rules.validateConfigPayload({
        categories: [{ name: 'Groceries', monthlyBudget: 4000 },
                     { name: 'Fuel' }]
    });
    assert(good.length === 0,
        `a valid budget and a category without one both pass (got ${good.length} errors)`);

    const zero = rules.validateConfigPayload({
        categories: [{ name: 'Groceries', monthlyBudget: 0 }]
    });
    assert(zero.length === 0, 'a budget of zero is allowed');

    // The budget lives on the category rather than in a structure of its own,
    // so it has to survive the config round-trip.
    const store = require('./api/_cloud_store.js');
    const native = {
        categories: [{ name: 'Groceries', icon: 'G', type: 'expense', monthlyBudget: 4000 }],
        staff: [], recurringBills: [], monthlyBudgetLimit: 50000
    };
    const back = store.fromStoredConfig(store.toStoredConfig(native));
    assert(back.categories[0].monthlyBudget === 4000,
        `the category budget survives the round trip (got ${back.categories[0].monthlyBudget})`);
}

async function testPushOutcomesAreReported() {
    console.log('\n--- TEST 9: the scan reports what push services accepted ---');
    const admin = await login(ADMIN.username, ADMIN.password);
    const res = await fetch(`${BASE_URL}/api/notifications?action=check_and_send`, {
        headers: authed(admin.token)
    });
    const json = await res.json();
    const r = json.result || {};

    assert(res.status === 200, `the scan ran (got ${res.status})`);
    assert('sentCount' in r, 'it reports how many reminders were dispatched');
    assert('pushAccepted' in r && 'pushFailed' in r,
        'and separately what the push services accepted and refused');
    assert('pushExpiredRemoved' in r,
        'and how many dead subscriptions were pruned');

    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./api/notifications.js'), 'utf8');
    assert(/accepted \+= Number/.test(src),
        'the counts come from the dispatch result, not from counting loop turns');
}

(async () => {
    console.log('====================================================');
    console.log(' NOTIFICATIONS & BILL REMINDERS SUITE');
    console.log('====================================================');

    testReminderWindow();
    testPaidBillsGoQuiet();
    testNothingConfiguredNothingSent();
    testStaffPaydayReminders();
    await testTriggerRequiresCredential();
    await testExpenseNotifiesHouseholdOnly();
    await testScanIsHouseholdScoped();
    testCategoryBudgets();
    await testPushOutcomesAreReported();

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
    console.error('\nSUITE ERROR:', e);
    process.exit(1);
});
