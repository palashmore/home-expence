#!/usr/bin/env python3
"""
Mobile UI audit for HOME EXPENCE.

Drives the real UI in Chromium on a 390x844 touch viewport (the owner's phone
class) and asserts things that code review cannot prove: that a realistic value
is actually accepted by the form, that a saved value survives a reload, that a
control is large enough to hit with a thumb, that nothing overflows sideways.

Run through ./run_audit.sh, which points the server at a scratch copy of data/
and disables cloud sync. Never run it against real data by hand.

Exit code 0 only when every check passes.
"""
import argparse
import json
import os
import sys
import time
from urllib.parse import quote

from playwright.sync_api import sync_playwright, Error as PWError

# Category icons and staff names contain emoji. The Windows console defaults to
# cp1252, which cannot encode them, so a report line would crash the run.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

BASE_URL = os.environ.get("AUDIT_BASE_URL", "http://localhost:8000")
PHONE = {"width": 390, "height": 844}
PHONE_WIDTHS = [360, 375, 390, 393, 412, 430]
MIN_TAP = 44          # px, WCAG 2.5.5 / Apple HIG minimum
MIN_TAP_GAP = 8       # px between adjacent targets
OWNER = ("palash", "Household123!")

# Controls that are intentionally not thumb targets (decorative, or inside a
# scrolling chip row where the row itself is the target). Kept explicit and
# small so it cannot quietly become a way to hide real failures.
TAP_EXEMPT_IDS = set()


class Audit:
    def __init__(self):
        self.checks = []
        self.console_errors = []
        self.dialogs = []
        # "accept" / "dismiss" while a step deliberately provokes dialogs;
        # None everywhere else, where a dialog is a bug. Exactly one handler
        # answers every dialog - leaving one unanswered hangs the page.
        self.dialog_action = None

    def record(self, name, ok, detail=""):
        self.checks.append({"name": name, "ok": bool(ok), "detail": detail})
        mark = "OK  " if ok else "BUG "
        line = f"  {mark} {name}"
        # `detail` describes what went wrong, so printing it next to a passing
        # check reads as a contradiction. Only show it on failure.
        if detail and not ok:
            line += f"\n         {detail}"
        print(line, flush=True)
        return ok

    @property
    def bugs(self):
        return [c for c in self.checks if not c["ok"]]

    @property
    def passed(self):
        return [c for c in self.checks if c["ok"]]


def attach_listeners(page, audit):
    def on_console(msg):
        if msg.type == "error":
            text = msg.text
            # Chrome logs a 401 on the pre-login session probe; that is expected.
            if "401" in text and "auth" in text.lower():
                return
            # Browser policy notice, not an app fault: Chrome refuses vibrate()
            # until the frame has had a real tap. A phone user always has.
            if "navigator.vibrate" in text:
                return
            audit.console_errors.append(text)

    def on_dialog(dialog):
        # Every dialog must be answered here. A handler that returns without
        # answering leaves the page blocked until the test times out.
        action = audit.dialog_action
        if action is None:
            audit.dialogs.append(f"{dialog.type}: {dialog.message}")
            action = "dismiss"
        try:
            if action == "accept":
                dialog.accept()
            else:
                dialog.dismiss()
        except PWError:
            pass          # already answered

    page.on("console", on_console)
    page.on("dialog", on_dialog)
    page.on("pageerror", lambda e: audit.console_errors.append(f"pageerror: {e}"))


def login(page, username=OWNER[0], password=OWNER[1]):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    page.wait_for_selector("#loginForm", timeout=20000)
    page.fill("#loginUsername", username)
    page.fill("#loginPassword", password)
    page.click("#btnLoginSubmit")
    # The app swaps the login screen for the shell; wait for the tab bar.
    page.wait_for_selector("#tab-dashboard", timeout=20000, state="attached")
    page.wait_for_timeout(1200)


def reload_app(page):
    """Reload without tripping the beforeunload guard, which has its own test."""
    page.evaluate("window.adminFormDirty = false")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#tab-dashboard", timeout=20000, state="attached")
    page.wait_for_timeout(1200)


def goto_tab(page, tab):
    # Navigation itself is not what most checks are testing, and the
    # unsaved-changes guard would block it with a confirm(). The guard has its
    # own dedicated test below.
    page.evaluate(f"window.adminFormDirty = false; switchTab({json.dumps(tab)})")
    page.wait_for_timeout(700)


