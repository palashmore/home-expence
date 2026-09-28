// Web Push Notification & Closed-App Mobile Alerts System (/api/notifications)
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const cloudSync = require('./_cloud_sync');
const db = require('./_db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const SUBS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure VAPID keys exist
let vapidKeys = null;
try {
    if (fs.existsSync(VAPID_FILE)) {
        vapidKeys = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
    }
} catch (e) {}

if (!vapidKeys || !vapidKeys.publicKey || !vapidKeys.privateKey) {
    vapidKeys = webpush.generateVAPIDKeys();
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeys, null, 2), 'utf8');
    } catch (e) {}
}

try {
    webpush.setVapidDetails(
        'mailto:admin@homeexpenses.local',
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} catch (e) {
    console.warn('VAPID initialization notice:', e.message);
}

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

// Dispatch push notification to all stored device subscriptions
async function sendPushToAll(payload) {
    const subs = await readSubscriptions();
    if (!subs.length) return { delivered: 0, removed: 0, total: 0 };

    let delivered = 0;
    const remainingSubs = [];

    const stringified = JSON.stringify(payload);

    for (const sub of subs) {
        try {
            await webpush.sendNotification(sub, stringified);
            delivered++;
            remainingSubs.push(sub);
        } catch (err) {
            console.warn(`Push to ${sub.endpoint?.slice(0, 35)}... error:`, err.statusCode || err.message);
            // 404 or 410 indicates subscription has expired or unsubscribed
            if (err.statusCode === 404 || err.statusCode === 410) {
                // Do not keep
            } else {
                remainingSubs.push(sub);
            }
        }
    }

    if (remainingSubs.length !== subs.length) {
        await writeSubscriptions(remainingSubs);
    }

    return { delivered, removed: subs.length - remainingSubs.length, total: subs.length };
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

            // 1. Subscribe Device
            if (postAction === 'subscribe') {
                const subscription = body.subscription;
                if (!subscription || !subscription.endpoint || !subscription.keys) {
                    return res.status(400).json({ success: false, error: "Invalid PushSubscription payload." });
                }

                const subs = await readSubscriptions();
                const existingIdx = subs.findIndex(s => s.endpoint === subscription.endpoint);
                const subRecord = {
                    ...subscription,
                    userAgent: req.headers['user-agent'] || 'Unknown Mobile/Browser',
                    updatedAt: new Date().toISOString()
                };

                if (existingIdx !== -1) {
                    subs[existingIdx] = subRecord;
                } else {
                    subs.push(subRecord);
                }

                await writeSubscriptions(subs);

                // Send immediate confirmation push notification so user can see it works right away!
                try {
                    await webpush.sendNotification(
                        subscription,
                        JSON.stringify({
                            title: '🎉 Mobile Push Notifications Active',
                            body: 'Closed-app alerts enabled! You will now receive reminders for due bills even when the app is completely closed.',
                            url: '/',
                            tag: 'welcome-push'
                        })
                    );
                } catch (pushErr) {
                    console.warn('Initial push confirmation warning:', pushErr.message);
                }

                return res.status(200).json({
                    success: true,
                    message: "Device successfully subscribed for closed-app mobile notifications!",
                    activeSubscriptionsCount: subs.length
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

            // 3. Send Test Push to all subscribed devices
            if (postAction === 'test_push') {
                const customTitle = body.title || '🔔 HomeExpenses Test Alert';
                const customBody = body.body || 'This is a test notification. It will arrive on your mobile phone even when this app is closed!';
                const customUrl = body.url || '/';

                const resResult = await sendPushToAll({
                    title: customTitle,
                    body: customBody,
                    url: customUrl,
                    tag: `test-${Date.now()}`
                });

                return res.status(200).json({
                    success: true,
                    message: `Test notification dispatched to ${resResult.delivered} mobile device(s).`,
                    result: resResult
                });
            }

            return res.status(400).json({ success: false, error: "Unknown POST action." });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/notifications error:", err);
        return res.status(500).json({ success: false, error: err.message || "Push notifications server error." });
    }
};

module.exports.checkAndSendScheduledReminders = checkAndSendScheduledReminders;
