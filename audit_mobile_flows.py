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
import calendar
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
        # True only while the logout test has deliberately ended the session,
        # where "Unauthorized" from the app is the correct behaviour.
        self.signed_out_on_purpose = False
        # True only while the sync test deliberately sends an outdated write,
        # where a 409 from the server is the behaviour being verified.
        self.expecting_conflict = False

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
            # While the logout test has the session deliberately ended, the app
            # is supposed to be refused by the API. Anywhere else this counts.
            if audit.signed_out_on_purpose and ("Unauthorized" in text or "401" in text):
                return
            if audit.expecting_conflict and "409" in text:
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


CLIPPED_CONTROLS_JS = """
() => {
  // `html, body { overflow-x: hidden }` means a row that is too wide is simply
  // cut off instead of growing scrollWidth, so a scrollWidth check cannot see
  // it. Measure the controls themselves: anything that starts on screen but
  // ends past the right edge is partly unreachable.
  const out = [];
  const sel = 'button, a[href], select, [role=button]';
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (el.closest('.hidden, [hidden]')) continue;
    if (cs.position === 'fixed' || cs.position === 'absolute') continue;  // drawers park off-screen
    if (el.closest('[class*="translate-x"]')) continue;                   // slide-in panels

    // Inside a horizontally scrollable strip (the tab bar, chip rows) content
    // beyond the edge is reachable by swiping - that is the design, not a bug.
    // Only content clipped by an ancestor that cannot scroll is unreachable.
    let scrollable = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll') { scrollable = true; break; }
    }
    if (scrollable) continue;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.left >= window.innerWidth) continue;        // fully off-screen, e.g. a closed sheet
    if (r.right > window.innerWidth + 1) {
      out.push({
        id: el.id || null,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 40),
        right: Math.round(r.right),
        viewport: window.innerWidth
      });
    }
  }
  return out;
}
"""


def audit_no_clipped_controls(page, audit, screen):
    """A control cut off by the right edge is unusable even when the page does
    not scroll sideways."""
    ok_all = True
    for w in PHONE_WIDTHS:
        page.set_viewport_size({"width": w, "height": 844})
        page.wait_for_timeout(250)
        clipped = page.evaluate(CLIPPED_CONTROLS_JS)
        if clipped:
            ok_all = False
            sample = "; ".join(
                f"{c['id'] or c['tag'] + '.' + c['cls'][:18]!r} ends at {c['right']}px"
                for c in clipped[:4]
            )
            audit.record(f"F no control is cut off on {screen} @{w}px", False,
                         f"{len(clipped)} clipped past {w}px: {sample}")
        else:
            audit.record(f"F no control is cut off on {screen} @{w}px", True)
    page.set_viewport_size(PHONE)
    page.wait_for_timeout(200)
    return ok_all


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