# ---------------------------------------------------------------------------
# C1 - number inputs must accept realistic money
# ---------------------------------------------------------------------------
NUMBER_FIELD_CASES = [
    # (selector, tab/opener, realistic values the owner actually types)
    ("#adminMonthlyBudgetLimit", "settings", [64250, 500, 2805.50]),
    ("#adminNewStaffSalary", "admin", [7525, 0.5, 12345.67]),
    ("#adminNewBillAmount", "admin", [2805, 99.99, 1]),
    ("#settleUpAmountInput", None, [250.50, 0.01, 1999.99]),
    ("#createHouseholdBudget", None, [64250, 2805, 100]),
    ("#editHouseholdBudget", None, [64250, 2805, 100]),
]


def audit_number_fields(page, audit):
    print("\n[C1] number inputs accept realistic amounts")
    for selector, tab, values in NUMBER_FIELD_CASES:
        if tab:
            goto_tab(page, tab)
        el = page.query_selector(selector)
        if el is None:
            audit.record(f"C1 {selector} present", False, "element not found in DOM")
            continue
        for value in values:
            # Set through the real input path so the browser applies step/min/max.
            bad = page.evaluate(
                """([sel, v]) => {
                    const el = document.querySelector(sel);
                    if (!el) return {missing: true};
                    el.value = String(v);
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                    return {
                        valid: el.checkValidity(),
                        message: el.validationMessage,
                        step: el.getAttribute('step'),
                        min: el.getAttribute('min'),
                        inputmode: el.getAttribute('inputmode'),
                        value: el.value
                    };
                }""",
                [selector, value],
            )
            if bad.get("missing"):
                audit.record(f"C1 {selector} accepts {value}", False, "element vanished")
                continue
            detail = (
                f"step={bad['step']} min={bad['min']} -> {bad['message']}"
                if not bad["valid"] else ""
            )
            audit.record(f"C1 {selector} accepts {value}", bad["valid"], detail)

        mode = page.get_attribute(selector, "inputmode")
        audit.record(
            f"C1 {selector} has inputmode=decimal",
            mode == "decimal",
            f"inputmode={mode!r} - phone shows the alphabetic keyboard without it",
        )


# ---------------------------------------------------------------------------
# F - tap targets and overflow
# ---------------------------------------------------------------------------
TAP_TARGET_JS = """
() => {
  const out = [];
  const sel = 'button, a[href], input[type=checkbox], input[type=radio], select, [role=button], [onclick]';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('[style*="display: none"], .hidden')) continue;

    // A checkbox or radio wrapped in a label is tapped via the label, so the
    // label is the real target. Measure what the thumb actually has to hit.
    let target = el;
    if (el.tagName === 'INPUT') {
      const lbl = el.closest('label');
      if (lbl) target = lbl;
    }

    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;          // not rendered
    if (r.bottom < 0 || r.top > window.innerHeight * 4) continue;  // far offscreen
    if (r.width < 44 || r.height < 44) {
      out.push({
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 60)) || '',
        text: (el.innerText || el.value || '').trim().slice(0, 32),
        w: Math.round(r.width),
        h: Math.round(r.height)
      });
    }
  }
  return out;
}
"""


def audit_tap_targets(page, audit, screen):
    small = page.evaluate(TAP_TARGET_JS)
    small = [s for s in small if s["id"] not in TAP_EXEMPT_IDS]
    if small:
        sample = "; ".join(
            f"{s['id'] or s['tag']+'.'+s['cls'][:20]!r} {s['w']}x{s['h']}"
            for s in small[:6]
        )
        detail = f"{len(small)} control(s) under {MIN_TAP}px, e.g. {sample}"
    else:
        detail = ""
    return audit.record(f"F tap targets >= {MIN_TAP}px on {screen}", not small, detail)


def audit_no_overflow(page, audit, screen):
    ok_all = True
    for w in PHONE_WIDTHS:
        page.set_viewport_size({"width": w, "height": 844})
        page.wait_for_timeout(250)
        overflow = page.evaluate(
            """() => ({
                doc: document.documentElement.scrollWidth,
                win: window.innerWidth,
                worst: (() => {
                  let worst = null;
                  for (const el of document.querySelectorAll('body *')) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0) continue;
                    if (r.right > window.innerWidth + 1) {
                      if (!worst || r.right > worst.right) {
                        worst = {right: Math.round(r.right), id: el.id || null,
                                 tag: el.tagName.toLowerCase(),
                                 cls: String(el.className || '').slice(0, 50)};
                      }
                    }
                  }
                  return worst;
                })()
            })"""
        )
        if overflow["doc"] > overflow["win"] + 1:
            ok_all = False
            w0 = overflow["worst"] or {}
            audit.record(
                f"F no horizontal overflow on {screen} @{w}px",
                False,
                f"scrollWidth {overflow['doc']} > {overflow['win']}; "
                f"widest: {w0.get('id') or w0.get('tag')} .{w0.get('cls','')} right={w0.get('right')}",
            )
        else:
            audit.record(f"F no horizontal overflow on {screen} @{w}px", True)
    page.set_viewport_size(PHONE)
    page.wait_for_timeout(200)
    return ok_all


