# HOME EXPENCE: Project Context

Purpose of this file: give a human or an AI assistant (GitHub Copilot, Claude) the full picture of this repo so it can
work safely. Facts below come from reading the code at commit `eb8809f`
(and the security patch `e846fe3` where marked **[after patch]**). Anything I could not confirm is marked **(unverified)**.

> **Status of this checkout (verified 2026-09-30):** the working tree is at `eb8809f` on branch `fix/security-hardening`.
> Commit `e846fe3` is **not present in this repository**, and none of the files it introduces exist here
> (`test_security_suite.js`, `test_ui_smoke.py`, `run_tests.sh`, `run_ui_tests.sh`, `reset_password.js`).
> Treat every **[after patch]** item below as *not yet applied locally* — it describes the target state, not this one.

---

## 1. What this is

A household finance web app (PWA) for Indian households (amounts in INR). Features:

- Expense ledger (add, edit, delete, search, filter, receipts, Excel import/export)
- Dashboard with budget, charts, due-bill radar ("Recurring Bill Radar")
- Personal (per-person) view
- Domestic staff payroll: attendance calendar, paid-leave quota, salary deductions, WhatsApp voucher
- Reimbursement / settle-up matrix (Splitwise style)
- Master settings (categories, family members, payment methods, staff, recurring bills, budget)
- Audit log, backup/restore snapshots
- Multi-household ("tenant") isolation with roles
- Push notifications (web-push) and in-app notifications

Live site: `https://home-expence-pink.vercel.app/`
Repo: `github.com/palashmore/home-expence` (legacy repo: `palashmore/homeexpenses`)

---

## 2. Tech stack

| Area | Choice |
|---|---|
| Backend | Plain Node.js `http` server (`server.js`), no Express. API files in `api/` are Vercel-style handlers `(req, res)` |
| Frontend | One `index.html` + two large vanilla JS files (`tracker_app.js`, `advance_modules.js`), no build step, no framework |
| Styling | Tailwind **Play CDN** (`cdn.tailwindcss.com`) + `styles.css`; Font Awesome 6.5 from cdnjs |
| Libraries (CDN) | Chart.js (unpinned, jsdelivr), SheetJS `xlsx@0.18.5` (jsdelivr) |
| Hosting | Vercel (`vercel.json` routes every request to `server.js`) |
| Storage | JSON files (see section 5), optional GitHub Gist sync |
| npm deps | `cookie`, `dotenv`, `googleapis`, `jsonwebtoken`, `web-push`, `xlsx` (note: `jsonwebtoken` and `cookie` appear unused: auth uses Node `crypto`) |
| Tests | Node scripts + Playwright (Python) **[after patch]** |

Size: about 19,000 lines. `advance_modules.js` 4,755, `tracker_app.js` 4,652, `index.html` 3,668, `api/_storage.js` 1,046.

---

## 3. Run it

```bash
npm install
node server.js          # http://localhost:8000  (PORT env overrides)
```

**[after patch]**
```bash
bash ./run_tests.sh     # API suites, each on its own server and data copy (needs port 8000 free)
./run_ui_tests.sh       # browser tests (needs Python + Playwright + local Tailwind build in /tmp/uitools)
node reset_password.js <username> "<new password, 8+ chars>"
```

Windows: use **Git Bash** for `.sh` files. PowerShell does not support `&&` (older versions) and has no `bash`.

Default seed logins (before you rotate them): `admin`, `palash`, `pallavi`, `sanjay`. Their passwords follow a
guessable pattern and appear in test files, so **change them** with `reset_password.js`.

---

## 4. Repo map

