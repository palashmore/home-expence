// Staff Attendance & Leave API Route (/api/attendance)
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'staff_attendance.json');

const TMP_ATTENDANCE = path.join('/tmp', 'staff_attendance.json');

function readAttendance() {
    try {
        if (fs.existsSync(TMP_ATTENDANCE)) {
            const raw = fs.readFileSync(TMP_ATTENDANCE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {}

    try {
        if (fs.existsSync(ATTENDANCE_FILE)) {
            const raw = fs.readFileSync(ATTENDANCE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            try { fs.writeFileSync(TMP_ATTENDANCE, JSON.stringify(parsed, null, 2), 'utf8'); } catch (e) {}
            return parsed;
        }
    } catch (err) {
        console.warn('Error reading staff_attendance.json:', err.message);
    }
    return {
        'Maid - Madhuri': { baseSalary: 800, billingCycleDay: 21, months: {} },
        'Chef - Nilima Nikose': { baseSalary: 4500, billingCycleDay: 30, months: {} }
    };
}

function writeAttendance(data) {
    try {
        fs.writeFileSync(TMP_ATTENDANCE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {}

    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.warn('Warning: Could not write to data/staff_attendance.json (serverless read-only):', err.message);
        return true;
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');

    try {
        if (req.method === 'GET') {
            const attendance = readAttendance();
            return res.status(200).json({
                success: true,
                data: attendance
            });
        }

        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body) {
                return res.status(400).json({ success: false, error: 'Missing request body' });
            }

            const attendance = readAttendance();

            // Bulk or direct dictionary update
            if (body.data || body['Maid - Madhuri'] || body['Chef - Nilima Nikose']) {
                const toSave = body.data || body;
                writeAttendance(toSave);
                return res.status(200).json({
                    success: true,
                    message: 'Attendance data updated successfully',
                    data: toSave
                });
            }

            if (!body.staff || !body.month) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields: staff, month'
                });
            }

            if (!attendance[body.staff]) {
                attendance[body.staff] = { baseSalary: body.baseSalary || 1000, billingCycleDay: 30, months: {} };
            }
            if (!attendance[body.staff].months) {
                attendance[body.staff].months = {};
            }

            attendance[body.staff].months[body.month] = {
                days: body.days || {},
                bonus: Number(body.bonus) || 0,
                notes: body.notes || '',
                updatedAt: new Date().toISOString()
            };

            writeAttendance(attendance);

            return res.status(200).json({
                success: true,
                message: 'Attendance record updated successfully',
                data: attendance
            });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
        console.error('Attendance API error:', err);
        return res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
};