# ---------------------------------------------------------------------------
# C4 - destructive confirm must be thumb sized
# ---------------------------------------------------------------------------
def audit_delete_confirm(page, audit):
    print("\n[C4] destructive confirmation is thumb sized")
    opened = page.evaluate(
        """() => {
            const m = document.getElementById('deleteConfirmModal');
            if (!m) return {missing: true};
            m.dataset.auditPrevDisplay = m.style.display;
            m.dataset.auditWasHidden = m.classList.contains('hidden') ? '1' : '0';
            m.classList.remove('hidden');
            m.style.display = 'flex';
            return {ok: true};
        }"""
    )
    if opened.get("missing"):
        return audit.record("C4 delete confirm button sized", False, "delete modal not found")

    # The modal animates in from scale(.95). getBoundingClientRect reflects the
    # transform, so let it settle before measuring or we read a false 42px.
    page.wait_for_timeout(600)

    box = page.evaluate(
        """() => {
            const btn = document.getElementById('btnConfirmDeleteAction');
            const cancel = document.querySelector('#deleteConfirmModal button:not(#btnConfirmDeleteAction)');
            if (!btn) return {missingBtn: true};
            const lay = (el) => el ? {w: el.offsetWidth, h: el.offsetHeight} : null;
            return {btn: lay(btn), cancel: lay(cancel)};
        }"""
    )
    page.evaluate(
        """() => {
            const m = document.getElementById('deleteConfirmModal');
            if (!m) return;
            if (m.dataset.auditWasHidden === '1') m.classList.add('hidden');
            m.style.display = m.dataset.auditPrevDisplay || '';
        }"""
    )
    if box.get("missingBtn"):
        return audit.record("C4 delete confirm button sized", False, "confirm button not found")

    ok = box["btn"]["h"] >= MIN_TAP
    audit.record(
        "C4 delete confirm button >= 44px tall",
        ok,
        f"measured {box['btn']['w']}x{box['btn']['h']}px",
    )
    cancel = box.get("cancel")
    audit.record(
        "C4 cancel button is equally thumb sized",
        bool(cancel) and cancel["h"] >= MIN_TAP,
        f"cancel measured {cancel}",
    )
    return ok


# ---------------------------------------------------------------------------
# C2 - staff shortName must survive a save
# ---------------------------------------------------------------------------
def read_config(api):
    """/api/config wraps the household config in `data`."""
    res = api("GET", "/api/config")
    for key in ("data", "config"):
        inner = res.get(key)
        if isinstance(inner, dict):
            return inner
    return res


def audit_staff_shortname(page, audit, api):
    """C2: editing one staff field must not wipe the fields that have no input,
    and must not wipe the ones that do. Proven by a real round-trip, not by
    reading the code."""
    print("\n[C2/C3] staff edits round-trip without data loss")
    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    cfg = read_config(api)
    staff = cfg.get("staff") or []
    if not staff:
        audit.record("C2 staff round-trip", False, "no staff configured to test against")
        return

    target_id = staff[0]["id"]

    # Seed a distinctive shortName straight through the API so we know the
    # stored value before the UI touches it.
    seeded = dict(staff[0])
    seeded["shortName"] = "ZZ9"
    new_staff = [seeded if s["id"] == target_id else s for s in staff]
    api("POST", "/api/config", {**cfg, "staff": new_staff})
    reload_app(page)

    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    # The field must exist on screen at all.
    has_field = page.query_selector(".staff-edit-shortname") is not None
    audit.record(
        "C2 staff Short Name has an input in the UI",
        has_field,
        "no shortName input rendered; a save rebuilds the object and loses it",
    )

    # It must be pre-filled with the stored value.
    if has_field:
        prefilled = page.evaluate(
            """(id) => {
                const row = document.querySelector(`[data-staff-id="${id}"] .staff-edit-shortname`);
                return row ? row.value : null;
            }""",
            target_id,
        )
        audit.record(
            "C2 Short Name is pre-filled when editing",
            prefilled == "ZZ9",
            f"expected 'ZZ9', form shows {prefilled!r}",
        )

    # Now change only the salary through the UI and save.
    changed = page.evaluate(
        """(id) => {
            const row = document.querySelector(`[data-staff-id="${id}"]`);
            if (!row) return {no_row: true};
            const sal = row.querySelector('.staff-edit-salary');
            if (!sal) return {no_salary: true};
            sal.value = '7525';
            sal.dispatchEvent(new Event('input', {bubbles: true}));
            sal.dispatchEvent(new Event('change', {bubbles: true}));
            return {ok: true};
        }""",
        target_id,
    )
    if not changed.get("ok"):
        audit.record("C2 staff round-trip", False, f"could not drive the row: {changed}")
        return

    page.evaluate("saveAdminConfigFromUI()")
    page.wait_for_timeout(1800)

    after = read_config(api)
    saved = next((s for s in (after.get("staff") or []) if s["id"] == target_id), None)
    if not saved:
        audit.record("C2 staff round-trip", False, "staff record disappeared after save")
        return

    audit.record(
        "C2 shortName survives an unrelated edit",
        saved.get("shortName") == "ZZ9",
        f"shortName is now {saved.get('shortName')!r}, expected 'ZZ9'",
    )
    audit.record(
        "C2 the edited salary is stored as an exact number",
        saved.get("baseSalary") == 7525,
        f"baseSalary is {saved.get('baseSalary')!r} ({type(saved.get('baseSalary')).__name__})",
    )
    audit.record(
        "C2 name is not overwritten by the save",
        saved.get("name") == staff[0].get("name"),
        f"name is {saved.get('name')!r}, expected {staff[0].get('name')!r}",
    )