```
server.js                 Static file server + router to api/*. Preloads static files, mock res.status/res.json
index.html                The whole UI markup: 8 tab containers, modals, login modal, mobile bottom nav (#mobileBottomNav)
tracker_app.js            Core app: session, expense CRUD, dashboard, filters, offline queue, sync, admin console, theme
advance_modules.js        Advanced modules: master config UI, payroll/attendance, recurring bill radar, audit viewer,
                          notifications center, duplicate detection, personal view, reports/PDF
styles.css                Custom CSS (glass nav, modals, safe-area padding)
sw.js                     Service worker (cache name homeexpenses-v11)
manifest.json, icon*.png  PWA assets
api/
  auth.js                 Login/logout/verify, users, households, sessions (HMAC token), RBAC helpers
  expenses.js             GET/POST/PUT/DELETE expenses (household-scoped), push notify on change
  config.js               GET/POST/PUT master config; normalization of amounts
  attendance.js           Staff attendance GET/POST
  audit.js                Audit log GET (json / report formats)
  backup.js               Snapshot create/list/restore
  notifications.js        Web-push subscribe/unsubscribe, in-app list/dismiss, scheduled due-bill reminders
  receipts.js             Receipt upload/fetch
  migrate.js              Batch migrate expenses (uses _db.js)
  _storage.js             THE data layer: households, users, expenses, config, attendance, audit, receipts
  _cloud_sync.js          GitHub Gist sync (read/write) + disk/tmp fallbacks
  _db.js                  Legacy flat-file expense reader/writer (used by notifications + migrate)
data/
  users.json              All users (scrypt password hashes)
  households.json         Household registry
  expenses.json           Legacy H001 ledger copy (root level)
  config.json, audit_log.json, staff_attendance.json   Legacy root copies
  households/H001|H002/   Per-household: expenses.json, config.json, attendance.json, audit_log.json, notifications.json, receipts/
  vapid_keys.json         Push keys (removed from git by the patch; use env vars)
test_verification_suite.js, test_master_settings_and_expenses.js   Original API tests
test_security_suite.js, test_ui_smoke.py, run_tests.sh, run_ui_tests.sh, reset_password.js   [after patch]
import_excel_to_seed.js, sync_to_google_sheet.js, schema.sql, initial_expenses.json   Old tooling, excluded from Vercel
FEATURES_*.md, IMPLEMENTATION_PLAN.md, OLD_VS_NEW_FEATURES_COMPARISON.md   Earlier planning docs
```

---

## 5. Architecture you must understand before editing

### 5.1 Request flow
Browser `fetch('/api/...')` with `Authorization: Bearer <token>` (or the `household_session` cookie)
→ `server.js` → `api/<name>.js` handler → `api/_storage.js` → files.

Every API handler first calls `authenticateRequest(req)` and takes `householdId` from the **session**, never from the client.
Only `ADMIN` / `SYSTEM_ADMIN` may pass a different `householdId`.

### 5.2 Storage layers (important: easy to get wrong)
`_storage.js` uses three layers:

1. **In-memory** `memoryStore` (per process)
2. **/tmp overlay**: `os.tmpdir()/homeexpenses_data` (override with `HOMEEXPENSES_TMP_DIR`). **Reads check the overlay FIRST**
3. **Repo files** in `data/`

- **Writes** always go to the overlay, and also to `data/` if the disk is writable.
- On **Vercel the repo disk is read-only and `/tmp` is per-instance and temporary** (unverified on your deployment, but this is how
  the code behaves). Data not backed up elsewhere can vanish on a cold start or differ between instances.
- **H001 only** is also synced to a **GitHub Gist** (`api/_cloud_sync.js`, default `GIST_ID` is hardcoded there). Reads need no token.
  The live ledger therefore lives in that gist and was at least **125 records** when checked, versus **122** in the repo (₹156,761.33).
  Writes need `GITHUB_TOKEN` or `GIST_TOKEN`. Set `CLOUD_SYNC_DISABLED=1` to turn all gist traffic off (tests do this).
- Because of the overlay-first read, a stale overlay can hide a change you made in `data/*.json` on the same machine.

**Recommendation:** move to a real database (Vercel KV / Supabase / Mongo; `.env.example` already mentions them).

