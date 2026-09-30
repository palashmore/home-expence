// Web Push Notification & Closed-App Mobile Alerts System (/api/notifications)
// Multi-Tenant Household-Scoped Device Push Dispatcher
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const cloudSync = require('./_cloud_sync');
const db = require('./_db');
const { authenticateRequest } = require('./auth');
const storage = require('./_storage');
const paths = require('./_paths');

const DATA_DIR = paths.DATA_DIR;
const VAPID_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const SUBS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Resolve VAPID keys: environment first, then the on-disk file, and only as a
// last resort generate a throwaway pair.
//
// The env var matters on serverless. There the filesystem is read-only, so the
// write below silently fails and a fresh key pair is generated on every cold
// start. Every push subscription a device made is bound to the public key it
// saw, so the next cold start invalidates all of them and notifications stop
// arriving with no visible error. Setting VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
// pins one pair for the life of the deployment.
let vapidKeys = null;
let vapidSource = 'generated';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapidKeys = {
        publicKey: process.env.VAPID_PUBLIC_KEY.trim(),
        privateKey: process.env.VAPID_PRIVATE_KEY.trim()
    };
    vapidSource = 'environment';
} else {
    try {
        if (fs.existsSync(VAPID_FILE)) {
            vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
            vapidSource = 'data/vapid_keys.json';
        }
    } catch (e) {}
}

if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    vapidSource = 'generated';
    let persisted = false;
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
        persisted = true;
    } catch (e) {}

    if (!persisted) {
        console.warn(
            '[Push] VAPID keys were generated in memory and could not be saved. ' +
            'Push subscriptions will break on the next cold start. ' +
            'Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to fix this.'
        );
    }
}

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@homeexpenses.local';

try {
    webpush.setVapidDetails(VAPID_SUBJECT, vapidKeys.publicKey, vapidKeys.privateKey);
    if (process.env.NODE_ENV !== 'test') {
        console.log(`[Push] VAPID keys loaded from ${vapidSource}.`);
    }
} catch (e) {
    console.warn('VAPID initialization notice:', e.message);
}

// High-Priority Web Push Options (RFC 8030 compliant: Urgency: high guarantees heads-up banners on Android/Chrome)
const HIGH_PRIORITY_PUSH_OPTIONS = {
    TTL: 86400, // 24 hours
    urgency: 'high',
    headers: {
        'Urgency': 'high',
        'Topic': 'household_updates'
    }
};