def audit_no_silent_defaults(page, audit, api):
    """C3: a blank required field must block the save with a message, not be
    quietly replaced by 'Staff' / 0 / 30 / 50000."""
    print("\n[C3] blank fields block the save instead of inventing values")
    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    before = read_config(api)
    staff = before.get("staff") or []
    if not staff:
        audit.record("C3 blank name blocked", False, "no staff configured to test against")
        return
    target_id = staff[0]["id"]
    original_name = staff[0].get("name")

    cleared = page.evaluate(
        """(id) => {
            const row = document.querySelector(`[data-staff-id="${id}"]`);
            if (!row) return {no_row: true};
            const n = row.querySelector('.staff-edit-name');
            if (!n) return {no_name: true};
            n.value = '';
            n.dispatchEvent(new Event('input', {bubbles: true}));
            return {ok: true};
        }""",
        target_id,
    )
    if not cleared.get("ok"):
        audit.record("C3 blank name blocked", False, f"could not drive the row: {cleared}")
        return

    page.evaluate("saveAdminConfigFromUI()")

    # Check the form state the owner would actually see, before anything else
    # re-renders the view.
    msg_shown = page.evaluate(
        """() => {
            const p = document.querySelector('.field-error.is-visible');
            return p ? p.textContent.trim() : null;
        }"""
    )
    audit.record(
        "C3 a field-level error is shown next to the blank field",
        bool(msg_shown),
        "save was blocked but no message appeared next to the field",
    )
    audit.record(
        "C3 the error names the field that is wrong",
        bool(msg_shown) and "required" in (msg_shown or "").lower(),
        f"message was {msg_shown!r}",
    )

    page.wait_for_timeout(1500)
    after = read_config(api)
    saved = next((s for s in (after.get("staff") or []) if s["id"] == target_id), None)
    audit.record(
        "C3 blank staff name does not become 'Staff'",
        saved is not None and saved.get("name") == original_name,
        f"stored name is {(saved.get('name') if saved else None)!r}, expected it unchanged at {original_name!r}",
    )

    # Put the form back so later checks start clean.
    reload_app(page)



def audit_unsaved_guard(page, audit, api):
    """C5: inline row edits are only persisted by one global Save, so leaving
    the tab must not discard them silently."""
    print("\n[C5] pending inline edits are not lost silently")
    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    typed = page.evaluate(
        """() => {
            const card = document.querySelector('.staff-mobile-card, #adminStaffTableBody tr');
            if (!card) return {no_row: true};
            const sal = card.querySelector('.staff-edit-salary');
            if (!sal) return {no_salary: true};
            sal.value = '8888';
            sal.dispatchEvent(new Event('input', {bubbles: true}));
            return {ok: true};
        }"""
    )
    if not typed.get("ok"):
        audit.record("C5 unsaved-changes guard", False, f"could not drive a row: {typed}")
        return

    audit.record(
        "C5 an edit marks the form dirty",
        page.evaluate("window.adminHasUnsavedChanges && window.adminHasUnsavedChanges()") is True,
        "typing in a row did not register as an unsaved change",
    )
    audit.record(
        "C5 a sticky Save bar appears while changes are pending",
        page.evaluate(
            """() => {
                const b = document.getElementById('adminUnsavedBanner');
                if (!b) return false;
                return !b.classList.contains('hidden') && b.offsetHeight > 0;
            }"""
        ),
        "no visible save bar while edits were pending",
    )
    audit.record(
        "C5 the sticky Save button is thumb sized",
        page.evaluate(
            """() => {
                const b = document.getElementById('btnSaveAdminConfigMobile');
                return b ? b.offsetHeight >= 44 : false;
            }"""
        ),
        "sticky save button is under 44px",
    )

    # Leaving the tab must prompt rather than discard.
    prompted = {"seen": False}

    def on_dialog(dialog):
        prompted["seen"] = True

    page.on("dialog", on_dialog)
    audit.dialog_action = "dismiss"        # "stay on this tab"
    try:
        page.evaluate("switchTab('dashboard')")
        page.wait_for_timeout(600)
    finally:
        audit.dialog_action = None
        page.remove_listener("dialog", on_dialog)

    audit.record(
        "C5 leaving the tab with pending edits asks first",
        prompted["seen"],
        "switching tabs discarded the pending edits without asking",
    )
    audit.record(
        "C5 declining the prompt keeps the owner on the admin tab",
        page.evaluate(
            """() => {
                const v = document.getElementById('view-admin');
                return v ? !v.classList.contains('hidden') : false;
            }"""
        ),
        "the tab switched away even though the prompt was declined",
    )

    page.evaluate("window.adminFormDirty = false")


