// Backup & Disaster Recovery Center API Route (/api/backup)
const fs = require('fs');
const path = require('path');
const db = require('./_db');
const cloudSync = require('./_cloud_sync');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'staff_attendance.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit_log.json');

// Ensure backups dir exists
try {
    if (!fs.existsSync(BACKUPS_DIR)) {
        fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }
} catch (e) {}

// Helper to read JSON safely
function readJsonSafe(filepath, fallback = null) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (e) {}
    return fallback;
}

// Helper to generate full unified backup bundle
async function generateBackupBundle() {
    const allExpenses = await db.getAllExpenses(true);
    let config = null;
    try {
        config = await cloudSync.readJson('config.json');
    } catch (e) {}
    if (!config) config = readJsonSafe(CONFIG_FILE, {});

    let attendance = null;
    try {
        attendance = await cloudSync.readJson('staff_attendance.json');
    } catch (e) {}
    if (!attendance) attendance = readJsonSafe(ATTENDANCE_FILE, {});

    let audit = null;
    try {
        audit = await cloudSync.readJson('audit_log.json');
    } catch (e) {}
    if (!audit) audit = readJsonSafe(AUDIT_FILE, []);

    const now = new Date().toISOString();
    return {
        backupVersion: "5.0",
        application: "HOMEEXPENSES",
        createdAt: now,
        system: {
            nodeEnv: process.env.NODE_ENV || 'production',
            isServerless: !!process.env.VERCEL,
            totalExpenses: allExpenses.length,
            activeExpenses: allExpenses.filter(e => !e.isDeleted).length,
            softDeletedExpenses: allExpenses.filter(e => e.isDeleted).length,
            totalAuditEntries: Array.isArray(audit) ? audit.length : 0
        },
        expenses: allExpenses,
        config: config,
        attendance: attendance,
        audit: Array.isArray(audit) ? audit.slice(0, 500) : [] // Keep recent 500 audit entries
    };
}

