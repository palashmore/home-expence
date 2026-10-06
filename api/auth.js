// Authentication & Authorization API Route (/api/auth)
// Multi-Tenant Household Identity & Session Security Engine
const crypto = require('crypto');
const storage = require('./_storage');
const perms = require('./_permissions');

// Session tokens are signed with this. The previous fallback was a literal
// string committed to this repository, so anyone reading the source could forge
// a token for any household and any role, including SYSTEM_ADMIN.
//
// In production a real secret is now required and the process refuses to start
// without one. Outside production a random per-process secret is used instead of
// a shared constant: local sessions stop working after a restart, which is a far
// smaller cost than shipping a publicly known signing key.
const MIN_SECRET_LENGTH = 32;
const INSECURE_LEGACY_SECRET = 'household_secret_token_signing_key_2026_luxury_secure';

// Never throws. Throwing here runs at require() time, which on serverless kills
// the whole function before module.exports is assigned - the platform then
// reports "No exports found in module" and every route, including static files,
// returns 500 with nothing pointing at the real cause.
//
// Instead we always return a usable secret and, when the configuration is unsafe
// in production, flag it. Requests that mint or accept a session are refused
// with an explicit message; everything else still serves, so the operator sees
// the app and a clear reason rather than an opaque 500.
function resolveSessionSecret() {
    const fromEnv = (process.env.JWT_SECRET || '').trim();
    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

    if (fromEnv && fromEnv !== INSECURE_LEGACY_SECRET && fromEnv.length >= MIN_SECRET_LENGTH) {
        return { secret: fromEnv, misconfigured: null };
    }

    const why = !fromEnv
        ? 'JWT_SECRET is not set'
        : (fromEnv === INSECURE_LEGACY_SECRET
            ? 'JWT_SECRET is still the old hardcoded value from the source'
            : `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);

    if (isProduction) {
        // A random secret means nothing signed with a guessable key is ever
        // accepted. Sessions cannot be issued at all until this is fixed.
        console.error(
            `[Auth] ${why}. Sign-in is disabled until it is set, because session ` +
            `tokens would otherwise be forgeable. Generate one with: npm run keys`
        );
        return { secret: crypto.randomBytes(48).toString('base64url'), misconfigured: why };
    }

    if (fromEnv) {
        console.warn(
            `[Auth] ${why}. Using it anyway because this is not production, ` +
            'but it must be replaced before deploying.'
        );
        return { secret: fromEnv, misconfigured: null };
    }

    console.warn(
        '[Auth] JWT_SECRET is not set. Using a random secret for this process only; ' +
        'sessions will not survive a restart. Set JWT_SECRET for a stable local setup.'
    );
    return { secret: crypto.randomBytes(48).toString('base64url'), misconfigured: null };
}

const { secret: JWT_SECRET, misconfigured: SESSION_SECRET_PROBLEM } = resolveSessionSecret();
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ==========================================
// CRYPTOGRAPHIC PASSWORD HASHING
// ==========================================
// Floor for passwords chosen from here on. create_user still accepts 6 for
// compatibility with accounts already seeded; anything set deliberately from
// now on clears a higher bar.
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password) {
    if (!password || typeof password !== 'string') throw new Error('Password required.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (!password || !storedHash || !storedHash.includes(':')) return false;
    try {
        const [salt, hash] = storedHash.split(':');
        const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch (e) {
        return false;
    }
}

// ==========================================
// SESSION TOKEN CREATION & VERIFICATION
// ==========================================
function createSignature(payloadStr) {
    return crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('hex');
}

function generateSessionToken(user, household) {
    const payload = JSON.stringify({
        userId: user.userId,
        username: user.username,
        name: user.name || user.username,
        householdId: user.householdId || household.householdId,
        householdName: household?.householdName || 'Household',
        role: user.role || 'MEMBER',
        // The credential generation this token was issued against. If the
        // password changes afterwards, the stored value moves past this one and
        // the token stops verifying - which is what ends sessions opened before
        // the change.
        pwAt: Number(user.passwordChangedAt) || 0,
        iat: Date.now(),
        exp: Date.now() + SESSION_EXPIRY_MS
    });
    const base64Payload = Buffer.from(payload).toString('base64url');
    const signature = createSignature(base64Payload);
    return `${base64Payload}.${signature}`;
}

function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 2) {
        return null;
    }

    const [base64Payload, signature] = parts;
    const expectedSig = createSignature(base64Payload);

    if (signature.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return null;
    }

    try {
        const payloadStr = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const payload = JSON.parse(payloadStr);
        if (Date.now() > payload.exp) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

// Universal Request Authenticator for API routes
function authenticateRequest(req) {
    let token = '';

    // 1. Check Authorization Header (Bearer <token>) or X-Auth-Token
    const authHeader = req.headers && (req.headers.authorization || req.headers['authorization']);
    if (authHeader && typeof authHeader === 'string') {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
    }
    if (!token && req.headers && req.headers['x-auth-token']) {
        token = String(req.headers['x-auth-token']).trim();
    }

    // 2. Check Cookie (session_token=<token>)
    if (!token && req.headers && req.headers.cookie) {
        const match = req.headers.cookie.match(/(?:^|;\s*)household_session=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]);
    }

    // 3. Check Query parameter (for direct browser downloads / reports)
    if (!token && req.query && req.query.token) {
        token = req.query.token;
    }

    const session = verifySessionToken(token);
    if (!session) return null;

    // A self-contained token proves only that we issued it. It says nothing
    // about whether the account still exists, is still enabled, or still has
    // the password it was issued against - so a stolen token used to survive a
    // password change, a deactivation and even a deletion, until it expired.
    //
    // This is a local file read, not a network call, so it costs microseconds
    // on a request that is about to read household data anyway.
    let users;
    try {
        users = storage.getAllUsers();
    } catch (e) {
        // Storage is momentarily unreadable. Fail open rather than signing
        // everybody out over a transient error - the signature was still valid.
        // The token still names a role, so authorisation keeps working; it just
        // cannot see a per-user override until storage comes back.
        session.permissions = perms.permissionsFor(session.role);
        return session;
    }
    if (!Array.isArray(users) || users.length === 0) {
        session.permissions = perms.permissionsFor(session.role);
        return session;
    }

    const user = users.find(u => u && u.userId === session.userId);
    if (!user) return null;                       // deleted account
    if (user.status && String(user.status).toLowerCase() !== 'active') return null;   // disabled

    const changedAt = Number(user.passwordChangedAt) || 0;
    const issuedFor = Number(session.pwAt) || 0;
    if (changedAt > issuedFor) return null;       // issued before the current password

    // The token records the role the account had when it was issued. Authorise
    // against the record instead, so a demotion - or a per-user permission the
    // admin just revoked - takes effect on the next request rather than at the
    // user's next sign-in.
    if (user.role) session.role = user.role;
    session.permissions = perms.permissionsFor(user);

    return session;
}

// The one question every route should ask. Taking a session rather than a role
// means a per-user override is honoured everywhere automatically; the previous
// scattered `session.role === 'ADMIN'` comparisons could not see one.
function sessionCan(session, permission) {
    if (!session) return false;
    const held = Array.isArray(session.permissions)
        ? session.permissions
        : perms.permissionsFor(session.role);
    return held.indexOf(permission) !== -1;
}

// ==========================================
// HTTP REQUEST HANDLER (/api/auth)
// ==========================================
module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

    // Refuse to issue or accept sessions while the signing secret is unsafe,
    // and say exactly why. The rest of the deployment keeps serving so this is
    // visible and fixable instead of showing a bare 500.
    if (SESSION_SECRET_PROBLEM) {
        return res.status(503).json({
            success: false,
            error: `Server configuration error: ${SESSION_SECRET_PROBLEM}. ` +
                   'Sign-in is disabled until a valid JWT_SECRET is set. ' +
                   'Generate one with "npm run keys", add it to the environment, and redeploy.',
            code: 'SESSION_SECRET_NOT_CONFIGURED'
        });
    }

    // Every users/households read in this app happens in this handler, so one
    // refresh here is enough. On a serverless host /tmp is empty after a cold
    // start, and without this the directory would silently fall back to the
    // copy committed in data/ - losing every household and user created since.
    try {
        await storage.hydrateDirectoryFromCloud();
    } catch (e) {
        console.warn('[Auth] Directory refresh skipped:', e.message);
    }

    try {
        // GET: Verify session or list public user directory
        if (req.method === 'GET') {
            const queryAction = req.query ? req.query.action : null;

            // List available household users (requires active authenticated session, isolated to current household)
            if (queryAction === 'users') {
                const session = authenticateRequest(req);
                if (!session) {
                    return res.status(401).json({ success: false, error: "Authentication required to view household members." });
                }
                const users = storage.getAllUsers()
                    .filter(u => u.householdId === session.householdId)
                    .map(u => {
                        const h = storage.getHouseholdById(u.householdId);
                        return {
                            userId: u.userId,
                            username: u.username,
                            name: u.name,
                            householdId: u.householdId,
                            householdName: h ? h.householdName : u.householdId,
                            role: u.role
                        };
                    });
                return res.status(200).json({ success: true, users: users });
            }

            // Admin Overview: Return households and users for console (Restricted strictly to SYSTEM_ADMIN / ADMIN)
            if (queryAction === 'admin_overview') {
                const session = authenticateRequest(req);
                if (!session) {
                    return res.status(401).json({ success: false, error: "Authentication required." });
                }
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin) {
                    return res.status(403).json({ success: false, error: "Forbidden: Access denied. System Administrator role required." });
                }

                const allHouseholds = storage.getAllHouseholds();
                const allUsers = storage.getAllUsers();

                const filteredHouseholds = allHouseholds;
                const allowedHIds = new Set(filteredHouseholds.map(h => h.householdId));

                const households = filteredHouseholds.map(h => {
                    const memberUsers = allUsers.filter(u => u.householdId === h.householdId);
                    return {
                        householdId: h.householdId,
                        householdName: h.householdName,
                        ownerUserId: h.ownerUserId,
                        memberCount: memberUsers.length,
                        status: h.status || 'active',
                        createdAt: h.createdAt
                    };
                });

                const users = allUsers
                    .filter(u => session.role === 'ADMIN' || allowedHIds.has(u.householdId))
                    .map(u => {
                        const h = storage.getHouseholdById(u.householdId);
                        return {
                            userId: u.userId,
                            username: u.username,
                            email: u.email,
                            name: u.name,
                            householdId: u.householdId,
                            householdName: h ? h.householdName : u.householdId,
                            role: u.role,
                            status: u.status,
                            createdAt: u.createdAt,
                            // What this account may do right now, and whether
                            // that is an explicit list or the role's defaults.
                            permissions: perms.permissionsFor(u),
                            permissionsAreCustom: perms.hasExplicitPermissions(u)
                        };
                    });

                return res.status(200).json({
                    success: true,
                    households: households,
                    users: users,
                    activeHouseholdId: session.householdId,
                    currentUserRole: session.role,
                    // The catalogue the permission editor renders. Served from
                    // the same registry the API enforces, so the checkboxes
                    // cannot drift away from what is actually checked.
                    permissionCatalog: perms.ALL_PERMISSIONS,
                    permissionPresets: perms.ROLE_PRESETS,
                    rolePermissions: perms.ROLE_PERMISSIONS,
                    myPermissions: Array.isArray(session.permissions)
                        ? session.permissions
                        : perms.permissionsFor(session.role)
                });
            }

            // Verify current session
            const session = authenticateRequest(req);
            if (session) {
                // Fetch fresh user record to reflect any live permission/status changes
                const userRec = storage.getUserById(session.userId);
                if (userRec && userRec.status === 'disabled') {
                    return res.status(403).json({
                        success: false,
                        authenticated: false,
                        error: "Account has been disabled. Please contact administrator."
                    });
                }
                const activeRole = userRec ? userRec.role : session.role;
                // A per-user override lives on the record, so when we have the
                // record we answer from it rather than from the role alone.
                const hasOverride = !!userRec && perms.hasExplicitPermissions(userRec);
                const isSysAdmin = activeRole === 'SYSTEM_ADMIN' || activeRole === 'ADMIN';
                const activeHouseholdId = userRec ? userRec.householdId : session.householdId;
                const hh = storage.getHouseholdById(activeHouseholdId);
                const finalHouseholdId = hh ? activeHouseholdId : (isSysAdmin ? 'SYSTEM' : 'H001');
                const finalHousehold = hh || (isSysAdmin ? { householdId: 'SYSTEM', householdName: 'System Administration' } : storage.getHouseholdById('H001'));

                return res.status(200).json({
                    success: true,
                    authenticated: true,
                    user: {
                        userId: session.userId,
                        username: userRec ? userRec.username : session.username,
                        name: userRec ? userRec.name : session.name,
                        householdId: finalHouseholdId,
                        householdName: finalHousehold ? finalHousehold.householdName : 'Primary Household',
                        role: activeRole,
                        // What this account may do. The client drives navigation
                        // from these rather than re-deriving capability from a
                        // role string in a dozen places. An explicit per-user
                        // list wins over the role's defaults.
                        permissions: perms.permissionsFor(
                            hasOverride ? userRec : activeRole),
                        permissionsAreCustom: hasOverride
                    }
                });
            } else {
                return res.status(401).json({
                    success: false,
                    authenticated: false,
                    error: "No active session found."
                });
            }
        }

        // POST: Login / Logout / Verify / Admin Actions
        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }
            if (!body) body = {};

            const action = body.action || (body.username ? 'login' : 'verify');

            // 1. SIGN IN ACTION
            if (action === 'login') {
                const username = String(body.username || '').trim().toLowerCase();
                const password = String(body.password || '').trim();

                if (!username || !password) {
                    return res.status(400).json({ success: false, error: "Username and password are required." });
                }

                const user = storage.getUserByUsernameOrEmail(username);
                if (!user || user.status !== 'active') {
                    return res.status(401).json({ success: false, error: "Invalid username or password." });
                }

                // Verify the password against this user's stored scrypt hash, and
                // nothing else.
                //
                // This used to accept four fallbacks as well: the literal
                // "Household123!", "<display name>@123", and two account-specific
                // strings. "Household123!" opened EVERY account in EVERY household
                // regardless of that user's real password, and the name pattern is
                // guessable from any screen that shows who paid for something. On a
                // deployment holding several households' financial records that is a
                // complete authentication bypass, and it also made password changes
                // meaningless: a user could pick a strong password and still be
                // reachable with the fallback.
                //
                // Every seeded account already had a valid scrypt hash, so removing
                // these locked nobody out - it only stopped the bypass.
                const isValidPassword = verifyPassword(password, user.passwordHash);

                if (!isValidPassword) {
                    return res.status(401).json({ success: false, error: "Invalid username or password." });
                }

                const household = storage.getHouseholdById(user.householdId);
                const token = generateSessionToken(user, household);

                // Set HttpOnly cookie for session security
                res.setHeader('Set-Cookie', `household_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);

                return res.status(200).json({
                    success: true,
                    token: token,
                    user: {
                        userId: user.userId,
                        username: user.username,
                        name: user.name,
                        householdId: user.householdId,
                        householdName: household ? household.householdName : user.householdId,
                        role: user.role,
                        permissions: perms.permissionsFor(user)
                    },
                    message: `Welcome back, ${user.name}!`
                });
            }

            // 1b. CHANGE OWN PASSWORD (every authenticated role)
            //
            // Deliberately separate from edit_user, which is the administrator's
            // reset path and requires ADMIN/SYSTEM_ADMIN/OWNER. This one is for
            // the signed-in user and nobody else:
            //   - the target is always session.userId. A userId in the body is
            //     ignored, so this can never be aimed at another account.
            //   - the current password must be supplied and verified. Without
            //     that, a borrowed unlocked phone or any XSS becomes a permanent
            //     account takeover rather than a temporary one.
            //   - neither password is ever logged or echoed back.
            if (action === 'change_password') {
                const session = authenticateRequest(req);
                if (!session) {
                    return res.status(401).json({ success: false, error: "Authentication required." });
                }

                const currentPassword = String(body.currentPassword || '');
                const newPassword = String(body.newPassword || '');
                const confirmPassword = String(body.confirmPassword !== undefined ? body.confirmPassword : newPassword);

                if (!currentPassword) {
                    return res.status(422).json({
                        success: false, field: 'currentPassword',
                        error: "Enter your current password."
                    });
                }
                if (newPassword.length < MIN_PASSWORD_LENGTH) {
                    return res.status(422).json({
                        success: false, field: 'newPassword',
                        error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`
                    });
                }
                if (newPassword !== confirmPassword) {
                    return res.status(422).json({
                        success: false, field: 'confirmPassword',
                        error: "The two new passwords do not match."
                    });
                }
                if (newPassword === currentPassword) {
                    return res.status(422).json({
                        success: false, field: 'newPassword',
                        error: "The new password must be different from the current one."
                    });
                }

                const user = storage.getUserById(session.userId);
                if (!user) {
                    return res.status(404).json({ success: false, error: "Account not found." });
                }
                if (!verifyPassword(currentPassword, user.passwordHash)) {
                    return res.status(403).json({
                        success: false, field: 'currentPassword',
                        error: "That is not your current password."
                    });
                }

                try {
                    storage.updateUser(session.userId,
                        {
                            passwordHash: hashPassword(newPassword),
                            passwordChangedAt: Date.now()
                        },
                        session.username);
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }

                // The write has to reach the Gist before the response, or a cold
                // start can discard it and the owner is left believing their
                // password changed when it did not.
                await storage.flushPendingCloudWrites();

                return res.status(200).json({
                    success: true,
                    message: "Password updated. It is already in effect everywhere you sign in.",
                    // Session tokens are self-contained and are not checked against
                    // the user record, so sessions opened before this change stay
                    // valid until they expire.
                    sessionsUnaffected: true
                });
            }

            // 2. SIGN OUT ACTION
            if (action === 'logout') {
                res.setHeader('Set-Cookie', 'household_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
                return res.status(200).json({
                    success: true,
                    message: "Signed out successfully."
                });
            }

            // 3. VERIFY TOKEN ACTION
            if (action === 'verify') {
                const session = authenticateRequest(req) || (body.token ? verifySessionToken(body.token) : null);
                if (session) {
                    const userRec = storage.getUserById(session.userId);
                    if (userRec && userRec.status === 'disabled') {
                        return res.status(403).json({ success: false, authenticated: false, error: "Account has been disabled." });
                    }
                    const activeRole = userRec ? userRec.role : session.role;
                    const activeHouseholdId = userRec ? userRec.householdId : session.householdId;
                    const isSysAdmin = activeRole === 'SYSTEM_ADMIN' || activeRole === 'ADMIN';
                    const hh = storage.getHouseholdById(activeHouseholdId);
                    const finalHouseholdId = hh ? activeHouseholdId : (isSysAdmin ? 'SYSTEM' : 'H001');
                    const finalHousehold = hh || (isSysAdmin ? { householdId: 'SYSTEM', householdName: 'System Administration' } : storage.getHouseholdById('H001'));

                    return res.status(200).json({
                        success: true,
                        authenticated: true,
                        user: {
                            userId: session.userId,
                            username: userRec ? userRec.username : session.username,
                            name: userRec ? userRec.name : session.name,
                            householdId: finalHouseholdId,
                            householdName: finalHousehold ? finalHousehold.householdName : 'Primary Household',
                            role: activeRole
                        }
                    });
                } else {
                    return res.status(401).json({ success: false, authenticated: false, error: "Session invalid or expired." });
                }
            }

            // 4. CREATE HOUSEHOLD ACTION (Restricted strictly to SYSTEM_ADMIN / ADMIN)
            if (action === 'create_household') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin) {
                    return res.status(403).json({ success: false, error: "Forbidden: System Administrator role required to create households." });
                }

                const householdName = String(body.householdName || '').trim();
                if (!householdName || householdName.length < 2) {
                    return res.status(400).json({ success: false, error: "Household name must be at least 2 characters long." });
                }

                const initialBudget = Number(body.initialBudget) || 50000;
                const ownerUserId = body.ownerUserId || session.userId;
                const ownerUser = storage.getUserById(ownerUserId);

                try {
                    const newHousehold = storage.createHousehold({
                        householdName: householdName,
                        initialBudget: initialBudget,
                        ownerUserId: ownerUserId,
                        ownerName: ownerUser ? ownerUser.name : (body.ownerName || 'Household Owner')
                    }, session.username);

                    return res.status(201).json({
                        success: true,
                        household: newHousehold,
                        message: `Household '${newHousehold.householdName}' created successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            // 5. CREATE USER ACTION (Restricted strictly to SYSTEM_ADMIN / ADMIN)
            if (action === 'create_user') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin) {
                    return res.status(403).json({ success: false, error: "Forbidden: System Administrator role required to create users." });
                }

                const username = String(body.username || '').trim().toLowerCase();
                const password = String(body.password || '').trim();
                const name = String(body.name || username).trim();
                const email = String(body.email || `${username}@homeexpenses.local`).trim().toLowerCase();
                const householdId = String(body.householdId || session.householdId).trim();
                const role = String(body.role || 'MEMBER').trim().toUpperCase();

                if (!username || username.length < 3) {
                    return res.status(400).json({ success: false, error: "Username must be at least 3 characters." });
                }
                if (!password || password.length < 6) {
                    return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
                }
                if (!['ADMIN', 'SYSTEM_ADMIN', 'OWNER', 'MEMBER', 'VIEWER'].includes(role)) {
                    return res.status(400).json({ success: false, error: "Invalid role specified. Must be OWNER, MEMBER, or VIEWER." });
                }

                const passwordHash = hashPassword(password);
                try {
                    const newUser = storage.createUser({
                        username,
                        passwordHash,
                        name,
                        email,
                        householdId,
                        role
                    }, session.username);

                    return res.status(201).json({
                        success: true,
                        user: newUser,
                        message: `User '${newUser.name}' (@${newUser.username}) created successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            // 6. SWITCH ACTIVE HOUSEHOLD CONTEXT (Disabled in production for strict tenancy)
            if (action === 'switch_household') {
                return res.status(403).json({
                    success: false,
                    error: "Forbidden: Household switching is disabled in production. Please sign in directly with the appropriate household credentials."
                });
            }

            // 7. EDIT HOUSEHOLD ACTION (Admin & Owner)
            if (action === 'edit_household') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });

                const targetHId = String(body.householdId || '').trim();
                if (!targetHId) return res.status(400).json({ success: false, error: "Household ID required." });

                const targetH = storage.getHouseholdById(targetHId);
                if (!targetH) return res.status(404).json({ success: false, error: "Household not found." });

                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin) {
                    if (targetH.ownerUserId !== session.userId && targetH.householdId !== session.householdId) {
                        return res.status(403).json({ success: false, error: "Forbidden: You can only edit your own household." });
                    }
                }

                try {
                    const updated = storage.updateHousehold(targetHId, {
                        householdName: body.householdName,
                        monthlyBudgetLimit: body.monthlyBudgetLimit,
                        status: body.status
                    }, session.username);

                    return res.status(200).json({
                        success: true,
                        household: updated,
                        message: `Household '${updated.householdName}' updated successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            // 8. DELETE HOUSEHOLD ACTION (Admin Only)
            if (action === 'delete_household') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin) {
                    return res.status(403).json({ success: false, error: "Forbidden: Only System Administrators can delete households." });
                }

                const targetHId = String(body.householdId || '').trim();
                if (!targetHId) return res.status(400).json({ success: false, error: "Household ID required." });

                try {
                    const result = storage.deleteHousehold(targetHId, session.username);
                    return res.status(200).json({
                        success: true,
                        message: `Household '${result.householdName}' deleted successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            // 9. EDIT USER ACTION (Admin & Owner)
            if (action === 'edit_user') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin && session.role !== 'OWNER') {
                    return res.status(403).json({ success: false, error: "Forbidden: Administrator or Household Owner role required to edit users." });
                }

                const targetUId = String(body.userId || '').trim();
                if (!targetUId) return res.status(400).json({ success: false, error: "User ID required." });

                const targetUser = storage.getUserById(targetUId);
                if (!targetUser) return res.status(404).json({ success: false, error: "User not found." });

                if (!isSysAdmin) {
                    if (targetUser.householdId !== session.householdId && targetUser.userId !== session.userId) {
                        return res.status(403).json({ success: false, error: "Forbidden: You may only edit users in your own household." });
                    }
                    if (targetUser.role === 'ADMIN' || targetUser.role === 'SYSTEM_ADMIN') {
                        return res.status(403).json({ success: false, error: "Forbidden: You cannot modify administrator accounts." });
                    }
                    if (body.role === 'ADMIN' || body.role === 'SYSTEM_ADMIN') {
                        return res.status(403).json({ success: false, error: "Forbidden: Only System Administrators can grant ADMIN role." });
                    }
                }

                const updates = {};
                if (body.name) updates.name = String(body.name).trim();
                if (body.username) updates.username = String(body.username).trim().toLowerCase();
                if (body.email) updates.email = String(body.email).trim().toLowerCase();
                if (body.role) updates.role = String(body.role).trim().toUpperCase();
                if (body.status) updates.status = String(body.status).trim().toLowerCase();
                if (isSysAdmin && body.householdId) updates.householdId = String(body.householdId).trim();

                // Per-user permission overrides.
                //
                // Only somebody who may manage users can set them, and only up
                // to what they hold themselves - otherwise an OWNER could tick
                // "manage households" for a member and hand out an authority
                // they do not have. Sending an empty array clears the override
                // and the account falls back to its role.
                if (body.permissions !== undefined) {
                    if (!sessionCan(session, perms.PERMISSIONS.USERS_MANAGE)
                        && !sessionCan(session, perms.PERMISSIONS.SETTINGS_MANAGE)) {
                        return res.status(403).json({
                            success: false,
                            error: "Forbidden: changing individual permissions requires user management rights."
                        });
                    }
                    const requested = perms.sanitizePermissions(body.permissions) || [];
                    if (!isSysAdmin) {
                        const mine = Array.isArray(session.permissions)
                            ? session.permissions
                            : perms.permissionsFor(session.role);
                        const excess = requested.filter(p => mine.indexOf(p) === -1);
                        if (excess.length) {
                            return res.status(403).json({
                                success: false,
                                error: "Forbidden: you cannot grant a permission you do not hold: " + excess.join(', ')
                            });
                        }
                    }
                    // Nobody may remove their own ability to manage users; that
                    // is the one change that cannot be undone from inside the app.
                    if (targetUId === session.userId
                        && requested.length
                        && requested.indexOf(perms.PERMISSIONS.USERS_MANAGE) === -1
                        && sessionCan(session, perms.PERMISSIONS.USERS_MANAGE)) {
                        return res.status(400).json({
                            success: false,
                            error: "You cannot remove your own user-management permission; another administrator must do it."
                        });
                    }
                    updates.permissions = requested;
                }

                // If password is being reset
                if (body.password && String(body.password).trim().length >= 6) {
                    updates.passwordHash = hashPassword(String(body.password).trim());
                    // An administrator resetting a compromised account must also
                    // sign the intruder out, not just change what they would
                    // need to type next time.
                    updates.passwordChangedAt = Date.now();
                }

                try {
                    const updatedUser = storage.updateUser(targetUId, updates, session.username);
                    return res.status(200).json({
                        success: true,
                        user: updatedUser,
                        message: `User '${updatedUser.name}' updated successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            // 10. DELETE USER ACTION (Admin & Owner)
            if (action === 'delete_user') {
                const session = authenticateRequest(req);
                if (!session) return res.status(401).json({ success: false, error: "Authentication required." });
                const isSysAdmin = session.role === 'ADMIN' || session.role === 'SYSTEM_ADMIN';
                if (!isSysAdmin && session.role !== 'OWNER') {
                    return res.status(403).json({ success: false, error: "Forbidden: Administrator or Household Owner role required to delete users." });
                }

                const targetUId = String(body.userId || '').trim();
                if (!targetUId) return res.status(400).json({ success: false, error: "User ID required." });

                if (session.userId === targetUId) {
                    return res.status(400).json({ success: false, error: "Action Forbidden: You cannot delete your own active account." });
                }

                const targetUser = storage.getUserById(targetUId);
                if (!targetUser) return res.status(404).json({ success: false, error: "User not found." });

                if (!isSysAdmin) {
                    if (targetUser.householdId !== session.householdId) {
                        return res.status(403).json({ success: false, error: "Forbidden: You may only delete users from your own household." });
                    }
                    if (targetUser.role === 'ADMIN' || targetUser.role === 'SYSTEM_ADMIN' || targetUser.role === 'OWNER') {
                        return res.status(403).json({ success: false, error: "Forbidden: Household Owners cannot delete Admin or Owner accounts." });
                    }
                }

                try {
                    const result = storage.deleteUser(targetUId, session.username);
                    return res.status(200).json({
                        success: true,
                        message: `User '@${result.username}' deleted successfully!`
                    });
                } catch (err) {
                    return res.status(400).json({ success: false, error: err.message });
                }
            }

            return res.status(400).json({ success: false, error: "Invalid authentication action." });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/auth error:", err);
        return res.status(500).json({ success: false, error: "Internal authentication error." });
    } finally {
        // createHousehold and createUser are synchronous, so their cloud writes
        // are started rather than awaited. A serverless host freezes the
        // instance once this handler's promise settles - not when the response
        // is sent - so draining them here is what makes a new household or user
        // actually reach the Gist.
        try {
            await storage.flushPendingCloudWrites();
        } catch (e) {
            console.warn('[Auth] Cloud write flush notice:', e.message);
        }
    }
};

module.exports.generateSessionToken = generateSessionToken;
module.exports.verifySessionToken = verifySessionToken;
module.exports.authenticateRequest = authenticateRequest;
module.exports.sessionCan = sessionCan;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