def audit_rename_flows(page, audit, api):
    """Section D: category, family member, payment method and split rule had no
    edit UI at all. Prove a rename is reachable from the phone, survives a
    reload, and carries the referring expenses with it."""
    print("\n[D] renameable entities round-trip from the UI")
    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    # --- the edit affordances must exist on screen -------------------------
    for label, selector in (
        ("category", ".cat-edit-btn"),
        ("family member", '[onclick*="adminRenameEntity(\'familyMember\'"]'),
        ("payment method", '[onclick*="adminRenameEntity(\'paymentMethod\'"]'),
        ("split rule", '[onclick*="adminRenameEntity(\'splitRule\'"]'),
    ):
        audit.record(
            f"D {label} has an edit control in the UI",
            page.query_selector(selector) is not None,
            "add and delete only; no way to rename",
        )

    # --- category edit modal round-trip ------------------------------------
    cfg = read_config(api)
    cats = cfg.get("categories") or []
    if not cats:
        audit.record("D category edit round-trip", False, "no categories configured")
        return

    original = cats[0]["name"]
    renamed = f"{original} QA"

    # Count what should move with it.
    usage = api("GET", f"/api/config?action=usage&entity=category&name={quote(original)}")
    expected_moves = usage.get("count", 0)

    opened = page.evaluate("(n) => window.adminEditCategory(n)", original)
    page.wait_for_timeout(500)
    audit.record(
        "D the category editor opens with the stored values pre-filled",
        opened is True
        and page.input_value("#editCategoryName") == original
        and page.input_value("#editCategoryType") in ("expense", "income", "transfer"),
        f"opened={opened}, name field={page.input_value('#editCategoryName') if opened else 'n/a'}",
    )

    # Change name, icon and type together, and accept the cascade prompt.
    page.fill("#editCategoryName", renamed)
    page.fill("#editCategoryIcon", "🧪")
    page.select_option("#editCategoryType", "expense")
    page.fill("#editCategoryDefaultPaidTo", "QA Vendor")

    audit.dialog_action = "accept"         # confirm the cascade
    try:
        page.evaluate("submitAdminEditCategory()")
        page.wait_for_timeout(2500)
    finally:
        audit.dialog_action = None

    after = read_config(api)
    got = next((c for c in (after.get("categories") or []) if c["name"] == renamed), None)
    audit.record(
        "D category rename is stored",
        got is not None,
        f"no category named {renamed!r} after the save",
    )
    if got:
        audit.record("D category icon is stored", got.get("icon") == "🧪",
                     f"icon is {got.get('icon')!r}")
        audit.record("D category defaultPaidTo is stored", got.get("defaultPaidTo") == "QA Vendor",
                     f"defaultPaidTo is {got.get('defaultPaidTo')!r}")

    # The referring expenses must have moved, not been orphaned.
    left_behind = api("GET", f"/api/config?action=usage&entity=category&name={quote(original)}")
    audit.record(
        "D renaming a category carries its expenses with it",
        left_behind.get("count") == 0,
        f"{left_behind.get('count')} expense(s) still point at the old name "
        f"(expected {expected_moves} to move)",
    )
    moved_to = api("GET", f"/api/config?action=usage&entity=category&name={quote(renamed)}")
    audit.record(
        "D the moved expenses now carry the new name",
        moved_to.get("count") == expected_moves,
        f"{moved_to.get('count')} under the new name, expected {expected_moves}",
    )

    # It must survive a reload, and re-open pre-filled with the new values.
    reload_app(page)
    goto_tab(page, "admin")
    page.wait_for_timeout(900)
    page.evaluate("(n) => window.adminEditCategory(n)", renamed)
    page.wait_for_timeout(500)
    audit.record(
        "D the renamed category is pre-filled after a reload",
        page.input_value("#editCategoryName") == renamed
        and page.input_value("#editCategoryDefaultPaidTo") == "QA Vendor",
        f"name={page.input_value('#editCategoryName')!r}, "
        f"paidTo={page.input_value('#editCategoryDefaultPaidTo')!r}",
    )

    # Second save: change it back, proving edit-again works too.
    page.fill("#editCategoryName", original)
    page.fill("#editCategoryIcon", cats[0].get("icon") or "🏷️")
    page.fill("#editCategoryDefaultPaidTo", cats[0].get("defaultPaidTo") or "")
    audit.dialog_action = "accept"         # confirm the cascade
    try:
        page.evaluate("submitAdminEditCategory()")
        page.wait_for_timeout(2500)
    finally:
        audit.dialog_action = None

    restored = read_config(api)
    audit.record(
        "D a second edit saves correctly and restores the original",
        any(c["name"] == original for c in (restored.get("categories") or [])),
        f"category {original!r} was not restored",
    )
    back = api("GET", f"/api/config?action=usage&entity=category&name={quote(original)}")
    audit.record(
        "D the expenses come back with it",
        back.get("count") == expected_moves,
        f"{back.get('count')} expenses under {original!r}, expected {expected_moves}",
    )

    page.evaluate("closeAdminEditCategoryModal()")


