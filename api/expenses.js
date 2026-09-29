// Expenses API Route (/api/expenses)
// Multi-Tenant Household-Scoped Financial Transaction Engine
const { authenticateRequest } = require('./auth');
const storage = require('./_storage');
const notifications = require('./notifications');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 1. Mandatory Identity & Household Resolution
    const session = authenticateRequest(req);
    if (!session || !session.householdId) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized: Access denied. Please sign in to access household financial data."
        });
    }

    const householdId = session.householdId;
    const actorUser = session.name || session.username || 'Authenticated User';

    try {
        // GET: Fetch all expenses or single expense for the authenticated household
        if (req.method === 'GET') {
            const queryId = req.query ? req.query.id : null;
            if (queryId) {
                const expense = await storage.getHouseholdExpenseById(householdId, queryId);
                if (!expense) {
                    return res.status(404).json({ success: false, error: "Transaction record not found." });
                }
                return res.status(200).json({ success: true, data: expense });
            }

            const expenses = await storage.getHouseholdExpenses(householdId);
            return res.status(200).json({
                success: true,
                householdId: householdId,
                count: expenses.length,
                data: expenses
            });
        }

        // POST / PUT: Create or Edit Expense in the authenticated household
        if (req.method === 'POST' || req.method === 'PUT') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body) {
                return res.status(400).json({ success: false, error: "Missing expense data payload." });
            }

            // Input Validation
            if (!body.date || isNaN(new Date(body.date).getTime())) {
                return res.status(422).json({ success: false, error: "Validation Error: Valid transaction date is required." });
            }
            if (isNaN(body.amount) || Number(body.amount) <= 0) {
                return res.status(422).json({ success: false, error: "Validation Error: Amount must be a positive number greater than zero." });
            }

            // Cross-household edit prevention: If an existing ID is passed, verify it belongs to this household
            if (body.id) {
                const existing = await storage.getHouseholdExpenseById(householdId, body.id);
                if (!existing && req.method === 'PUT') {
                    return res.status(404).json({
                        success: false,
                        error: "Transaction record not found in your household."
                    });
                }
            }

            const isEdit = req.method === 'PUT';
            const saved = await storage.saveHouseholdExpense(householdId, body, actorUser);

            // Closed-app Push Notification & In-App Activity Alert to linked household members
            // E.g., when Palash adds/updates, Pallavi receives a push notification, and vice versa!
            try {
                const actorName = session.name || session.username || actorUser;
                const formattedAmount = Number(saved.amount || body.amount || 0).toLocaleString('en-IN');
                const category = saved.category || body.category || 'General';
                const notes = saved.note || body.note || saved.description || body.description || '';
                const paidBy = saved.paidBy || body.paidBy || actorName;

                let notifTitle, notifBody, actionType;
                if (isEdit) {
                    actionType = 'EXPENSE_UPDATE';
                    notifTitle = `✏️ ${actorName} updated an expense`;
                    notifBody = `${category} • ₹${formattedAmount}${notes ? ` • "${notes}"` : ''}`;
                } else {
                    actionType = 'EXPENSE_CREATE';
                    notifTitle = `💰 ${actorName} added expense: ₹${formattedAmount}`;
                    notifBody = `${category} • Paid by ${paidBy}${notes ? ` • "${notes}"` : ''}`;
                }

                await notifications.sendPushToHouseholdMembers({
                    householdId: householdId,
                    title: notifTitle,
                    body: notifBody,
                    url: '/#tab-expenses',
                    tag: `expense-${isEdit ? 'update' : 'new'}-${saved.id || Date.now()}`,
                    excludeUserId: session.userId,
                    excludeUsername: session.username,
                    actor: {
                        userId: session.userId,
                        username: session.username,
                        name: actorName
                    },
                    type: actionType,
                    amount: saved.amount
                });
            } catch (pushErr) {
                console.warn('[Push] Notification trigger notice:', pushErr.message);
            }

            return res.status(200).json({
                success: true,
                message: isEdit ? "Expense record updated successfully!" : "New expense record saved successfully!",
                data: saved
            });
        }

        // DELETE: Delete Expense Record from the authenticated household
        if (req.method === 'DELETE') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            const id = (req.query && req.query.id) ? req.query.id : (body ? body.id : null);
            if (!id) {
                return res.status(400).json({ success: false, error: "Missing expense ID parameter." });
            }

            // Cross-household delete prevention
            const existing = await storage.getHouseholdExpenseById(householdId, id);
            if (!existing) {
                return res.status(404).json({ success: false, error: "Record not found or already deleted." });
            }

            const deleted = await storage.deleteHouseholdExpense(householdId, id, actorUser);
            if (deleted) {
                // Closed-app Push Notification to linked household members
                try {
                    const actorName = session.name || session.username || actorUser;
                    const formattedAmount = Number(existing.amount || 0).toLocaleString('en-IN');
                    const category = existing.category || 'General';

                    await notifications.sendPushToHouseholdMembers({
                        householdId: householdId,
                        title: `🗑️ ${actorName} deleted an expense`,
                        body: `${category} • ₹${formattedAmount} removed from ledger`,
                        url: '/#tab-expenses',
                        tag: `expense-delete-${id}`,
                        excludeUserId: session.userId,
                        excludeUsername: session.username,
                        actor: {
                            userId: session.userId,
                            username: session.username,
                            name: actorName
                        },
                        type: 'EXPENSE_DELETE',
                        amount: existing.amount
                    });
                } catch (pushErr) {
                    console.warn('[Push] Notification delete trigger notice:', pushErr.message);
                }

                return res.status(200).json({ success: true, message: "Expense record deleted successfully." });
            } else {
                return res.status(404).json({ success: false, error: "Record not found or already deleted." });
            }
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/expenses error:", err);
        const statusCode = err.status || (err.code === 'ERR_CONFLICT' ? 409 : 500);
        return res.status(statusCode).json({
            success: false,
            conflict: err.code === 'ERR_CONFLICT',
            error: err.message || "Internal server error.",
            current: err.currentRecord || null
        });
    }
};