def audit_attendance_follows_period(page, audit, api):
    """The attendance calendar must show the month the rest of the app is
    showing, and a tap must save against that month - not silently against
    today's. Also checks the save survives a reload and that each month keeps
    its own marks."""
    print("\n[D] attendance calendar follows the selected period")
    goto_tab(page, "staff")
    page.wait_for_timeout(1000)

    if page.query_selector("#attendanceDaysGrid") is None:
        audit.record("D attendance calendar", False, "attendance grid not present on the staff tab")
        return

    today = page.evaluate("() => ({y: new Date().getFullYear(), m: new Date().getMonth() + 1})")
    cur_key = f"{today['y']}-{today['m']:02d}"

    opening_key = page.evaluate(
        "() => document.getElementById('attendanceDaysGrid').dataset.monthKey")
    audit.record(
        "D the calendar opens on the current month by default",
        opening_key == cur_key,
        f"grid month is {opening_key!r}, expected {cur_key!r}",
    )

    # Switch the period filter to a different month and confirm the calendar moves.
    prev_month = today["m"] - 1 or 12
    prev_year = today["y"] if today["m"] > 1 else today["y"] - 1
    prev_key = f"{prev_year}-{prev_month:02d}"
    month_names = ["January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"]

    page.evaluate(
        """([mName, yStr]) => {
            const m = document.getElementById('filterMonth');
            const y = document.getElementById('filterYear');
            if (m) { m.value = mName; }
            if (y) { y.value = yStr; }
            onFilterChange();
        }""",
        [month_names[prev_month - 1], str(prev_year)],
    )
    page.wait_for_timeout(1200)

    grid_key = page.evaluate("() => document.getElementById('attendanceDaysGrid').dataset.monthKey")
    audit.record(
        "D selecting a past month moves the calendar to that month",
        grid_key == prev_key,
        f"calendar shows {grid_key!r}, expected {prev_key!r}",
    )
    title = page.evaluate("() => document.getElementById('attendanceMonthTitle').textContent")
    audit.record(
        "D the calendar heading names the month being viewed",
        month_names[prev_month - 1] in title and str(prev_year) in title,
        f"heading reads {title!r}",
    )
    audit.record(
        "D the day count matches that month, not today's",
        page.evaluate("() => document.querySelectorAll('#attendanceDaysGrid .att-day-cell').length")
        == calendar.monthrange(prev_year, prev_month)[1],
        "the number of day cells does not match the selected month",
    )

    # Toggle a day in the PAST month and confirm it is stored under that month.
    staff = page.evaluate("() => document.getElementById('attendanceStaffSelect').value")
    page.evaluate("""() => {
        const c = document.querySelectorAll('#attendanceDaysGrid .att-day-cell');
        if (c.length > 4) c[4].click();
    }""")
    page.wait_for_timeout(2000)

    stored = api("GET", "/api/attendance")
    record = (stored.get("data") or {}).get(staff) or {}
    months = record.get("months") or {}
    audit.record(
        "D a tap in a past month is saved against that month",
        prev_key in months and bool((months.get(prev_key) or {}).get("days")),
        f"months stored for {staff!r}: {list(months.keys())}",
    )
    audit.record(
        "D the current month is not written to by mistake",
        not (months.get(cur_key) or {}).get("days"),
        f"a mark landed in {cur_key} while viewing {prev_key}",
    )

    marked = dict((months.get(prev_key) or {}).get("days") or {})

    # Survives a reload, with the filter still on the past month.
    reload_app(page)
    page.evaluate(
        """([mName, yStr]) => {
            const m = document.getElementById('filterMonth');
            const y = document.getElementById('filterYear');
            if (m) m.value = mName;
            if (y) y.value = yStr;
            onFilterChange();
        }""",
        [month_names[prev_month - 1], str(prev_year)],
    )
    page.wait_for_timeout(1500)
    goto_tab(page, "staff")
    page.wait_for_timeout(1200)

    after = api("GET", "/api/attendance")
    after_days = (((after.get("data") or {}).get(staff) or {}).get("months") or {}).get(prev_key, {}).get("days") or {}
    audit.record(
        "D the past-month marks survive a reload",
        after_days == marked and bool(after_days),
        f"stored {after_days!r}, expected {marked!r}",
    )
    audit.record(
        "D the calendar returns to the selected month after a reload",
        page.evaluate("() => document.getElementById('attendanceDaysGrid').dataset.monthKey") == prev_key,
        "the calendar reverted to the current month after reloading",
    )

    # Switching back to the current month must show a different, clean record.
    page.evaluate(
        """([mName, yStr]) => {
            const m = document.getElementById('filterMonth');
            const y = document.getElementById('filterYear');
            if (m) m.value = mName;
            if (y) y.value = yStr;
            onFilterChange();
        }""",
        [month_names[today["m"] - 1], str(today["y"])],
    )
    page.wait_for_timeout(1200)
    audit.record(
        "D switching back returns the calendar to the current month",
        page.evaluate("() => document.getElementById('attendanceDaysGrid').dataset.monthKey") == cur_key,
        "the calendar did not return to the current month",
    )


