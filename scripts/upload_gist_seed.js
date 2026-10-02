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

// Everything lives in ONE Gist file. See api/_cloud_store.js for the shape:
//   { updatedAt, users, households, pushSubscriptions, data: { H001: {...}, H002: {...} } }
const STORE_FILE = 'gharkhata.json';

function buildStore() {
    const households = readLocalSafe('households.json', []) || [];
    const doc = {
        updatedAt: new Date().toISOString(),
        users: readLocalSafe('users.json', []) || [],
        households: households,
        pushSubscriptions: readLocalSafe('push_subscriptions.json', []) || [],
        data: {}
    };

    const ids = new Set(['H001', ...households.map(h => h && h.householdId).filter(Boolean)]);
    for (const id of ids) {
        doc.data[id] = {
            config: id === 'H001'
                ? (readLocalSafe('config.json', {}) || perHousehold(id, 'config.json', {}))
                : perHousehold(id, 'config.json', {}),
            expenses: id === 'H001'
                ? (readLocalSafe('expenses.json', []) || [])
                : perHousehold(id, 'expenses.json', []),
            attendance: id === 'H001'
                ? (readLocalSafe('staff_attendance.json', {}) || {})
                : perHousehold(id, 'attendance.json', {}),
            auditLog: id === 'H001'
                ? (readLocalSafe('audit_log.json', []) || [])
                : perHousehold(id, 'audit_log.json', [])
        };
    }
    return doc;
}

const FILES = { [STORE_FILE]: buildStore };

function readLocalSafe(name, fallback) {
    try {
        return readLocal(name, fallback);
    } catch (e) {
        return fallback;
    }
}

function perHousehold(id, name, fallback) {
    const p = path.join(DATA, 'households', id, name);
    if (!fs.existsSync(p)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

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
    if (value && value.data && value.users) {
        const households = Object.keys(value.data);
        return `${value.users.length} users, ${households.length} households (${households.join(', ')})`;
    }
    if (Array.isArray(value)) return `${value.length} records`;
    if (value && Array.isArray(value.users)) return `${value.users.length} users`;
    if (value && Array.isArray(value.households)) return `${value.households.length} households`;
    if (value && typeof value === 'object') return `${Object.keys(value).length} keys`;
    return typeof value;
}

async function main() {
    // This builds the document from the LOCAL data/ directory, which is a
    // development seed - it is usually older and smaller than what the live
    // Gist holds. Uploading it over a populated Gist destroys data. The safe
    // path for an existing deployment is:
    //
    //   node scripts/build_gharkhata.js <folder-of-exported-gist-files> gharkhata.json
    //   node scripts/upload_gharkhata.js gharkhata.json
    //
    // which validates and refuses to shrink any record count.
    if (!process.argv.includes('--dry-run') && !process.argv.includes('--i-know-this-overwrites')) {
        console.error('');
        console.error('This seeds the Gist from the LOCAL data/ directory and will OVERWRITE');
        console.error('whatever is in the Gist, including newer data.');
        console.error('');
        console.error('For an existing deployment use instead:');
        console.error('  node scripts/build_gharkhata.js <exported-gist-folder> gharkhata.json');
        console.error('  node scripts/upload_gharkhata.js gharkhata.json');
        console.error('');
        console.error('To seed a brand new, empty Gist anyway:');
        console.error('  node scripts/upload_gist_seed.js --i-know-this-overwrites');
        console.error('');
        process.exit(1);
    }

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
