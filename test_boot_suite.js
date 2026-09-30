// Boot suite: the serverless entry points must always load and export a
// handler, whatever the environment looks like.
//
// This exists because a startup `throw` for a missing JWT_SECRET ran at
// require() time and killed the Vercel function before module.exports was
// assigned. The platform reported:
//
//     No exports found in module "/var/task/index.cjs".
//     Node.js process exited with exit status: 1
//
// and every route - including "/" and static assets - returned 500 with nothing
// pointing at the real cause. Configuration problems must degrade to a clear
// error on the affected endpoint, never to a module that fails to load.
const { execFileSync } = require('child_process');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        console.log(`  ✅ PASS: ${msg}`);
        passed++;
    } else {
        console.log(`  ❌ FAIL: ${msg}`);
        failed++;
    }
}

const REPO = __dirname;

// Load an entry point in a clean child process and report what it exported.
function loadEntry(entry, env) {
    const script = `
        const m = require(${JSON.stringify(path.join(REPO, entry))});
        const t = typeof (m && m.default ? m.default : m);
        process.stdout.write('EXPORT_TYPE=' + t);
    `;
    try {
        const out = execFileSync(process.execPath, ['-e', script], {
            cwd: REPO,
            env: { ...process.env, ...env },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const m = /EXPORT_TYPE=(\w+)/.exec(out);
        return { ok: true, exportType: m ? m[1] : null };
    } catch (err) {
        return {
            ok: false,
            status: err.status,
            stderr: String(err.stderr || '').trim().split('\n').slice(-3).join(' | ')
        };
    }
}

// Each case clears JWT_SECRET explicitly so the parent environment cannot mask
// the very condition being tested.
const ENVIRONMENTS = [
    {
        name: 'production with no JWT_SECRET (the Vercel failure)',
        env: { NODE_ENV: 'production', JWT_SECRET: '', VERCEL: '' }
    },
    {
        name: 'production with the old hardcoded JWT_SECRET',
        env: {
            NODE_ENV: 'production',
            JWT_SECRET: 'household_secret_token_signing_key_2026_luxury_secure',
            VERCEL: ''
        }
    },
    {
        name: 'production with a too-short JWT_SECRET',
        env: { NODE_ENV: 'production', JWT_SECRET: 'short', VERCEL: '' }
    },
    {
        name: 'a Vercel environment with no JWT_SECRET',
        env: { NODE_ENV: '', JWT_SECRET: '', VERCEL: '1' }
    },
    {
        name: 'production with a valid JWT_SECRET',
        env: {
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            VERCEL: ''
        }
    },
    {
        name: 'local development with nothing set',
        env: { NODE_ENV: '', JWT_SECRET: '', VERCEL: '' }
    }
];

function run() {
    console.log('====================================================');
    console.log('🚀 Serverless Boot Suite');
    console.log('====================================================\n');

    for (const entry of ['index.js', 'server.js']) {
        console.log(`--- ${entry} ---`);
        for (const { name, env } of ENVIRONMENTS) {
            const res = loadEntry(entry, env);
            if (!res.ok) {
                assert(false,
                    `${entry} loads in ${name} (exited ${res.status}: ${res.stderr})`);
                continue;
            }
            assert(res.exportType === 'function',
                `${entry} exports a handler in ${name} (got ${res.exportType})`);
        }
        console.log('');
    }

    // The api/* routes are their own serverless functions on Vercel and must
    // survive the same conditions.
    console.log('--- api/* route modules, production with no JWT_SECRET ---');
    const apiEnv = { NODE_ENV: 'production', JWT_SECRET: '', VERCEL: '' };
    for (const mod of ['auth', 'expenses', 'config', 'attendance', 'audit',
                       'backup', 'notifications', 'receipts', 'migrate']) {
        const res = loadEntry(path.join('api', `${mod}.js`), apiEnv);
        assert(res.ok && res.exportType === 'function',
            `api/${mod}.js exports a handler (${res.ok ? res.exportType : 'failed to load: ' + res.stderr})`);
    }

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    if (failed > 0) process.exit(1);
}

run();