def audit_expense_view_toggle(page, audit, api):
    """The expenses tab must offer Timeline and Table on a phone, switch between
    them, and remember the choice."""
    print("\n[D] expenses tab offers a Timeline / Table choice")
    goto_tab(page, "expenses")
    page.wait_for_timeout(1000)

    # Show the whole ledger. The default filter is the current month, which is
    # legitimately empty at the start of a month, and an empty list would make
    # the "has rows" checks below prove nothing.
    page.evaluate("""() => {
        const m = document.getElementById('filterMonth');
        if (m) m.value = 'all';
        onFilterChange();
    }""")
    page.wait_for_timeout(1200)

    def shown():
        return page.evaluate(
            """() => {
                const vis = (id) => {
                    const el = document.getElementById(id);
                    if (!el) return false;
                    return getComputedStyle(el).display !== 'none' && el.offsetHeight > 0;
                };
                const c = document.getElementById('expenseLedgerContainer');
                return {
                    mode: c ? c.dataset.expenseView : null,
                    table: vis('expenseTableView'),
                    timeline: vis('mobileExpenseCardList')
                };
            }"""
        )

    audit.record(
        "D both view buttons exist",
        page.query_selector("#btnExpenseViewTimeline") is not None
        and page.query_selector("#btnExpenseViewTable") is not None,
        "the Timeline/Table switcher is missing",
    )

    start = shown()
    audit.record(
        "D a phone defaults to the timeline view",
        start["timeline"] and not start["table"],
        f"state is {start}",
    )

    # Switch to Table.
    page.click("#btnExpenseViewTable")
    page.wait_for_timeout(700)
    table_state = shown()
    audit.record(
        "D choosing Table shows the table and hides the timeline",
        table_state["table"] and not table_state["timeline"],
        f"state is {table_state}",
    )
    audit.record(
        "D the Table button reports itself as selected",
        page.get_attribute("#btnExpenseViewTable", "aria-pressed") == "true"
        and page.get_attribute("#btnExpenseViewTimeline", "aria-pressed") == "false",
        "aria-pressed does not reflect the active view",
    )
    audit.record(
        "D the table actually has rows in table view",
        page.evaluate("() => document.querySelectorAll('#expenseTableBody tr').length") > 0,
        "the table is visible but empty",
    )

    # The choice must survive a reload.
    reload_app(page)
    goto_tab(page, "expenses")
    page.evaluate("""() => {
        const m = document.getElementById('filterMonth');
        if (m) m.value = 'all';
        onFilterChange();
    }""")
    page.wait_for_timeout(1200)
    after_reload = shown()
    audit.record(
        "D the Table choice is remembered after a reload",
        after_reload["mode"] == "table" and after_reload["table"] and not after_reload["timeline"],
        f"state after reload is {after_reload}",
    )

    # Switch back to Timeline.
    page.click("#btnExpenseViewTimeline")
    page.wait_for_timeout(700)
    back = shown()
    audit.record(
        "D switching back to Timeline restores the cards",
        back["timeline"] and not back["table"],
        f"state is {back}",
    )
    audit.record(
        "D the timeline actually has cards",
        page.evaluate("() => document.querySelectorAll('#mobileExpenseCardList > div').length") > 0,
        "the timeline is visible but empty",
    )


