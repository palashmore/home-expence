const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./api/auth');

const PORT = 8000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest({ method = 'GET', urlPath, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlPath, BASE_URL);
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: method,
            headers: {
                ...headers,
                ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(JSON.stringify(body)) } : {})
            }
        };

        const req = http.request(options, (res) => {
            let resBody = '';
            res.on('data', (chunk) => resBody += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(resBody);
                } catch (e) {
                    parsed = resBody;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: parsed
                });
            });
        });

        req.on('error', (e) => reject(e));
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log('====================================================');
    console.log('🚀 Running Zero-Cache & Master Settings Sync Test Suite');
    console.log('====================================================\n');

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passedTests++;
        } else {
            console.error(`  ❌ FAIL: ${message}`);
            failedTests++;
        }
    }

    // Generate tokens for testing
    const palashUser = { userId: 'U001', username: 'palash', name: 'Palash', role: 'OWNER', householdId: 'H001' };
    const pallaviUser = { userId: 'U002', username: 'pallavi', name: 'Pallavi', role: 'MEMBER', householdId: 'H001' };
    const viewerUser = { userId: 'U999', username: 'guest_viewer', name: 'Guest Viewer', role: 'VIEWER', householdId: 'H001' };
    const sanjayUser = { userId: 'U003', username: 'sanjay', name: 'Sanjay', role: 'OWNER', householdId: 'H002' };

    const palashToken = auth.generateSessionToken(palashUser, { householdId: 'H001', householdName: 'Palash & Pallavi Residence' });
    const pallaviToken = auth.generateSessionToken(pallaviUser, { householdId: 'H001', householdName: 'Palash & Pallavi Residence' });
    const viewerToken = auth.generateSessionToken(viewerUser, { householdId: 'H001', householdName: 'Palash & Pallavi Residence' });
    const sanjayToken = auth.generateSessionToken(sanjayUser, { householdId: 'H002', householdName: 'Sanjay Residence' });

    // Test 1: GET /api/config zero-cache headers
    console.log('--- TEST 1: Zero-Cache Response Headers on /api/config ---');
    try {
        const res = await makeRequest({
            method: 'GET',
            urlPath: '/api/config?householdId=H001',
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(res.statusCode === 200, 'GET /api/config returns 200 OK');
        const cacheControl = res.headers['cache-control'] || '';
        assert(cacheControl.includes('no-store') && cacheControl.includes('no-cache'), `Cache-Control header specifies no-store, no-cache: ${cacheControl}`);
        assert(res.headers['pragma'] === 'no-cache', `Pragma header is no-cache`);
    } catch (err) {
        assert(false, `TEST 1 threw error: ${err.message}`);
    }

    // Test 2: Add category via POST /api/config (action: add_category)
    console.log('\n--- TEST 2: Atomic Category Creation via /api/config ---');
    const testCatName = `Automated Test Category ${Date.now()}`;
    try {
        const res = await makeRequest({
            method: 'POST',
            urlPath: '/api/config',
            headers: { 'Authorization': `Bearer ${palashToken}` },
            body: {
                action: 'add_category',
                category: {
                    name: testCatName,
                    icon: '🔬',
                    type: 'expense',
                    defaultPaidTo: 'Lab Services'
                },
                householdId: 'H001'
            }
        });
        assert(res.statusCode === 200, `Add category returns 200 OK: ${res.statusCode}`);
        assert(res.data && res.data.success === true, `Response returns success: true`);
        const cats = res.data.data && res.data.data.categories;
        const found = cats && cats.find(c => c.name === testCatName);
        assert(!!found, `Newly created category "${testCatName}" present in response categories`);
    } catch (err) {
        assert(false, `TEST 2 threw error: ${err.message}`);
    }

    // Test 3: Zero-Cache direct read of newly created category
    console.log('\n--- TEST 3: Zero-Cache Direct Read of Newly Created Category ---');
    try {
        const res = await makeRequest({
            method: 'GET',
            urlPath: `/api/config?householdId=H001&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${pallaviToken}` }
        });
        assert(res.statusCode === 200, 'Pallavi fetches fresh H001 config successfully');
        const cats = res.data && res.data.data && res.data.data.categories;
        const found = cats && cats.find(c => c.name === testCatName);
        assert(!!found, `Pallavi immediately sees new category "${testCatName}" without cache`);
    } catch (err) {
        assert(false, `TEST 3 threw error: ${err.message}`);
    }

    // Test 4: Role-based permission enforcement for VIEWER
    console.log('\n--- TEST 4: Role-Based Permission Enforcement for VIEWER ---');
    try {
        // 4a: VIEWER attempting to modify config
        const configRes = await makeRequest({
            method: 'POST',
            urlPath: '/api/config',
            headers: { 'Authorization': `Bearer ${viewerToken}` },
            body: {
                action: 'add_category',
                category: { name: 'Illegal Viewer Cat' },
                householdId: 'H001'
            }
        });
        assert(configRes.statusCode === 403, `VIEWER modifying config returns 403 Forbidden (got ${configRes.statusCode})`);

        // 4b: VIEWER attempting to add expense
        const expRes = await makeRequest({
            method: 'POST',
            urlPath: '/api/expenses',
            headers: { 'Authorization': `Bearer ${viewerToken}` },
            body: {
                date: '2026-09-29',
                amount: 999,
                category: testCatName,
                paidBy: 'Palash'
            }
        });
        assert(expRes.statusCode === 403, `VIEWER creating expense returns 403 Forbidden (got ${expRes.statusCode})`);

        // 4c: VIEWER attempting to record attendance
        const attRes = await makeRequest({
            method: 'POST',
            urlPath: '/api/attendance',
            headers: { 'Authorization': `Bearer ${viewerToken}` },
            body: {
                action: 'mark',
                staffId: 'staff-maid-madhuri',
                date: '2026-09-29',
                status: 'present'
            }
        });
        assert(attRes.statusCode === 403, `VIEWER recording attendance returns 403 Forbidden (got ${attRes.statusCode})`);
    } catch (err) {
        assert(false, `TEST 4 threw error: ${err.message}`);
    }

    // Test 5: Add Expense using new category by OWNER/MEMBER (verifying save action doesn't crash on notes)
    console.log('\n--- TEST 5: Add Expense with Notes & Category Sync ---');
    let createdExpenseId = null;
    try {
        const res = await makeRequest({
            method: 'POST',
            urlPath: '/api/expenses',
            headers: { 'Authorization': `Bearer ${palashToken}` },
            body: {
                date: '2026-09-29',
                amount: 350.50,
                category: testCatName,
                paidBy: 'Palash',
                paidTo: 'Lab Services',
                paymentMethod: 'UPI',
                splitBetween: 'Household Expense',
                notes: 'Automated test note verifying save action works end-to-end'
            }
        });
        assert(res.statusCode === 200 || res.statusCode === 201, `Save expense returns 200/201 (got ${res.statusCode})`);
        assert(res.data && res.data.success === true, `Expense creation success: true`);
        createdExpenseId = res.data && res.data.data && res.data.data.id;
        assert(!!createdExpenseId, `Created expense ID received: ${createdExpenseId}`);
    } catch (err) {
        assert(false, `TEST 5 threw error: ${err.message}`);
    }

    // Test 6: Verify expense saved in ledger & auto-sync category in config
    console.log('\n--- TEST 6: Verify Expense in Ledger & Clean Up ---');
    try {
        // Read back expenses
        const res = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H001&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${pallaviToken}` }
        });
        assert(res.statusCode === 200, `GET /api/expenses returns 200 OK`);
        const exps = res.data && res.data.data;
        const foundExp = exps && exps.find(e => String(e.id) === String(createdExpenseId));
        assert(!!foundExp, `Expense ${createdExpenseId} retrieved successfully from H001 ledger`);
        assert(foundExp && foundExp.notes === 'Automated test note verifying save action works end-to-end', `Notes correctly stored and retrieved`);

        // Clean up test expense
        if (createdExpenseId) {
            const delRes = await makeRequest({
                method: 'DELETE',
                urlPath: `/api/expenses?id=${createdExpenseId}`,
                headers: { 'Authorization': `Bearer ${palashToken}` }
            });
            assert(delRes.statusCode === 200, `Test expense cleaned up successfully`);

            // Purge temporary test expense from disk so raw files remain pure baseline
            const h1File = path.join(__dirname, 'data', 'households', 'H001', 'expenses.json');
            const mainFile = path.join(__dirname, 'data', 'expenses.json');
            [h1File, mainFile].forEach(f => {
                if (fs.existsSync(f)) {
                    const records = JSON.parse(fs.readFileSync(f, 'utf8'));
                    const filtered = records.filter(r => String(r.id) !== String(createdExpenseId));
                    fs.writeFileSync(f, JSON.stringify(filtered, null, 2));
                }
            });
        }

        // Clean up test category from config
        const configRes = await makeRequest({
            method: 'GET',
            urlPath: '/api/config?householdId=H001',
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        if (configRes.data && configRes.data.data) {
            const cleanCats = configRes.data.data.categories.filter(c => c.name !== testCatName);
            await makeRequest({
                method: 'POST',
                urlPath: '/api/config',
                headers: { 'Authorization': `Bearer ${palashToken}` },
                body: { categories: cleanCats, householdId: 'H001' }
            });
            console.log(`  🧹 Cleaned up temporary test category: ${testCatName}`);
        }
    } catch (err) {
        assert(false, `TEST 6 threw error: ${err.message}`);
    }

    // Test 7: Verify baseline expenses integrity (122 records, ₹156,761.33)
    console.log('\n--- TEST 7: Baseline Ledger Data Integrity Verification ---');
    try {
        const raw = fs.readFileSync(path.join(__dirname, 'data', 'expenses.json'), 'utf8');
        const exps = JSON.parse(raw);
        const activeExps = exps.filter(e => !e.isDeleted);
        const count = activeExps.length;
        const total = activeExps.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

        assert(count === 122, `Active expenses count is exactly 122 (got ${count})`);
        assert(Math.abs(total - 156761.33) < 0.05, `Total amount is exactly ₹156,761.33 (got ₹${total.toFixed(2)})`);
    } catch (err) {
        assert(false, `TEST 7 threw error: ${err.message}`);
    }

    // Test 8: Household Isolation Check (H001 vs H002)
    console.log('\n--- TEST 8: Multi-Tenant Household Isolation Check ---');
    try {
        const h2Res = await makeRequest({
            method: 'GET',
            urlPath: '/api/expenses?householdId=H002',
            headers: { 'Authorization': `Bearer ${sanjayToken}` }
        });
        assert(h2Res.statusCode === 200, `H002 user can query H002 expenses`);
        const h2Exps = h2Res.data && h2Res.data.data;
        // Sanjay cannot see H001's 122 expenses
        assert(Array.isArray(h2Exps) && h2Exps.length !== 122, `H002 expenses isolated from H001`);
    } catch (err) {
        assert(false, `TEST 8 threw error: ${err.message}`);
    }

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log('====================================================');

    process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
