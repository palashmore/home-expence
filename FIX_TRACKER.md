# FIX TRACKER

A row is DONE only when an automated test drives the real UI on a 390x844 touch
viewport and proves the value is entered, saved, visible in the API response,
still there after a reload, pre-filled when editing, changeable, and correct
after a second save. **Nothing here is marked DONE because the code looks right.**

Runners (both copy `data/` to a scratch directory, disable cloud sync, and
assert afterwards that the real `data/` is untouched):

```bash
bash ./run_tests.sh     # 3 Node API suites
bash ./run_audit.sh     # Playwright mobile UI audit
```

**Current state:** API suites green. Mobile audit **165 checks, 0 bugs**
(baseline on an unchanged checkout: 44 OK / 34 bugs).

---

## C. Confirmed bugs — all DONE

| Item | Bug found | Test that proves the fix |
|---|---|---|
| C1 `#adminMonthlyBudgetLimit` | `step=500 min=1000` rejected 64250, 2805.50, anything under 1000 | `C1 #adminMonthlyBudgetLimit accepts ...` ×3 |
| C1 `#adminNewStaffSalary` | `step=50` rejected 7525, 0.5, 12345.67 | `C1 #adminNewStaffSalary accepts ...` ×3 |
| C1 `#adminNewBillAmount` | `step=10` rejected 2805, 99.99, 1 | `C1 #adminNewBillAmount accepts ...` ×3 |
| C1 `#settleUpAmountInput` | `step=1 min=1` blocked every paise settlement | `C1 #settleUpAmountInput accepts 250.5 / 0.01` |
| C1 `#createHouseholdBudget` | `step=1000 min=5000` rejected 64250, 2805, 100 | `C1 #createHouseholdBudget accepts ...` ×3 |
| C1 `#editHouseholdBudget` | `step=1000 min=1000` rejected 64250, 2805, 100 | `C1 #editHouseholdBudget accepts ...` ×3 |
| C1 `.staff-edit-salary` / `.bill-edit-amount` | same `step=50` trap in the JS row templates | `C2 the edited salary is stored as an exact number` (7525) |
| C1 phone keyboards | no `inputmode` on any money field | `C1 ... has inputmode=decimal` ×6 |
| C1 server side | server coerced bad input instead of rejecting it | server suite TEST 1–3 (422 + value unchanged) |
| C2 staff `shortName` destroyed | object rebuilt from visible inputs; `shortName` re-derived from name | `C2 shortName survives an unrelated edit` |
| C2 no Short Name input | field existed in neither layout | `C2 staff Short Name has an input in the UI`, `... is pre-filled when editing` |
| C2 unknown properties dropped | both client and server rebuilt records | server suite TEST 4 |
| C3 silent fallbacks | blank name → `"Staff"`, salary → `0`, cycle day → `30`, budget → `50000` | `C3 blank staff name does not become 'Staff'`, server TEST 2/3 |
| C3 no field-level error | the save just did nothing | `C3 a field-level error is shown next to the blank field`, `... names the field that is wrong` |
| C4 delete confirm 101×30px | below the 44px thumb minimum | `C4 delete confirm button >= 44px tall`, `C4 cancel button is equally thumb sized` |
| C4 tap targets | 34 of 42 controls at 390px under 44px | `F tap targets >= 44px on <tab>` ×7 |
| C5 inline edits lost on navigation | one global Save; leaving the tab discarded everything | `C5 leaving the tab with pending edits asks first`, `... declining keeps the owner on the admin tab` |
| C5 unverified success | success toast fired on any HTTP 200 | `C5 an edit marks the form dirty`, `C5 a sticky Save bar appears ...`, read-back verification in `saveMasterConfig` |

## Found during the work — not in the brief

| Item | Bug found | Status |
|---|---|---|
| Test isolation | the existing tests wrote to the real `data/` and could PATCH the live public Gist | **DONE** — `HOMEEXPENSES_DATA_DIR`, `HOMEEXPENSES_TMP_DIR`, `CLOUD_SYNC_DISABLED=1`; both runners assert `data/` untouched |
| XSS in the ledger | `<tagged>` typed into an expense note became a real DOM element; `O'Brien` broke out of an `onclick` | **DONE** — 39 markup interpolations escaped, 27 event-attribute values moved to `escapeHtml(JSON.stringify(v))`. Test: `D user text is escaped, not rendered as markup` |
| Sign-out left data behind | the whole ledger, budgets and attendance stayed in `localStorage` after signing out | **DONE** — `E no household data is left cached in localStorage` + 5 more |
| Rename cascade cost | a cascade wrote the ledger once per record and logged N anonymous entries | **DONE** — `storage.bulkUpdateHouseholdExpenses`: one read, one write, one `RENAME_ENTITY` audit entry |
| No horizontal overflow | none found | verified clean at 360/375/390/393/412/430px × 7 tabs |

