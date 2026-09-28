// Staff Attendance & Leave API Route (/api/attendance)
// Multi-Tenant Household-Scoped Domestic Staff Attendance Engine
const { authenticateRequest } = require('./auth');
const storage = require('./_storage');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

    // 1. Mandatory Identity & Household Resolution
    const session = authenticateRequest(req);
    if (!session || !session.householdId) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized: Access denied. Please sign in."
        });
    }

    const householdId = session.householdId;
    const actorUser = session.name || session.username || 'Authenticated User';

    try {
        if (req.method === 'GET') {
            const data = await storage.getHouseholdAttendance(householdId);
            return res.status(200).json({
                success: true,
                householdId: householdId,
                data: data
            });
        }

        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body) {
                return res.status(400).json({ success: false, error: 'Missing attendance data' });
            }

            // Action: Toggle single day attendance
            if (body.action === 'toggleDay') {
                const { staffName, monthKey, day, status } = body;
                if (!staffName || !monthKey || !day) {
                    return res.status(400).json({ success: false, error: 'staffName, monthKey, and day are required' });
                }

                const attendance = await storage.getHouseholdAttendance(householdId);
                if (!attendance[staffName]) {
                    attendance[staffName] = { baseSalary: 4500, billingCycleDay: 30, months: {} };
                }
                if (!attendance[staffName].months) {
                    attendance[staffName].months = {};
                }
                if (!attendance[staffName].months[monthKey]) {
                    attendance[staffName].months[monthKey] = { days: {}, notes: '' };
                }
                if (!attendance[staffName].months[monthKey].days) {
                    attendance[staffName].months[monthKey].days = {};
                }

                attendance[staffName].months[monthKey].days[String(day)] = status;
                attendance[staffName].months[monthKey].updatedAt = new Date().toISOString();

                await storage.saveHouseholdAttendance(householdId, attendance, actorUser);
                return res.status(200).json({ success: true, message: 'Attendance day updated', data: attendance });
            }

            // Action: Full state replacement / sync
            if (body.action === 'syncAll' && body.data) {
                await storage.saveHouseholdAttendance(householdId, body.data, actorUser);
                return res.status(200).json({ success: true, message: 'All staff attendance synchronized', data: body.data });
            }

            return res.status(400).json({ success: false, error: 'Unknown action' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
        console.error('API /api/attendance error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
