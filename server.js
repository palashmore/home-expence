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

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Helper: Parse JSON Body for API requests
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    
    req.on('end', async () => {
        if (bodyData) {
            try { req.body = JSON.parse(bodyData); } catch (e) { req.body = bodyData; }
        }
        req.query = parsedUrl.query;

        // Mock Serverless Response object methods for local execution
        res.status = function(code) {
            res.statusCode = code;
            return res;
        };
        res.json = function(data) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
        };

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

        // Serve Static Files
        const baseDir = fs.existsSync(path.join(process.cwd(), 'index.html')) ? process.cwd() : __dirname;
        let filePath = path.join(baseDir, pathname === '/' ? 'index.html' : pathname);
        const ext = path.extname(filePath).toLowerCase();

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    // Fallback to index.html for SPA routes
                    fs.readFile(path.join(baseDir, 'index.html'), (e, indexContent) => {
                        if (e) {
                            res.writeHead(500);
                            res.end('Server Error loading index.html');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html' });
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
    });
});

server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` 🚀 Full-Stack Household Expense Server Running Live!`);
    console.log(` 🌐 Server URL: http://localhost:${PORT}`);
    console.log(` 🔒 Security: Server-Side Auth & Validation Enabled`);
    console.log(`=======================================================`);
});

module.exports = server;