// Helper: Read subscriptions
async function readSubscriptions() {
    try {
        const cloudData = await cloudSync.readJson('push_subscriptions.json');
        if (Array.isArray(cloudData)) return cloudData;
    } catch (e) {}

    try {
        if (fs.existsSync(SUBS_FILE)) {
            const raw = fs.readFileSync(SUBS_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {}
    return [];
}

// Helper: Save subscriptions
async function writeSubscriptions(list) {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {}
    try {
        await cloudSync.writeJson('push_subscriptions.json', list);
    } catch (e) {}
}

// In-App Notification File per Household
function getHouseholdNotifsFile(householdId) {
    let dir;
    try {
        dir = storage.getHouseholdDir ? storage.getHouseholdDir(householdId) : path.join(DATA_DIR, 'households', householdId);
    } catch (e) {
        dir = path.join(DATA_DIR, 'households', householdId || 'H001');
    }
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'notifications.json');
}

function getHouseholdInAppNotifications(householdId, limit = 50) {
    try {
        const file = getHouseholdNotifsFile(householdId);
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.slice(0, limit);
        }
    } catch (e) {}
    return [];
}

function recordHouseholdInAppNotification({ householdId, title, body, url, tag, actor, type = 'activity', amount = null }) {
    try {
        const file = getHouseholdNotifsFile(householdId);
        let list = [];
        if (fs.existsSync(file)) {
            try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
        }
        if (!Array.isArray(list)) list = [];

        const newRecord = {
            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            householdId: householdId || 'H001',
            title,
            body,
            url: url || '/#tab-expenses',
            tag: tag || `notif-${Date.now()}`,
            actor: actor || 'System',
            type,
            amount,
            timestamp: new Date().toISOString(),
            readBy: []
        };

        list.unshift(newRecord);
        if (list.length > 100) list = list.slice(0, 100);

        fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
        return newRecord;
    } catch (err) {
        console.warn('Warning recording in-app notification:', err.message);
        return null;
    }
}

// Dispatch push notification to all stored device subscriptions
async function sendPushToAll(payload) {
    const subs = await readSubscriptions();
    if (!subs.length) return { delivered: 0, removed: 0, total: 0 };

    let delivered = 0;
    const remainingSubs = [];
    const stringified = JSON.stringify(payload);

    for (const sub of subs) {
        try {
            await webpush.sendNotification(sub, stringified, HIGH_PRIORITY_PUSH_OPTIONS);
            delivered++;
            remainingSubs.push(sub);
        } catch (err) {
            console.warn(`Push to ${sub.endpoint?.slice(0, 35)}... error:`, err.statusCode || err.message);
            if (err.statusCode !== 404 && err.statusCode !== 410) {
                remainingSubs.push(sub);
            }
        }
    }

    if (remainingSubs.length !== subs.length) {
        await writeSubscriptions(remainingSubs);
    }

    return { delivered, removed: subs.length - remainingSubs.length, total: subs.length };
}

// Dispatch push notification to ALL linked household members (including actor confirmation)
async function sendPushToHouseholdMembers({ householdId, title, body, url, tag, excludeUserId, excludeUsername, actor, type = 'activity', amount = null }) {
    // 1. Record In-App notification for the household
    recordHouseholdInAppNotification({
        householdId,
        title,
        body,
        url,
        tag,
        actor: actor?.name || actor?.username || 'Household Member',
        type,
        amount
    });

    // 2. Dispatch Closed-App Web Push Notification to ALL linked household members (including actor's devices)
    const subs = await readSubscriptions();
    if (!subs.length) {
        return { delivered: 0, total: 0, reason: 'no_subscriptions_stored' };
    }

    const cleanExcludeUsername = (excludeUsername || '').toLowerCase().trim();
    const cleanExcludeUserId = (excludeUserId || '').trim();

    // Target strictly members who belong to this household (Zero cross-household leakage)
    const targetSubs = subs.filter(sub => {
        const subHId = sub.householdId || (sub.user && sub.user.householdId);
        return subHId === householdId;
    });

    if (!targetSubs.length) {
        return { delivered: 0, total: 0, reason: 'no_recipient_subscribers' };
    }

    let delivered = 0;
    const remainingEndpoints = new Set();

    for (const sub of targetSubs) {
        try {
            const isActor = (cleanExcludeUsername && sub.username && sub.username.toLowerCase() === cleanExcludeUsername) ||
                            (cleanExcludeUserId && sub.userId && sub.userId === cleanExcludeUserId);

            // Personalize title for the actor vs other linked members
            let personalTitle = title;
            if (isActor) {
                if (type === 'EXPENSE_CREATE') {
                    personalTitle = amount ? `💰 Expense Added: ₹${Number(amount).toLocaleString('en-IN')}` : '💰 Expense Added';
                } else if (type === 'EXPENSE_UPDATE') {
                    personalTitle = amount ? `✏️ Expense Updated: ₹${Number(amount).toLocaleString('en-IN')}` : '✏️ Expense Updated';
                } else if (type === 'EXPENSE_DELETE') {
                    personalTitle = amount ? `🗑️ Expense Deleted: ₹${Number(amount).toLocaleString('en-IN')}` : '🗑️ Expense Deleted';
                } else if (type === 'STAFF_ATTENDANCE') {
                    personalTitle = '👩‍🍳 Staff Attendance Updated';
                } else if (type === 'CONFIG_UPDATE') {
                    personalTitle = '⚙️ Household Settings Updated';
                }
            }

            // Generate unique alert tag so notifications stack in the notification shade like Snapchat & WhatsApp
            const alertTag = tag || `expense-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            const payload = JSON.stringify({
                title: personalTitle,
                body,
                url: url || '/#tab-expenses',
                tag: alertTag,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                silent: false,
                requireInteraction: true,
                vibrate: [300, 100, 300, 100, 300],
                timestamp: Date.now()
            });

            await webpush.sendNotification(sub, payload, HIGH_PRIORITY_PUSH_OPTIONS);
            delivered++;
            remainingEndpoints.add(sub.endpoint);
        } catch (err) {
            console.warn(`[Push Error] to ${sub.endpoint?.slice(0, 35)}...:`, err.statusCode || err.message);
            // 404/410 means expired/uninstalled; keep only if not expired
            if (err.statusCode !== 404 && err.statusCode !== 410) {
                remainingEndpoints.add(sub.endpoint);
            }
        }
    }

    // Prune expired endpoints from global subscription store
    const cleanedSubs = subs.filter(s => {
        if (targetSubs.some(t => t.endpoint === s.endpoint)) {
            return remainingEndpoints.has(s.endpoint);
        }
        return true;
    });

    if (cleanedSubs.length !== subs.length) {
        await writeSubscriptions(cleanedSubs);
    }

    return { delivered, total: targetSubs.length };
}

// Background Reminder Scanner: Evaluates bills & staff cutoffs
async function checkAndSendScheduledReminders() {
    const subs = await readSubscriptions();
    if (!subs.length) return { status: 'no_subscriptions' };

    const expenses = await db.getAllExpenses(false);
    let config = null;
    try {
        config = await cloudSync.readJson('config.json');
    } catch (e) {}
    if (!config && fs.existsSync(CONFIG_FILE)) {
        try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) {}
    }

    const bills = config?.recurringBills || [
        { name: "Electricity Bill", category: "Electricity Bill", approxAmount: 2200, dueDay: 10, icon: "⚡" },
        { name: "Flat Maintenance", category: "Flat Maintenance", approxAmount: 3500, dueDay: 5, icon: "🏢" },
        { name: "Airtel Broadband / Wifi", category: "Wifi & Internet", approxAmount: 999, dueDay: 15, icon: "📶" },
        { name: "Tata Play / Dish Bill", category: "Dish Bill (DTH)", approxAmount: 450, dueDay: 20, icon: "📺" },
        { name: "Maid - Madhuri Salary", category: "Maid - Madhuri", approxAmount: 800, dueDay: 21, icon: "🧹" },
        { name: "Chef - Nilima Salary", category: "Chef - Nilima Nikose", approxAmount: 4500, dueDay: 30, icon: "👩‍🍳" }
    ];

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    const currentMonthExpenses = expenses.filter(e => {
        if (!e.date) return false;
        const d = new Date(e.date);
        return (d.getMonth() + 1) === currentMonth && d.getFullYear() === currentYear;
    });

    const notificationsToSend = [];

    // 1. Scan recurring bills
    for (const bill of bills) {
        if (bill.active === false) continue;
        const dueDay = Number(bill.dueDay) || 1;
        const daysDiff = dueDay - currentDay;

        // Check if paid
        const isPaid = currentMonthExpenses.some(e => {
            const cat = (e.category || '').toLowerCase();
            const paidTo = (e.paidTo || e.vendor || '').toLowerCase();
            const bCat = (bill.category || '').toLowerCase();
            const bName = (bill.name || '').toLowerCase();
            return (cat && bCat && (cat === bCat || cat.includes(bCat))) ||
                   (paidTo && bName && paidTo.includes(bName));
        });

        if (isPaid) continue;

        if (daysDiff === 0) {
            notificationsToSend.push({
                title: `${bill.icon || '⏰'} ${bill.name} Due Today!`,
                body: `Expected amount: ₹${Number(bill.approxAmount).toLocaleString('en-IN')}. Due date is today (${dueDay}th). Tap to record payment.`,
                url: '/#tab-expenses',
                tag: `due-today-${bill.id || bill.name}-${currentYear}-${currentMonth}`
            });
        } else if (daysDiff < 0 && Math.abs(daysDiff) <= 5) {
            notificationsToSend.push({
                title: `🚨 OVERDUE: ${bill.name}`,
                body: `Payment of ₹${Number(bill.approxAmount).toLocaleString('en-IN')} was due on ${dueDay}th (${Math.abs(daysDiff)} days ago). Tap to pay.`,
                url: '/#tab-expenses',
                tag: `overdue-${bill.id || bill.name}-${currentYear}-${currentMonth}`
            });
        } else if (daysDiff === 1 || daysDiff === 2) {
            notificationsToSend.push({
                title: `📅 Upcoming: ${bill.name}`,
                body: `Due in ${daysDiff} day${daysDiff > 1 ? 's' : ''} on ${dueDay}th (~₹${Number(bill.approxAmount).toLocaleString('en-IN')}).`,
                url: '/#tab-expenses',
                tag: `upcoming-${bill.id || bill.name}-${currentYear}-${currentMonth}`
            });
        }
    }

    // 2. Scan staff salary cutoffs
    if (currentDay === 21) {
        const madhuriPaid = currentMonthExpenses.some(e => (e.category || '').includes('Madhuri'));
        if (!madhuriPaid) {
            notificationsToSend.push({
                title: '🧹 Maid Madhuri Salary Cutoff Today',
                body: 'Billing cycle closes today on the 21st Date (Base: ₹800). Please verify attendance and record payment.',
                url: '/#tab-staff',
                tag: `cutoff-madhuri-${currentYear}-${currentMonth}`
            });
        }
    }

    if (currentDay === 30 || currentDay === 31) {
        const nilimaPaid = currentMonthExpenses.some(e => (e.category || '').includes('Nilima'));
        if (!nilimaPaid) {
            notificationsToSend.push({
                title: '👩‍🍳 Chef Nilima Salary Cutoff',
                body: 'Month-end payroll cutoff active (Base: ₹4,500). Please check paid leaves quota and process salary.',
                url: '/#tab-staff',
                tag: `cutoff-nilima-${currentYear}-${currentMonth}`
            });
        }
    }

    let sentCount = 0;
    for (const notif of notificationsToSend) {
        await sendPushToAll(notif);
        sentCount++;
    }

    return { evaluatedBills: bills.length, sentCount, subscribersCount: subs.length };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const action = req.query?.action || (req.body && req.body.action) || 'status';

    try {
        // ---------------- GET ACTIONS ----------------
        if (req.method === 'GET') {
            if (action === 'vapid_key') {
                return res.status(200).json({
                    success: true,
                    publicKey: vapidKeys.publicKey
                });
            }

            if (action === 'list_in_app') {
                const session = authenticateRequest(req);
                if (!session) {
                    return res.status(401).json({ success: false, error: "Unauthorized: Sign in required to view notifications." });
                }
                let householdId = session.householdId;
                const requestedHId = req.query?.householdId;
                if (requestedHId && requestedHId !== session.householdId) {
                    if (session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN') {
                        householdId = requestedHId;
                    } else {
                        return res.status(403).json({ success: false, error: "Forbidden: Cannot view notifications of another household." });
                    }
                }
                const list = getHouseholdInAppNotifications(householdId, 40);
                return res.status(200).json({
                    success: true,
                    householdId,
                    data: list,
                    notifications: list
                });
            }

            if (action === 'check_and_send') {
                const result = await checkAndSendScheduledReminders();
                return res.status(200).json({
                    success: true,
                    result
                });
            }

            const subs = await readSubscriptions();
            return res.status(200).json({
                success: true,
                publicKey: vapidKeys.publicKey,
                activeSubscriptionsCount: subs.length
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

            // 1. Subscribe Device (Associate device endpoint with householdId, userId, and username)
            if (postAction === 'subscribe') {
                const subscription = body.subscription;
                if (!subscription || !subscription.endpoint || !subscription.keys) {
                    return res.status(400).json({ success: false, error: "Invalid PushSubscription payload." });
                }

                const session = authenticateRequest(req);
                const householdId = (session && session.householdId) || body.householdId || 'H001';
                const userId = (session && session.userId) || body.userId || 'U001';
                const username = (session && (session.username || session.name)) || body.username || 'user';
                const name = (session && (session.name || session.username)) || body.name || username;

                const subs = await readSubscriptions();
                const existingIdx = subs.findIndex(s => s.endpoint === subscription.endpoint);
                const subRecord = {
                    ...subscription,
                    householdId: householdId,
                    userId: userId,
                    username: username.toLowerCase().trim(),
                    name: name,
                    userAgent: req.headers['user-agent'] || 'Unknown Mobile/Browser',
                    updatedAt: new Date().toISOString()
                };

                if (existingIdx !== -1) {
                    subs[existingIdx] = subRecord;
                } else {
                    subs.push(subRecord);
                }

                await writeSubscriptions(subs);

                // Send immediate confirmation push notification so user verifies mobile connectivity!
                try {
                    await webpush.sendNotification(
                        subscription,
                        JSON.stringify({
                            title: '🎉 Closed-App Push Active',
                            body: `Alerts enabled for ${name}! You will receive live household updates from linked members even when the app is closed.`,
                            url: '/',
                            tag: `welcome-push-${Date.now()}`,
                            icon: '/icon-192.png',
                            badge: '/icon-192.png',
                            silent: false,
                            requireInteraction: true,
                            vibrate: [300, 100, 300, 100, 300]
                        }),
                        HIGH_PRIORITY_PUSH_OPTIONS
                    );
                } catch (pushErr) {
                    console.warn('Initial push confirmation notice:', pushErr.message);
                }

                return res.status(200).json({
                    success: true,
                    message: "Device successfully subscribed for closed-app mobile notifications!",
                    activeSubscriptionsCount: subs.length,
                    subscribedUser: username,
                    householdId: householdId
                });
            }

            // 2. Unsubscribe Device
            if (postAction === 'unsubscribe') {
                const endpoint = body.endpoint;
                if (!endpoint) return res.status(400).json({ success: false, error: "Endpoint required." });

                let subs = await readSubscriptions();
                subs = subs.filter(s => s.endpoint !== endpoint);
                await writeSubscriptions(subs);

                return res.status(200).json({
                    success: true,
                    message: "Device unsubscribed from background notifications.",
                    activeSubscriptionsCount: subs.length
                });
            }

            // 3. Test Push Route (Disabled in Production)
            if (postAction === 'test_push') {
                return res.status(403).json({
                    success: false,
                    error: "Test push notifications are disabled in production environment."
                });
            }

            // 4. Dismiss in-app notifications
            if (postAction === 'dismiss' || postAction === 'dismiss_all') {
                const session = authenticateRequest(req);
                const householdId = (session && session.householdId) || body.householdId || 'H001';
                const userKey = (session && (session.userId || session.username)) || 'user';
                const notifId = body.id;

                const file = getHouseholdNotifsFile(householdId);
                let list = [];
                if (fs.existsSync(file)) {
                    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
                }
                if (Array.isArray(list)) {
                    list.forEach(item => {
                        if (!notifId || item.id === notifId) {
                            if (!Array.isArray(item.readBy)) item.readBy = [];
                            if (!item.readBy.includes(userKey)) item.readBy.push(userKey);
                        }
                    });
                    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
                }
                return res.status(200).json({ success: true, message: 'Notifications marked as read.' });
            }

            return res.status(400).json({ success: false, error: "Unknown POST action." });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/notifications error:", err);
        return res.status(500).json({ success: false, error: err.message || "Push notifications server error." });
    }
};

module.exports.sendPushToAll = sendPushToAll;
module.exports.sendPushToHouseholdMembers = sendPushToHouseholdMembers;
module.exports.recordHouseholdInAppNotification = recordHouseholdInAppNotification;
module.exports.getHouseholdInAppNotifications = getHouseholdInAppNotifications;
module.exports.checkAndSendScheduledReminders = checkAndSendScheduledReminders;
module.exports.readSubscriptions = readSubscriptions;
module.exports.writeSubscriptions = writeSubscriptions;
