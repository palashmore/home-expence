// Server-side config validation and rename-cascade suite.
//
// Run through ./run_tests.sh, which points the server at a scratch copy of
// data/ and disables cloud sync. These tests mutate config and expenses.
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:8000';

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

function authed(token, extra = {}) {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra };
}

async function getConfig(token) {
    const res = await fetch(`${BASE_URL}/api/config?_t=${Date.now()}`, { headers: authed(token) });
    const json = await res.json();
    return json.data;
}

async function postConfig(token, body) {
    const res = await fetch(`${BASE_URL}/api/config`, {
        method: 'POST',
        headers: authed(token),
        body: JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (e) { json = {}; }
    return { status: res.status, json };
}

async function run() {
    console.log('====================================================');
    console.log('🔒 Config Validation & Rename Cascade Suite');
    console.log('====================================================\n');

    const token = await login('palash', 'Household123!');
    const original = await getConfig(token);

    // ---------------------------------------------------------------
    console.log('--- TEST 1: realistic amounts are accepted exactly ---');
    {
        const r = await postConfig(token, { monthlyBudgetLimit: 64250 });
        assert(r.status === 200, `budget 64250 accepted (got ${r.status})`);
        const cfg = await getConfig(token);
        assert(cfg.monthlyBudgetLimit === 64250,
            `budget stored exactly as 64250 (got ${cfg.monthlyBudgetLimit})`);

        const r2 = await postConfig(token, { monthlyBudgetLimit: 2805.5 });
        assert(r2.status === 200, `budget 2805.50 accepted (got ${r2.status})`);
        const cfg2 = await getConfig(token);
        assert(cfg2.monthlyBudgetLimit === 2805.5,
            `paise preserved in budget (got ${cfg2.monthlyBudgetLimit})`);
        assert(typeof cfg2.monthlyBudgetLimit === 'number',
            'budget is stored as a number, not a formatted string');
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 2: invalid values are rejected with 422, not coerced ---');
    {
        const r = await postConfig(token, { monthlyBudgetLimit: '' });
        assert(r.status === 422, `blank budget rejected with 422 (got ${r.status})`);
        assert(Array.isArray(r.json.fieldErrors) && r.json.fieldErrors.length > 0,
            'response carries per-field error messages');
        const cfg = await getConfig(token);
        assert(cfg.monthlyBudgetLimit === 2805.5,
            `blank budget did not overwrite the stored value with 50000 (got ${cfg.monthlyBudgetLimit})`);

        const r2 = await postConfig(token, { monthlyBudgetLimit: 'abc' });
        assert(r2.status === 422, `non-numeric budget rejected with 422 (got ${r2.status})`);

        const r3 = await postConfig(token, { monthlyBudgetLimit: -5 });
        assert(r3.status === 422, `negative budget rejected with 422 (got ${r3.status})`);
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 3: staff and bill rules ---');
    {
        const cfg = await getConfig(token);
        const staff = (cfg.staff || []).map(s => ({ ...s }));
        if (staff.length) {
            const bad = staff.map((s, i) => (i === 0 ? { ...s, name: '' } : s));
            const r = await postConfig(token, { staff: bad });
            assert(r.status === 422, `blank staff name rejected with 422 (got ${r.status})`);
            const after = await getConfig(token);
            assert((after.staff[0] || {}).name === staff[0].name,
                `staff name unchanged after rejected save (got ${(after.staff[0] || {}).name})`);

            const bad2 = staff.map((s, i) => (i === 0 ? { ...s, billingCycleDay: 45 } : s));
            const r2 = await postConfig(token, { staff: bad2 });
            assert(r2.status === 422, `payday 45 rejected with 422 (got ${r2.status})`);

            const good = staff.map((s, i) => (i === 0 ? { ...s, baseSalary: 7525 } : s));
            const r3 = await postConfig(token, { staff: good });
            assert(r3.status === 200, `salary 7525 accepted (got ${r3.status})`);
            const after3 = await getConfig(token);
            assert(after3.staff[0].baseSalary === 7525,
                `salary stored exactly as 7525 (got ${after3.staff[0].baseSalary})`);
        } else {
            console.log('  (no staff configured; skipping staff rules)');
        }

        const bills = (cfg.recurringBills || []).map(b => ({ ...b }));
        if (bills.length) {
            const bad = bills.map((b, i) => (i === 0 ? { ...b, dueDay: 0 } : b));
            const r = await postConfig(token, { recurringBills: bad });
            assert(r.status === 422, `due day 0 rejected with 422 (got ${r.status})`);

            const good = bills.map((b, i) => (i === 0 ? { ...b, approxAmount: 2805 } : b));
            const r2 = await postConfig(token, { recurringBills: good });
            assert(r2.status === 200, `bill amount 2805 accepted (got ${r2.status})`);
            const after = await getConfig(token);
            assert(after.recurringBills[0].approxAmount === 2805,
                `bill amount stored exactly as 2805 (got ${after.recurringBills[0].approxAmount})`);
        } else {
            console.log('  (no recurring bills configured; skipping bill rules)');
        }
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 4: unknown properties survive a save ---');
    {
        const cfg = await getConfig(token);
        const staff = (cfg.staff || []).map(s => ({ ...s }));
        if (staff.length) {
            const marked = staff.map((s, i) =>
                (i === 0 ? { ...s, shortName: 'ZZ9', someFutureField: 'keep-me' } : s));
            const r = await postConfig(token, { staff: marked });
            assert(r.status === 200, `save with extra properties accepted (got ${r.status})`);
            const after = await getConfig(token);
            assert(after.staff[0].shortName === 'ZZ9',
                `shortName survived (got ${after.staff[0].shortName})`);
            assert(after.staff[0].someFutureField === 'keep-me',
                `unknown property survived (got ${after.staff[0].someFutureField})`);

            // And a later save that omits them must not wipe them either,
            // because the client merges onto the stored record.
            const again = after.staff.map(s => ({ ...s }));
            const r2 = await postConfig(token, { staff: again });
            assert(r2.status === 200, 'follow-up save accepted');
            const after2 = await getConfig(token);
            assert(after2.staff[0].shortName === 'ZZ9', 'shortName still present after a second save');
        }
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 5: usage probe counts referring expenses ---');
    let probeCategory = null;
    {
        const expRes = await fetch(`${BASE_URL}/api/expenses?_t=${Date.now()}`, { headers: authed(token) });
        const expJson = await expRes.json();
        const live = (expJson.data || []).filter(e => !e.isDeleted);
        const counts = {};
        live.forEach(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
        probeCategory = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

        if (probeCategory) {
            const res = await fetch(
                `${BASE_URL}/api/config?action=usage&entity=category&name=${encodeURIComponent(probeCategory)}&_t=${Date.now()}`,
                { headers: authed(token) });
            const json = await res.json();
            assert(res.status === 200, `usage probe returns 200 (got ${res.status})`);
            assert(json.count === counts[probeCategory],
                `usage count matches the ledger for "${probeCategory}" (api ${json.count} vs ledger ${counts[probeCategory]})`);
        } else {
            console.log('  (no categorised expenses; skipping usage probe)');
        }
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 6: rename refuses to orphan history, then cascades ---');
    if (probeCategory) {
        const newName = `${probeCategory} Renamed`;

        // Without opting in, a rename that would move history is refused.
        const refused = await postConfig(token, {
            action: 'rename_entity', entity: 'category', from: probeCategory, to: newName
        });
        assert(refused.status === 409,
            `rename without cascade refused with 409 (got ${refused.status})`);
        assert(refused.json.requiresCascade === true && refused.json.affected > 0,
            `refusal reports how many expenses are affected (${refused.json.affected})`);

        const beforeCfg = await getConfig(token);
        assert((beforeCfg.categories || []).some(c => c.name === probeCategory),
            'category was not renamed by the refused attempt');

        // Opting in performs the rename and moves the history with it.
        const done = await postConfig(token, {
            action: 'rename_entity', entity: 'category',
            from: probeCategory, to: newName, cascade: true
        });
        assert(done.status === 200, `rename with cascade succeeds (got ${done.status})`);
        assert(done.json.updatedExpenses === refused.json.affected,
            `all ${refused.json.affected} expenses moved (moved ${done.json.updatedExpenses})`);

        const afterCfg = await getConfig(token);
        assert((afterCfg.categories || []).some(c => c.name === newName),
            'category list shows the new name');
        assert(!(afterCfg.categories || []).some(c => c.name === probeCategory),
            'old category name is gone');

        const expRes2 = await fetch(`${BASE_URL}/api/expenses?_t=${Date.now()}`, { headers: authed(token) });
        const expJson2 = await expRes2.json();
        const stillOld = (expJson2.data || []).filter(e => !e.isDeleted && e.category === probeCategory);
        assert(stillOld.length === 0,
            `no live expense still points at the old name (found ${stillOld.length})`);

        // Rename back so the fixture is stable for repeat runs.
        await postConfig(token, {
            action: 'rename_entity', entity: 'category',
            from: newName, to: probeCategory, cascade: true
        });
        const restored = await getConfig(token);
        assert((restored.categories || []).some(c => c.name === probeCategory),
            'rename is reversible and the original name is restored');
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 7: rename guards ---');
    {
        const cfg = await getConfig(token);
        const cats = cfg.categories || [];
        if (cats.length >= 2) {
            const clash = await postConfig(token, {
                action: 'rename_entity', entity: 'category',
                from: cats[0].name, to: cats[1].name, cascade: true
            });
            assert(clash.status === 422,
                `renaming onto an existing name is refused with 422 (got ${clash.status})`);
        }
        const missing = await postConfig(token, {
            action: 'rename_entity', entity: 'category',
            from: 'No Such Category At All', to: 'Whatever', cascade: true
        });
        assert(missing.status === 404, `renaming a missing entity returns 404 (got ${missing.status})`);

        const badEntity = await postConfig(token, {
            action: 'rename_entity', entity: 'nonsense', from: 'a', to: 'b'
        });
        assert(badEntity.status === 400, `unknown entity type returns 400 (got ${badEntity.status})`);
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 8: rename respects the tenant boundary ---');
    {
        // sanjay owns H002. He must not be able to rename anything in H001,
        // and the new action must not become a way around tenant isolation.
        const sanjay = await login('sanjay', 'Household123!');
        const res = await fetch(`${BASE_URL}/api/config?householdId=H001`, {
            method: 'POST',
            headers: authed(sanjay),
            body: JSON.stringify({
                action: 'rename_entity', entity: 'category',
                from: probeCategory || 'Anything', to: 'Hijacked', cascade: true
            })
        });
        assert(res.status === 403,
            `an owner of H002 is refused a rename in H001 (got ${res.status})`);

        const h1 = await getConfig(token);
        assert(!(h1.categories || []).some(c => c.name === 'Hijacked'),
            'H001 categories were not modified by the cross-tenant attempt');

        // The same rename inside his own household is fine.
        const own = await fetch(`${BASE_URL}/api/config`, {
            method: 'POST',
            headers: authed(sanjay),
            body: JSON.stringify({
                action: 'rename_entity', entity: 'category',
                from: 'No Such Category In H002', to: 'X', cascade: true
            })
        });
        assert(own.status === 404,
            `the same call scoped to his own household reaches the handler (got ${own.status})`);
    }

    // ---------------------------------------------------------------
    console.log('\n--- TEST 9: restore the original budget ---');
    {
        const r = await postConfig(token, { monthlyBudgetLimit: original.monthlyBudgetLimit });
        assert(r.status === 200, 'original budget restored');
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
