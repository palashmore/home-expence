// Backup & Disaster Recovery Center API Route (/api/backup)
// Multi-Tenant Household-Scoped Backup & Restoration Engine
const fs = require('fs');
const path = require('path');
const { authenticateRequest, sessionCan } = require('./auth');
const { PERMISSIONS: P } = require('./_permissions');
const storage = require('./_storage');
const paths = require('./_paths');

const DATA_DIR = paths.DATA_DIR;

function getHouseholdBackupsDir(householdId) {
    const clean = storage.sanitizeId(householdId);
    if (!clean) throw new Error('Invalid household ID');
    const dir = path.join(DATA_DIR, 'households', clean, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Create an automated safety snapshot on disk for this household
function saveHouseholdSafetySnapshot(householdId, bundle, prefix = 'snapshot') {
    try {
        const backupsDir = getHouseholdBackupsDir(householdId);
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${prefix}-${ts}.json`;
        const filepath = path.join(backupsDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(bundle, null, 2), 'utf8');
        return { filename, filepath, createdAt: bundle.createdAt };
    } catch (err) {
        console.warn('Could not persist local snapshot to disk:', err.message);
        return null;
    }
}

// List all existing disk snapshots for this household
function listHouseholdSnapshots(householdId) {
    try {
        const backupsDir = getHouseholdBackupsDir(householdId);
        if (!fs.existsSync(backupsDir)) return [];
        const files = fs.readdirSync(backupsDir);
        return files
            .filter(f => f.endsWith('.json'))
            .map(filename => {
                const filePath = path.join(backupsDir, filename);
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

    // 1. Mandatory Identity & Household Resolution
    const session = authenticateRequest(req);
    if (!session || !session.householdId) {
        return res.status(401).json({
            success: false,
            error: "Unauthorized: Please sign in to manage household backups."
        });
    }

    const householdId = session.householdId;
    const actorUser = session.name || session.username || 'Authenticated User';
    const action = req.query?.action || (req.body && req.body.action) || 'export';

    try {
        // ---------------- GET ACTIONS ----------------
        if (req.method === 'GET') {
            if (action === 'list') {
                const snapshots = listHouseholdSnapshots(householdId);
                return res.status(200).json({
                    success: true,
                    householdId: householdId,
                    snapshots: snapshots
                });
            }

            // Export / Download Backup Bundle for current household
            const bundle = await storage.getHouseholdBackupBundle(householdId);
            
            if (req.query?.download === '1') {
                const nowStr = new Date().toISOString().slice(0, 10);
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="${householdId}-backup-${nowStr}.json"`);
                return res.status(200).end(JSON.stringify(bundle, null, 2));
            }

            return res.status(200).json({
                success: true,
                householdId: householdId,
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
                const currentBundle = await storage.getHouseholdBackupBundle(householdId);
                const snap = saveHouseholdSafetySnapshot(householdId, currentBundle, 'manual-snapshot');
                await storage.logHouseholdAudit(
                    householdId,
                    'CREATE_BACKUP_SNAPSHOT',
                    snap ? snap.filename : 'memory',
                    { totalExpenses: currentBundle.expenses.length },
                    {},
                    actorUser
                );
                return res.status(200).json({
                    success: true,
                    householdId: householdId,
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

                // If backup specifies another household, verify user permission
                if (backupData.householdId && backupData.householdId !== householdId && !sessionCan(session, P.HOUSEHOLD_MANAGE)) {
                    return res.status(403).json({
                        success: false,
                        error: "Cross-household restoration denied: Cannot restore another household's data."
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

                // A. Automated Pre-Restoration Safety Snapshot First!
                const preRestoreBundle = await storage.getHouseholdBackupBundle(householdId);
                const safetySnap = saveHouseholdSafetySnapshot(householdId, preRestoreBundle, 'safety-pre-restore');

                // B. Write Restored Expenses to current household
                const hExpensesPath = path.join(DATA_DIR, 'households', householdId, 'expenses.json');
                fs.writeFileSync(hExpensesPath, JSON.stringify(newExpenses, null, 2), 'utf8');

                // C. Write Config if present
                if (backupData.config && typeof backupData.config === 'object') {
                    await storage.saveHouseholdConfig(householdId, backupData.config, actorUser);
                }

                // D. Write Attendance if present
                if (backupData.attendance && typeof backupData.attendance === 'object') {
                    await storage.saveHouseholdAttendance(householdId, backupData.attendance, actorUser);
                }

                // Log Audit
                await storage.logHouseholdAudit(
                    householdId,
                    'RESTORE_BACKUP',
                    safetySnap ? safetySnap.filename : 'safety-snap',
                    {
                        restoredCount: newExpenses.length,
                        hasConfig: !!backupData.config,
                        hasAttendance: !!backupData.attendance,
                        safetySnapshot: safetySnap ? safetySnap.filename : null
                    },
                    {},
                    actorUser
                );

                return res.status(200).json({
                    success: true,
                    householdId: householdId,
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
                const backupsDir = getHouseholdBackupsDir(householdId);
                const targetPath = path.join(backupsDir, path.basename(targetFilename));
                if (!fs.existsSync(targetPath)) {
                    return res.status(404).json({ success: false, error: "Snapshot file not found in your household." });
                }

                const raw = fs.readFileSync(targetPath, 'utf8');
                const parsed = JSON.parse(raw);

                // Take safety snapshot of current state
                const preRestoreBundle = await storage.getHouseholdBackupBundle(householdId);
                const safetySnap = saveHouseholdSafetySnapshot(householdId, preRestoreBundle, 'safety-pre-restore');

                if (Array.isArray(parsed.expenses)) {
                    const hExpensesPath = path.join(DATA_DIR, 'households', householdId, 'expenses.json');
                    fs.writeFileSync(hExpensesPath, JSON.stringify(parsed.expenses, null, 2), 'utf8');
                }
                if (parsed.config) {
                    await storage.saveHouseholdConfig(householdId, parsed.config, actorUser);
                }
                if (parsed.attendance) {
                    await storage.saveHouseholdAttendance(householdId, parsed.attendance, actorUser);
                }

                await storage.logHouseholdAudit(
                    householdId,
                    'RESTORE_SNAPSHOT',
                    targetFilename,
                    {
                        restoredFrom: targetFilename,
                        safetySnapshot: safetySnap ? safetySnap.filename : null
                    },
                    {},
                    actorUser
                );

                return res.status(200).json({
                    success: true,
                    householdId: householdId,
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