def audit_logout(page, audit, api):
    """Section E: signing out must actually end the session. A token left in
    localStorage, or household data still cached after logout, means the next
    person to pick up the phone can reach it."""
    print("\n[E] logout clears the session and cached household data")

    before = page.evaluate("() => !!localStorage.getItem('household_auth_token')")
    audit.record("E a session token exists while signed in", before,
                 "no token in localStorage even though the app is signed in")

    audit.dialog_action = "accept"        # some builds confirm the sign-out
    audit.signed_out_on_purpose = True
    try:
        page.evaluate("() => (window.signOut ? window.signOut() : null)")
        page.wait_for_timeout(2000)
    finally:
        audit.dialog_action = None

    state = page.evaluate("""() => {
        const keys = Object.keys(localStorage);
        return {
            token: localStorage.getItem('household_auth_token'),
            loginVisible: !!document.querySelector('#loginForm') &&
                          !document.querySelector('#loginForm').closest('.hidden'),
            // The offline queue holds the owner's own unsent entries and no
            // server data; the theme is a device preference. Everything else
            // under these prefixes is cached household data.
            residualKeys: keys.filter(k => /expense|household|config|master/i.test(k)
                                           && k !== 'homeexpenses_offline_queue'
                                           && k !== 'household_app_theme'
                                           && k !== 'homeexpenses_expense_view')
        };
    }""")

    audit.record(
        "E signing out removes the auth token from localStorage",
        not state["token"],
        f"token still present after sign out: {str(state['token'])[:24]}...",
    )
    audit.record(
        "E signing out returns the app to the login screen",
        state["loginVisible"],
        "the login form is not shown after signing out",
    )
    audit.record(
        "E no household data is left cached in localStorage",
        not state["residualKeys"],
        f"left behind: {state['residualKeys']}",
    )

    # The API must reject the old token, not just hide it in the UI.
    stale = page.evaluate("""async () => {
        const r = await fetch('/api/expenses?_t=' + Date.now(), {cache: 'no-store'});
        return r.status;
    }""")
    audit.record(
        "E the API refuses requests once signed out",
        stale in (401, 403),
        f"/api/expenses returned {stale} after sign out",
    )

    # Going back must not re-expose the previous session's screens. If history
    # has nowhere to go the browser lands on about:blank, where localStorage is
    # inaccessible - that is not a finding, so treat it as "nothing exposed".
    page.go_back()
    page.wait_for_timeout(1500)
    try:
        after_back = page.evaluate("""() => ({
            token: localStorage.getItem('household_auth_token'),
            showsLedger: !!document.querySelector('#view-expenses:not(.hidden)'),
            readable: true
        })""")
    except PWError:
        after_back = {"token": None, "showsLedger": False, "readable": False}
    audit.record(
        "E the back button does not restore a signed-out session",
        not after_back["token"] and not after_back["showsLedger"],
        f"after going back: {after_back}",
    )

    # Leave the browser signed in again for anything that runs after this.
    login(page)
    audit.signed_out_on_purpose = False


def make_api(page):
    """Bind an API caller to one page's session."""
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
    return api