// Create an automated safety snapshot on disk
function saveSafetySnapshot(bundle, prefix = 'snapshot') {
    try {
        if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${prefix}-${ts}.json`;
        const filepath = path.join(BACKUPS_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(bundle, null, 2), 'utf8');
        return { filename, filepath, createdAt: bundle.createdAt };
    } catch (err) {
        console.warn('Could not persist local snapshot to disk:', err.message);
        return null;
    }
}

// List all existing disk snapshots
function listSnapshots() {
    try {
        if (!fs.existsSync(BACKUPS_DIR)) return [];
        const files = fs.readdirSync(BACKUPS_DIR);
        return files
            .filter(f => f.endsWith('.json'))
            .map(filename => {
                const filePath = path.join(BACKUPS_DIR, filename);
                const stats = fs.statSync(filePath);
                return {
                    filename,
                    sizeBytes: stats.size,
                    createdAt: stats.birthtime ? stats.birthtime.toISOString() : stats.mtime.toISOString(),
                    isSafetyBackup: filename.startsWith('safety-pre-restore')
                };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (err) {
        return [];
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const action = req.query?.action || (req.body && req.body.action) || 'export';

    try {
        // ---------------- GET ACTIONS ----------------
        if (req.method === 'GET') {
            if (action === 'list') {
                const snapshots = listSnapshots();
                return res.status(200).json({
                    success: true,
                    snapshots: snapshots
                });
            }

            // Export / Download Backup Bundle
            const bundle = await generateBackupBundle();
            
            if (req.query?.download === '1') {
                const nowStr = new Date().toISOString().slice(0, 10);
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="homeexpenses-backup-${nowStr}.json"`);
                return res.status(200).end(JSON.stringify(bundle, null, 2));
            }

            return res.status(200).json({
                success: true,
                data: bundle
            });
        }

        // ---------------- POST ACTIONS ----------------
        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {
                    return res.status(400).json({ success: false, error: "Invalid JSON body payload." });
                }
            }

            const postAction = body?.action || action;

            // 1. Manually Create Instant Snapshot
            if (postAction === 'create_snapshot') {
                const currentBundle = await generateBackupBundle();
                const snap = saveSafetySnapshot(currentBundle, 'manual-snapshot');
                await cloudSync.logAudit('CREATE_BACKUP_SNAPSHOT', snap ? snap.filename : 'memory', {
                    totalExpenses: currentBundle.system.totalExpenses
                });
                return res.status(200).json({
                    success: true,
                    message: "Backup snapshot created successfully.",
                    snapshot: snap
                });
            }

            // 2. Restore Backup Payload
            if (postAction === 'restore') {
                const backupData = body.backupData || body;
                if (!backupData || (!Array.isArray(backupData.expenses) && !backupData.backupVersion)) {
                    return res.status(400).json({
                        success: false,
                        error: "Invalid backup format. Expected a valid HomeExpenses backup JSON containing expenses."
                    });
                }

                const newExpenses = Array.isArray(backupData.expenses) ? backupData.expenses : [];
                
                // Validate items
                let invalidCount = 0;
                newExpenses.forEach(item => {
                    if (!item.date || isNaN(Number(item.amount)) || Number(item.amount) <= 0) {
                        invalidCount++;
                    }
                });

                if (invalidCount > 0 && invalidCount === newExpenses.length && newExpenses.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: "Backup validation failed: Contains only invalid expense rows."
                    });
                }

                // A. Take Automated Pre-Restoration Safety Snapshot First!
                const preRestoreBundle = await generateBackupBundle();
                const safetySnap = saveSafetySnapshot(preRestoreBundle, 'safety-pre-restore');

                // B. Write Restored Expenses
                db.writeExpensesToFile(newExpenses);
                await cloudSync.writeJson('expenses.json', newExpenses);

                // C. Write Config if present
                if (backupData.config && typeof backupData.config === 'object') {
                    await cloudSync.writeJson('config.json', backupData.config);
                    try {
                        fs.writeFileSync(CONFIG_FILE, JSON.stringify(backupData.config, null, 2), 'utf8');
                    } catch (e) {}
                }

                // D. Write Attendance if present
                if (backupData.attendance && typeof backupData.attendance === 'object') {
                    await cloudSync.writeJson('staff_attendance.json', backupData.attendance);
                    try {
                        fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(backupData.attendance, null, 2), 'utf8');
                    } catch (e) {}
                }

                // Log Audit
                await cloudSync.logAudit('RESTORE_BACKUP', safetySnap ? safetySnap.filename : 'safety-snap', {
                    restoredCount: newExpenses.length,
                    hasConfig: !!backupData.config,
                    hasAttendance: !!backupData.attendance,
                    safetySnapshot: safetySnap ? safetySnap.filename : null
                });

                return res.status(200).json({
                    success: true,
                    message: "Backup successfully restored.",
                    restoredExpensesCount: newExpenses.length,
                    safetySnapshot: safetySnap ? safetySnap.filename : null
                });
            }

            // 3. Restore Specific Snapshot from Disk
            if (postAction === 'restore_snapshot') {
                const targetFilename = body.filename;
                if (!targetFilename || typeof targetFilename !== 'string') {
                    return res.status(400).json({ success: false, error: "Snapshot filename is required." });
                }
                const targetPath = path.join(BACKUPS_DIR, path.basename(targetFilename));
                if (!fs.existsSync(targetPath)) {
                    return res.status(404).json({ success: false, error: "Snapshot file not found." });
                }

                const raw = fs.readFileSync(targetPath, 'utf8');
                const parsed = JSON.parse(raw);

                // Take safety snapshot of current state
                const preRestoreBundle = await generateBackupBundle();
                const safetySnap = saveSafetySnapshot(preRestoreBundle, 'safety-pre-restore');

                if (Array.isArray(parsed.expenses)) {
                    db.writeExpensesToFile(parsed.expenses);
                    await cloudSync.writeJson('expenses.json', parsed.expenses);
                }
                if (parsed.config) {
                    await cloudSync.writeJson('config.json', parsed.config);
                }
                if (parsed.attendance) {
                    await cloudSync.writeJson('staff_attendance.json', parsed.attendance);
                }

                await cloudSync.logAudit('RESTORE_SNAPSHOT', targetFilename, {
                    restoredFrom: targetFilename,
                    safetySnapshot: safetySnap ? safetySnap.filename : null
                });

                return res.status(200).json({
                    success: true,
                    message: `Snapshot '${targetFilename}' restored successfully.`,
                    safetySnapshot: safetySnap ? safetySnap.filename : null
                });
            }

            return res.status(400).json({ success: false, error: "Unknown POST action." });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/backup error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Internal server error during backup operation."
        });
    }
};
