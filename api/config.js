const { authenticateRequest } = require('./auth');
const storage = require('./_storage');
const notifications = require('./notifications');

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
        // GET: Fetch config for authenticated household
        if (req.method === 'GET') {
            const config = await storage.getHouseholdConfig(householdId);
            if (config && session && session.name) {
                if (!Array.isArray(config.familyMembers)) config.familyMembers = [];
                if (!config.familyMembers.includes(session.name)) {
                    config.familyMembers.unshift(session.name);
                }
            }
            return res.status(200).json({
                success: true,
                householdId: householdId,
                data: config
            });
        }

        // POST / PUT: Update config for authenticated household
        if (req.method === 'POST' || req.method === 'PUT') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body || typeof body !== 'object') {
                return res.status(400).json({ success: false, error: "Missing configuration payload." });
            }

            const current = await storage.getHouseholdConfig(householdId);
            const updated = {
                ...current,
                ...body,
                householdId: householdId,
                updatedAt: new Date().toISOString()
            };

            await storage.saveHouseholdConfig(householdId, updated, actorUser);

            // Closed-app Push Notification to linked household members
            try {
                notifications.sendPushToHouseholdMembers({
                    householdId: householdId,
                    title: `⚙️ ${actorUser} updated household settings`,
                    body: `Master household rules, budget limits, or categories modified`,
                    url: '/#tab-settings',
                    tag: `config-update-${Date.now()}`,
                    excludeUserId: session.userId,
                    excludeUsername: session.username,
                    actor: { userId: session.userId, username: session.username, name: actorUser },
                    type: 'CONFIG_UPDATE'
                }).catch(e => console.warn('[Push] Config dispatch warning:', e.message));
            } catch (pushErr) {}

            return res.status(200).json({
                success: true,
                message: "Household configuration updated successfully!",
                data: updated
            });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/config error:", err);
        return res.status(500).json({ success: false, error: "Internal server error updating configuration." });
    }
};