def audit_two_device_sync(browser, audit):
    """Section E: two devices in the same household, each in its own browser
    context with its own storage and session - the real situation when the owner
    uses a phone and a laptop. BroadcastChannel does not cross contexts, so this
    exercises the polling/visibility path that a second device actually relies on.
    """
    print("\n[E] two-device sync within a household")

    ctx_a = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
    ctx_b = browser.new_context(viewport={"width": 1280, "height": 900})
    page_a = ctx_a.new_page()          # phone, owner
    page_b = ctx_b.new_page()          # laptop, second member of H001
    attach_listeners(page_a, audit)
    attach_listeners(page_b, audit)

    try:
        login(page_a, "palash", "Household123!")
        login(page_b, "pallavi", "Household123!")
        api_a = make_api(page_a)
        api_b = make_api(page_b)

        audit.record(
            "E both devices are signed into the same household",
            (page_a.evaluate("() => (window.currentSessionUser||{}).householdId")
             == page_b.evaluate("() => (window.currentSessionUser||{}).householdId")
             == "H001"),
            "the two sessions are not both in H001",
        )

        # --- device A creates an expense through the UI ---------------------
        today = page_a.evaluate("() => new Date().toISOString().slice(0, 10)")
        cfg = read_config(api_a)
        category = (cfg.get("categories") or [{}])[0].get("name")
        member = (cfg.get("familyMembers") or ["Palash"])[0]
        method = (cfg.get("paymentMethods") or ["UPI"])[0]

        marker = "Two-device sync probe"
        page_a.evaluate("openExpenseModal()")
        page_a.wait_for_timeout(700)
        page_a.fill("#inputDate", today)
        page_a.fill("#inputAmount", "3456.78")
        page_a.select_option("#inputCategory", category)
        page_a.select_option("#inputPaidBy", member)
        page_a.fill("#inputPaidTo", "Device A Vendor")
        page_a.select_option("#inputPaymentMethod", method)
        page_a.fill("#inputNotes", marker)
        page_a.evaluate("""() => document.getElementById('expenseForm')
            .dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}))""")
        page_a.wait_for_timeout(2500)

        created = [e for e in (api_a("GET", "/api/expenses").get("data") or [])
                   if not e.get("isDeleted") and marker in str(e.get("notes", ""))]
        audit.record("E device A can create an expense", len(created) == 1,
                     f"{len(created)} matching expenses after the save")
        if len(created) != 1:
            return
        expense_id = created[0]["id"]

        # --- device B must see it without a manual reload --------------------
        # Poll is 7s; a focus event also triggers a refresh, which is what
        # happens when the owner picks the other device up.
        page_b.bring_to_front()
        page_b.evaluate("() => window.dispatchEvent(new Event('focus'))")
        page_b.wait_for_timeout(3000)

        seen_b = page_b.evaluate(
            """(id) => {
                const list = window.expensesData || window.expenses || [];
                return list.some(e => e && e.id === id && !e.isDeleted);
            }""",
            expense_id,
        )
        audit.record(
            "E device B sees device A's new expense after a refresh trigger",
            seen_b,
            "the second device's in-memory ledger does not contain the new record",
        )
        audit.record(
            "E device B reads the same amount",
            any(e.get("id") == expense_id and e.get("amount") == 3456.78
                for e in (api_b("GET", "/api/expenses").get("data") or [])),
            "device B's API response has a different amount",
        )

        # --- device B edits, device A must pick it up ------------------------
        edited = dict(created[0])
        edited["amount"] = 4567.89
        edited["paidTo"] = "Device B Vendor"
        api_b("POST", "/api/expenses", edited)
        page_a.wait_for_timeout(500)
        page_a.evaluate("() => window.dispatchEvent(new Event('focus'))")
        page_a.wait_for_timeout(3000)

        a_amount = page_a.evaluate(
            """(id) => {
                const list = window.expensesData || window.expenses || [];
                const hit = list.find(e => e && e.id === id);
                return hit ? hit.amount : null;
            }""",
            expense_id,
        )
        audit.record(
            "E device A picks up device B's edit",
            a_amount == 4567.89,
            f"device A still shows {a_amount!r}, expected 4567.89",
        )

        # --- a stale write must be refused, not silently overwrite -----------
        stale = dict(created[0])           # still carries the pre-edit version
        stale["amount"] = 1.0
        stale["paidTo"] = "Stale Overwrite"
        audit.expecting_conflict = True
        try:
            res = api_a("POST", "/api/expenses", stale)
        finally:
            audit.expecting_conflict = False
        conflict = (res.get("status") == 409) or (res.get("success") is False)
        audit.record(
            "E a stale edit is refused rather than silently overwriting",
            conflict,
            f"the outdated write was accepted: {str(res)[:140]}",
        )
        current = next((e for e in (api_b("GET", "/api/expenses").get("data") or [])
                        if e.get("id") == expense_id), {})
        audit.record(
            "E the newer value survives the stale write",
            current.get("amount") == 4567.89,
            f"stored amount is now {current.get('amount')!r}, expected 4567.89",
        )

        # --- delete on one device disappears on the other --------------------
        api_b("DELETE", f"/api/expenses?id={quote(expense_id)}")
        page_a.wait_for_timeout(500)
        page_a.evaluate("() => window.dispatchEvent(new Event('focus'))")
        page_a.wait_for_timeout(3000)
        gone = page_a.evaluate(
            """(id) => {
                const list = window.expensesData || window.expenses || [];
                return !list.some(e => e && e.id === id && !e.isDeleted);
            }""",
            expense_id,
        )
        audit.record(
            "E a delete on one device clears it on the other",
            gone,
            "device A still shows the deleted expense as active",
        )

        # --- tenant isolation across devices ---------------------------------
        ctx_c = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        page_c = ctx_c.new_page()
        try:
            login(page_c, "sanjay", "Household123!")          # owner of H002
            api_c = make_api(page_c)
            other = api_c("GET", "/api/expenses").get("data") or []
            audit.record(
                "E a device in another household never receives H001 records",
                all(e.get("id") != expense_id for e in other),
                "an H002 session can see an H001 expense",
            )
        finally:
            ctx_c.close()

    finally:
        ctx_a.close()
        ctx_b.close()