def audit_delete_warnings(page, audit, api):
    """Deleting a category, member, method or rule that expenses still use must
    warn with the real count and must not proceed if the owner declines."""
    print("\n[D] destructive removes warn with the affected count")
    goto_tab(page, "admin")
    page.wait_for_timeout(900)

    cfg = read_config(api)
    cats = cfg.get("categories") or []
    if not cats:
        audit.record("D delete warning", False, "no categories to test with")
        return

    # Pick a category that is actually in use, so the count must be non-zero.
    target, expected = None, 0
    for c in cats:
        n = api("GET", f"/api/config?action=usage&entity=category&name={quote(c['name'])}").get("count", 0)
        if n > 0:
            target, expected = c["name"], n
            break
    if not target:
        audit.record("D delete warning", False, "no category is referenced by any expense")
        return

    seen = {"msg": None}

    def capture(dialog):
        seen["msg"] = dialog.message

    page.on("dialog", capture)
    audit.dialog_action = "dismiss"          # decline the delete
    try:
        page.evaluate("(n) => window.adminDeleteCategory(n)", target)
        page.wait_for_timeout(1500)
    finally:
        audit.dialog_action = None
        page.remove_listener("dialog", capture)

    audit.record(
        "D removing a category in use asks first",
        seen["msg"] is not None,
        "the category was removed with no confirmation at all",
    )
    audit.record(
        "D the warning states how many expenses are affected",
        seen["msg"] is not None and str(expected) in seen["msg"],
        f"expected the count {expected} in the message, got: {seen['msg']!r}",
    )
    audit.record(
        "D declining the warning leaves the category in place",
        any(c["name"] == target for c in (read_config(api).get("categories") or [])),
        f"{target!r} was removed even though the confirmation was declined",
    )
    after = api("GET", f"/api/config?action=usage&entity=category&name={quote(target)}")
    audit.record(
        "D no expense was orphaned by the declined delete",
        after.get("count") == expected,
        f"{after.get('count')} expenses reference it now, expected {expected}",
    )


