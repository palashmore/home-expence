// Central path + environment resolution for every storage layer.
//
// Every module that touches persisted state must get its directories from here.
// Hardcoding `path.join(__dirname, '..', 'data')` makes the app untestable: a test
// run would mutate the real household data and PATCH the live public Gist.
//
// Environment overrides:
//   HOMEEXPENSES_DATA_DIR  - repo-level data directory (default: <repo>/data)
//   HOMEEXPENSES_TMP_DIR   - writable overlay used on serverless (default: <os tmp>/homeexpenses_data)
//   CLOUD_SYNC_DISABLED=1  - never read from or write to the GitHub Gist
const path = require('path');
const os = require('os');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_TMP_DIR = path.join(os.tmpdir(), 'homeexpenses_data');

function resolveDir(envValue, fallback) {
    if (typeof envValue === 'string' && envValue.trim()) {
        return path.resolve(envValue.trim());
    }
    return fallback;
}

const DATA_DIR = resolveDir(process.env.HOMEEXPENSES_DATA_DIR, DEFAULT_DATA_DIR);
const TMP_DIR = resolveDir(process.env.HOMEEXPENSES_TMP_DIR, DEFAULT_TMP_DIR);

// Truthy for "1", "true", "yes" (any case). Anything else leaves sync enabled.
function isCloudSyncDisabled() {
    const raw = process.env.CLOUD_SYNC_DISABLED;
    if (raw === undefined || raw === null) return false;
    return /^(1|true|yes)$/i.test(String(raw).trim());
}

module.exports = {
    DATA_DIR,
    TMP_DIR,
    HOUSEHOLDS_DIR: path.join(DATA_DIR, 'households'),
    TMP_HOUSEHOLDS_DIR: path.join(TMP_DIR, 'households'),
    USERS_FILE: path.join(DATA_DIR, 'users.json'),
    HOUSEHOLDS_FILE: path.join(DATA_DIR, 'households.json'),
    TMP_USERS_FILE: path.join(TMP_DIR, 'users.json'),
    TMP_HOUSEHOLDS_FILE: path.join(TMP_DIR, 'households.json'),
    isCloudSyncDisabled
};
