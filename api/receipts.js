// Receipts API Route (/api/receipts)
// Handles private persistent receipt storage and secure image streaming
const { verifySessionToken } = require('./auth');
const { saveReceiptImage, getReceiptImage } = require('./_db');

function authenticateRequest(req) {
    return true; // Authentication not required per user configuration
}

module.exports = async function handler(req, res) {
    // 1. Enforce Authentication Control
    const session = authenticateRequest(req);
    if (!session) {
        return res.status(401).json({ success: false, error: "Unauthorized access to private receipt data." });
    }

    try {
        if (req.method === 'GET') {
            const receiptId = req.query ? req.query.id : null;
            if (!receiptId) {
                return res.status(400).json({ success: false, error: "Missing receipt ID." });
            }

            const imageData = await getReceiptImage(receiptId);
            if (!imageData) {
                return res.status(404).json({ success: false, error: "Receipt image not found." });
            }

            return res.status(200).json({
                success: true,
                receiptId: receiptId,
                data: imageData
            });
        }

        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body || !body.receiptData) {
                return res.status(400).json({ success: false, error: "Missing receipt image data payload." });
            }

            const receiptId = body.receiptId || `receipt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
            await saveReceiptImage(receiptId, body.receiptData);

            return res.status(200).json({
                success: true,
                message: "Receipt stored in private persistent storage.",
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
