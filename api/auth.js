// Authentication & Authorization API Route (/api/auth)
// Multi-Tenant Household Identity & Session Security Engine
const crypto = require('crypto');
const storage = require('./_storage');

const JWT_SECRET = process.env.JWT_SECRET || "household_secret_token_signing_key_2026_luxury_secure";
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ==========================================
// CRYPTOGRAPHIC PASSWORD HASHING
// ==========================================
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
        // Fallback for legacy demo direct access tokens
        if (token === 'direct_access') {
            return {
                userId: 'U001',
                username: 'palash',
                name: 'Palash',
                householdId: 'H001',
                householdName: 'Palash & Pallavi Household',
                role: 'OWNER',
                iat: Date.now(),
                exp: Date.now() + SESSION_EXPIRY_MS
            };
        }
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

    // 1. Check Authorization Header (Bearer <token>)
    const authHeader = req.headers && req.headers.authorization;
    if (authHeader && typeof authHeader === 'string') {
        token = authHeader.replace(/^Bearer\s+/i, '').trim();
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
    return session || null;
}

// ==========================================
// HTTP REQUEST HANDLER (/api/auth)
// ==========================================
module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

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

            // Verify current session
            const session = authenticateRequest(req);
            if (session) {
                return res.status(200).json({
                    success: true,
                    authenticated: true,
                    user: {
                        userId: session.userId,
                        username: session.username,
                        name: session.name,
                        householdId: session.householdId,
                        householdName: session.householdName,
                        role: session.role
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

        // POST: Login / Logout / Verify
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

                // Verify Password (supports default demo passwords or user configured password)
                const isValidPassword = verifyPassword(password, user.passwordHash) ||
                    password === "Household123!" ||
                    password === `${user.name}@123` ||
                    (user.userId === 'U003' && password === 'UserB@123');

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
                        role: user.role
                    },
                    message: `Welcome back, ${user.name}!`
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
                    return res.status(200).json({
                        success: true,
                        authenticated: true,
                        user: {
                            userId: session.userId,
                            username: session.username,
                            name: session.name,
                            householdId: session.householdId,
                            householdName: session.householdName,
                            role: session.role
                        }
                    });
                } else {
                    return res.status(401).json({ success: false, authenticated: false, error: "Session invalid or expired." });
                }
            }

            return res.status(400).json({ success: false, error: "Invalid authentication action." });
        }

        return res.status(405).json({ success: false, error: "Method not allowed." });
    } catch (err) {
        console.error("API /api/auth error:", err);
        return res.status(500).json({ success: false, error: "Internal authentication error." });
    }
};

module.exports.verifySessionToken = verifySessionToken;
module.exports.authenticateRequest = authenticateRequest;
module.exports.hashPassword = hashPassword;
module.exports.verifyPassword = verifyPassword;
