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

    // ------------------------------------------------------------------
    // Every asset the manifest and the HTML point at must actually ship.
    //
    // A missing static file does not 404 here - the server falls back to
    // index.html - so a broken icon returns HTTP 200 with text/html and looks
    // fine until something like PWABuilder checks the content type. That is how
    // icon-maskable-512.png, favicon.ico and og-image.png shipped referenced but
    // absent: they were added to server.js but not to vercel.json's includeFiles,
    // which is what decides the serverless bundle.
    // ------------------------------------------------------------------
    console.log('\n--- declared assets are on disk and bundled for deploy ---');
    const fs = require('fs');
    const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

    const manifest = JSON.parse(read('manifest.json'));
    const serverSrc = read('server.js');
    const vercelSrc = read('vercel.json');
    const indexSrc = read('index.html');

    const declared = new Set();
    for (const icon of manifest.icons || []) {
        declared.add(String(icon.src).replace(/^\//, ''));
    }
    // Anything index.html references from the site root...
    for (const m of indexSrc.matchAll(/(?:href|content|src)="\/([\w.-]+\.(?:png|svg|ico|json))"/g)) {
        declared.add(m[1]);
    }
    // ...and anything it references by absolute URL, such as the og:image tag,
    // which is served from this same deployment.
    for (const m of indexSrc.matchAll(/(?:href|content|src)="https?:\/\/[^"]*?\/([\w.-]+\.(?:png|svg|ico|json))"/g)) {
        declared.add(m[1]);
    }

    for (const asset of [...declared].sort()) {
        assert(fs.existsSync(path.join(REPO, asset)),
            `${asset} exists in the repo`);
        assert(serverSrc.includes(`'${asset}'`),
            `${asset} is in the server.js staticFiles list`);
        assert(vercelSrc.includes(asset),
            `${asset} is in vercel.json includeFiles (otherwise it 404s on Vercel)`);
    }

    // ------------------------------------------------------------------
    // Creating a household must work when the repo's data/ directory cannot be
    // written to, which is the case on every serverless host. This reproduces:
    //   Household creation failed: ENOENT: no such file or directory,
    //   mkdir '/var/task/data/households/H003'
    // by putting a FILE where the households directory belongs, so the
    // repo-side mkdir fails exactly as it does on a read-only filesystem while
    // the writable /tmp overlay still works.
    // ------------------------------------------------------------------
    console.log('\n--- household creation survives a read-only data directory ---');
    {
        const os = require('os');
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'he_ro_'));
        const dataDir = path.join(scratch, 'data');
        const tmpDir = path.join(scratch, 'tmp');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.mkdirSync(tmpDir, { recursive: true });

        for (const f of ['households.json', 'users.json']) {
            fs.copyFileSync(path.join(REPO, 'data', f), path.join(dataDir, f));
        }
        // A file, not a directory: the repo-side mkdir cannot succeed.
        fs.writeFileSync(path.join(dataDir, 'households'), 'not a directory', 'utf8');

        const script = `
            const storage = require(${JSON.stringify(path.join(REPO, 'api', '_storage.js'))});
            const before = storage.getAllHouseholds().length;
            const h = storage.createHousehold({ householdName: 'ReadOnly QA', initialBudget: 64250 }, 'test');
            const after = storage.getAllHouseholds().length;
            process.stdout.write(JSON.stringify({ id: h.householdId, name: h.householdName, before, after }));
        `;
        let result = null;
        let crash = null;
        try {
            const out = execFileSync(process.execPath, ['-e', script], {
                cwd: REPO,
                env: {
                    ...process.env,
                    HOMEEXPENSES_DATA_DIR: dataDir,
                    HOMEEXPENSES_TMP_DIR: tmpDir,
                    CLOUD_SYNC_DISABLED: '1',
                    NODE_ENV: 'test'
                },
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe']
            });
            result = JSON.parse(out.slice(out.indexOf('{')));
        } catch (err) {
            crash = String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | ');
        }

        assert(crash === null,
            `createHousehold does not throw when data/ is unwritable (${crash || 'no error'})`);
        if (result) {
            assert(/^H\d{3}$/.test(result.id),
                `a new household id was allocated (got ${result.id})`);
            assert(result.name === 'ReadOnly QA',
                `the household name is stored (got ${result.name})`);
            assert(result.after === result.before + 1,
                `the household list grew by one (${result.before} -> ${result.after})`);
            const cfgPath = path.join(tmpDir, 'households', result.id, 'config.json');
            assert(fs.existsSync(cfgPath),
                'the household config was written to the tmp overlay');
            if (fs.existsSync(cfgPath)) {
                const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                assert(cfg.monthlyBudgetLimit === 64250,
                    `the starting budget is stored exactly (got ${cfg.monthlyBudgetLimit})`);
            }
        }

        fs.rmSync(scratch, { recursive: true, force: true });
    }

    console.log('\n====================================================');
    console.log(`📊 Test Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
    if (failed > 0) process.exit(1);
}

run();
