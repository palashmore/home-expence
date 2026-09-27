// Authentication API Route (/api/auth)
// Handles login, session token verification, and logout
const crypto = require('crypto');

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "Household123!";
const JWT_SECRET = process.env.JWT_SECRET || "household_secret_token_signing_key_2026";

function createSignature(payloadStr) {
    return crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('hex');
}

function generateSessionToken(accountName = "household_owner") {
    const payload = JSON.stringify({
        account: accountName,
        iat: Date.now(),
        exp: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
    });
    const base64Payload = Buffer.from(payload).toString('base64url');
    const signature = createSignature(base64Payload);
    return `${base64Payload}.${signature}`;
}

function verifySessionToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [base64Payload, signature] = parts;
    const expectedSig = createSignature(base64Payload);

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return false;
    }

    try {
        const payloadStr = Buffer.from(base64Payload, 'base64url').toString('utf8');
        const payload = JSON.parse(payloadStr);
        if (Date.now() > payload.exp) return false;
        return payload;
    } catch (e) {
        return false;
    }
}

module.exports = async function handler(req, res) {
    // CORS & Content-Type Headers
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const action = body ? body.action : null;

        if (action === 'login') {
            const token = generateSessionToken();
            return res.status(200).json({
                success: true,
                token: token,
                message: "Sign-in successful!"
            });
        }

        if (action === 'verify') {
            const authHeader = req.headers.authorization || '';
            const token = authHeader.replace('Bearer ', '').trim() || (body ? body.token : '');
            const payload = verifySessionToken(token);
            if (payload) {
                return res.status(200).json({ success: true, authenticated: true, user: payload.account });
            } else {
                return res.status(401).json({ success: false, authenticated: false, error: "Invalid or expired session token." });
            }
        }

        return res.status(400).json({ success: false, error: "Unknown auth action." });
    }

    if (req.method === 'GET') {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '').trim();
        const payload = verifySessionToken(token);
        if (payload) {
            return res.status(200).json({ success: true, authenticated: true, user: payload.account });
        } else {
            return res.status(401).json({ success: false, authenticated: false });
        }
    }

    return res.status(405).json({ success: false, error: "Method not allowed." });
};

module.exports.verifySessionToken = verifySessionToken;
