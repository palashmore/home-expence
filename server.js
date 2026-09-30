// Local Node.js Express / HTTP Server for Household Expense Tracker
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8000;

// Import Vercel API Handlers
const authHandler = require('./api/auth');
const expensesHandler = require('./api/expenses');
const receiptsHandler = require('./api/receipts');
const migrateHandler = require('./api/migrate');
const attendanceHandler = require('./api/attendance');
const configHandler = require('./api/config');
const auditHandler = require('./api/audit');
const backupHandler = require('./api/backup');
const notificationsHandler = require('./api/notifications');

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Pre-load static assets at startup into memory
const staticCache = {};
const staticFiles = [
    'index.html',
    'styles.css',
    'tracker_app.js',
    'advance_modules.js',
    'sw.js',
    'manifest.json',
    'icon.svg',
    'icon-192.png',
    'icon-512.png',
    'icon-maskable-512.png',
    'apple-touch-icon.png',
    'favicon.ico',
    'og-image.png'
];

for (const f of staticFiles) {
    try {
        const p1 = path.join(process.cwd(), f);
        const p2 = path.join(__dirname, f);
        if (fs.existsSync(p1)) {
            staticCache[f] = fs.readFileSync(p1);
        } else if (fs.existsSync(p2)) {
            staticCache[f] = fs.readFileSync(p2);
        }
    } catch (e) {}
}

const handler = async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    const processRequest = async () => {
        if (!req.query) req.query = parsedUrl.query;

        // Mock Serverless Response object methods if not present
        if (!res.status) {
            res.status = function(code) {
                res.statusCode = code;
                return res;
            };
        }
        if (!res.json) {
            res.json = function(data) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
            };
        }

        // API Route Handlers
        if (pathname === '/api/auth') {
            return await authHandler(req, res);
        }
        if (pathname === '/api/expenses' || pathname.startsWith('/api/expenses/')) {
            if (pathname.startsWith('/api/expenses/')) {
                req.query = req.query || {};
                req.query.id = pathname.slice('/api/expenses/'.length);
            }
            return await expensesHandler(req, res);
        }
        if (pathname === '/api/receipts') {
            return await receiptsHandler(req, res);
        }
        if (pathname === '/api/migrate') {
            return await migrateHandler(req, res);
        }
        if (pathname === '/api/attendance') {
            return await attendanceHandler(req, res);
        }
        if (pathname === '/api/config') {
            return await configHandler(req, res);
        }
        if (pathname === '/api/audit') {
            return await auditHandler(req, res);
        }
        if (pathname === '/api/backup') {
            return await backupHandler(req, res);
        }
        if (pathname === '/api/notifications') {
            return await notificationsHandler(req, res);
        }

        // Serve Static Files: Prioritize fresh disk read, fallback to staticCache
        const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
        const baseDir = fs.existsSync(path.join(process.cwd(), 'index.html')) ? process.cwd() : __dirname;
        const filePath = path.join(baseDir, cleanPath);
        const ext = path.extname(cleanPath).toLowerCase();

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            try {
                const liveContent = fs.readFileSync(filePath);
                res.writeHead(200, {
                    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                return res.end(liveContent);
            } catch (e) {}
        }

        if (staticCache[cleanPath]) {
            res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            return res.end(staticCache[cleanPath]);
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                // If not found, fallback to cached index.html
                if (staticCache['index.html']) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    return res.end(staticCache['index.html']);
                }
                if (err.code === 'ENOENT') {
                    // Fallback to index.html for SPA routes
                    fs.readFile(path.join(baseDir, 'index.html'), (e, indexContent) => {
                        if (e) {
                            res.writeHead(500);
                            res.end('Server Error loading index.html');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                            res.end(indexContent, 'utf-8');
                        }
                    });
                } else {
                    res.writeHead(500);
                    res.end(`Server Error: ${err.code}`);
                }
            } else {
                res.writeHead(200, {
                    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(content, 'utf-8');
            }
        });
    };

    if (req.body !== undefined) {
        return await processRequest();
    }

    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
        if (bodyData) {
            try { req.body = JSON.parse(bodyData); } catch (e) { req.body = bodyData; }
        }
        await processRequest();
    });
};

const server = http.createServer(handler);

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(` 🚀 Full-Stack Household Expense Server Running Live!`);
        console.log(` 🌐 Server URL: http://localhost:${PORT}`);
        console.log(` 🔒 Security: Server-Side Auth & Validation Enabled`);
        console.log(` 📲 Closed-App Mobile Push Notifications: Enabled`);
        console.log(`=======================================================`);

        // Closed-App Scheduled Push Reminders Background Worker (Runs every 4 hours)
        setInterval(async () => {
            try {
                if (notificationsHandler.checkAndSendScheduledReminders) {
                    await notificationsHandler.checkAndSendScheduledReminders();
                }
            } catch (e) {
                console.warn('Scheduled push reminders background error:', e.message);
            }
        }, 4 * 60 * 60 * 1000);
    });
}

module.exports = handler;
module.exports.default = handler;
