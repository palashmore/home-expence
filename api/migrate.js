// Migration API Route (/api/migrate)
// Performs one-time migration from legacy localStorage with duplicate detection
const { authenticateRequest, sessionCan } = require('./auth');
const { PERMISSIONS: P } = require('./_permissions');
const { batchMigrateExpenses } = require('./_db');

// This file used to define its own authenticateRequest that returned `true`
// unconditionally, shadowing the real one imported from ./auth. The effect was
// that an anonymous POST to /api/migrate wrote records straight into the
// database - an unauthenticated write to household financial data, reachable by
// anyone who knew the path. Verified by curl before the fix: no token, and the
// response was importedCount: 1.
//
// Migration is a bulk write over somebody's ledger, so it needs a real session
// and an owning role, not merely a signed-in one.
// Migration rewrites a whole ledger, which is the same authority a restore
// needs - so it asks for the same permission rather than listing roles again.

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    const session = authenticateRequest(req);
    if (!session || !session.householdId) {
        return res.status(401).json({ success: false, error: "Unauthorized: sign in to migrate records." });
    }
    if (!sessionCan(session, P.RESTORE_MANAGE)) {
        return res.status(403).json({
            success: false,
            error: "Forbidden: migrating records requires an owner or administrator."
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: "Method not allowed." });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const records = body ? (body.records || body) : null;
        if (!Array.isArray(records)) {
            return res.status(400).json({ success: false, error: "Invalid payload: expected an array of records to migrate." });
        }

        const summary = await batchMigrateExpenses(records);
        return res.status(200).json({
            success: true,
            message: "Batch migration completed successfully!",
            summary: summary
        });
    } catch (err) {
        console.error("API /api/migrate error:", err);
        return res.status(500).json({ success: false, error: err.message || "Migration failed on server." });
    }
};
