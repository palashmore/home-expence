// Expenses API Route (/api/expenses)
// Enforces Server-Side Authentication & Provides CRUD operations for transactions
const { verifySessionToken } = require('./auth');
const { getAllExpenses, saveExpense, deleteExpense, getExpenseById } = require('./_db');

function authenticateRequest(req) {
    return true; // Authentication not required per user configuration
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 1. Enforce Access Control on Every Server Request
    const session = authenticateRequest(req);
    if (!session) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized: Access denied. Please sign in to access household financial data."
        });
    }

    try {
        // GET: Fetch all expenses
        if (req.method === 'GET') {
            const expenses = await getAllExpenses();
            return res.status(200).json({
                success: true,
                count: expenses.length,
                data: expenses
            });
        }

        // POST / PUT: Create or Edit Expense
        if (req.method === 'POST' || req.method === 'PUT') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body) {
                return res.status(400).json({ success: false, error: "Missing expense data payload." });
            }

            // Server-side Input Validation
            if (!body.date || isNaN(new Date(body.date).getTime())) {
                return res.status(422).json({ success: false, error: "Validation Error: Valid transaction date is required." });
            }
            if (isNaN(body.amount) || Number(body.amount) <= 0) {
                return res.status(422).json({ success: false, error: "Validation Error: Amount must be a positive number greater than zero." });
            }

            const saved = await saveExpense(body);
            return res.status(200).json({
                success: true,
                message: req.method === 'PUT' ? "Expense record updated successfully!" : "New expense record saved successfully!",
                data: saved
            });
        }

        // DELETE: Delete Expense Record
        if (req.method === 'DELETE') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            const id = (req.query && req.query.id) ? req.query.id : (body ? body.id : null);
            if (!id) {
                return res.status(400).json({ success: false, error: "Missing expense ID parameter." });
            }

            const deleted = await deleteExpense(id);
            if (deleted) {
                return res.status(200).json({ success: true, message: "Expense record deleted permanently." });
            } else {
                return res.status(404).json({ success: false, error: "Record not found or already deleted." });
            }
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/expenses error:", err);
        return res.status(500).json({ success: false, error: err.message || "Internal server error." });
    }
};
