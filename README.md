# GharKhata · Household Finance & Staff Payroll

A mobile-first PWA for running a household's money: shared and personal expenses,
domestic staff payroll with attendance and paid-leave quotas, recurring-bill
reminders, reimbursement settlement, and Excel import/export.

Vanilla JavaScript, Tailwind via CDN, Chart.js, SheetJS. **No build step** — the
browser loads the source as written. The server is plain Node `http` routing to
Vercel-style handlers in `api/`.

---

## Features

**Multi-household, multi-user.** Households are isolated: a member of one never
sees another's expenses, notifications or configuration. Roles are
`SYSTEM_ADMIN`, `ADMIN`, `OWNER`, `MEMBER` and `VIEWER`, enforced server-side —
a `VIEWER` is refused writes by the API, not just by a hidden button.

**Per-user permissions.** A role sets the defaults; an administrator can pin an
explicit list of the 25 capabilities on one person, and that list wins
everywhere — the endpoints ask the same registry the checkboxes are drawn from.
Four presets (Member, Finance Manager, Staff Manager, Administrator) are a
starting point, not a cage. Nobody can grant a permission they do not hold
themselves, and clearing every box returns the account to its role. A user
record with no `permissions` field behaves exactly as before, so nothing stored
had to be migrated.

**Everything is configured, nothing is hardcoded.** Staff, recurring bills,
categories, payment methods, split rules, family members and budgets all come
from each household's own Master Configuration. A new household starts empty and
its dashboard hides the sections it has nothing for — no staff means no payroll
card anywhere.

**Dashboard mode.** `household`, `personal` or `combined`, chosen once in Master
Settings so every member sees the same thing. The monthly budget counts *every*
expense in the period, household and personal together.

**Phone home screen.** One figure first — remaining budget — with spend, net flow
and the cap beneath it, a `Today / Weekly / Monthly / Yearly` switch, and a
swipeable KPI strip. The ledger groups by day with each day's total. Desktop
keeps its own denser layout.

**Staff payroll.** Attendance calendar per configured staff member, paid-leave
quotas before deductions apply, pro-rata salary, WhatsApp payment vouchers.

**Notifications.** Adding an expense notifies the rest of that household.
Recurring bills and staff paydays produce reminders daily from five days before
the due date, on the day, and while overdue — stopping as soon as a payment is
recorded.

**Theming.** Eight themes including a full dark mode, carried by a semantic
token layer rather than per-component overrides.

**Settings in named sections.** Master Settings is grouped into Account,
Household, Finance, Bills, Staff and Security rather than one long scroll; the
Data screen holds backups, health and Excel. A validation error opens the group
that holds it, so a blocked save can never be invisible.

**Accessibility.** Every form control has a programmatic label, every icon-only
button has a name, every modal is a named `dialog`, the active section carries
`aria-current`, and the icons are hidden from screen readers because they are
decorative.

**Icons.** Lucide, as an inline SVG sprite — no icon library at runtime, which
matters in an app that renders with `innerHTML` in a hundred places and polls
every seven seconds. Font Awesome Brands remains for the three platform logos
Lucide has no equivalent for.

**No inline handlers.** The markup carries `data-click` / `data-change` /
`data-submit` attributes and `ui_actions.js` holds the behaviour, so the page
works under a strict Content-Security-Policy.

**Dashboard design.** Two kinds of dashboard share the dashboard tab. *Default dashboard*
is the original and is what everyone gets until told otherwise; *New UI dashboard*
(Overview, Minimal, Analytics or Timeline) is built by `dashboard_ui.js` into
`#dashNew`. It is assigned **per user by an administrator**: Admin → Users → edit
user → Dashboard design. The choice is stored on that user's record
(`user.dashboardUi`, validated server-side by `dashboardUiErrors`) and arrives with
their session. The new designs only present figures the existing render pass already
computed, make no requests of their own and store nothing in the browser.

---

## Running locally

```bash
npm install
node server.js          # http://localhost:8000
```

Without `JWT_SECRET` the server generates a random one per process, so sessions
will not survive a restart. Fine for a quick look; set it for real use.

