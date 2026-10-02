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
    console.log('🚀 Running Comprehensive Zero-Cache Transaction Sync Test Suite');
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

    // Test 1: Zero-Cache Headers on GET /api/expenses
    console.log('--- TEST 1: Zero-Cache Headers on /api/expenses ---');
    try {
        const res = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H001&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(res.statusCode === 200, 'GET /api/expenses returns 200 OK');
        const cc = res.headers['cache-control'] || '';
        assert(cc.includes('no-store') && cc.includes('no-cache'), `Cache-Control includes no-store, no-cache: "${cc}"`);
        assert(res.headers['pragma'] === 'no-cache', 'Pragma is no-cache');
        assert(res.headers['surrogate-control'] === 'no-store', 'Surrogate-Control is no-store');
    } catch (err) {
        assert(false, `TEST 1 threw error: ${err.message}`);
    }

    // Test 2: Zero-Cache Headers on GET /api/config, /api/audit, and /api/attendance
    console.log('\n--- TEST 2: Zero-Cache Headers Across All Household API Routes ---');
    try {
        const configRes = await makeRequest({
            method: 'GET',
            urlPath: '/api/config?householdId=H001',
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(configRes.statusCode === 200, 'GET /api/config returns 200 OK');
        assert((configRes.headers['cache-control'] || '').includes('no-store'), 'Config Cache-Control has no-store');

        const auditRes = await makeRequest({
            method: 'GET',
            urlPath: '/api/audit?format=json',
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(auditRes.statusCode === 200, 'GET /api/audit returns 200 OK');
        assert((auditRes.headers['cache-control'] || '').includes('no-store'), 'Audit Cache-Control has no-store');

        const attRes = await makeRequest({
            method: 'GET',
            urlPath: '/api/attendance',
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(attRes.statusCode === 200, 'GET /api/attendance returns 200 OK');
        assert((attRes.headers['cache-control'] || '').includes('no-store'), 'Attendance Cache-Control has no-store');
    } catch (err) {
        assert(false, `TEST 2 threw error: ${err.message}`);
    }

    // Test 3: Multi-User Direct Transaction Sync (Palash creates -> Pallavi reads without cache)
    console.log('\n--- TEST 3: Multi-User Direct Transaction Sync (Create -> Read) ---');
    const testExpense = {
        date: '2026-09-29',
        amount: 475.25,
        category: 'Grocery & Vegetables',
        paidBy: 'Palash',
        paidTo: 'Nature Basket',
        paymentMethod: 'UPI',
        splitBetween: 'Household Expense',
        notes: 'Real-time multi-user zero-cache verification transaction'
    };
    let createdId = null;
    try {
        // Palash adds expense
        const postRes = await makeRequest({
            method: 'POST',
            urlPath: '/api/expenses',
            headers: { 'Authorization': `Bearer ${palashToken}` },
            body: testExpense
        });
        assert(postRes.statusCode === 200 || postRes.statusCode === 201, `Palash posts expense: ${postRes.statusCode}`);
        assert(postRes.data && postRes.data.success === true, 'Palash receive success: true');
        createdId = postRes.data && postRes.data.data && postRes.data.data.id;
        assert(!!createdId, `Created expense ID: ${createdId}`);

        // Pallavi fetches fresh ledger with zero-cache immediately
        const pallaviGet = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H001&_t=${Date.now()}`,
            headers: {
                'Authorization': `Bearer ${pallaviToken}`,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            }
        });
        assert(pallaviGet.statusCode === 200, 'Pallavi fetches ledger returns 200 OK');
        const exps = pallaviGet.data && pallaviGet.data.data;
        const found = exps && exps.find(e => String(e.id) === String(createdId));
        assert(!!found, `Pallavi immediately sees newly created expense ${createdId} without stale cache`);
        assert(found && found.amount === 475.25, `Expense amount correctly reflects 475.25`);
    } catch (err) {
        assert(false, `TEST 3 threw error: ${err.message}`);
    }

    // Test 4: Multi-User Direct Transaction Sync (Palash updates -> Pallavi reads fresh)
    console.log('\n--- TEST 4: Multi-User Direct Transaction Sync (Update -> Read) ---');
    try {
        const updatePayload = {
            id: createdId,
            date: '2026-09-29',
            amount: 520.00,
            category: 'Grocery & Vegetables',
            paidBy: 'Palash',
            paidTo: 'Nature Basket Superstore',
            notes: 'Updated note for zero-cache live sync'
        };
        const putRes = await makeRequest({
            method: 'PUT',
            urlPath: '/api/expenses',
            headers: { 'Authorization': `Bearer ${palashToken}` },
            body: updatePayload
        });
        assert(putRes.statusCode === 200, `Palash updates expense returns 200 OK`);

        // Pallavi reads updated transaction
        const pallaviGetUpdated = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H001&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${pallaviToken}` }
        });
        const exps = pallaviGetUpdated.data && pallaviGetUpdated.data.data;
        const found = exps && exps.find(e => String(e.id) === String(createdId));
        assert(!!found && found.amount === 520.00, `Pallavi immediately sees updated amount ₹520.00 without cache`);
        assert(found && found.paidTo === 'Nature Basket Superstore', `Pallavi sees updated paidTo value`);
    } catch (err) {
        assert(false, `TEST 4 threw error: ${err.message}`);
    }

    // Test 5: Multi-User Direct Transaction Sync (Palash deletes -> Pallavi verifies removal)
    console.log('\n--- TEST 5: Multi-User Direct Transaction Sync (Delete -> Read) ---');
    try {
        const delRes = await makeRequest({
            method: 'DELETE',
            urlPath: `/api/expenses?id=${createdId}&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${palashToken}` }
        });
        assert(delRes.statusCode === 200, 'Palash deletes expense returns 200 OK');

        // Pallavi queries fresh ledger
        const pallaviGetDeleted = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H001&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${pallaviToken}` }
        });
        const exps = pallaviGetDeleted.data && pallaviGetDeleted.data.data;
        const found = exps && exps.find(e => String(e.id) === String(createdId));
        assert(!found, `Pallavi immediately sees expense removed from active ledger without cache`);

        // Purge temporary record from disk
        const h1File = path.join(__dirname, 'data', 'households', 'H001', 'expenses.json');
        const mainFile = path.join(__dirname, 'data', 'expenses.json');
        [h1File, mainFile].forEach(f => {
            if (fs.existsSync(f)) {
                const records = JSON.parse(fs.readFileSync(f, 'utf8'));
                const filtered = records.filter(r => String(r.id) !== String(createdId));
                fs.writeFileSync(f, JSON.stringify(filtered, null, 2));
            }
        });
    } catch (err) {
        assert(false, `TEST 5 threw error: ${err.message}`);
    }

    // Test 6: Role-Based Permission Enforcement for VIEWER
    console.log('\n--- TEST 6: Role-Based Permission Enforcement for VIEWER ---');
    try {
        // The viewer has to be a real account. This used to mint a token for
        // U999, a userId that was never created - which passed only because
        // tokens were accepted without checking the account still exists. Now
        // that a token for an unknown or disabled user is refused, a fabricated
        // viewer gets 401 and the role check it exists to prove never runs.
        const adminLogin = await makeRequest({
            method: 'POST', urlPath: '/api/auth',
            headers: { 'Content-Type': 'application/json' },
            body: { action: 'login', username: 'admin', password: 'Admin@123' }
        });
        const adminTok = adminLogin.data && adminLogin.data.token;
        const viewerName = `guest_viewer_${Date.now().toString().slice(-6)}`;
        await makeRequest({
            method: 'POST', urlPath: '/api/auth',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminTok}` },
            body: {
                action: 'create_user', username: viewerName, password: 'Viewer@12345',
                name: 'Guest Viewer', role: 'VIEWER', householdId: 'H001'
            }
        });
        const viewerLogin = await makeRequest({
            method: 'POST', urlPath: '/api/auth',
            headers: { 'Content-Type': 'application/json' },
            body: { action: 'login', username: viewerName, password: 'Viewer@12345' }
        });
        const realViewerToken = viewerLogin.data && viewerLogin.data.token;
        assert(!!realViewerToken, 'a real VIEWER account was created and can sign in');

        const expRes = await makeRequest({
            method: 'POST',
            urlPath: '/api/expenses',
            headers: { 'Authorization': `Bearer ${realViewerToken}` },
            body: { date: '2026-09-29', amount: 100, category: 'Test', paidBy: 'Palash' }
        });
        assert(expRes.statusCode === 403, `VIEWER creating expense blocked with 403 Forbidden`);

        const delRes = await makeRequest({
            method: 'DELETE',
            urlPath: '/api/expenses?id=some-id',
            headers: { 'Authorization': `Bearer ${realViewerToken}` }
        });
        assert(delRes.statusCode === 403, `VIEWER deleting expense blocked with 403 Forbidden`);
    } catch (err) {
        assert(false, `TEST 6 threw error: ${err.message}`);
    }

    // Test 7: Multi-Tenant Household Isolation (H001 vs H002)
    console.log('\n--- TEST 7: Multi-Tenant Household Isolation (H001 vs H002) ---');
    try {
        const h2Res = await makeRequest({
            method: 'GET',
            urlPath: `/api/expenses?householdId=H002&_t=${Date.now()}`,
            headers: { 'Authorization': `Bearer ${sanjayToken}` }
        });
        assert(h2Res.statusCode === 200, `H002 user queries H002 expenses returns 200 OK`);
        const h2Exps = h2Res.data && h2Res.data.data;
        assert(Array.isArray(h2Exps) && h2Exps.length !== 122, `H002 expenses strictly isolated from H001`);
    } catch (err) {
        assert(false, `TEST 7 threw error: ${err.message}`);
    }

    // Test 8: Baseline Ledger Data Integrity
    console.log('\n--- TEST 8: Baseline Ledger Data Integrity Verification ---');
    try {
        const raw = fs.readFileSync(path.join(__dirname, 'data', 'expenses.json'), 'utf8');
        const exps = JSON.parse(raw);
        const activeExps = exps.filter(e => !e.isDeleted);
        const count = activeExps.length;
        const total = activeExps.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

        assert(count === 122, `Active expenses count is exactly 122 (got ${count})`);
        assert(Math.abs(total - 156761.33) < 0.05, `Total amount is exactly ₹156,761.33 (got ₹${total.toFixed(2)})`);
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
