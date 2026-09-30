const { authenticateRequest } = require('./auth');
const storage = require('./_storage');
const notifications = require('./notifications');
const rules = require('./_config_rules');

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
    // ADMIN and SYSTEM_ADMIN can access/modify any household requested; OWNER and MEMBER strictly scoped to their household.
    let householdId = session.householdId;
    const requestedHId = req.query?.householdId || (req.body && req.body.householdId);
    if (requestedHId) {
        if (session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN') {
            householdId = requestedHId;
        } else if (requestedHId !== session.householdId) {
            return res.status(403).json({
                success: false,
                error: "Forbidden: You cannot access or modify configuration for another household."
            });
        }
    }

    const actorUser = session.name || session.username || 'Authenticated User';

    try {
        // GET: Fetch config for authenticated household (Strict fresh reload from disk)
        if (req.method === 'GET') {
            // Usage probe: how many live expenses reference a category, member,
            // payment method or split rule. Used to warn before a delete or a
            // rename instead of silently orphaning records.
            if (req.query && req.query.action === 'usage') {
                const spec = rules.entitySpec(req.query.entity);
                if (!spec) {
                    return res.status(400).json({ success: false, error: 'Unknown entity for usage lookup.' });
                }
                const name = String(req.query.name || '').trim();
                if (!name) {
                    return res.status(400).json({ success: false, error: 'A name is required for a usage lookup.' });
                }
                const expenses = await storage.getHouseholdExpenses(householdId, true);
                return res.status(200).json({
                    success: true,
                    entity: req.query.entity,
                    name: name,
                    count: rules.countReferences(expenses, spec, name)
                });
            }

            const config = await storage.getHouseholdConfig(householdId, true);
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

            // Action: rename a category, family member, payment method or split
            // rule, cascading the new value onto every expense that refers to
            // the old one. Without the cascade a rename orphans history.
            if (body.action === 'rename_entity') {
                const spec = rules.entitySpec(body.entity);
                if (!spec) {
                    return res.status(400).json({ success: false, error: 'Unknown entity type for rename.' });
                }
                const from = String(body.from || '').trim();
                const to = String(body.to || '').trim();
                if (!from || !to) {
                    return res.status(422).json({
                        success: false,
                        error: 'Both the current name and the new name are required.',
                        fieldErrors: [{ field: 'to', message: 'Enter a new name.' }]
                    });
                }

                const list = Array.isArray(current[spec.list]) ? current[spec.list] : [];
                const nameOf = (item) => (spec.objects ? String(item?.name ?? '') : String(item ?? ''));
                const idx = list.findIndex(i => nameOf(i).trim().toLowerCase() === from.toLowerCase());
                if (idx === -1) {
                    return res.status(404).json({ success: false, error: `"${from}" was not found.` });
                }
                const clash = list.findIndex((i, j) =>
                    j !== idx && nameOf(i).trim().toLowerCase() === to.toLowerCase());
                if (clash !== -1) {
                    return res.status(422).json({
                        success: false,
                        error: `"${to}" already exists.`,
                        fieldErrors: [{ field: 'to', message: 'That name is already in use.' }]
                    });
                }

                const expenses = await storage.getHouseholdExpenses(householdId, true);
                const affected = rules.countReferences(expenses, spec, from);

                // The caller must opt in once it knows how much history moves.
                if (affected > 0 && body.cascade !== true) {
                    return res.status(409).json({
                        success: false,
                        error: `"${from}" is used by ${affected} expense${affected === 1 ? '' : 's'}.`,
                        requiresCascade: true,
                        affected: affected
                    });
                }

                const nextList = list.slice();
                nextList[idx] = spec.objects ? { ...list[idx], name: to } : to;

                // Recurring bills also carry a category name.
                let nextBills = current.recurringBills;
                if (body.entity === 'category' && Array.isArray(nextBills)) {
                    nextBills = nextBills.map(b =>
                        String(b?.category ?? '').trim().toLowerCase() === from.toLowerCase()
                            ? { ...b, category: to }
                            : b);
                }

                const updatedConfig = {
                    ...current,
                    [spec.list]: nextList,
                    ...(nextBills ? { recurringBills: nextBills } : {}),
                    householdId: householdId,
                    updatedAt: new Date().toISOString()
                };
                await storage.saveHouseholdConfig(householdId, updatedConfig, actorUser);

                // Cascade onto the referring expenses in a single pass, logged
                // as the one action it is rather than N anonymous updates.
                let moved = 0;
                if (affected > 0) {
                    const needle = from.toLowerCase();
                    moved = await storage.bulkUpdateHouseholdExpenses(
                        householdId,
                        (record) => {
                            let touched = false;
                            for (const f of spec.expenseFields) {
                                if (String(record[f] ?? '').trim().toLowerCase() === needle) {
                                    record[f] = to;
                                    touched = true;
                                }
                            }
                            return touched ? record : null;
                        },
                        actorUser,
                        {
                            action: 'RENAME_ENTITY',
                            recordId: `${body.entity}:${from}`,
                            diff: { [body.entity]: { old: from, new: to } },
                            snapshot: { entity: body.entity, from, to }
                        }
                    );
                }

                const freshConfig = await storage.getHouseholdConfig(householdId, true);
                return res.status(200).json({
                    success: true,
                    message: `Renamed "${from}" to "${to}".` +
                        (moved ? ` ${moved} expense${moved === 1 ? '' : 's'} updated.` : ''),
                    renamed: { entity: body.entity, from, to },
                    updatedExpenses: moved,
                    data: freshConfig
                });
            }

            // Reject invalid values outright rather than coercing them into
            // plausible-looking numbers nobody chose.
            const fieldErrors = rules.validateConfigPayload(body);
            if (fieldErrors.length) {
                return res.status(422).json({
                    success: false,
                    error: fieldErrors.map(e => e.message).join(' '),
                    fieldErrors: fieldErrors
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
                        // Spread first so properties this endpoint does not know
                        // about survive the round-trip instead of being dropped.
                        dedupedCats.push({
                            ...cat,
                            name: String(cat.name).trim(),
                            icon: cat.icon || '🏷️',
                            type: cat.type || 'expense',
                            defaultPaidTo: cat.defaultPaidTo || ''
                        });
                    }
                }
                body.categories = dedupedCats;
            }

            // Normalization of recurring bills (approxAmount & budgetedAmount)
            if (Array.isArray(body.recurringBills)) {
                // Values are already validated above, so normalisation here only
                // converts types - it never substitutes a default for a value
                // the caller actually supplied.
                body.recurringBills = body.recurringBills.map((b, idx) => {
                    if (!b || typeof b !== 'object') return null;
                    const rawAmt = b.approxAmount !== undefined ? b.approxAmount : (b.budgetedAmount !== undefined ? b.budgetedAmount : b.amount);
                    const cleanAmount = rules.parseAmount(rawAmt);
                    return {
                        ...b,
                        id: b.id || `bill-${idx + 1}`,
                        name: String(b.name).trim(),
                        category: String(b.category || '').trim(),
                        dueDay: rules.parseDay(b.dueDay),
                        approxAmount: cleanAmount,
                        budgetedAmount: cleanAmount,
                        icon: b.icon || '⚡'
                    };
                }).filter(Boolean);
            }

            // Normalization of staff salary
            if (Array.isArray(body.staff)) {
                body.staff = body.staff.map((s, idx) => {
                    if (!s || typeof s !== 'object') return null;
                    const rawSal = s.baseSalary !== undefined ? s.baseSalary : s.salary;
                    const prevLeaves = rules.parseDay(s.allowedPaidLeaves);
                    const prevCycleDay = rules.parseDay(s.billingCycleDay);
                    return {
                        ...s,
                        id: s.id || `staff-${idx + 1}`,
                        name: String(s.name).trim(),
                        baseSalary: rules.parseAmount(rawSal),
                        allowedPaidLeaves: prevLeaves,
                        billingCycleDay: prevCycleDay,
                        active: s.active !== false
                    };
                }).filter(Boolean);
            }

            // Normalization of monthly budget target
            if (body.monthlyBudgetLimit !== undefined) {
                body.monthlyBudgetLimit = rules.parseAmount(body.monthlyBudgetLimit);
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
