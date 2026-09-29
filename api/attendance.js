// Staff Attendance & Leave API Route (/api/attendance)
// Multi-Tenant Household-Scoped Domestic Staff Attendance Engine
const { authenticateRequest } = require('./auth');
const storage = require('./_storage');
const notifications = require('./notifications');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');

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
            if (session.role === 'VIEWER') {
                return res.status(403).json({
                    success: false,
                    error: "Forbidden: Viewer role has read-only access and cannot modify attendance records."
                });
            }

            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body) {
                return res.status(400).json({ success: false, error: 'Missing attendance data' });
            }

            // Action: Save or update staff monthly attendance record (standard payload from saveAttendanceToApi)
            const staffName = body.staff || body.staffName;
            const monthKey = body.month || body.monthKey;
            if (staffName && monthKey) {
                const attendance = await storage.getHouseholdAttendance(householdId) || {};
                if (!attendance[staffName]) {
                    attendance[staffName] = {
                        baseSalary: staffName.includes('Nilima') ? 4500 : 800,
                        billingCycleDay: staffName.includes('Nilima') ? 30 : 21,
                        months: {}
                    };
                }
                if (!attendance[staffName].months) {
                    attendance[staffName].months = {};
                }
                attendance[staffName].months[monthKey] = {
                    days: body.days || {},
                    bonus: Number(body.bonus) || 0,
                    notes: body.notes || '',
                    updatedAt: new Date().toISOString()
                };

                await storage.saveHouseholdAttendance(householdId, attendance, actorUser);

                // Closed-app Push Notification to linked household members
                try {
                    notifications.sendPushToHouseholdMembers({
                        householdId: householdId,
                        title: `👩‍🍳 ${actorUser} updated staff payroll/attendance`,
                        body: `${staffName} attendance updated for ${monthKey}`,
                        url: '/#tab-staff',
                        tag: `attendance-${monthKey}`,
                        excludeUserId: session.userId,
                        excludeUsername: session.username,
                        actor: { userId: session.userId, username: session.username, name: actorUser },
                        type: 'STAFF_ATTENDANCE'
                    }).catch(e => console.warn('[Push] Attendance dispatch warning:', e.message));
                } catch (pushErr) {}

                return res.status(200).json({
                    success: true,
                    message: `Attendance updated for ${staffName} (${monthKey})`,
                    data: attendance
                });
            }

            // Action: Toggle single day attendance
            if (body.action === 'toggleDay') {
                const targetStaff = body.staffName || body.staff;
                const targetMonth = body.monthKey || body.month;
                const { day, status } = body;
                if (!targetStaff || !targetMonth || !day) {
                    return res.status(400).json({ success: false, error: 'staffName, monthKey, and day are required' });
                }

                const attendance = await storage.getHouseholdAttendance(householdId) || {};
                if (!attendance[targetStaff]) {
                    attendance[targetStaff] = { baseSalary: 4500, billingCycleDay: 30, months: {} };
                }
                if (!attendance[targetStaff].months) {
                    attendance[targetStaff].months = {};
                }
                if (!attendance[targetStaff].months[targetMonth]) {
                    attendance[targetStaff].months[targetMonth] = { days: {}, notes: '' };
                }
                if (!attendance[targetStaff].months[targetMonth].days) {
                    attendance[targetStaff].months[targetMonth].days = {};
                }

                attendance[targetStaff].months[targetMonth].days[String(day)] = status;
                attendance[targetStaff].months[targetMonth].updatedAt = new Date().toISOString();

                await storage.saveHouseholdAttendance(householdId, attendance, actorUser);
                return res.status(200).json({ success: true, message: 'Attendance day updated', data: attendance });
            }

            // Action: Full state replacement / sync
            if (body.action === 'syncAll' && body.data) {
                await storage.saveHouseholdAttendance(householdId, body.data, actorUser);
                return res.status(200).json({ success: true, message: 'All staff attendance synchronized', data: body.data });
            }

            return res.status(400).json({ success: false, error: 'Unknown attendance action or missing staff/month fields' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
        console.error('API /api/attendance error:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