---

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `JWT_SECRET` | **yes** | Signs session tokens. Without it, every restart invalidates all sessions. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | for push | Web Push identity. If unset, keys are generated per cold start and **every existing subscription silently breaks**. |
| `VAPID_SUBJECT` | optional | `mailto:` contact sent to push services. |
| `CRON_SECRET` | for reminders | Authorises the scheduled reminder scan. Without it the daily cron is refused and **reminders never send**. |
| `GITHUB_TOKEN` / `GIST_ID` | for cloud sync | Durable storage. See below. |
| `PORT` | optional | Defaults to `8000`. |
| `HOMEEXPENSES_DATA_DIR` / `HOMEEXPENSES_TMP_DIR` | testing | Point storage at a scratch directory. |
| `CLOUD_SYNC_DISABLED` | testing | Set to `1` to keep a run entirely off the network. |

Generate the push keys with `npm run keys`. Generate a `CRON_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Storage

Three layers: an in-process memory store, a `/tmp` overlay for serverless, and
the repository's `data/` directory. `/tmp` is wiped on cold start, so the
durable copy lives in a **GitHub Gist**.

Everything is one document, `gharkhata.json`:

```
gharkhata.json
├── users[]                 directory across all households
├── households[]
├── pushSubscriptions[]
└── data
    ├── H001
    │   ├── config          masterConfig, categories, budgets, settings
    │   ├── users[]         membership, derived from the directory
    │   ├── expenses[]
    │   ├── attendance      { staff[], records[] }
    │   └── auditLog[]
    └── H002 …
```

Expenses are soft-deleted (`isDeleted`) and carry a `version` for optimistic
concurrency — a stale write is refused with `409` rather than silently
overwriting. Writes to the single document are serialised, because concurrent
read-modify-write cycles clobbered each other.

Keep the Gist **secret**. It holds every household's financial records.

### Migrating from the older per-file layout

```bash
node scripts/build_gharkhata.js <folder-of-exported-gist-files> gharkhata.json
node scripts/upload_gharkhata.js gharkhata.json
```

`build_gharkhata.js` refuses to write unless every record count matches and the
records are byte-identical. `upload_gharkhata.js` refuses to upload if any count
would shrink, and reads the result back to confirm. Neither touches the original
files.

---

## Security notes

- Passwords are hashed with **scrypt** and a per-user salt; verification is
  constant-time.
- Any signed-in user can change their own password from Master Settings. The
  current password is required, and a `userId` in the request body is ignored —
  the session decides whose password changes.
- **Changing a password ends sessions opened before it.** Tokens carry the
  credential generation they were issued against. The same check refuses tokens
  belonging to deleted or deactivated accounts.
- An administrator can reset any user's password, which also signs that user out
  everywhere.
- The reminder scan is not open to the world: it requires `CRON_SECRET` or an
  administrator session.

If you are bringing up a deployment from this repository's seed data, treat the
seeded passwords as public and rotate them before use.

---

## Testing

```bash
npm test          # or: bash ./run_tests.sh   — 9 Node suites
npm run audit     # or: bash ./run_audit.sh   — 450+ check browser audit
```

Both copy `data/` to a scratch directory and disable cloud sync, so they never
touch real records or the Gist, and each run asserts `data/` is unchanged
afterwards.

| Suite | Covers |
|---|---|
| `test_boot_suite.js` | serverless boot, declared assets, read-only filesystem |
| `test_cloud_recovery_suite.js` | cold-start recovery, concurrent writes |
| `test_verification_suite.js` | RBAC and tenant isolation |
| `test_master_settings_and_expenses.js` | zero-cache sync, role enforcement |
| `test_config_rules_suite.js` | config validation, rename cascades |
| `test_dashboard_config_suite.js` | dashboard mode, per-household config |
| `test_password_suite.js` | authentication, password change, session invalidation |
| `test_notifications_suite.js` | household notifications, reminder windows |
| `test_permissions_suite.js` | the permission registry, per-user overrides, closed authorization gaps |

`run_audit.sh` drives a real browser at 390×844 with touch emulation, checking
tap targets, overflow at six phone widths, theme coverage across every tab, and
complete user journeys. It also measures every screen at 768, 1024, 1440 and
1920, verifies every form control and icon-only button has an accessible name,
and verifies every icon reference resolves to a symbol that actually draws.

The audit needs Python with Playwright:

```bash
pip install playwright && playwright install chromium
```

---

## Deploying to Vercel

1. Import the repository on [vercel.com](https://vercel.com). Framework preset
   **Other**, output directory `./`.
2. Add the environment variables above. **They only apply to new deployments** —
   redeploy after adding them.
3. `vercel.json` registers a daily cron that runs the reminder scan. Confirm it
   under **Settings → Cron Jobs** after the first deploy.

A `setInterval` in `server.js` runs the same scan locally. It does **not** fire
on Vercel — serverless functions are frozen between requests — which is why the
cron exists.