### 5.3 Multi-tenancy
- Household ids: `H001`, `H002`, ... (next id = highest + 1). `SYSTEM` is a pseudo-household for the system admin (no expenses).
- User ids: `U000` (admin), `U001`, ... Users belong to exactly one household.
- Every expense/config/attendance/audit file is per household. Tenant isolation was tested: one household cannot read, edit or delete another's records.
- Client-supplied expense ids are allowed (offline queue needs them) and are namespaced per household.

### 5.4 Roles
`SYSTEM_ADMIN`/`ADMIN` (manage all households and users; no personal ledger), `OWNER` (manage own household, edit members),
`MEMBER` (read/write expenses), `VIEWER` (read only; 403 on create/edit/delete).
**Known weakness:** the role inside the session token is trusted until expiry (30 days), so a demoted user keeps the old role
until the token expires. Expenses and most routes use the token's role, not a fresh lookup.

### 5.5 Session token
`base64url(JSON payload) + "." + HMAC-SHA256(hex)` signed with `JWT_SECRET`. Payload: userId, username, name, householdId,
householdName, role, iat, exp (30 days). Sent as Bearer header, `x-auth-token` header, or HttpOnly cookie `household_session`.
**Known weakness:** the frontend also stores the token in `localStorage` (`household_auth_token`), so any XSS can steal it.

---

## 6. Data model (real samples)

**Expense** (`data/households/<id>/expenses.json`, array)
```json
{ "id":"exp-1790529345118-i75v", "date":"2026-09-27", "amount":480, "category":"Food Delivery",
  "paidBy":"Palash", "splitBetween":"Personal Expense (Palash)", "paidTo":"Zomato", "vendor":"Zomato",
  "paymentMethod":"UPI / GPay / PhonePe", "notes":"KFC", "description":"KFC", "billingCycle":"Standard",
  "receipt":null, "receiptStatus":"No Receipt", "createdAt":"...", "updatedAt":"...", "version":1 }
```
Deletes are **soft**: `isDeleted: true, deletedAt, deletedBy`. `version` is used for conflict detection (HTTP 409).
Active count = records without `isDeleted`. (`deleted` without "is" is NOT the flag.)

**Config** (`config.json`): `staff[]`, `categories[]`, `recurringBills[]`, `familyMembers[]`, `paymentMethods[]`,
`householdCycle{type,cycleStartDay,cycleEndDay,description}`, `monthlyBudgetLimit`, `splitRules[]`, `updatedAt`, `householdId`.
- category: `{ name, icon, type: "expense"|"income"|"transfer", defaultPaidTo }`
- recurring bill: `{ id, name, category, dueDay, approxAmount, budgetedAmount, icon }` (**numbers**, both fields kept equal)
- staff: `{ id, name, shortName, role, baseSalary, allowedPaidLeaves, billingCycleDay, cycleType, active }`

**Attendance** (`attendance.json`): `{ "<staff name>": { baseSalary, billingCycleDay, months: { "2026-09": { days: {"1":"P",...}, bonus, notes, updatedAt } } } }`

**User**: `userId, username, email, name, passwordHash ("salt:hash", scrypt), householdId, role, status ("active"|"disabled"), createdAt, updatedAt`
**Household**: `householdId, householdName, status, ownerUserId, memberUserIds[], createdAt, updatedAt`

**Audit entry**: `{ id, householdId, timestamp, action (string like CREATE_EXPENSE), recordId, actor, diff, snapshot }`.
Older entries written by household/user create/delete have an object in `action`; fixed for new entries **[after patch]**.

---

## 7. API reference

All under `/api/`. JSON in, JSON out. `401` no/invalid session, `403` not allowed, `422` validation, `409` version conflict.

