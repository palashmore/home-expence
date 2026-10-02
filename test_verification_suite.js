// Comprehensive Automated Production Verification Test Suite
const assert = require('assert');

const BASE_URL = 'http://localhost:8000';

async function run() {
    console.log("==================================================");
    console.log("RUNNING PRODUCTION REPAIR & RBAC VERIFICATION SUITE");
    console.log("==================================================");

    // 1. Admin Login & Authorization
    console.log("\n[TEST 1] Admin Sign-In & Context Scoping...");
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: 'admin', password: 'Admin@123' })
    });
    const adminLogin = await adminLoginRes.json();
    assert.strictEqual(adminLoginRes.status, 200, "Admin login should return 200");
    assert.strictEqual(adminLogin.success, true, "Admin login should succeed");
    assert.strictEqual(adminLogin.user.role, 'SYSTEM_ADMIN', "Admin role should be SYSTEM_ADMIN");
    assert.strictEqual(adminLogin.user.householdId, 'SYSTEM', "Admin household should be SYSTEM");
    const adminToken = adminLogin.token;
    console.log("  ✓ Admin signed in successfully as SYSTEM_ADMIN in SYSTEM context");

    // Admin overview access
    const adminOverviewRes = await fetch(`${BASE_URL}/api/auth?action=admin_overview`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminOverviewRes.status, 200, "Admin overview should return 200 for SYSTEM_ADMIN");
    const adminOverview = await adminOverviewRes.json();
    assert.strictEqual(adminOverview.success, true, "Admin overview should succeed");
    assert(adminOverview.households.length >= 2, "Admin overview should list all households");
    console.log(`  ✓ Admin overview accessible to SYSTEM_ADMIN (Households: ${adminOverview.households.length}, Users: ${adminOverview.users.length})`);

    // Admin SYSTEM expenses isolation
    const adminExpensesRes = await fetch(`${BASE_URL}/api/expenses`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const adminExpenses = await adminExpensesRes.json();
    assert.strictEqual(adminExpenses.count, 0, "Admin in SYSTEM context must have 0 personal expenses");
    assert.deepStrictEqual(adminExpenses.data, [], "Admin in SYSTEM context data must be empty array");
    console.log("  ✓ Admin SYSTEM context has 0 personal expenses (no bleed with tenant data)");

    // 2. Non-Admin (Palash / Owner) Login & Strict RBAC Lockdown
    console.log("\n[TEST 2] Non-Admin (Palash) Sign-In & Strict RBAC Enforcement...");
    const palashLoginRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: 'palash', password: 'Palash@123' })
    });
    const palashLogin = await palashLoginRes.json();
    assert.strictEqual(palashLoginRes.status, 200, "Palash login should return 200");
    assert.strictEqual(palashLogin.user.role, 'OWNER', "Palash role should be OWNER");
    assert.strictEqual(palashLogin.user.householdId, 'H001', "Palash household should be H001");
    const palashToken = palashLogin.token;
    console.log("  ✓ Palash signed in as OWNER of H001");

    // Non-admin attempting to access admin_overview -> Must be 403 Forbidden
    const palashOverviewRes = await fetch(`${BASE_URL}/api/auth?action=admin_overview`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    assert.strictEqual(palashOverviewRes.status, 403, "admin_overview MUST return 403 for non-admin");
    console.log("  ✓ Non-admin calling admin_overview correctly received 403 Forbidden");

    // Non-admin attempting to create household -> Must be 403 Forbidden
    const palashCreateHRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${palashToken}` },
        body: JSON.stringify({ action: 'create_household', householdName: 'Unauthorized HH' })
    });
    assert.strictEqual(palashCreateHRes.status, 403, "create_household MUST return 403 for non-admin");
    console.log("  ✓ Non-admin calling create_household correctly received 403 Forbidden");

    // Non-admin attempting cross-household config read -> Must be 403 Forbidden
    const palashCrossCfgRes = await fetch(`${BASE_URL}/api/config?householdId=H002`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    assert.strictEqual(palashCrossCfgRes.status, 403, "Cross-household config GET MUST return 403 for non-admin");
    console.log("  ✓ Non-admin attempting cross-household config read correctly received 403 Forbidden");

    // Non-admin attempting cross-household expenses read -> Must be 403 Forbidden
    const palashCrossExpRes = await fetch(`${BASE_URL}/api/expenses?householdId=H002`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    assert.strictEqual(palashCrossExpRes.status, 403, "Cross-household expenses GET MUST return 403 for non-admin");
    console.log("  ✓ Non-admin attempting cross-household expenses read correctly received 403 Forbidden");

    // Non-admin attempting cross-household notifications read -> Must be 403 Forbidden
    const palashCrossNotifRes = await fetch(`${BASE_URL}/api/notifications?action=list_in_app&householdId=H002`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    assert.strictEqual(palashCrossNotifRes.status, 403, "Cross-household notifications GET MUST return 403 for non-admin");
    console.log("  ✓ Non-admin attempting cross-household notifications read correctly received 403 Forbidden");

    // Disabled switch_household route
    const switchRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${palashToken}` },
        body: JSON.stringify({ action: 'switch_household', householdId: 'H002' })
    });
    assert.strictEqual(switchRes.status, 403, "switch_household route MUST return 403 Forbidden");
    console.log("  ✓ switch_household route correctly returns 403 Forbidden");

    // Direct access backdoor removal
    const directAccessRes = await fetch(`${BASE_URL}/api/auth`, {
        headers: { 'Authorization': 'Bearer direct_access' }
    });
    assert.strictEqual(directAccessRes.status, 401, "direct_access token backdoor MUST return 401 Unauthorized");
    console.log("  ✓ direct_access backdoor permanently eliminated (returns 401 Unauthorized)");

    // 3. Verify H001 Configuration & Zero Bleed into familyMembers
    console.log("\n[TEST 3] Verifying H001 Master Configuration & In-Memory Bleed Elimination...");
    // First trigger a GET from Admin
    await fetch(`${BASE_URL}/api/config?householdId=H001`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    // Now fetch H001 config as Palash
    const h001CfgRes = await fetch(`${BASE_URL}/api/config`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    const h001Cfg = await h001CfgRes.json();
    assert.strictEqual(h001CfgRes.status, 200);
    assert(!h001Cfg.data.familyMembers.includes("System Administrator"), "System Administrator must NEVER bleed into H001 familyMembers!");
    assert.deepStrictEqual(h001Cfg.data.familyMembers, ["Palash", "Pallavi"], "H001 family members must be strictly ['Palash', 'Pallavi']");
    console.log("  ✓ H001 family members strictly preserved: ['Palash', 'Pallavi'] (System Administrator bleed eliminated)");

    // 4. Budget Persistence & Read-After-Write
    console.log("\n[TEST 4] Verifying Budget Update, Persistence & Read-After-Write...");
    const currentBudget = h001Cfg.data.monthlyBudgetLimit || 20000;
    const testBudget = 55000;

    const budgetUpdateRes = await fetch(`${BASE_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${palashToken}` },
        body: JSON.stringify({ monthlyBudgetLimit: testBudget })
    });
    assert.strictEqual(budgetUpdateRes.status, 200, "Updating budget should return 200");
    const budgetUpdateData = await budgetUpdateRes.json();
    assert.strictEqual(budgetUpdateData.data.monthlyBudgetLimit, testBudget, "Updated config should reflect new budget limit");

    // Read back fresh from disk
    const freshCfgRes = await fetch(`${BASE_URL}/api/config`, {
        headers: { 'Authorization': `Bearer ${palashToken}` }
    });
    const freshCfg = await freshCfgRes.json();
    assert.strictEqual(freshCfg.data.monthlyBudgetLimit, testBudget, "Disk config must persist updated budget limit");
    console.log(`  ✓ Budget updated to ₹${testBudget} and successfully verified on disk via read-after-write`);

    // Revert back to original budget
    await fetch(`${BASE_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${palashToken}` },
        body: JSON.stringify({ monthlyBudgetLimit: currentBudget })
    });
    console.log(`  ✓ Budget restored cleanly to ₹${currentBudget}`);

    // 5. New Household Creation, Custom Budget & Clean Ledger Isolation
    console.log("\n[TEST 5] Testing New Household Creation, Custom Budget & Ledger Isolation...");
    const createHRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({
            action: 'create_household',
            householdName: 'Ashwini Villa',
            initialBudget: 35000
        })
    });
    assert.strictEqual(createHRes.status, 201, "Creating household should return 201 Created");
    const createdH = (await createHRes.json()).household;
    const newHId = createdH.householdId;
    console.log(`  ✓ Created new household '${createdH.householdName}' (${newHId}) with ₹35,000 budget`);

    // Create owner user for new household
    const createURes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({
            action: 'create_user',
            username: `ashwini_${Date.now()}`,
            password: 'Password123!',
            name: 'Ashwini',
            householdId: newHId,
            role: 'OWNER'
        })
    });
    assert.strictEqual(createURes.status, 201, "Creating user should return 201 Created");
    const createdUser = (await createURes.json()).user;
    console.log(`  ✓ Created owner user '@${createdUser.username}' for ${newHId}`);

    // Sign in as new user
    const ashwiniLoginRes = await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: createdUser.username, password: 'Password123!' })
    });
    const ashwiniLogin = await ashwiniLoginRes.json();
    assert.strictEqual(ashwiniLoginRes.status, 200);
    const ashwiniToken = ashwiniLogin.token;

    // Verify new household expenses ledger has 0 records (no records copied from H001)
    const ashwiniExpRes = await fetch(`${BASE_URL}/api/expenses`, {
        headers: { 'Authorization': `Bearer ${ashwiniToken}` }
    });
    const ashwiniExp = await ashwiniExpRes.json();
    assert.strictEqual(ashwiniExp.count, 0, "New household must have exactly 0 expense records");
    assert.deepStrictEqual(ashwiniExp.data, [], "New household data array must be empty");
    console.log(`  ✓ New household ${newHId} has exactly 0 expenses (zero bleed from H001)`);

    // Verify new household initial budget
    const ashwiniCfgRes = await fetch(`${BASE_URL}/api/config`, {
        headers: { 'Authorization': `Bearer ${ashwiniToken}` }
    });
    const ashwiniCfg = await ashwiniCfgRes.json();
    assert.strictEqual(ashwiniCfg.data.monthlyBudgetLimit, 35000, "New household must have the requested initial budget");
    console.log(`  ✓ New household ${newHId} initialized with requested ₹35,000 budget`);

    // Clean up test household & user
    await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'delete_user', userId: createdUser.userId })
    });
    await fetch(`${BASE_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
        body: JSON.stringify({ action: 'delete_household', householdId: newHId })
    });
    console.log(`  ✓ Test household ${newHId} and user cleaned up successfully`);

    // 6. Invariant Baseline Verification
    console.log("\n[TEST 6] Validating Production Data Invariant Baseline (H001)...");
    const fs = require('fs');
    const path = require('path');
    const h001Expenses = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'households', 'H001', 'expenses.json'), 'utf8'));
    assert.strictEqual(h001Expenses.length, 122, `Expected 122 expenses in H001, got ${h001Expenses.length}`);
    const totalAmount = h001Expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    assert.strictEqual(totalAmount.toFixed(2), "156761.33", `Expected ₹156,761.33 total, got ₹${totalAmount.toFixed(2)}`);
    console.log(`  ✓ Baseline verified: exactly 122 records, ₹${totalAmount.toFixed(2)} intact`);

    console.log("\n==================================================");
    console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! ZERO REGRESSIONS.");
    console.log("==================================================");
}

run().catch(err => {
    console.error("\n❌ TEST SUITE FAILED:", err);
    process.exit(1);
});
