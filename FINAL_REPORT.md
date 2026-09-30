# FINAL REPORT

Branch `fix/mobile-complete`, cut from `fix/security-hardening` at `eb8809f`
(identical to `main`).

**Verification at the time of writing**

```
bash ./run_tests.sh   ->  3 suites, all passing
bash ./run_audit.sh   ->  165 checks, 0 bugs
```

Baseline on the unchanged checkout was **44 OK / 34 bugs**.

---

## 1. What the brief assumed that was not true

The "How to use" section said to start from the branch with the security fixes
and drop in `audit_tools/`. None of that existed:

- commit `e846fe3` is in no branch of this repository
- `run_tests.sh`, `run_audit.sh`, `audit_mobile_flows.py`, `test_security_suite.js`
  and `reset_password.js` were all absent
- `api/_storage.js` had no `HOMEEXPENSES_TMP_DIR`, and there was no
  `CLOUD_SYNC_DISABLED` switch, despite `PROJECT_CONTEXT.md` describing both
- Playwright was installed for neither Node nor Python
- `node_modules` was not installed

`fix/security-hardening` is byte-identical to `main`. The security work that
branch name implies has not landed here.

**The most serious consequence:** the two existing test suites wrote to the real
`data/` directory and, on H001, could PATCH the live public GitHub Gist. There
was no safe way to run a test. That had to be fixed before anything else.

## 2. The five confirmed bugs

All fixed, each proven by a named automated check.

**C1 — number fields rejected normal amounts.** `step` was being used as a
business rule. Browsers silently block submission when a value is not a multiple
of `step`, which on a phone reads as "Save did nothing". This is almost certainly
the reported *Approx / Budgeted Amount not saving*. Seven fields were affected,
plus the same trap in the JS-rendered inline edit rows. Rejected values included
64250, 7525, 2805, 99.99 and every settlement involving paise. Money fields are
now `step="any" min="0"` with `inputmode="decimal"`; the settle-up field is
`step="0.01"`. Real rules moved into JavaScript and onto the server.

**C2 — staff data loss.** `saveAdminConfigFromUI` rebuilt each staff object from
the visible inputs, so every property without a field on screen was dropped, and
`shortName` was re-derived from the name. Saves now merge onto the stored record
and a Short Name input exists in both layouts.

**C3 — silent fallbacks.** A blank name became `"Staff"`, a blank salary `0`, a
blank cycle day `30`, a blank budget `50000`. The server did the same. Blank now
means blank: the save is blocked, a message appears next to the field, the form
keeps the owner's input, and the server returns 422 with per-field errors.

**C4 — destructive confirmation was 101×30px.** Both buttons are now full width
and at least 48px tall, Cancel below Delete. Separately, 34 of 42 visible
controls at 390px were under 44px; a scoped media rule brings buttons, selects
and click-handling elements to the floor, and a checkbox is measured by the
label the thumb actually hits.

**C5 — inline edits lost on navigation.** Editing a row now marks the form dirty
and reveals a sticky Save bar above the bottom nav. Leaving the tab or the page
asks first. The Save button shows a spinner and cannot be double-tapped.

## 3. Bugs found that the brief did not know about

**Stored XSS in the ledger.** An expense whose notes contained `<tagged>`
produced a live `<tagged>` element, and a vendor named `O'Brien` broke out of an
`onclick` attribute. 39 markup interpolations now go through `escapeHtml`, and 27
values inside inline event attributes use `escapeHtml(JSON.stringify(v))` —
quoting alone is not enough there, because the HTML parser decodes `&#039;` back
to `'` before the JavaScript is parsed.

Deliberately left raw, because escaping corrupts rather than protects: Map keys,
the ledger search index, duplicate-detection signatures, `prompt()` and toast
text, Chart.js tooltip callbacks, and `input.value` assignments. None reach
`innerHTML`.