| Route | Methods | Notes |
|---|---|---|
| `auth` | GET `?action=users\|admin_overview`, GET (verify), POST | POST `action`: `login, logout, verify, create_household, create_user, edit_household, delete_household, edit_user, delete_user, switch_household` (always 403) |
| `expenses` | GET (list or `?id=`), POST, PUT, DELETE (`?id=` or `/api/expenses/<id>`) | Household from session. Triggers push notification to other members |
| `config` | GET, POST, PUT | POST `action:"add_category"` supported. Amounts normalized |
| `attendance` | GET, POST | Staff attendance per month |
| `audit` | GET `?format=json` | Household audit log |
| `backup` | GET, POST, OPTIONS | POST `action`: `create_snapshot, list, restore, restore_snapshot` |
| `notifications` | GET, POST, OPTIONS | POST `action`: `subscribe, unsubscribe, vapid_key, list_in_app, dismiss, dismiss_all, check_and_send` |
| `receipts` | GET, POST | Receipt files per household |
| `migrate` | (batch migrate) | Uses `_db.js` |

**[after patch] validation rules:** expense amount 0.01 to 10,000,000; date year 2000 to +1 year; category required; any string
over 2000 chars rejected; `<` or `>` rejected in name-type fields and config; request body max 1 MB; money strings like
`₹2,800` accepted and stored as numbers, negatives and junk rejected (422).

---

## 8. Frontend structure

**Tabs** (`switchTab(name)`, containers `#tab-<name>` in `index.html`):
`dashboard`, `personal`, `expenses`, `staff` (payroll), `matrix` (reimbursement), `settings` (master settings), `admin`, `audit`.
Mobile: fixed bottom nav `#mobileBottomNav` (6 visible items at 390px), center Quick Add (+).

**Login:** modal `#loginModal`, form `#loginForm`, fields `#loginUsername`, `#loginPassword`, handler `handleLoginFormSubmit`.
No user list or quick-login buttons exist.

**Key functions:** `loadData` (fetch expenses), `renderAllViews`, `renderDashboard`, `renderCategoryPieChart`,
`switchTab`, `loadMasterConfig` / `window.masterConfig` (advance_modules), `loadAdminConsoleData`, `showToast`, `formatINR`,
`getAuthHeaders`, `getActiveHouseholdId`, `escapeHtml`, `neutralizeMarkup` **[after patch]**, `signOut`.

**Global state:** `expenses`, `window.expenses`, `window.expensesData`, `window.masterConfig`, `authToken`, `currentSessionUser`.

**localStorage keys:** `household_auth_token`, `household_session_user`, `homeexpenses_offline_queue`,
`household_expenses_online_cache`, `household_budget_limit_<householdId>`, `household_monthly_budget_limit`,
`household_app_theme`, `homeexpenses_staff_attendance`, `hideMobilePwaBanner`.

**Rendering rule (security):** the UI builds HTML with template strings and `innerHTML` (about 140 places). **Every user-supplied
string must go through `escapeHtml(...)`.** Inside `onclick="..."` use `escapeHtml(JSON.stringify(value))`.
Never interpolate notes, vendor, category, names, or payer raw.

---

## 9. Sync, offline and PWA (do not replace)

- API responses send `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`, `Expires: 0`.
- `sw.js`: `/api/*` is **network-only**; static assets are **network-first** with cache fallback.
- Cross-tab sync: `BroadcastChannel('homeexpenses_tx_sync')` (note: the actual name, not `homeexpenses_sync`).
- Refresh triggers: `visibilitychange`, window focus, and a background `setInterval` poll.
- Offline: writes queue in `localStorage["homeexpenses_offline_queue"]`; badge `#offlineQueueBadge`; replayed when online.
- Conflicts: `version` field, server returns 409 with the current record.
- Push: `web-push` with VAPID keys; `sw.js` handles `push` and `notificationclick`; scheduled reminders run every 4 hours
  from `server.js` (only on a long-running server, **not on Vercel serverless**).

---

## 10. Environment variables