def audit_expense_round_trip(page, audit, api):
    """Section D, row 1: the flow the owner uses every day. Every field must be
    enterable on a phone, saved exactly, visible in the API, still right after a
    reload, pre-filled on edit, changeable, and correct after a second save."""
    print("\n[D] expense round-trip through the mobile UI")
    goto_tab(page, "expenses")
    page.wait_for_timeout(800)

    cfg = read_config(api)
    categories = [c["name"] for c in (cfg.get("categories") or [])]
    members = cfg.get("familyMembers") or []
    methods = cfg.get("paymentMethods") or []
    if not (categories and members and methods):
        audit.record("D expense round-trip", False,
                     "household config has no categories/members/payment methods")
        return

    # Deliberately awkward values: paise, an apostrophe, and an amount that the
    # old step attributes would have rejected outright.
    # Today's date: the ledger filters by the active period, so a record dated
    # months back would legitimately not be listed and the reload check below
    # would prove nothing.
    today = page.evaluate("() => new Date().toISOString().slice(0, 10)")
    first = {
        "date": today,
        "amount": "2805.55",
        "category": categories[0],
        "paidBy": members[0],
        "paidTo": "O'Brien & Co <QA>",
        "paymentMethod": methods[0],
        "notes": 'Audit round-trip "quoted" & <tagged>',
    }

    page.evaluate("openExpenseModal()")
    page.wait_for_timeout(700)
    audit.record(
        "D the expense form opens on a phone viewport",
        page.is_visible("#inputAmount"),
        "amount field is not visible after opening the form",
    )

    def fill_form(values):
        page.fill("#inputDate", values["date"])
        page.fill("#inputAmount", values["amount"])
        page.select_option("#inputCategory", values["category"])
        page.select_option("#inputPaidBy", values["paidBy"])
        page.fill("#inputPaidTo", values["paidTo"])
        page.select_option("#inputPaymentMethod", values["paymentMethod"])
        page.fill("#inputNotes", values["notes"])

    fill_form(first)

    audit.record(
        "D the amount field accepts paise",
        page.evaluate("() => document.getElementById('inputAmount').checkValidity()"),
        page.evaluate("() => document.getElementById('inputAmount').validationMessage"),
    )

    page.evaluate("""() => {
        const f = document.getElementById('expenseForm');
        f.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    }""")
    page.wait_for_timeout(2500)

    def find_saved(marker):
        res = api("GET", "/api/expenses")
        rows = [e for e in (res.get("data") or [])
                if not e.get("isDeleted") and marker in str(e.get("notes", ""))]
        return rows[0] if rows else None

    saved = find_saved("Audit round-trip")
    audit.record("D the expense is saved and visible in the API", saved is not None,
                 "no expense with the audit marker came back from /api/expenses")
    if not saved:
        return

    audit.record(
        "D the amount is stored as an exact number, not a formatted string",
        saved.get("amount") == 2805.55 and isinstance(saved.get("amount"), (int, float)),
        f"amount is {saved.get('amount')!r} ({type(saved.get('amount')).__name__})",
    )
    for field, want in (("category", first["category"]),
                        ("paidBy", first["paidBy"]),
                        ("paymentMethod", first["paymentMethod"])):
        audit.record(f"D {field} is stored as entered",
                     saved.get(field) == want,
                     f"{field} is {saved.get(field)!r}, expected {want!r}")
    audit.record(
        "D paidTo keeps punctuation exactly as typed",
        saved.get("paidTo") == first["paidTo"] or saved.get("vendor") == first["paidTo"],
        f"paidTo={saved.get('paidTo')!r} vendor={saved.get('vendor')!r}",
    )
    audit.record(
        "D the date is stored as entered",
        str(saved.get("date", "")).startswith(today),
        f"date is {saved.get('date')!r}",
    )

    expense_id = saved["id"]

    # --- survives a reload, and the ledger does not execute the notes --------
    reload_app(page)
    goto_tab(page, "expenses")
    page.wait_for_timeout(1200)

    audit.record(
        "D the new expense is listed after a reload",
        page.evaluate("(id) => !!document.querySelector(`[data-expense-id='${id}'], [data-id='${id}']`) "
                      "|| document.body.innerText.includes('Audit round-trip')", expense_id),
        "the saved expense is not on screen after reloading",
    )
    audit.record(
        "D user text is escaped, not rendered as markup",
        page.evaluate("""() => document.querySelectorAll('tagged, injected').length === 0"""),
        "a tag typed into notes became a real element - unescaped interpolation",
    )
    audit.record(
        "D the escaped text is still displayed correctly to the user",
        page.evaluate("() => document.body.innerText.includes('<tagged>')"),
        "the notes text is not shown, or was mangled by escaping",
    )

    # --- re-open pre-filled --------------------------------------------------
    page.evaluate("(id) => (window.editExpense || window.openExpenseModal)(id)", expense_id)
    page.wait_for_timeout(1000)
    prefill = page.evaluate("""() => ({
        amount: document.getElementById('inputAmount').value,
        category: document.getElementById('inputCategory').value,
        paidBy: document.getElementById('inputPaidBy').value,
        paidTo: document.getElementById('inputPaidTo').value,
        notes: document.getElementById('inputNotes').value,
        date: document.getElementById('inputDate').value
    })""")
    audit.record(
        "D editing pre-fills every field from the stored record",
        (Number(prefill["amount"]) == 2805.55
         and prefill["category"] == first["category"]
         and prefill["paidBy"] == first["paidBy"]
         and prefill["paidTo"] == first["paidTo"]
         and first["notes"] in prefill["notes"]
         and prefill["date"] == first["date"]),
        f"form shows {prefill}",
    )

    # --- change and save again ----------------------------------------------
    second = dict(first)
    second["amount"] = "199.05"
    second["category"] = categories[1] if len(categories) > 1 else categories[0]
    second["paidBy"] = members[1] if len(members) > 1 else members[0]
    second["paidTo"] = "Second Vendor"
    second["notes"] = "Audit round-trip second save"
    fill_form(second)
    page.evaluate("""() => {
        const f = document.getElementById('expenseForm');
        f.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    }""")
    page.wait_for_timeout(2500)

    res = api("GET", "/api/expenses")
    again = next((e for e in (res.get("data") or []) if e.get("id") == expense_id), None)
    audit.record("D the edited expense still exists under the same id", again is not None,
                 "the record disappeared after the second save")
    if again:
        audit.record(
            "D the second save stores the changed amount exactly",
            again.get("amount") == 199.05,
            f"amount is {again.get('amount')!r}, expected 199.05",
        )
        audit.record(
            "D the second save stores the changed category",
            again.get("category") == second["category"],
            f"category is {again.get('category')!r}, expected {second['category']!r}",
        )
        audit.record(
            "D editing does not create a duplicate record",
            len([e for e in (res.get("data") or [])
                 if not e.get("isDeleted") and "Audit round-trip" in str(e.get("notes", ""))]) == 1,
            "more than one expense carries the audit marker",
        )

    # --- clean up: soft-delete the fixture ----------------------------------
    api("DELETE", f"/api/expenses?id={quote(expense_id)}")
    page.wait_for_timeout(800)
    res2 = api("GET", "/api/expenses")
    leftover = [e for e in (res2.get("data") or [])
                if not e.get("isDeleted") and "Audit round-trip" in str(e.get("notes", ""))]
    audit.record(
        "D deleting the expense removes it from the active ledger",
        len(leftover) == 0,
        f"{len(leftover)} audit expense(s) still active after delete",
    )


