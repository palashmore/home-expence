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

    // Role-based household scoping:
    // ADMIN can access/modify any household requested; OWNER and MEMBER strictly scoped to their household.
    let householdId = session.householdId;
    const requestedHId = req.query?.householdId || (req.body && req.body.householdId);
    if (requestedHId && (session.role === 'ADMIN' || requestedHId === session.householdId)) {
        householdId = requestedHId;
    }

    const actorUser = session.name || session.username || 'Authenticated User';

    try {
        // GET: Fetch config for authenticated household (Strict fresh reload from disk)
        if (req.method === 'GET') {
            const config = await storage.getHouseholdConfig(householdId, true);
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
            // Permission check: Viewer role cannot modify household master configuration
            if (session.role === 'VIEWER') {
                return res.status(403).json({
                    success: false,
                    error: "Forbidden: Viewer role has read-only permissions and cannot modify household configuration."
                });
            }

            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            if (!body || typeof body !== 'object') {
                return res.status(400).json({ success: false, error: "Missing configuration payload." });
            }

            const current = await storage.getHouseholdConfig(householdId, true);

            // Action: Dedicated atomic category creation
            if (body.action === 'add_category' && body.category) {
                const currentCats = Array.isArray(current.categories) ? [...current.categories] : [];
                const catObj = typeof body.category === 'string' ? { name: body.category } : body.category;
                const catName = String(catObj.name || '').trim();

                if (!catName) {
                    return res.status(400).json({ success: false, error: "Validation Error: Category name is required." });
                }

                const existingIdx = currentCats.findIndex(c => c.name.toLowerCase() === catName.toLowerCase());
                if (existingIdx !== -1) {
                    // Update existing
                    currentCats[existingIdx] = {
                        ...currentCats[existingIdx],
                        ...catObj,
                        name: catName
                    };
                } else {
                    currentCats.push({
                        name: catName,
                        icon: catObj.icon || '🏷️',
                        type: catObj.type || 'expense',
                        defaultPaidTo: catObj.defaultPaidTo || ''
                    });
                }

                const updated = {
                    ...current,
                    categories: currentCats,
                    householdId: householdId,
                    updatedAt: new Date().toISOString()
                };

                await storage.saveHouseholdConfig(householdId, updated, actorUser);

                // Closed-app Push Notification to linked household members
                try {
                    await notifications.sendPushToHouseholdMembers({
                        householdId: householdId,
                        title: `🏷️ ${actorUser} added category: ${catName}`,
                        body: `New spending category available in Master Settings`,
                        url: '/#tab-settings',
                        tag: `cat-new-${Date.now()}`,
                        excludeUserId: session.userId,
                        excludeUsername: session.username,
                        actor: { userId: session.userId, username: session.username, name: actorUser },
                        type: 'CONFIG_UPDATE'
                    });
                } catch (pushErr) {}

                return res.status(200).json({
                    success: true,
                    message: `Category "${catName}" added to Master Settings successfully!`,
                    data: updated
                });
            }

            // Sanitization and deduplication of categories if provided in batch update
            if (Array.isArray(body.categories)) {
                const seen = new Set();
                const dedupedCats = [];
                for (const cat of body.categories) {
                    if (!cat || !cat.name) continue;
                    const key = String(cat.name).trim().toLowerCase();
                    if (!seen.has(key)) {
                        seen.add(key);
                        dedupedCats.push({
                            name: String(cat.name).trim(),
                            icon: cat.icon || '🏷️',
                            type: cat.type || 'expense',
                            defaultPaidTo: cat.defaultPaidTo || ''
                        });
                    }
                }
                body.categories = dedupedCats;
            }

            const updated = {
                ...current,
                ...body,
                householdId: householdId,
                updatedAt: new Date().toISOString()
            };

            await storage.saveHouseholdConfig(householdId, updated, actorUser);

            // Closed-app Push Notification to linked household members
            try {
                await notifications.sendPushToHouseholdMembers({
                    householdId: householdId,
                    title: `⚙️ ${actorUser} updated household settings`,
                    body: `Master household rules, budget limits, or categories modified`,
                    url: '/#tab-settings',
                    tag: `config-update-${Date.now()}`,
                    excludeUserId: session.userId,
                    excludeUsername: session.username,
                    actor: { userId: session.userId, username: session.username, name: actorUser },
                    type: 'CONFIG_UPDATE'
                });
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