**Sign-out left the household's data on the device.** The token was removed but
`household_expenses_cache_H001`, `household_expenses_online_cache`, the budget
limits and staff attendance all stayed in `localStorage`. Anyone picking up the
phone could read the ledger from devtools. Sign-out now clears them, keeping only
the offline queue (the owner's own unsent entries) and the theme preference.

**Unverified saves.** `saveMasterConfig` showed "Master Settings Synchronized!"
on any HTTP 200. It now re-reads the config and compares every field it wrote,
reporting a mismatch instead of claiming success.

**No way to rename anything.** Category, family member, payment method and split
rule had add and delete only. A delete silently orphaned every expense that
referred to the value.

## 3b. Deployment and admin bugs (second pass)

**`JWT_SECRET` had a hardcoded fallback** committed to this repository, so
anyone reading the source could forge a session token for any household and any
role. Production now refuses to start without a real secret; outside production
a random per-process secret is used instead of a shared constant.

**VAPID keys were file-only.** On serverless the filesystem is read-only, so the
write failed silently and a new key pair was generated on every cold start,
invalidating every push subscription with no error anywhere. They are now read
from the environment first. `DEPLOYMENT.md` has the full Vercel walkthrough and
`npm run keys` generates all three secrets.

**The admin console was unreachable.** The tenant-management card was gated on
`role === 'ADMIN'`, but the seeded system administrator has `SYSTEM_ADMIN` -
which is what the server accepts. The card was hidden from the only account that
can use it, the directory stayed empty, and every row action was dead. The same
mismatch gated the Switch, Edit and Delete buttons.

**Editing a household could overwrite another household's budget.**
`openEditHouseholdModal` pre-filled the budget from `window.masterConfig`, the
*currently active* household's config, while Save sends it to the *target*
household. Renaming household B silently wrote A's budget onto B.

**Two-device sync was verified, not assumed.** Two independent browser contexts,
same household: create, edit and delete each propagate, a stale write is refused
with 409 rather than silently overwriting the newer value, and a device in
another household never receives the records.

## 4. What was added

- `api/_paths.js` — one source of truth for storage locations, honouring
  `HOMEEXPENSES_DATA_DIR`, `HOMEEXPENSES_TMP_DIR` and `CLOUD_SYNC_DISABLED`
- `api/_config_rules.js` — server-side validation returning 422 with per-field
  messages, and the reference-counting used by rename and delete
- `POST /api/config` `action: "rename_entity"` — renames with a cascade onto
  every referring expense; returns 409 with the affected count until the caller
  opts in; refuses a duplicate name (422), a missing entity (404), an unknown
  type (400), and honours tenant isolation (403)
- `GET /api/config?action=usage&entity=&name=` — live reference count
- `storage.bulkUpdateHouseholdExpenses` — applies a cascade in one read and one
  write with a single `RENAME_ENTITY` audit entry. The naive loop rewrote the
  whole ledger per record (twice for H001) and logged 35 anonymous entries for
  one rename
- category edit modal; rename controls on the three chip lists; usage-aware
  delete confirmations
- `run_tests.sh`, `run_audit.sh`, `audit_mobile_flows.py`,
  `test_config_rules_suite.js`, `FIX_TRACKER.md`, `PROJECT_CONTEXT.md`

## 5. Data safety

`data/` was never modified. `git diff main..HEAD -- data/` is empty, and both
runners fail the run if a test touches a tracked file under `data/`. The
122-active-expense / ₹156,761.33 baseline still holds.

## 6. What is NOT done

`FIX_TRACKER.md` has the row-by-row detail. In short, the following were **not**
audited or fixed, and should not be assumed working:

- receipts (upload, replace, remove)
- attendance calendar and payroll (leaves, deductions, final salary, voucher)
- the reimbursement settle-up flow itself
- profile display name and password change
- Excel import, Excel/PDF export
- the expenses ledger's search, filters, sort and pagination
- Dashboard, Personal view, Bill Radar, Audit tab, Data and Backup, Notifications
- offline queue replay
- theme switch, PWA install banner
- the section F redesign items: bottom-nav restructure, a single filter bottom
  sheet, dashboard reordering, transaction-card redesign. The existing bottom
  nav and more-sheet were left as they are

Round-trip tests are also still missing for recurring bills, the household cycle,
and the remaining staff fields, even though all of them are now validated on both
client and server.

## 7. Things worth knowing

- **Tailwind arbitrary values do not always generate.** `min-h-[48px]` produced
  no rule via the Play CDN, so sizes that matter are set in `styles.css`.
- **The Play CDN is not for production.** It warns about this on every load.
- **Seeded passwords are still the guessable defaults** (`Admin@123`,
  `Household123!`) and appear in the test files. `reset_password.js` does not
  exist in this repo. Rotate them before this is exposed to the internet.
- **`GIST_ID` is still hardcoded** as a fallback in `api/_cloud_sync.js`.
- Vercel needs `JWT_SECRET` (32+ chars) before login works, and the VAPID keys
  before push survives a cold start. `npm run keys` generates both; the full
  walkthrough is in `DEPLOYMENT.md`.

## 8. To verify this yourself

```bash
npm install
bash ./run_tests.sh
python -m pip install playwright && python -m playwright install chromium
bash ./run_audit.sh          # add --headed to watch it drive the phone viewport
```