---

## D. Field contract

| Entity | Status | Note |
|---|---|---|
| Expense — date, amount, category, paidBy, paidTo, paymentMethod, notes | **DONE** | full round-trip driven through the mobile UI: enter → save → API → reload → pre-filled edit → second save → no duplicate → delete. 18 checks |
| Category — name, icon, type, defaultPaidTo | **DONE** | edit modal added; rename cascades onto every referring expense or refuses with the count (409). 12 checks + server TEST 6/7 |
| Family member / payment method / split rule — rename | **DONE** | rename controls added; cascade onto `paidBy` / `paymentMethod` / `splitBetween` |
| Destructive removes | **DONE** | all four warn with the live reference count and suggest renaming instead. 4 checks |
| Monthly budget | **DONE** | C1 fixed, 422 on invalid, read-back verified, exact storage proven (64250, 2805.50) |
| Staff — name, shortName, baseSalary | **DONE** | proven by round-trip |
| Staff — allowedPaidLeaves, billingCycleDay, cycleType, active | **PARTIAL** | validated and range-checked client and server side; no UI round-trip test yet |
| Recurring bill — name, category, icon, dueDay, approxAmount | **PARTIAL** | C1/C3/C5 fixed, server-validated, exact storage proven (2805); no UI round-trip test yet |
| Household cycle — type, cycleStartDay, cycleEndDay | **PARTIAL** | validated client and server side; no round-trip test |
| Expense receipt — upload, replace, remove | **NOT DONE** | not audited |
| Attendance — day marks, bonus, notes | **NOT DONE** | not audited |
| Payroll — leaves, deductions, final salary, voucher | **NOT DONE** | not audited |
| Reimbursement — settle amount, note, history | **PARTIAL** | paise are now enterable (C1); the settle flow itself is not audited |
| Users (admin) — name, username, email, role, household, status, password | **DONE** | driven through the real admin UI: create, sign in as the user, change role (and prove a VIEWER is blocked from writing), reset password (and prove the old one stops working), deactivate (and prove they cannot sign in) |
| Households (admin) — name, budget, status | **DONE** | create and edit through the UI, budget stored exactly (64250, 2805.50), and editing one household proven not to disturb another's budget |
| Profile — display name, password change | **NOT DONE** | not audited |

## E. Areas

| Area | Status |
|---|---|
| Login / logout, stale session, back button | **DONE** — 6 checks |
| Layout integrity on every tab (6 phone widths) | **DONE** — 49 checks |
| Dashboard, Personal, Expenses ledger filters/sort/pagination/export | **NOT DONE** |
| Excel import, Excel/PDF export | **NOT DONE** |
| Receipts, Bill Radar, Payroll, attendance calendar | **NOT DONE** |
| Reimbursement and settle-up | **NOT DONE** |
| Audit tab, Data and Backup, Notifications | **NOT DONE** |
| Multi-device sync | **DONE** — 9 checks in two separate browser contexts: create/edit/delete propagate, stale write refused with 409, cross-household isolation |
| Offline mode and queue replay | **NOT DONE** |
| Admin create/edit/deactivate | **DONE** — see above |
| Theme switch, PWA install banner | **NOT DONE** |

## F. Mobile design standards

| Standard | Status |
|---|---|
| No horizontal scroll at 360–430px | **DONE**, verified |
| Tap targets ≥ 44×44px, ≥ 8px apart | **DONE**, verified on 7 tabs |
| Inputs ≥ 16px so iOS does not zoom | **DONE** |
| Correct keyboard per field (`decimal` / `numeric` / `date`) | **DONE** for money and day fields |
| Sticky Save not hidden by the keyboard, `env(safe-area-inset-bottom)` | **DONE** for master settings |
| Busy state, no double-tap, feedback after verified read-back | **DONE** for master settings and category edit |
| Destructive actions confirm with large buttons | **DONE** |
| Bottom nav restructure, one filter bottom sheet, dashboard reordering, transaction card redesign | **NOT DONE** — the existing bottom nav and more-sheet were left as they are |


---

## Deployment configuration

| Item | Status |
|---|---|
| `JWT_SECRET` | **DONE** — the hardcoded fallback is gone; production refuses to start without a real secret. See `DEPLOYMENT.md` |
| VAPID keys | **DONE** — read from `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, so they no longer regenerate on every serverless cold start |
| `npm run keys` | **DONE** — generates all three secrets locally |
| `.env.example` | **DONE** — rewritten; it previously documented databases this app does not use and omitted every variable it reads |