| Variable | Needed | Purpose |
|---|---|---|
| `JWT_SECRET` | **Yes in production** (32+ chars) | Signs session tokens. **[after patch]** missing in production means sign-in returns 503 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Yes for push | Generate: `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `GIST_ID`, `GITHUB_TOKEN` / `GIST_TOKEN` | Only for gist sync | Gist id has a hardcoded default in `_cloud_sync.js`. Token enables writes |
| `CLOUD_SYNC_DISABLED=1` | Tests / local | Turns off all gist reads and writes |
| `HOMEEXPENSES_TMP_DIR` | Tests | Overrides the `/tmp` overlay directory |
| `PORT` | Optional | Default 8000 |
| `VERCEL`, `NODE_ENV` | Automatic | Production detection |

Never commit `.env`, tokens, or private keys.

---

## 11. Testing

- `test_verification_suite.js`: RBAC, tenancy, household creation, budget persistence, baseline (expects port 8000).
- `test_master_settings_and_expenses.js`: zero-cache headers, create/update/delete sync across users, viewer rules, baseline.
  Mints tokens in-process, so the test and server must share `JWT_SECRET` (the runner does this).
- **[after patch]** `test_security_suite.js` (87 checks): no backdoor logins, forged-token rejection, login throttle,
  static-file exposure, headers, validation, tenant isolation, markup rejection, money parsing, household/user creation, audit shape.
- **[after patch]** `test_ui_smoke.py` (34 checks): page loads without JS errors, no user-switch UI, script-injection payloads inert
  in every tab, admin view, no sideways scroll at 360 to 430 px wide.
- Baseline every test protects: **122 active expenses, total 156,761.33** in the repo data (live gist had 125+).
- Tests mutate data: always run via the runners, which use a scratch copy and never touch real files or the gist.

---

## 12. Security status

**Fixed by the patch (commit `e846fe3`):** removed hardcoded login passwords and signing secret; token no longer accepted in URL;
login lockout; static files allow-listed (`data/`, `.git`, source no longer downloadable); security headers; input validation;
script injection closed (server rejects markup, frontend neutralizes and escapes); audit entries normalized; `test_push` removed;
notification dismiss requires login; household/user name validation; password minimum 8.

**Still open:**
- Real passwords are weak defaults and users.json with hashes is in a public repo: rotate passwords, make the repo private.
- Expense ledger lives in a **readable GitHub Gist** (hardcoded id): move to a real database.
- Vercel persistence: writes go to `/tmp` (see 5.2): verify on the live site.
- Tokens in `localStorage`; role in token trusted for 30 days.
- No full Content-Security-Policy (inline scripts and CDN scripts need refactoring first). Tailwind Play CDN and unpinned Chart.js with no integrity hashes.
- `jsonwebtoken`, `cookie`, `googleapis` dependencies look unused.
- Mobile tap targets: 34 of 42 visible buttons on a 390 px phone are under 44x44 px.

---

## 13. Product backlog (from the master prompt; sections 1 to 34)

Not yet done: filter redesign (bottom-sheet filter on mobile, context-specific filters, remove duplicates), one primary navigation
(sidebar on desktop, compact bottom nav on mobile), notification center (Action Required / Upcoming / Resolved), mobile dashboard
order (snapshot, budget, attention, upcoming, cash flow, spending, payroll, recent), full-screen quick-add, admin user-management
round-trip tests, logout / back-button behavior, offline-queue and service-worker tests, Excel and PDF verification, payroll checks.
The prompt text was cut off at section 35 (Master Settings save transaction).

---

## 14. Rules for any AI assistant editing this repo

1. **Never modify or delete files in `data/`** unless the task is explicitly a data migration with backup, validate, compare.
2. Never reset expenses, users, or households; never change existing ids.
3. Do not replace the sync architecture (section 9). Do not add caching to `/api/*`.
4. Every user string rendered into HTML goes through `escapeHtml`. Never use raw `${item.notes}` style interpolation.
5. Household comes from the session on the server, never from the request body (except for admins).
6. No new hardcoded secrets, passwords, tokens, or ids. Use env vars.
7. Keep amounts as numbers in storage; format with `formatINR` only for display.
8. Soft-delete only (`isDeleted`). Keep `version` handling and the 409 conflict flow.
9. After any change run `bash ./run_tests.sh`; all suites must pass. Never weaken a test to make it pass.