def Number(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    audit = Audit()
    print("=" * 60)
    print(" HOME EXPENCE :: MOBILE UI AUDIT  (390x844 touch)")
    print("=" * 60)
    print(f"target: {BASE_URL}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(
            viewport=PHONE,
            has_touch=True,
            is_mobile=True,
            device_scale_factor=3,
            user_agent=("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"),
        )
        page = ctx.new_page()
        attach_listeners(page, audit)

        try:
            login(page)
            audit.record("login as OWNER on 390px viewport", True)
        except PWError as e:
            audit.record("login as OWNER on 390px viewport", False, str(e)[:200])
            browser.close()
            report(audit, args)
            return 1

        def api(method, path, body=None):
            return page.evaluate(
                """async ([m, p, b]) => {
                    const t = localStorage.getItem('household_auth_token');
                    const r = await fetch(p + (p.includes('?') ? '&' : '?') + '_t=' + Date.now(), {
                        method: m,
                        headers: {'Content-Type': 'application/json',
                                  'Authorization': 'Bearer ' + t},
                        body: b ? JSON.stringify(b) : undefined
                    });
                    try { return await r.json(); } catch (e) { return {status: r.status}; }
                }""",
                [method, path, body],
            )

        audit_number_fields(page, audit)
        audit_delete_confirm(page, audit)
        for fn, label in ((audit_staff_shortname, "C2 staff round-trip"),
                          (audit_no_silent_defaults, "C3 blank fields blocked"),
                          (audit_unsaved_guard, "C5 unsaved-changes guard"),
                          (audit_rename_flows, "D rename round-trip"),
                          (audit_delete_warnings, "D delete warning"),
                          (audit_expense_round_trip, "D expense round-trip")):
            try:
                fn(page, audit, api)
            except Exception as e:
                audit.record(label, False, f"audit error: {type(e).__name__}: {e}")

        print("\n[F] layout and tap targets per screen")
        for tab in ["dashboard", "personal", "expenses", "staff", "matrix", "admin", "settings"]:
            goto_tab(page, tab)
            audit_tap_targets(page, audit, tab)
            audit_no_overflow(page, audit, tab)

        print("\n[general] runtime health")
        audit.record(
            "no JS console errors during audit",
            not audit.console_errors,
            "; ".join(audit.console_errors[:4]),
        )
        audit.record(
            "no blocking alert/confirm dialogs",
            not audit.dialogs,
            "; ".join(audit.dialogs[:4]),
        )

        browser.close()

    return report(audit, args)


def report(audit, args):
    print("\n" + "=" * 60)
    print(f" AUDIT RESULT: {len(audit.passed)} OK, {len(audit.bugs)} bugs")
    print("=" * 60)
    for b in audit.bugs:
        print(f"  BUG  {b['name']}")
        if b["detail"]:
            print(f"       {b['detail']}")
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(audit.checks, f, indent=2)
    return 1 if audit.bugs else 0


if __name__ == "__main__":
    sys.exit(main())