def audit_admin_management(browser, audit):
    """Section D/E: creating and editing households and users through the real
    admin UI on a phone - not through the API the existing suites already cover.
    Every change is verified against the API and by signing in as the user."""
    print("\n[E] admin household and user management through the UI")

    ctx = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    attach_listeners(page, audit)
    stamp = str(int(time.time()))[-6:]
    new_username = f"qa{stamp}"

    try:
        login(page, "admin", "Admin@123")
        api = make_api(page)
        audit.record(
            "E the admin signs in as SYSTEM_ADMIN",
            page.evaluate("() => (window.currentSessionUser||{}).role") == "SYSTEM_ADMIN",
            "the admin session does not carry the SYSTEM_ADMIN role",
        )

        goto_tab(page, "admin")
        page.wait_for_timeout(1500)

        # The tenant-management card used to be gated on role === 'ADMIN', which
        # hid it from SYSTEM_ADMIN entirely - the admin console was unreachable.
        audit.record(
            "E the tenant management card is visible to the admin",
            page.evaluate("""() => {
                const c = document.getElementById('adminTenantManagementCard');
                return !!c && !c.classList.contains('hidden') && c.offsetHeight > 0;
            }"""),
            "the household/user management card is hidden from SYSTEM_ADMIN",
        )
        audit.record(
            "E the admin directory is populated",
            page.evaluate("""() => (typeof adminDirectoryData !== 'undefined'
                && adminDirectoryData.households
                && adminDirectoryData.households.length > 0)"""),
            "adminDirectoryData.households is empty, so every row action is dead",
        )

        def overview():
            return api("GET", "/api/auth?action=admin_overview")

        # --- create a household ---------------------------------------------
        before = overview()
        page.evaluate("() => (window.openCreateHouseholdModal ? openCreateHouseholdModal() : null)")
        page.wait_for_timeout(600)
        household_name = f"QA Household {stamp}"
        page.fill("#createHouseholdName", household_name)
        page.fill("#createHouseholdBudget", "64250")     # would have failed the old step=1000 min=5000
        page.evaluate("submitCreateHousehold()")
        page.wait_for_timeout(2500)

        after = overview()
        made = next((h for h in (after.get("households") or [])
                     if h.get("householdName") == household_name), None)
        audit.record("E a household can be created from the admin UI", made is not None,
                     f"no household named {household_name!r} after submitting")
        audit.record(
            "E the household count went up by exactly one",
            len(after.get("households") or []) == len(before.get("households") or []) + 1,
            f"{len(before.get('households') or [])} -> {len(after.get('households') or [])}",
        )
        if not made:
            return
        household_id = made.get("householdId")
        # The budget lives in the household's own config, not on the household
        # record in the directory listing.
        new_cfg = api("GET", f"/api/config?householdId={quote(household_id)}")
        new_budget = (new_cfg.get("data") or {}).get("monthlyBudgetLimit")
        audit.record(
            "E the household budget is stored exactly as entered",
            new_budget == 64250,
            f"stored budget is {new_budget!r}, expected 64250",
        )

        # --- edit the household ---------------------------------------------
        page.evaluate("(id) => openEditHouseholdModal(id)", household_id)
        page.wait_for_timeout(800)
        audit.record(
            "E the edit-household form is pre-filled",
            page.input_value("#editHouseholdName") == household_name,
            f"name field shows {page.input_value('#editHouseholdName')!r}",
        )
        # The budget shown must belong to THIS household. It used to be read
        # from whichever household was active, so saving overwrote the target's
        # budget with an unrelated number.
        shown_budget = page.input_value("#editHouseholdBudget")
        audit.record(
            "E the edit form shows the budget of the household being edited",
            Number(shown_budget) == 64250,
            f"form shows {shown_budget!r}, but this household's budget is 64250",
        )
        renamed = f"{household_name} Renamed"
        page.fill("#editHouseholdName", renamed)
        page.fill("#editHouseholdBudget", "2805.5")
        page.evaluate("submitEditHousehold()")
        page.wait_for_timeout(2500)

        edited = next((h for h in (overview().get("households") or [])
                       if h.get("householdId") == household_id), {})
        audit.record("E the household rename is saved", edited.get("householdName") == renamed,
                     f"name is {edited.get('householdName')!r}")
        edited_cfg = api("GET", f"/api/config?householdId={quote(household_id)}")
        edited_budget = (edited_cfg.get("data") or {}).get("monthlyBudgetLimit")
        audit.record(
            "E the household budget accepts paise",
            edited_budget == 2805.5,
            f"budget is {edited_budget!r}, expected 2805.5",
        )
        # Editing one household must never disturb another's budget.
        h001 = api("GET", "/api/config?householdId=H001")
        audit.record(
            "E editing one household leaves another household's budget alone",
            (h001.get("data") or {}).get("monthlyBudgetLimit") != 2805.5,
            "H001's budget changed while a different household was being edited",
        )

        # --- create a user in that household ---------------------------------
        page.evaluate("() => (window.openCreateUserModal ? openCreateUserModal() : null)")
        page.wait_for_timeout(800)
        page.fill("#createUserName", f"QA User {stamp}")
        page.fill("#createUserUsername", new_username)
        page.fill("#createUserPassword", "QaUser@12345")
        page.fill("#createUserEmail", f"{new_username}@example.test")
        page.select_option("#createUserHouseholdSelect", household_id)
        page.select_option("#createUserRoleSelect", "MEMBER")
        page.evaluate("submitCreateUser()")
        page.wait_for_timeout(2500)

        made_user = next((u for u in (overview().get("users") or [])
                          if u.get("username") == new_username), None)
        audit.record("E a user can be created from the admin UI", made_user is not None,
                     f"no user {new_username!r} in the admin overview")
        if not made_user:
            return
        user_id = made_user.get("userId") or made_user.get("id")
        audit.record("E the new user lands in the chosen household",
                     made_user.get("householdId") == household_id,
                     f"user household is {made_user.get('householdId')!r}, expected {household_id!r}")
        audit.record("E the new user has the chosen role",
                     made_user.get("role") == "MEMBER",
                     f"role is {made_user.get('role')!r}")

        # The user must actually be able to sign in, in their own context.
        probe = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage = probe.new_page()
        try:
            login(ppage, new_username, "QaUser@12345")
            audit.record(
                "E the created user can sign in and is scoped to their household",
                ppage.evaluate("() => (window.currentSessionUser||{}).householdId") == household_id,
                "the new user signed in with the wrong household context",
            )
        except PWError as e:
            audit.record("E the created user can sign in and is scoped to their household",
                         False, f"login failed: {str(e)[:120]}")
        finally:
            probe.close()

        # --- edit the user ----------------------------------------------------
        page.evaluate("(id) => openEditUserModal(id)", user_id)
        page.wait_for_timeout(800)
        audit.record(
            "E the edit-user form is pre-filled",
            page.input_value("#editUserUsername") == new_username,
            f"username field shows {page.input_value('#editUserUsername')!r}",
        )
        page.fill("#editUserName", f"QA User {stamp} Edited")
        page.select_option("#editUserRoleSelect", "VIEWER")
        page.evaluate("submitEditUser()")
        page.wait_for_timeout(2500)

        edited_user = next((u for u in (overview().get("users") or [])
                            if (u.get("userId") or u.get("id")) == user_id), {})
        audit.record("E the user's display name is updated",
                     edited_user.get("name") == f"QA User {stamp} Edited",
                     f"name is {edited_user.get('name')!r}")
        audit.record("E the user's role is updated",
                     edited_user.get("role") == "VIEWER",
                     f"role is {edited_user.get('role')!r}")

        # A VIEWER must be refused writes - the role change has to have teeth.
        probe2 = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage2 = probe2.new_page()
        try:
            login(ppage2, new_username, "QaUser@12345")
            papi = make_api(ppage2)
            res = papi("POST", "/api/expenses", {
                "date": ppage2.evaluate("() => new Date().toISOString().slice(0,10)"),
                "amount": 10, "category": "Misc", "paidBy": "QA", "notes": "viewer write probe"
            })
            audit.record(
                "E demoting a user to VIEWER actually blocks their writes",
                res.get("success") is False or res.get("status") in (401, 403),
                f"the VIEWER write was accepted: {str(res)[:120]}",
            )
        finally:
            probe2.close()

        # --- password reset ---------------------------------------------------
        page.evaluate("(id) => openEditUserModal(id)", user_id)
        page.wait_for_timeout(800)
        page.fill("#editUserPassword", "QaReset@98765")
        page.evaluate("submitEditUser()")
        page.wait_for_timeout(2500)

        probe3 = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage3 = probe3.new_page()
        try:
            login(ppage3, new_username, "QaReset@98765")
            audit.record("E an admin password reset lets the user sign in with the new password",
                         True)
        except PWError as e:
            audit.record("E an admin password reset lets the user sign in with the new password",
                         False, f"login with the new password failed: {str(e)[:120]}")
        finally:
            probe3.close()

        probe4 = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage4 = probe4.new_page()
        try:
            ppage4.goto(BASE_URL, wait_until="domcontentloaded")
            ppage4.wait_for_selector("#loginForm", timeout=20000)
            ppage4.fill("#loginUsername", new_username)
            ppage4.fill("#loginPassword", "QaUser@12345")      # the old one
            ppage4.click("#btnLoginSubmit")
            ppage4.wait_for_timeout(2500)
            still_in = ppage4.evaluate("() => !!localStorage.getItem('household_auth_token')")
            audit.record("E the old password stops working after a reset", not still_in,
                         "the previous password still signs the user in")
        finally:
            probe4.close()

        # --- deactivate ---------------------------------------------------------
        page.evaluate("(id) => openEditUserModal(id)", user_id)
        page.wait_for_timeout(800)
        page.select_option("#editUserStatusSelect", "disabled")
        page.evaluate("submitEditUser()")
        page.wait_for_timeout(2500)

        deactivated = next((u for u in (overview().get("users") or [])
                            if (u.get("userId") or u.get("id")) == user_id), {})
        audit.record("E a user can be deactivated from the admin UI",
                     deactivated.get("status") in ("disabled", "inactive"),
                     f"status is {deactivated.get('status')!r}")

        probe5 = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage5 = probe5.new_page()
        try:
            ppage5.goto(BASE_URL, wait_until="domcontentloaded")
            ppage5.wait_for_selector("#loginForm", timeout=20000)
            ppage5.fill("#loginUsername", new_username)
            ppage5.fill("#loginPassword", "QaReset@98765")
            ppage5.click("#btnLoginSubmit")
            ppage5.wait_for_timeout(2500)
            got_in = ppage5.evaluate("() => !!localStorage.getItem('household_auth_token')")
            audit.record("E a deactivated user cannot sign in", not got_in,
                         "a deactivated user was still able to sign in")
        finally:
            probe5.close()

        # --- non-admins must not reach any of this ------------------------------
        probe6 = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        ppage6 = probe6.new_page()
        try:
            login(ppage6, "palash", "Household123!")          # OWNER, not admin
            papi6 = make_api(ppage6)
            ov = papi6("GET", "/api/auth?action=admin_overview")
            audit.record(
                "E a household owner cannot read the admin overview",
                ov.get("success") is False or ov.get("status") in (401, 403),
                f"an OWNER received the admin overview: {str(ov)[:120]}",
            )
        finally:
            probe6.close()

    finally:
        ctx.close()


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
                          (audit_expense_round_trip, "D expense round-trip"),
                          (audit_attendance_follows_period, "D attendance calendar"),
                          (audit_expense_view_toggle, "D expense view toggle")):
            try:
                fn(page, audit, api)
            except Exception as e:
                audit.record(label, False, f"audit error: {type(e).__name__}: {e}")

        print("\n[F] layout and tap targets per screen")
        for tab in ["dashboard", "personal", "expenses", "staff", "matrix", "admin", "settings"]:
            goto_tab(page, tab)
            audit_tap_targets(page, audit, tab)
            audit_no_overflow(page, audit, tab)
            audit_no_clipped_controls(page, audit, tab)

        # Multi-context scenarios run in their own browser contexts, which are
        # closed again afterwards.
        try:
            audit_two_device_sync(browser, audit)
        except Exception as e:
            audit.record("E two-device sync", False, f"audit error: {type(e).__name__}: {e}")

        try:
            audit_admin_management(browser, audit)
        except Exception as e:
            audit.record("E admin management", False, f"audit error: {type(e).__name__}: {e}")

        # Runs last: it ends the session, then signs back in.
        try:
            audit_logout(page, audit, api)
        except Exception as e:
            audit.record("E logout", False, f"audit error: {type(e).__name__}: {e}")

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
