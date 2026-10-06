// Receipts API Route (/api/receipts)
// Multi-Tenant Household-Scoped Private Receipt Storage
const { authenticateRequest, sessionCan } = require('./auth');
const { PERMISSIONS: P } = require('./_permissions');
const storage = require('./_storage');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

    // 1. Mandatory Identity & Household Resolution
    const session = authenticateRequest(req);
    if (!session || !session.householdId) {
        return res.status(401).json({ success: false, error: "Unauthorized access to private receipt data." });
    }

    const householdId = session.householdId;

    try {
        if (req.method === 'GET') {
            const receiptId = req.query ? req.query.id : null;
            if (!receiptId) {
                return res.status(400).json({ success: false, error: "Missing receipt ID." });
            }

            const imageData = await storage.getHouseholdReceipt(householdId, receiptId);
            if (!imageData) {
                return res.status(404).json({ success: false, error: "Receipt image not found in your household." });
            }

            return res.status(200).json({
                success: true,
                householdId: householdId,
                receiptId: receiptId,
                data: imageData
            });
        }

        if (req.method === 'POST') {
            // Consistent with every other write path: a VIEWER reads, never
            // writes. Uploading a receipt was the one place it still could.
            if (!sessionCan(session, P.EXPENSE_EDIT)) {
                return res.status(403).json({
                    success: false,
                    error: "Forbidden: Viewer role has read-only access and cannot upload receipts."
                });
            }

            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body || !body.receiptData) {
                return res.status(400).json({ success: false, error: "Missing receipt image data payload." });
            }

            const receiptId = body.receiptId || `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
            await storage.saveHouseholdReceipt(householdId, receiptId, body.receiptData);

            return res.status(200).json({
                success: true,
                message: "Receipt stored in private household storage.",
                householdId: householdId,
                receiptId: receiptId,
                receiptUrl: `/api/receipts?id=${receiptId}`
            });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/receipts error:", err);
        return res.status(500).json({ success: false, error: err.message || "Server error saving receipt." });
    }
};
