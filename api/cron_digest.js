// Scheduled Daily Spending Digest Endpoint (/api/cron_digest)
// Scheduled via vercel.json crons: 9:00 PM IST (15:30 UTC) daily
const crypto = require('crypto');
const storage = require('./_storage');
const notifications = require('./notifications');
const { authenticateRequest } = require('./auth');

// Format ISO date string into IST (UTC+5:30)
function getISTDate(date = new Date()) {
    const istOffset = 5.5 * 60 * 60 * 1000;
    return new Date(date.getTime() + istOffset);
}

function getISTDateString(date = new Date()) {
    return getISTDate(date).toISOString().slice(0, 10);
}

// Calculate daily digest stats for a single household
function calculateHouseholdDailyDigest(config, expenses, todayDateStr) {
    const activeExpenses = (expenses || []).filter(e => e && !e.isDeleted && e.category !== 'Accepted Payments (Income)');
    
    // 1. Today's expenses (strictly matching todayDateStr in YYYY-MM-DD)
    const todayExpenses = activeExpenses.filter(e => e.date === todayDateStr);
    const todaySpend = todayExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const todayCount = todayExpenses.length;

    // 2. Month-to-date (MTD) expenses in current billing cycle / calendar month
    const cycle = config && config.householdCycle ? config.householdCycle : { type: 'calendar' };
    const [tYear, tMonth, tDay] = todayDateStr.split('-').map(Number);
    
    let cycleStartDate;
    if (cycle.type === 'custom' && cycle.cycleStartDay) {
        const startDay = Number(cycle.cycleStartDay) || 1;
        if (tDay >= startDay) {
            cycleStartDate = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        } else {
            // Previous month
            const prevMonthDate = new Date(tYear, tMonth - 2, 1);
            const prevYear = prevMonthDate.getFullYear();
            const prevMonth = prevMonthDate.getMonth() + 1;
            cycleStartDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        }
    } else {
        // Standard Calendar Month (1st to current date)
        cycleStartDate = `${tYear}-${String(tMonth).padStart(2, '0')}-01`;
    }

    const mtdExpenses = activeExpenses.filter(e => e.date >= cycleStartDate && e.date <= todayDateStr);
    const mtdSpend = mtdExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const budgetLimit = (config && Number(config.monthlyBudgetLimit)) || 50000;
    const mtdPct = budgetLimit > 0 ? Math.round((mtdSpend / budgetLimit) * 100) : 0;

    return {
        todayDateStr,
        todaySpend,
        todayCount,
        cycleStartDate,
        mtdSpend,
        budgetLimit,
        mtdPct
    };
}

module.exports = async function handler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // Authorization check: CRON_SECRET or Admin session
    const cronSecret = (process.env.CRON_SECRET || '').trim();
    const presented = String(
        req.headers['x-cron-secret'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
        ''
    ).trim();

    let authorised = false;
    if (cronSecret && presented && presented.length === cronSecret.length) {
        try {
            authorised = crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(cronSecret));
        } catch (e) {
            authorised = false;
        }
    }

    // In local development or if caller has an active admin/owner session, allow triggering
    if (!authorised) {
        const session = authenticateRequest(req);
        if (session && (session.role === 'SYSTEM_ADMIN' || session.role === 'OWNER')) {
            authorised = true;
        } else if (process.env.NODE_ENV !== 'production' && !cronSecret) {
            // Dev testing fallback
            authorised = true;
        }
    }

    if (!authorised) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized: Missing or invalid CRON_SECRET'
        });
    }

    const todayDateStr = getISTDateString();
    let households = [];
    try {
        households = storage.getAllHouseholds() || [];
    } catch (e) {
        households = [];
    }

    const results = [];

    for (const h of households) {
        const householdId = h && h.householdId;
        if (!householdId) continue;

        try {
            const config = await storage.getHouseholdConfig(householdId, true);
            const expenses = await storage.getHouseholdExpenses(householdId, false, true);
            const stats = calculateHouseholdDailyDigest(config, expenses, todayDateStr);

            const title = `📊 Daily Spending Digest`;
            const body = `Today: ₹${stats.todaySpend.toLocaleString('en-IN')} spent across ${stats.todayCount} transaction${stats.todayCount === 1 ? '' : 's'}. Month-to-date: ₹${stats.mtdSpend.toLocaleString('en-IN')} (${stats.mtdPct}% of budget).`;
            const tag = `daily-digest-${householdId}-${todayDateStr}`;

            const pushResult = await notifications.sendPushToHouseholdMembers({
                householdId,
                title,
                body,
                url: '/#tab-expenses',
                tag,
                type: 'DAILY_DIGEST',
                amount: stats.todaySpend
            });

            results.push({
                householdId,
                householdName: h.name || householdId,
                stats,
                push: pushResult
            });
        } catch (err) {
            results.push({
                householdId,
                error: err.message
            });
        }
    }

    return res.status(200).json({
        success: true,
        date: todayDateStr,
        processed: results.length,
        results
    });
};

module.exports.calculateHouseholdDailyDigest = calculateHouseholdDailyDigest;
module.exports.getISTDateString = getISTDateString;
