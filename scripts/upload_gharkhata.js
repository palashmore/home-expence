#!/usr/bin/env node
/**
 * Upload an already-built gharkhata.json to the Gist.
 *
 *   $env:GITHUB_TOKEN = "<token with the gist scope>"
 *   $env:GIST_ID      = "<the id from your gist URL>"
 *   node scripts/upload_gharkhata.js <path-to-gharkhata.json>
 *
 * Safety, because this overwrites live data:
 *   - the file is validated before anything is sent
 *   - the Gist's current contents are fetched and compared first
 *   - the upload is REFUSED if it would reduce any record count, unless --force
 *   - the old per-file documents are never touched or deleted
 *   - the Gist is read back afterwards to confirm what landed
 *
 * The token is read from the environment, never printed, never written to disk.
 */
const fs = require('fs');
const path = require('path');

const STORE_FILE = 'gharkhata.json';
const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const filePath = args.find(a => !a.startsWith('--'));

if (!filePath) {
    console.error('usage: node scripts/upload_gharkhata.js <path-to-gharkhata.json> [--dry-run] [--force]');
    process.exit(1);
}

function readDoc(p) {
    if (!fs.existsSync(p)) throw new Error(`not found: ${p}`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Counts that matter, so a shrink is obvious before anything is overwritten.
function summarise(doc) {
    const out = {
        users: (doc.users || []).length,
        households: (doc.households || []).length,
        pushSubscriptions: (doc.pushSubscriptions || []).length,
        perHousehold: {}
    };
    for (const [id, slice] of Object.entries(doc.data || {})) {
        out.perHousehold[id] = {
            members: (slice.users || []).length,
            expenses: (slice.expenses || []).length,
            auditLog: (slice.auditLog || []).length,
            staff: ((slice.attendance || {}).staff || []).length,
            records: ((slice.attendance || {}).records || []).length
        };
    }
    return out;
}

function printSummary(label, s) {
    console.log(`\n${label}`);
    console.log(`  users ${s.users} | households ${s.households} | pushSubscriptions ${s.pushSubscriptions}`);
    for (const id of Object.keys(s.perHousehold).sort()) {
        const h = s.perHousehold[id];
        console.log(`    ${id}: members ${h.members}, expenses ${h.expenses}, ` +
                    `audit ${h.auditLog}, staff ${h.staff}, records ${h.records}`);
    }
}

// Anything the upload would make smaller is reported as a shrink.
function shrinks(before, after) {
    const losses = [];
    for (const k of ['users', 'households', 'pushSubscriptions']) {
        if (after[k] < before[k]) losses.push(`${k}: ${before[k]} -> ${after[k]}`);
    }
    for (const [id, h] of Object.entries(before.perHousehold)) {
        const a = after.perHousehold[id];
        if (!a) { losses.push(`household ${id} would disappear entirely`); continue; }
        for (const k of Object.keys(h)) {
            if (a[k] < h[k]) losses.push(`${id}.${k}: ${h[k]} -> ${a[k]}`);
        }
    }
    return losses;
}

async function gist(method, token, gistId, body) {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'GharKhata-Upload',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    return res;
}

(async () => {
    const doc = readDoc(path.resolve(filePath));

    // Validate with the same rules the application uses.
    const store = require('../api/_cloud_store.js');
    const problems = store.validateStore(doc);
    if (problems.length) {
        console.error('\nThis file does not validate, so nothing was uploaded:');
        for (const p of problems) console.error('  - ' + p);
        process.exit(1);
    }

    const incoming = summarise(doc);
    printSummary(`Local file: ${filePath}`, incoming);
    console.log(`  size: ${(fs.statSync(filePath).size / 1024).toFixed(0)} KB, validates cleanly`);

    const token = (process.env.GITHUB_TOKEN || process.env.GIST_TOKEN || '').trim();
    const gistId = (process.env.GIST_ID || '').trim();

    if (dryRun) {
        console.log('\n--dry-run: nothing was uploaded.\n');
        return;
    }
    if (!token || !gistId) {
        const missing = [!token && 'GITHUB_TOKEN', !gistId && 'GIST_ID'].filter(Boolean);
        console.error(`\nMissing: ${missing.join(' and ')}`);
        console.error('\nSet them in THIS terminal only - never paste a token into a chat:\n');
        console.error('  $env:GITHUB_TOKEN = "<token with the gist scope>"');
        console.error('  $env:GIST_ID      = "<the id from your gist URL>"');
        console.error(`  node scripts/upload_gharkhata.js ${filePath}\n`);
        process.exit(1);
    }

    // What is up there right now?
    const current = await gist('GET', token, gistId);
    if (!current.ok) {
        console.error(`\nCould not read the gist: HTTP ${current.status}`);
        if (current.status === 401) console.error('The token was rejected. Is it valid, with the gist scope?');
        if (current.status === 404) console.error('Gist not found. Check GIST_ID, and that the token owns it.');
        if (current.status === 403) console.error('Forbidden. A fine-grained token needs Account permissions -> Gists: Read and write.');
        process.exit(1);
    }
    const gistJson = await current.json();
    const existingFiles = Object.keys(gistJson.files || {});
    console.log(`\nGist currently holds: ${existingFiles.join(', ')}`);
    console.log(`  visibility: ${gistJson.public ? 'PUBLIC  <-- make this secret!' : 'secret'}`);

    if (existingFiles.includes(STORE_FILE)) {
        let live = null;
        try {
            const f = gistJson.files[STORE_FILE];
            const raw = f.truncated
                ? await (await fetch(f.raw_url, { headers: { 'User-Agent': 'GharKhata-Upload' } })).text()
                : f.content;
            live = JSON.parse(raw);
        } catch (e) {
            console.log(`  (could not parse the existing ${STORE_FILE}: ${e.message})`);
        }

        if (live) {
            const before = summarise(live);
            printSummary(`Already in the gist (${STORE_FILE}):`, before);
            const losses = shrinks(before, incoming);
            if (losses.length) {
                console.error('\nREFUSING TO UPLOAD - this would lose data:');
                for (const l of losses) console.error('  - ' + l);
                console.error('\nThe gist already holds more than the file you are uploading.');
                console.error('Re-export the gist and rebuild, or pass --force only if you are');
                console.error('certain the local file is the one you want to keep.\n');
                if (!force) process.exit(1);
                console.error('--force given: continuing anyway.\n');
            } else {
                console.log('\n  No record count would shrink.');
            }
        }
    } else {
        console.log(`  ${STORE_FILE} is not there yet - this will create it.`);
    }

    console.log(`\nUploading ${STORE_FILE} ...`);
    const res = await gist('PATCH', token, gistId, {
        files: { [STORE_FILE]: { content: JSON.stringify(doc, null, 2) } }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`\nUpload failed: HTTP ${res.status}\n${body.slice(0, 300)}`);
        process.exit(1);
    }

    // Read it back rather than trusting the write.
    const check = await gist('GET', token, gistId);
    const after = await check.json();
    const names = Object.keys(after.files || {});
    let landed = null;
    try {
        const f = after.files[STORE_FILE];
        const raw = f.truncated
            ? await (await fetch(f.raw_url, { headers: { 'User-Agent': 'GharKhata-Upload' } })).text()
            : f.content;
        landed = JSON.parse(raw);
    } catch (e) { /* reported below */ }

    console.log('\nVerifying what the gist now holds:');
    console.log(`  files: ${names.join(', ')}`);
    if (!landed) {
        console.error(`  Could not read ${STORE_FILE} back. Check the gist manually.`);
        process.exit(1);
    }
    const got = summarise(landed);
    printSummary('  Uploaded document:', got);

    const mismatch = shrinks(incoming, got);
    if (mismatch.length) {
        console.error('\n  What landed does not match what was sent:');
        for (const m of mismatch) console.error('    - ' + m);
        process.exit(1);
    }

    const keptOldFiles = names.filter(n => n !== STORE_FILE);
    console.log(`\n  Old files left untouched: ${keptOldFiles.join(', ') || '(none)'}`);
    console.log(`  url: ${after.html_url}`);
    console.log('\nRESULT: uploaded and verified.\n');
})().catch((e) => {
    console.error('\nUpload error:', e.message, '\n');
    process.exit(1);
});
