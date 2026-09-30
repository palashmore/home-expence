# FIX TRACKER

Every row is DONE only when an automated test drives the real UI on a 390x844
touch viewport and proves the value is entered, saved, visible in the API
response, still there after a reload, pre-filled when editing, changeable, and
correct after a second save. **No row is marked PASS because the code looks
right.**

Runners (both use a scratch copy of `data/`, cloud sync disabled, and assert
afterwards that the real `data/` is untouched):

```bash
bash ./run_tests.sh     # Node API suites
bash ./run_audit.sh     # Playwright mobile UI audit
```

**Current state:** API suites green. Mobile audit **91 checks, 0 bugs**
(baseline was 44 OK / 34 bugs).

---

## C. Confirmed bugs

| Item | Audited | Bug found | Fixed | Test name | Status |
|---|---|---|---|---|---|
| C1 `#adminMonthlyBudgetLimit` | yes | `step=500 min=1000` rejected 64250, 2805.50, anything under 1000 | yes | `C1 #adminMonthlyBudgetLimit accepts ...` | **DONE** |
| C1 `#adminNewStaffSalary` | yes | `step=50` rejected 7525, 0.5, 12345.67 | yes | `C1 #adminNewStaffSalary accepts ...` | **DONE** |
| C1 `#adminNewBillAmount` | yes | `step=10` rejected 2805, 99.99, 1 | yes | `C1 #adminNewBillAmount accepts ...` | **DONE** |
| C1 `#settleUpAmountInput` | yes | `step=1 min=1` blocked all paise settlements | yes | `C1 #settleUpAmountInput accepts 250.5 / 0.01` | **DONE** |
| C1 `#createHouseholdBudget` | yes | `step=1000 min=5000` rejected 64250, 2805, 100 | yes | `C1 #createHouseholdBudget accepts ...` | **DONE** |
| C1 `#editHouseholdBudget` | yes | `step=1000 min=1000` rejected 64250, 2805, 100 | yes | `C1 #editHouseholdBudget accepts ...` | **DONE** |
| C1 `.staff-edit-salary` inline | yes | same `step=50` trap in the JS row template | yes | covered by `C2 the edited salary is stored as an exact number` (7525) | **DONE** |
| C1 `.bill-edit-amount` inline | yes | same `step=50` trap | yes | `C1` + bill round-trip | **DONE** |
| C1 decimal keyboards | yes | no `inputmode` on any money field | yes | `C1 ... has inputmode=decimal` | **DONE** |
| C2 staff `shortName` lost on save | yes | object rebuilt from visible inputs; `shortName` re-derived from name | yes | `C2 shortName survives an unrelated edit` | **DONE** |
| C2 Short Name has no input | yes | field did not exist in either layout | yes | `C2 staff Short Name has an input in the UI`, `C2 Short Name is pre-filled when editing` | **DONE** |
| C3 silent fallbacks | yes | blank name -> `"Staff"`, salary -> `0`, cycle day -> `30`, budget -> `50000` | yes | `C3 blank staff name does not become 'Staff'` | **DONE** |
| C3 no field-level error | yes | save failed silently | yes | `C3 a field-level error is shown next to the blank field`, `C3 the error names the field that is wrong` | **DONE** |
| C4 delete confirm 101x30px | yes | under the 44px thumb minimum | yes | `C4 delete confirm button >= 44px tall`, `C4 cancel button is equally thumb sized` | **DONE** |
| C4 tap targets across app | yes | 34 of 42 controls at 390px under 44px | yes | `F tap targets >= 44px on <tab>` (7 tabs) | **DONE** |
| C5 inline edits lost on navigation | yes | only one global Save; leaving the tab discarded edits | yes | `C5 leaving the tab with pending edits asks first`, `C5 declining the prompt keeps the owner on the admin tab` | **DONE** |
| C5 no save feedback | yes | success toast fired on any 200, never verified | yes | `C5 an edit marks the form dirty`, `C5 a sticky Save bar appears ...` + read-back verification in `saveMasterConfig` | **DONE** |

## Cross-cutting (done alongside C)

| Item | Bug found | Fixed | Status |
|---|---|---|---|
| Test isolation | tests wrote to real `data/` and could PATCH the live public Gist | `HOMEEXPENSES_DATA_DIR`, `HOMEEXPENSES_TMP_DIR`, `CLOUD_SYNC_DISABLED=1`; both runners assert `data/` untouched | **DONE** |
| XSS in admin templates | `value="${s.name}"` and `onclick="adminDeleteStaff('${s.id}')"` raw-interpolated (rule 4 of PROJECT_CONTEXT.md) | routed through `escapeHtml` / `escapeHtml(JSON.stringify(v))` | **DONE** |
| Save verification | success claimed on HTTP 200 alone | re-reads config and compares every written field | **DONE** |
| No horizontal overflow | none found | n/a - verified clean at 360/375/390/393/412/430px on 7 tabs | **DONE** |

---

## D. Field contract - remaining

| Entity | Fields | Status | Note |
|---|---|---|---|
| Expense | date, amount, category, paidBy, splitBetween, paidTo, paymentMethod, notes | **TODO** | add/edit/delete verified by the API suites; not yet driven through the mobile UI |
| Expense receipt | upload, replace, remove | **TODO** | not audited |
| Category | rename, icon, type, defaultPaidTo | **TODO** | add + delete only; **no edit UI exists**. Rename must update existing expenses or block with a clear message |
| Recurring bill | name, category, icon, dueDay, approxAmount | **PARTIAL** | C1/C3/C5 fixed; full round-trip test still to add |
| Staff | name, shortName, role, baseSalary, allowedPaidLeaves, billingCycleDay, cycleType, active | **PARTIAL** | name/shortName/salary proven; leaves, cycle day, cycleType, active still to prove |
| Family member | rename | **TODO** | add + remove only; **no rename UI** |
| Payment method | rename | **TODO** | add + remove only; **no rename UI** |
| Split rule | rename | **TODO** | add + remove only; **no rename UI** |
| Household cycle | type, cycleStartDay, cycleEndDay | **PARTIAL** | validation added (C3); round-trip test still to add |
| Monthly budget | amount | **PARTIAL** | C1 fixed and verified on save; reload round-trip still to add |
| Attendance | day marks, bonus, notes, per month | **TODO** | not audited |
| Payroll | paid leaves, deductions, final salary, payment record, voucher text | **TODO** | not audited |
| Reimbursement | balance, settle amount and note, history | **PARTIAL** | paise now enterable (C1); settle flow not audited |
| Users (admin) | name, username, email, role, household, status, password reset | **TODO** | API tested; mobile UI not audited |
| Households (admin) | name, budget, status | **TODO** | API tested; mobile UI not audited |
| Profile | display name, password change | **TODO** | not audited |

Deleting a category, member, payment method or staff member that is referenced
by existing expenses must warn with the count of affected records and offer to
keep history. **Not yet implemented.**

## E. Areas not yet audited

Dashboard (period, budget bar, charts, cash flow, upcoming bills) · Personal
view · Expenses ledger (search, filters, sort, pagination, export) · Excel
import · Excel/PDF export · Receipts · Recurring Bill Radar · Payroll and
attendance calendar · Reimbursement and settle-up · Audit tab · Data and Backup
· Notifications · Offline mode · Multi-device sync · Login/logout · Admin
create/edit/deactivate · Theme switch · PWA install banner.

All **TODO**.
