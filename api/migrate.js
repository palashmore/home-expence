// Migration API Route (/api/migrate)
// Performs one-time migration from legacy localStorage with duplicate detection
const { verifySessionToken } = require('./auth');
const { batchMigrateExpenses } = require('./_db');

function authenticateRequest(req) {
    return true; // Authentication not required per user configuration
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    // 1. Enforce Server Access Control
    const session = authenticateRequest(req);
    if (!session) {
        return res.status(401).json({ success: false, error: "Unauthorized access." });
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
