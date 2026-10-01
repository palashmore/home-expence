#!/usr/bin/env node
/**
 * Seed the GitHub Gist that backs cloud sync, straight from this repo's data/.
 *
 * The token is read from the environment and never printed, never written to
 * disk, and never sent anywhere except api.github.com.
 *
 *   PowerShell:
 *     $env:GITHUB_TOKEN = "<your token>"
 *     $env:GIST_ID      = "<your gist id>"
 *     node scripts/upload_gist_seed.js
 *
 *   Add --dry-run to see exactly what would be sent without uploading.
 *
 * Why these filenames: cloud sync mirrors every write to data/<filename>, so the
 * directory snapshots deliberately use directory_*.json. Naming them users.json
 * or households.json would overwrite the real directory files with a wrapper
 * object and break the app.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DATA = path.join(REPO, 'data');
const dryRun = process.argv.includes('--dry-run');

// gist filename -> how to build its contents
const FILES = {
    'expenses.json':             () => passthrough('expenses.json', []),
    'config.json':               () => passthrough('config.json', {}),
    'staff_attendance.json':     () => passthrough('staff_attendance.json', {}),
    'audit_log.json':            () => passthrough('audit_log.json', []),
    'push_subscriptions.json':   () => passthrough('push_subscriptions.json', []),
    'directory_users.json':      () => snapshot('users.json', 'users'),
    'directory_households.json': () => snapshot('households.json', 'households')
};

function readLocal(name, fallback) {
    const p = path.join(DATA, name);
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        throw new Error(`data/${name} is not valid JSON: ${e.message}`);
    }
}

function passthrough(name, fallback) {
    return readLocal(name, fallback);
}

// The directory files are versioned snapshots: { updatedAt, users|households }.
function snapshot(sourceName, key) {
    const list = readLocal(sourceName, []);
    if (!Array.isArray(list)) {
        throw new Error(`data/${sourceName} should be an array`);
    }
    return { updatedAt: new Date().toISOString(), [key]: list };
}

function describe(name, value) {
    if (Array.isArray(value)) return `${value.length} records`;
    if (value && Array.isArray(value.users)) return `${value.users.length} users`;
    if (value && Array.isArray(value.households)) return `${value.households.length} households`;
    if (value && typeof value === 'object') return `${Object.keys(value).length} keys`;
    return typeof value;
}

async function main() {
    const token = (process.env.GITHUB_TOKEN || process.env.GIST_TOKEN || '').trim();
    const gistId = (process.env.GIST_ID || '').trim();

    const missing = [];
    if (!token) missing.push('GITHUB_TOKEN');
    if (!gistId) missing.push('GIST_ID');
    if (missing.length && !dryRun) {
        console.error(`\nMissing: ${missing.join(' and ')}\n`);
        console.error('Set them in THIS terminal only - never paste a token into a chat,');
        console.error('a commit, or an issue:\n');
        console.error('  $env:GITHUB_TOKEN = "<token with the gist scope>"');
        console.error('  $env:GIST_ID      = "<the id from your gist URL>"');
        console.error('  node scripts/upload_gist_seed.js\n');
        process.exit(1);
    }

    const files = {};
    console.log('\nBuilding payload from data/ ...\n');
    for (const [name, build] of Object.entries(FILES)) {
        const value = build();
        files[name] = { content: JSON.stringify(value, null, 2) };
        const bytes = Buffer.byteLength(files[name].content, 'utf8');
        console.log(`  ${name.padEnd(28)} ${String(describe(name, value)).padEnd(18)} ${bytes} bytes`);
    }

    if (dryRun) {
        console.log('\n--dry-run: nothing was uploaded.\n');
        return;
    }

    console.log(`\nUploading to gist ${gistId.slice(0, 8)}... `);

    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'GharKhata-Seed',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files })
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`\nUpload failed: HTTP ${res.status}`);
        if (res.status === 401) console.error('The token was rejected. Is it valid, and does it have the gist scope?');
        if (res.status === 404) console.error('Gist not found. Check GIST_ID, and that the token owns that gist.');
        if (res.status === 403) console.error('Forbidden. A fine-grained token needs Account permissions -> Gists: Read and write.');
        console.error(body.slice(0, 300));
        process.exit(1);
    }

    // Read back and confirm, rather than trusting the write.
    const check = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'GharKhata-Seed'
        }
    });
    const gist = await check.json();
    const present = Object.keys(gist.files || {});

    console.log('\nVerifying what the gist now holds:\n');
    let ok = true;
    for (const name of Object.keys(FILES)) {
        const hit = present.includes(name);
        if (!hit) ok = false;
        console.log(`  ${hit ? 'OK  ' : 'MISS'} ${name}`);
    }

    const extra = present.filter(n => !(n in FILES));
    if (extra.length) console.log(`\n  (also in the gist, untouched: ${extra.join(', ')})`);

    console.log(`\n  visibility: ${gist.public ? 'PUBLIC  <-- make this secret!' : 'secret'}`);
    console.log(`  url       : ${gist.html_url}\n`);
    console.log(ok ? 'RESULT: gist seeded successfully.\n' : 'RESULT: some files are missing - see above.\n');
    if (!ok) process.exit(1);
}

main().catch((e) => {
    console.error('\nUpload error:', e.message, '\n');
    process.exit(1);
});
