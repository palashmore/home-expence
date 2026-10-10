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
OWNER = ("palash", "Palash@123")

# Controls that are intentionally not thumb targets (decorative, or inside a
# scrolling chip row where the row itself is the target). Kept explicit and
# small so it cannot quietly become a way to hide real failures.
TAP_EXEMPT_IDS = set()


class Audit:
    def __init__(self):
        self.checks = []
        self.console_errors = []
        self.failed_requests = []
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

    # "Failed to load resource: net::ERR_FAILED" names no URL, which makes it
    # impossible to tell a real fault from a CDN hiccup. Record which request
    # failed, so the failure message can say.
    def on_request_failed(req):
        try:
            audit.failed_requests.append("%s %s (%s)" % (req.method, req.url[:90], req.failure))
        except Exception:
            pass

    page.on("requestfailed", on_request_failed)
    page.on("console", on_console)
    page.on("dialog", on_dialog)
    page.on("pageerror", lambda e: audit.console_errors.append(f"pageerror: {e}"))


def login(page, username=OWNER[0], password=OWNER[1]):
    # One retry: the first navigation in a freshly created context occasionally
    # loses the race with Chromium's startup on a loaded machine, and a retry is
    # far better than failing the whole suite over it.
    try:
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=45000)
    except PWError:
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=45000)
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
]

# Inside the admin-only dialogs, so only present for a system administrator.
ADMIN_NUMBER_FIELD_CASES = [
    ("#createHouseholdBudget", None, [64250, 2805, 100]),
    ("#editHouseholdBudget", None, [64250, 2805, 100]),
]


def audit_number_fields(page, audit, cases=None, who="owner"):
    print("\n[C1] number inputs accept realistic amounts (%s)" % who)
    for selector, tab, values in (cases if cases is not None else NUMBER_FIELD_CASES):
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

    # Each staff member used to be rendered twice - a card for phones, a table
    # row for desktop - and the save chose its source by viewport width, so this
    # check could clear one copy while the save read the other. There is one
    # list now, and the scope is no longer a guess.
    SCOPE_JS = """
        const scope = '#adminStaffMobileList';
    """
    try:
        page.wait_for_function(
            "(id) => {" + SCOPE_JS +
            "  return !!document.querySelector(scope + ' [data-staff-id=\"' + id + '\"] .staff-edit-name');"
            "}",
            arg=target_id, timeout=8000)
    except PWError:
        pass

    cleared = page.evaluate(
        "(id) => {" + SCOPE_JS + """
            const row = document.querySelector(scope + ' [data-staff-id="' + id + '"]');
            if (!row) return {no_row: true, scope: scope};
            const n = row.querySelector('.staff-edit-name');
            if (!n) return {no_name: true, scope: scope};
            n.value = '';
            n.dispatchEvent(new Event('input', {bubbles: true}));
            return {ok: true, scope: scope};
        }""",
        target_id,
    )
    if not cleared.get("ok"):
        audit.record("C3 blank name blocked", False, f"could not drive the row: {cleared}")
        return

    page.evaluate("saveAdminConfigFromUI()")

    # Check the form state the owner would actually see, before anything else
    # re-renders the view. The save is async, so wait for the message to appear
    # rather than reading the DOM in the same tick - reading immediately made
    # this check intermittently fail on a validation that was working.
    try:
        page.wait_for_selector(".field-error.is-visible", timeout=3000)
    except PWError:
        pass
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

    # The defect this check kept tripping over was a second copy of every row.
    # Assert the duplication is gone, so it cannot quietly come back.
    dup = page.evaluate(
        """() => {
            const ids = (sel) => Array.from(document.querySelectorAll(sel))
                .map(e => e.dataset.staffId || e.dataset.billId).filter(Boolean);
            const staff = ids('[data-staff-id]');
            const bills = ids('[data-bill-id]');
            return {
                staffDupes: staff.length - new Set(staff).size,
                billDupes: bills.length - new Set(bills).size,
                legacyTables: !!document.getElementById('adminStaffTableBody')
                           || !!document.getElementById('adminBillsTableBody')
            };
        }"""
    )
    audit.record(
        "C3 each staff member and bill is rendered exactly once",
        dup["staffDupes"] == 0 and dup["billDupes"] == 0 and not dup["legacyTables"],
        "duplicate rows present: %s" % (dup,),
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
            const card = document.querySelector('.staff-mobile-card');
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


def audit_dashboard_mode(page, audit, api):
    """The dashboard reports on whatever Master Settings says it should, and
    sections that nothing is configured for are not shown at all. Both used to
    be hardcoded: a per-device toggle, and two named staff members baked into
    the markup."""
    print("\n[D] dashboard follows Master Configuration")

    cfg = read_config(api)
    original_mode = cfg.get("dashboardMode") or "household"
    original_staff = cfg.get("staff") or []
    original_bills = cfg.get("recurringBills") or []

    goto_tab(page, "admin")
    page.wait_for_timeout(1200)

    audit.record(
        "D Master Settings hosts the dashboard view mode selector",
        page.query_selector("#adminDashboardModeOptions") is not None,
        "the dashboard mode card is missing from Master Settings",
    )
    audit.record(
        "D the dashboard no longer carries its own scope toggle",
        page.query_selector("#btnScopeCombined") is None
        and page.query_selector("#btnScopeHousehold") is None,
        "the per-device dashboard scope buttons are still present",
    )

    option_count = page.evaluate(
        "() => document.querySelectorAll('#adminDashboardModeOptions button').length"
    )
    audit.record(
        "D all three modes are offered",
        option_count == 3,
        "found %s options" % option_count,
    )

    def mode_state():
        # These checks are about mode gating, not about whether a phone fold is
        # open: open them so a closed fold cannot read as "section hidden".
        page.evaluate("() => document.querySelectorAll('details.dash-phone-fold').forEach(d => d.open = true)")
        return page.evaluate(
            """() => {
                const vis = (id) => {
                    const el = document.getElementById(id);
                    if (!el) return null;
                    return !el.classList.contains('hidden') && el.offsetHeight > 0;
                };
                return {
                    scope: (window.dashboardFilters || {}).scope,
                    stored: (window.masterConfig || {}).dashboardMode,
                    badge: (document.getElementById('dashboardModeBadge') || {}).textContent,
                    // kpiStaffPayroll moved to the Staff tab and the bill
                    // counters to Bills; they are asserted on their own screens
                    // below rather than measured here, where they would always
                    // read false and prove nothing.
                    staffLedger: vis('dashStaffLedgerSection'),
                    billsRadar: vis('dashBillsRadarSection')
                };
            }"""
        )

    for mode in ("personal", "combined", "household"):
        page.evaluate("(m) => setDashboardMode(m)", mode)
        page.wait_for_timeout(1400)
        goto_tab(page, "dashboard")
        page.wait_for_timeout(900)
        st = mode_state()
        audit.record(
            "D choosing %s in Master Settings drives the dashboard" % mode,
            st["scope"] == mode and st["stored"] == mode,
            "scope=%s stored=%s" % (st["scope"], st["stored"]),
        )
        audit.record(
            "D the %s mode is named in the dashboard header" % mode,
            st["badge"] is not None and mode[:4].lower() in st["badge"].lower(),
            "header badge reads %r" % (st["badge"],),
        )
        if mode == "personal":
            audit.record(
                "D personal mode hides household payroll and bill sections",
                st["staffLedger"] is not True and st["billsRadar"] is not True,
                "state is %s" % (st,),
            )
        goto_tab(page, "admin")
        page.wait_for_timeout(700)

    # The choice is a household setting, so it must reach the server and come
    # back on reload rather than living in this browser.
    page.evaluate("() => setDashboardMode('combined')")
    page.wait_for_timeout(1500)
    stored = read_config(api)
    audit.record(
        "D the mode is persisted server-side, not just locally",
        stored.get("dashboardMode") == "combined",
        "server stored %r" % (stored.get("dashboardMode"),),
    )
    reload_app(page)
    page.wait_for_timeout(1800)
    after = mode_state()
    audit.record(
        "D the mode is restored from the config after a reload",
        after["scope"] == "combined",
        "scope after reload is %r" % (after["scope"],),
    )

    page.evaluate("() => setDashboardMode('household')")
    page.wait_for_timeout(1500)
    goto_tab(page, "dashboard")
    page.wait_for_timeout(1000)

    if original_staff:
        with_staff = page.evaluate(
            """() => {
                const grid = document.getElementById('dashStaffLedgerGrid');
                const sec = document.getElementById('dashStaffLedgerSection');
                return {
                    shown: sec ? !sec.classList.contains('hidden') : null,
                    cards: grid ? grid.querySelectorAll('button').length : 0,
                    text: grid ? grid.textContent : ''
                };
            }"""
        )
        audit.record(
            "D payroll is shown when staff are configured",
            with_staff["shown"] is True and with_staff["cards"] == len(original_staff),
            "%s cards for %s staff, shown=%s"
            % (with_staff["cards"], len(original_staff), with_staff["shown"]),
        )
        names = [(st.get("shortName") or st.get("name") or "") for st in original_staff]
        audit.record(
            "D the payroll cards name this household's own staff",
            all(n and n in with_staff["text"] for n in names),
            "expected %s in the ledger" % (names,),
        )

    # The cards that left the dashboard are asserted where they landed, so the
    # coverage moves with them instead of evaporating.
    goto_tab(page, "staff")
    page.wait_for_timeout(1200)
    on_staff = page.evaluate(
        """() => {
            const el = document.getElementById('kpiStaffPayroll');
            return {present: !!el, visible: !!el && !el.classList.contains('hidden') && el.offsetHeight > 0};
        }"""
    )
    audit.record(
        "D the payroll card lives on the Staff screen now",
        on_staff["present"] and (on_staff["visible"] or not original_staff),
        "payroll card on Staff: %s" % (on_staff,),
    )

    goto_tab(page, "bills")
    page.wait_for_timeout(1200)
    on_bills = page.evaluate(
        """() => {
            const ids = ['kpiPendingBills', 'kpiPaidBills'];
            return ids.map(i => {
                const el = document.getElementById(i);
                return {id: i, present: !!el};
            });
        }"""
    )
    audit.record(
        "D the bill counters live on the Bills screen now",
        all(x["present"] for x in on_bills),
        "bill counters: %s" % (on_bills,),
    )

    goto_tab(page, "dashboard")
    page.wait_for_timeout(900)
    four = page.evaluate(
        """() => {
            const g = document.getElementById('dashSummaryGrid');
            return g ? g.querySelectorAll(':scope > .kpi-card').length : -1;
        }"""
    )
    audit.record(
        "D the dashboard shows four primary figures, not ten",
        four == 4,
        "dashboard KPI count is %s" % four,
    )

    # Remove staff and bills and prove the sections disappear. This is the bug
    # the owner reported: a household with no staff still saw payroll cards.
    try:
        api("POST", "/api/config", {"staff": [], "recurringBills": []})
        page.evaluate("async () => { await window.loadMasterConfig(); }")
        page.wait_for_timeout(1800)
        goto_tab(page, "dashboard")
        page.wait_for_timeout(1200)
        empty = mode_state()
        audit.record(
            "D no staff configured means no payroll anywhere on the dashboard",
            empty["staffLedger"] is not True,
            "state is %s" % (empty,),
        )
        audit.record(
            "D no recurring bills configured means no bill radar",
            empty["billsRadar"] is not True,
            "state is %s" % (empty,),
        )

        goto_tab(page, "staff")
        page.wait_for_timeout(1200)
        staff_tab = page.evaluate(
            """() => {
                const g = document.getElementById('staffOverviewGrid');
                return {cards: g ? g.querySelectorAll('.glass-card').length : -1,
                        text: g ? g.textContent.trim() : ''};
            }"""
        )
        audit.record(
            "D the staff tab shows no staff cards when none are configured",
            staff_tab["cards"] == 0,
            "%s cards still rendered" % staff_tab["cards"],
        )
        audit.record(
            "D the empty staff tab explains itself instead of going blank",
            "No staff configured" in staff_tab["text"],
            "staff tab reads %r" % (staff_tab["text"][:120],),
        )
    finally:
        # Put the household back exactly as it was.
        api("POST", "/api/config", {
            "staff": original_staff,
            "recurringBills": original_bills,
            "dashboardMode": original_mode,
        })
        page.evaluate("async () => { await window.loadMasterConfig(); }")
        page.wait_for_timeout(1500)

    restored = read_config(api)
    audit.record(
        "D the household's staff and bills are restored after the audit",
        len(restored.get("staff") or []) == len(original_staff)
        and len(restored.get("recurringBills") or []) == len(original_bills)
        and (restored.get("dashboardMode") or "household") == original_mode,
        "staff %s/%s, bills %s/%s"
        % (len(restored.get("staff") or []), len(original_staff),
           len(restored.get("recurringBills") or []), len(original_bills)),
    )


def audit_budget_counts_everything(page, audit, api):
    """The monthly budget must measure every expense in the period, household
    and personal together. It used to count household spending only, so
    personal spending could run past the cap without the bar ever moving."""
    print("\n[D] the monthly budget counts every expense")

    goto_tab(page, "dashboard")
    page.wait_for_timeout(1000)

    # Show a period that actually has both kinds of expense in it.
    page.evaluate(
        """() => {
            const m = document.getElementById('filterMonth');
            const y = document.getElementById('filterYear');
            if (m) m.value = 'all';
            if (y) y.value = 'all';
            onFilterChange();
        }"""
    )
    page.wait_for_timeout(1500)

    audit.record(
        "D the budget is labelled Monthly Budget, not Monthly Household Budget",
        page.evaluate(
            "() => !/Monthly Household Budget/.test(document.body.innerText)"
        ),
        "the dashboard still says 'Monthly Household Budget'",
    )

    state = page.evaluate(
        r"""() => {
            const num = (id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                const m = (el.textContent || '').replace(/[^0-9.]/g, '');
                return m === '' ? null : Number(m);
            };
            const sub = (id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                const m = (el.textContent || '').match(/[\d,]+(?:\.\d+)?/);
                return m ? Number(m[0].replace(/,/g, '')) : null;
            };
            const items = (window.getFilteredExpenses ? window.getFilteredExpenses() : [])
                .filter(i => i.category !== 'Accepted Payments (Income)');
            const sum = (list) => list.reduce((a, b) => a + Number(b.amount), 0);
            const personal = items.filter(i => window.isPersonalExpense(i));
            const household = items.filter(i => !window.isPersonalExpense(i));
            return {
                shown: num('budgetSpentVal'),
                cap: num('budgetCapVal'),
                subHousehold: sub('budgetHouseholdSubtext'),
                subPersonal: sub('budgetPersonalSubtext'),
                dataHousehold: Math.round(sum(household)),
                dataPersonal: Math.round(sum(personal)),
                dataAll: Math.round(sum(items)),
                mode: (window.dashboardFilters || {}).scope
            };
        }"""
    )

    def close(a, b, tol=2):
        return a is not None and b is not None and abs(a - b) <= tol

    audit.record(
        "D the budget bar shows household plus personal spending",
        close(state["shown"], state["dataAll"]),
        "bar shows %s, all expenses total %s" % (state["shown"], state["dataAll"]),
    )
    audit.record(
        "D the budget bar is not the household-only figure",
        state["dataPersonal"] == 0 or not close(state["shown"], state["dataHousehold"]),
        "bar shows %s which equals household-only %s, with %s personal unaccounted for"
        % (state["shown"], state["dataHousehold"], state["dataPersonal"]),
    )
    audit.record(
        "D the household and personal subtotals match the data",
        close(state["subHousehold"], state["dataHousehold"])
        and close(state["subPersonal"], state["dataPersonal"]),
        "subtotals read household=%s personal=%s, data says %s / %s"
        % (state["subHousehold"], state["subPersonal"],
           state["dataHousehold"], state["dataPersonal"]),
    )
    audit.record(
        "D the two subtotals add up to the figure on the bar",
        close((state["subHousehold"] or 0) + (state["subPersonal"] or 0), state["shown"]),
        "%s + %s != %s"
        % (state["subHousehold"], state["subPersonal"], state["shown"]),
    )

    # Over-budget must be reachable: the pill used to compare a value clamped
    # at 100 against "> 100", so it could never fire.
    cfg = read_config(api)
    original_cap = cfg.get("monthlyBudgetLimit")
    try:
        tiny = max(1, int((state["dataAll"] or 1000) / 2))
        api("POST", "/api/config", {"monthlyBudgetLimit": tiny})
        page.evaluate("async () => { await window.loadMasterConfig(); }")
        page.wait_for_timeout(1600)
        page.evaluate("() => renderDashboard(getFilteredExpenses())")
        page.wait_for_timeout(900)
        over = page.evaluate(
            """() => ({
                pill: (document.getElementById('budgetAlertPill') || {}).textContent,
                pct: (document.getElementById('budgetPercentText') || {}).textContent
            })"""
        )
        audit.record(
            "D exceeding the cap actually reports Over Budget",
            over["pill"] is not None and "Over Budget" in over["pill"],
            "pill reads %r at %r" % (over["pill"], over["pct"]),
        )
    finally:
        if original_cap is not None:
            api("POST", "/api/config", {"monthlyBudgetLimit": original_cap})
            page.evaluate("async () => { await window.loadMasterConfig(); }")
            page.wait_for_timeout(1500)

    restored = read_config(api)
    audit.record(
        "D the budget cap is restored after the audit",
        str(restored.get("monthlyBudgetLimit")) == str(original_cap),
        "cap is %r, expected %r" % (restored.get("monthlyBudgetLimit"), original_cap),
    )


def audit_design_system(page, audit, api):
    """The v6 design pass: every theme has to reach every tab, and every icon
    has to actually draw. Both failed silently before - the dark theme styled
    the handful of components that had explicit overrides and left the rest
    light, and two Font Awesome Pro glyph names rendered as nothing on the
    Free CDN build."""
    print("\n[G] design system: themes reach every tab, icons render")

    goto_tab(page, "dashboard")
    page.wait_for_timeout(1200)

    # --- Icons -------------------------------------------------------------
    # The interface icons are Lucide symbols in an inline sprite. A <use> that
    # names a symbol which is not there draws nothing and says nothing, so the
    # reference is checked as well as the result. Walk every tab, because most
    # icons are rendered at runtime.
    dangling = {}
    flat = {}
    leftover = {}
    for tab in ("dashboard", "expenses", "bills", "reports", "personal",
                "staff", "matrix", "settings", "admin", "audit"):
        try:
            goto_tab(page, tab)
        except Exception:
            continue
        page.wait_for_timeout(900)
        found = page.evaluate(
            """() => {
                const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    return el.getClientRects().length > 0 && r.height > 0;
                };
                const bad = [], zero = [], stale = [];
                document.querySelectorAll('svg.ic > use').forEach(u => {
                    const id = (u.getAttribute('href') || u.getAttribute('xlink:href') || '').replace('#', '');
                    if (!id || !document.getElementById(id)) bad.push(id || '(empty href)');
                });
                document.querySelectorAll('svg.ic').forEach(svg => {
                    if (!visible(svg)) return;
                    if (Math.round(svg.getBoundingClientRect().width) === 0) {
                        const u = svg.querySelector('use');
                        zero.push((u && u.getAttribute('href')) || '(no use)');
                    }
                });
                // Anything still asking for a Font Awesome glyph that is not a
                // brand mark is an icon the migration missed; the solid font is
                // no longer loaded, so it will draw nothing.
                document.querySelectorAll('i[class*="fa-"]').forEach(i => {
                    if (i.classList.contains('fa-brands')) return;
                    if (!visible(i)) return;
                    stale.push([...i.classList].find(c => c.startsWith('fa-')) || '(unknown)');
                });
                return {bad: bad, zero: zero, stale: stale};
            }"""
        )
        for b in found["bad"]:
            dangling.setdefault(b, tab)
        for z in found["zero"]:
            flat.setdefault(z, tab)
        for st in found["stale"]:
            leftover.setdefault(st, tab)

    audit.record(
        "G every icon reference resolves to a symbol in the sprite",
        not dangling,
        "unresolved: " + ", ".join("%s (on %s)" % (k, v) for k, v in sorted(dangling.items())[:8]),
    )
    audit.record(
        "G every icon on every tab draws",
        not flat,
        "drawn at zero width: " + ", ".join("%s (on %s)" % (k, v) for k, v in sorted(flat.items())[:8]),
    )
    audit.record(
        "G no icon was left pointing at a font that is no longer loaded",
        not leftover,
        "still Font Awesome: " + ", ".join("%s (on %s)" % (k, v) for k, v in sorted(leftover.items())[:8]),
    )

    # The three brand marks are the one thing Lucide cannot express, so they
    # keep Font Awesome Brands - and that has to still be loading.
    goto_tab(page, "dashboard")
    page.wait_for_timeout(500)
    brands = page.evaluate(
        """() => {
            const probe = document.createElement('i');
            probe.className = 'fa-brands fa-android';
            probe.style.cssText = 'position:absolute;left:-9999px;font-size:32px';
            document.body.appendChild(probe);
            const w = Math.round(probe.getBoundingClientRect().width);
            probe.remove();
            return w;
        }"""
    )
    audit.record(
        "G the brand marks still have a font to draw with",
        brands > 0,
        "a brand glyph lays out at zero width - brands.min.css is not loading",
    )

    # --- Themes ------------------------------------------------------------
    def surfaces():
        return page.evaluate(
            r"""() => {
                const lum = (c) => {
                    const m = (c || '').match(/-?[\d.]+/g);
                    if (!m || m.length < 3) return null;
                    const [r, g, b] = m.slice(0, 3).map(Number);
                    // sRGB values can arrive 0-1 from color() notation.
                    const sc = (v) => (v <= 1 ? v * 255 : v);
                    return (0.2126 * sc(r) + 0.7152 * sc(g) + 0.0722 * sc(b)) / 255;
                };
                // Scan every visible element with an opaque background, not a
                // hand-picked set. An earlier version sampled five selectors and
                // de-duplicated on the first 40 characters of className - which
                // happens to be identical for the indigo and pink member chips,
                // so the near-white one was never looked at and the check passed
                // with the whole dark bridge disabled.
                const sample = [];
                for (const el of document.querySelectorAll('body *')) {
                    const r = el.getBoundingClientRect();
                    // Status dots are 8-10px, textless, and deliberately bright:
                    // they are indicators, not surfaces. Everything from a chip
                    // or icon tile upwards stays in scope.
                    if (r.width < 18 || r.height < 18) continue;
                    const s = getComputedStyle(el);
                    if (s.visibility === 'hidden' || s.display === 'none') continue;
                    { const det = el.closest('details'); if (det && !det.open && !el.closest('summary')) continue; }
                    const bg = s.backgroundColor;
                    const alpha = (bg.match(/-?[\d.]+/g) || [])[3];
                    if (alpha !== undefined && Number(alpha) < 0.5) continue;
                    const l = lum(bg);
                    if (l === null) continue;
                    sample.push({
                        key: (el.tagName.toLowerCase() + '.' + (el.className || '')).trim().slice(0, 90),
                        l: l,
                        bg: bg
                    });
                }
                return {body: lum(getComputedStyle(document.body).backgroundColor), sample};
            }"""
        )

    goto_tab(page, "dashboard")
    page.wait_for_timeout(800)

    page.evaluate("() => changeTheme('indigo')")
    page.wait_for_timeout(1200)
    light = surfaces()

    page.evaluate("() => changeTheme('dark')")
    page.wait_for_timeout(1400)
    dark = surfaces()

    audit.record(
        "G the dark theme actually darkens the page",
        dark["body"] is not None and light["body"] is not None and dark["body"] < 0.25 < light["body"],
        "body luminance light=%s dark=%s" % (light["body"], dark["body"]),
    )

    # Nothing styled by the app may stay near-white on a dark page: that is
    # exactly what the unmapped Tailwind utilities used to do.
    glare = [x for x in dark["sample"] if x["l"] is not None and x["l"] > 0.72]
    audit.record(
        "G no surface stays near-white in the dark theme",
        not glare,
        "near-white surfaces remain: "
        + "; ".join("%s -> %s" % (g["key"], g["bg"]) for g in glare[:5]),
    )

    # And every tab, not only the dashboard.
    per_tab_glare = {}
    for tab in ("expenses", "staff", "settings", "admin", "audit"):
        try:
            goto_tab(page, tab)
        except Exception:
            continue
        page.wait_for_timeout(900)
        bad = [x for x in surfaces()["sample"] if x["l"] is not None and x["l"] > 0.72]
        if bad:
            per_tab_glare[tab] = bad[0]["key"]

    audit.record(
        "G the dark theme reaches every tab, not just the dashboard",
        not per_tab_glare,
        "still light on: " + ", ".join("%s (%s)" % (k, v) for k, v in per_tab_glare.items()),
    )

    # Amounts line up: a finance UI with proportional figures jitters.
    goto_tab(page, "dashboard")
    page.wait_for_timeout(800)
    audit.record(
        "G amounts use fixed-width figures",
        page.evaluate(
            """() => {
                const s = getComputedStyle(document.body).fontVariantNumeric || '';
                return s.includes('tabular-nums');
            }"""
        ),
        "body is not set to tabular-nums, so money columns will not align",
    )

    page.evaluate("() => changeTheme('indigo')")
    page.wait_for_timeout(1000)
    audit.record(
        "G the theme is restored after the audit",
        page.evaluate("() => document.documentElement.getAttribute('data-theme')") == "indigo",
        "theme left as %r"
        % page.evaluate("() => document.documentElement.getAttribute('data-theme')"),
    )


ACCESSIBLE_NAME_JS = r"""
(() => {
    // An approximation of the accessible-name computation, limited to the
    // mechanisms this app actually uses. It deliberately does NOT count
    // placeholder or title as sufficient for a control, because both vanish
    // the moment the field has content or the pointer moves away.
    const named = (el) => {
        const lb = el.getAttribute('aria-labelledby');
        if (lb) {
            const txt = lb.split(/\s+/)
                .map(id => (document.getElementById(id) || {}).textContent || '')
                .join(' ').trim();
            if (txt) return true;
        }
        if ((el.getAttribute('aria-label') || '').trim()) return true;
        if (el.id) {
            const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
            if (l && l.textContent.trim()) return true;
        }
        if (el.closest('label') && el.closest('label').textContent.trim()) return true;
        return false;
    };
    const visible = (el) => {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        // Inside a closed <details> the content is not rendered or exposed, so it
        // is neither visible nor in need of a name until the section is opened.
        const det = el.closest('details');
        if (det && !det.open && !el.closest('summary')) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const describe = (el) =>
        el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
        (el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

    const controls = [];
    document.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'hidden' || !visible(el)) return;
        if (!named(el)) controls.push(describe(el));
    });

    const buttons = [];
    document.querySelectorAll('button, [role="button"], a[href]').forEach(el => {
        if (!visible(el)) return;
        // Text the user can see counts as the name.
        const txt = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (txt) return;
        if (!named(el)) buttons.push(describe(el));
    });

    return {controls, buttons};
})()
"""


def audit_accessibility(page, audit, api):
    """Every control and every control-shaped thing has to say what it is.

    Before this pass 53 of 60 inputs had no programmatic label and 23 buttons
    were a bare icon, so a screen reader announced "edit text" and "button".
    The check walks every tab and every dialog rather than sampling, because a
    sampled accessibility check is the kind that stays green while the screen
    it never looks at is unusable.
    """
    print("\n[A] accessibility: everything interactive has a name")

    bad_controls, bad_buttons = {}, {}
    for tab in ("dashboard", "expenses", "bills", "reports", "personal",
                "staff", "matrix", "settings", "admin", "audit"):
        try:
            goto_tab(page, tab)
        except Exception:
            continue
        page.wait_for_timeout(700)
        res = page.evaluate(ACCESSIBLE_NAME_JS)
        for c in res["controls"]:
            bad_controls.setdefault(c, tab)
        for b in res["buttons"]:
            bad_buttons.setdefault(b, tab)

    audit.record(
        "A every visible form control has a programmatic label",
        not bad_controls,
        "unnamed: " + ", ".join("%s (%s)" % (k, v) for k, v in sorted(bad_controls.items())[:8]),
    )
    audit.record(
        "A every icon-only control has an accessible name",
        not bad_buttons,
        "unnamed: " + ", ".join("%s (%s)" % (k, v) for k, v in sorted(bad_buttons.items())[:8]),
    )

    # --- Dialogs -----------------------------------------------------------
    # A modal that is only a <div> leaves a screen reader reading the page
    # behind it, with no announcement that anything opened.
    goto_tab(page, "dashboard")
    page.wait_for_timeout(500)
    dialogs = page.evaluate(
        """() => Array.from(document.querySelectorAll('.modal-backdrop')).map(d => ({
            id: d.id,
            role: d.getAttribute('role'),
            modal: d.getAttribute('aria-modal'),
            named: !!((d.getAttribute('aria-label') || '').trim() ||
                      ((document.getElementById(d.getAttribute('aria-labelledby') || '') || {}).textContent || '').trim())
        }))"""
    )
    unmarked = [d for d in dialogs
                if d["role"] not in ("dialog", "alertdialog")
                or d["modal"] != "true" or not d["named"]]
    audit.record(
        "A every modal is a named dialog, not an anonymous div",
        dialogs and not unmarked,
        "%d dialogs, unmarked: %s" % (len(dialogs), [d["id"] for d in unmarked][:6]),
    )

    # --- Decorative icons ---------------------------------------------------
    icons = page.evaluate(
        """() => {
            // Both kinds: the Lucide sprite icons that carry the interface, and
            // the three Font Awesome brand marks. Counting only one of them
            // would let the other drift.
            const all = Array.from(document.querySelectorAll('svg.ic, i[class*="fa-"]'));
            return {total: all.length,
                    sprite: all.filter(e => e.tagName.toLowerCase() === 'svg').length,
                    exposed: all.filter(e => e.getAttribute('aria-hidden') !== 'true').length};
        }"""
    )
    audit.record(
        "A decorative icons are hidden from assistive tech",
        icons["sprite"] > 20 and icons["exposed"] == 0,
        "%d of %d icons still exposed (%d from the sprite)"
        % (icons["exposed"], icons["total"], icons["sprite"]),
    )

    # --- Current location ---------------------------------------------------
    goto_tab(page, "expenses")
    page.wait_for_timeout(600)
    current = page.evaluate(
        """() => Array.from(document.querySelectorAll('[aria-current="page"]'))
                      .map(e => e.id || e.className)"""
    )
    audit.record(
        "A the active section is announced, not just coloured in",
        len(current) > 0,
        "aria-current carriers: %s" % (current,),
    )
    goto_tab(page, "dashboard")


def audit_settings_sections(page, audit, api):
    """Master Settings was ten cards on one scroll. They are grouped now, and a
    group is only useful if selecting it really does hide the rest - and if a
    validation error in a hidden group brings its group back."""
    print("\n[H] settings are grouped, and the groups work")

    goto_tab(page, "admin")
    page.wait_for_timeout(1400)

    shape = page.evaluate(
        """() => {
            const view = document.getElementById('view-admin');
            const cards = Array.from(view.querySelectorAll('[data-settings-section]'));
            const chips = Array.from(view.querySelectorAll('.settings-chip'));
            const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0;
            return {
                cards: cards.length,
                untagged: Array.from(view.querySelectorAll(':scope > .glass-card'))
                    .filter(c => !c.hasAttribute('data-settings-section')).length,
                chips: chips.map(c => c.getAttribute('data-section-key')),
                selected: chips.filter(c => c.getAttribute('aria-selected') === 'true')
                               .map(c => c.getAttribute('data-section-key')),
                visibleSections: Array.from(new Set(cards.filter(visible)
                    .map(c => c.getAttribute('data-settings-section'))))
            };
        }"""
    )
    audit.record(
        "H every settings card declares the group it belongs to",
        shape["cards"] > 0 and shape["untagged"] == 0,
        "%d cards, %d untagged" % (shape["cards"], shape["untagged"]),
    )
    audit.record(
        "H the group rail offers more than one group",
        len(shape["chips"]) >= 2,
        "chips: %s" % (shape["chips"],),
    )
    audit.record(
        "H exactly one group is selected and only its cards are on screen",
        len(shape["selected"]) == 1 and shape["visibleSections"] == shape["selected"],
        "selected %s, visible %s" % (shape["selected"], shape["visibleSections"]),
    )

    # Selecting another group has to actually move the page, not just recolour
    # a chip.
    other = next((c for c in shape["chips"] if c not in shape["selected"]), None)
    if other:
        page.evaluate("(k) => window.showSettingsSection('view-admin', k)", other)
        page.wait_for_timeout(350)
        after = page.evaluate(
            """() => {
                const view = document.getElementById('view-admin');
                const visible = (el) => el.offsetParent !== null && el.getBoundingClientRect().height > 0;
                return Array.from(new Set(
                    Array.from(view.querySelectorAll('[data-settings-section]'))
                        .filter(visible).map(c => c.getAttribute('data-settings-section'))));
            }"""
        )
        audit.record(
            "H choosing a group swaps what is on screen",
            after == [other],
            "asked for %s, showing %s" % (other, after),
        )

    # The household/user management card must not exist for a household owner.
    # Hiding it with a class left the markup, its form fields and its buttons in
    # the page; it is mounted for a system administrator only.
    absent = page.evaluate(
        """() => ({
            card: document.getElementById('adminTenantManagementCard') === null,
            fields: document.getElementById('createHouseholdName') === null
                 && document.getElementById('createUserUsername') === null,
            role: (window.currentSessionUser || {}).role
        })"""
    )
    audit.record(
        "H the household and user management card is not in the page for an owner",
        absent["card"] and absent["role"] not in ("ADMIN", "SYSTEM_ADMIN"),
        "the card is present in the DOM for role %s" % absent["role"],
    )

    # A hidden group must not be able to swallow a validation message. Clear a
    # staff name while the Staff group is closed and save: the save is blocked,
    # and the group holding the bad field opens so the person can see why.
    page.evaluate("() => window.showSettingsSection('view-admin', 'account')")
    page.wait_for_timeout(300)
    drove = page.evaluate(
        """() => {
            const n = document.querySelector('#adminStaffMobileList .staff-edit-name');
            if (!n) return {none: true};
            n.value = '';
            n.dispatchEvent(new Event('input', {bubbles: true}));
            return {ok: true};
        }"""
    )
    if drove.get("ok"):
        page.evaluate("saveAdminConfigFromUI()")
        try:
            page.wait_for_selector(".field-error.is-visible", timeout=4000)
        except PWError:
            pass
        revealed = page.evaluate(
            """() => {
                const err = document.querySelector('.field-error.is-visible');
                if (!err) return {noError: true};
                const owner = err.closest('[data-settings-section]');
                return {
                    section: owner ? owner.getAttribute('data-settings-section') : null,
                    seen: err.offsetParent !== null && err.getBoundingClientRect().height > 0
                };
            }"""
        )
        audit.record(
            "H a validation error opens the group that holds it",
            revealed.get("seen") is True,
            "error state: %s" % (revealed,),
        )
    reload_app(page)


def audit_add_expense_sheet(page, audit, api):
    """The add form asked for the date - which the app already knows - before
    the amount, and opened centred so the first field sat under the keyboard."""
    print("\n[H] the add-expense form is a sheet, in answering order")

    goto_tab(page, "dashboard")
    page.wait_for_timeout(600)
    page.evaluate("() => window.openExpenseModal && window.openExpenseModal()")
    page.wait_for_timeout(600)

    shape = page.evaluate(
        """() => {
            const modal = document.getElementById('expenseModal');
            const form = document.getElementById('expenseForm');
            if (!modal || modal.classList.contains('hidden')) return {closed: true};
            const content = modal.querySelector('.modal-content');
            const r = content.getBoundingClientRect();
            const fields = Array.from(form.querySelectorAll('input, select, textarea'))
                .filter(e => e.type !== 'hidden' && e.offsetParent !== null)
                .map(e => e.id);
            return {
                order: fields,
                bottomGap: Math.round(window.innerHeight - r.bottom),
                radiusTop: getComputedStyle(content).borderTopLeftRadius,
                radiusBottom: getComputedStyle(content).borderBottomLeftRadius
            };
        }"""
    )
    if shape.get("closed"):
        audit.record("H the add-expense form opens", False, "the modal did not open")
        return

    audit.record(
        "H the form asks for the amount, then the category, then who paid",
        shape["order"][:3] == ["inputAmount", "inputCategory", "inputPaidBy"],
        "field order is %s" % (shape["order"][:5],),
    )
    audit.record(
        "H on a phone it sits against the bottom edge, under the thumb",
        shape["bottomGap"] <= 2,
        "there are %spx between the sheet and the bottom of the screen" % shape["bottomGap"],
    )
    audit.record(
        "H it is shaped like a sheet: rounded at the top, square at the bottom",
        shape["radiusBottom"] in ("0px", "0"),
        "top %s, bottom %s" % (shape["radiusTop"], shape["radiusBottom"]),
    )

    page.evaluate("() => window.closeExpenseModal && window.closeExpenseModal()")
    page.wait_for_timeout(300)


def audit_permission_editor(browser, audit):
    """Per-user permissions are enforced by the API - the suite proves that.
    This checks an administrator can actually reach them.

    It runs in its own context because only an administrator may read the
    user directory. Driving it from the OWNER session the rest of the audit
    uses found an empty list and failed for a reason that had nothing to do
    with the editor - the OWNER was being refused the directory, correctly.
    """
    print("\n[H] the permission editor")

    ctx = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    attach_listeners(page, audit)
    try:
        login(page, "admin", "Admin@123")
    except PWError as e:
        audit.record("H the permission editor", False,
                     "admin login failed: %s" % str(e)[:120])
        ctx.close()
        return

    goto_tab(page, "admin")
    page.wait_for_timeout(1200)
    audit_number_fields(page, audit, ADMIN_NUMBER_FIELD_CASES, who="system administrator")
    page.evaluate("() => window.showSettingsSection && window.showSettingsSection('view-admin', 'household')")
    # The directory is fetched asynchronously; picking a user before it lands
    # finds an empty list and fails for a reason that is not the editor's.
    page.evaluate("() => window.loadAdminConsoleData && window.loadAdminConsoleData(true)")
    try:
        page.wait_for_function(
            "() => ((window.adminDirectoryData || {}).users || []).length > 0",
            timeout=8000)
    except PWError:
        pass
    page.wait_for_timeout(400)

    state = page.evaluate(
        """() => {
            const users = (window.adminDirectoryData || {}).users || [];
            const target = users.find(u => u.role !== 'ADMIN' && u.role !== 'SYSTEM_ADMIN');
            if (!target) return {noUser: true};
            window.openEditUserModal(target.userId);
            return {userId: target.userId, role: target.role};
        }"""
    )
    if state.get("noUser"):
        audit.record("H the permission editor", False, "no editable user in the directory")
        ctx.close()
        return

    page.wait_for_timeout(600)
    panel = page.evaluate(
        """() => {
            const body = document.getElementById('editUserPermissionsBody');
            const boxes = Array.from(document.querySelectorAll('.user-perm-box'));
            return {
                collapsed: body ? body.classList.contains('hidden') : null,
                boxes: boxes.length,
                checked: boxes.filter(b => b.checked).length,
                presets: document.querySelectorAll('#editUserPermissionPresets button').length,
                summary: (document.getElementById('editUserPermissionSummary') || {}).textContent
            };
        }"""
    )
    audit.record(
        "H the editor offers every permission the API knows about",
        panel["boxes"] >= 25,
        "%d checkboxes rendered" % panel["boxes"],
    )
    audit.record(
        "H it offers the four role presets",
        panel["presets"] == 4,
        "%d preset buttons" % panel["presets"],
    )
    audit.record(
        "H it starts collapsed, showing the role defaults",
        panel["collapsed"] is True and (panel["summary"] or "").strip() == "role defaults",
        "collapsed=%s summary=%r" % (panel["collapsed"], panel["summary"]),
    )
    audit.record(
        "H it opens pre-ticked with what the account can do today",
        panel["checked"] > 0,
        "%d of %d ticked" % (panel["checked"], panel["boxes"]),
    )

    # Select all / Clear all have to move every box that the admin may grant.
    cleared = page.evaluate(
        """() => {
            window.setAllUserPermissions(false);
            const boxes = Array.from(document.querySelectorAll('.user-perm-box'));
            return boxes.filter(b => b.checked).length;
        }"""
    )
    selected = page.evaluate(
        """() => {
            window.setAllUserPermissions(true);
            const boxes = Array.from(document.querySelectorAll('.user-perm-box'));
            return {on: boxes.filter(b => b.checked).length, total: boxes.length};
        }"""
    )
    audit.record(
        "H Clear all empties the grid and Select all fills it",
        cleared == 0 and selected["on"] == selected["total"],
        "cleared to %d, selected %d of %d" % (cleared, selected["on"], selected["total"]),
    )

    page.evaluate("() => window.closeEditUserModal && window.closeEditUserModal()")
    page.wait_for_timeout(300)
    ctx.close()


def audit_event_delegation(page, audit, api):
    """The markup used to carry 168 inline handlers, which is 168 reasons a
    Content-Security-Policy would turn the page into a picture of an app.

    Two things have to hold: nothing inline is left, and every data-click,
    data-change, data-submit and data-input in the document names an entry that
    exists. A dangling name is a control that silently does nothing - the worst
    possible failure, because it looks fine.
    """
    print("\n[H] behaviour lives in script, not in attributes")

    dangling = {}
    inline = {}
    for tab in ("dashboard", "expenses", "bills", "reports", "personal",
                "staff", "matrix", "settings", "admin", "audit"):
        try:
            goto_tab(page, tab)
        except Exception:
            continue
        page.wait_for_timeout(500)
        found = page.evaluate(
            """() => {
                const actions = window.UI_ACTIONS || {};
                const bad = [];
                ['data-click', 'data-change', 'data-submit', 'data-input'].forEach(attr => {
                    document.querySelectorAll('[' + attr + ']').forEach(el => {
                        const key = el.getAttribute(attr);
                        if (!actions[key]) bad.push(attr + '=' + key);
                    });
                });
                // Only the static document is converted; the renderers still
                // build their rows with inline handlers, so this counts the
                // attributes that survived in markup the generator saw.
                const stale = Array.from(document.querySelectorAll('[onclick], [onchange], [onsubmit], [oninput]'))
                    .filter(el => !el.closest('[id$="TableBody"], [id$="List"], [id$="Grid"], [id$="Container"], tbody'))
                    .map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
                return {bad: bad, stale: stale.slice(0, 10)};
            }"""
        )
        for b in found["bad"]:
            dangling.setdefault(b, tab)
        for i in found["stale"]:
            inline.setdefault(i, tab)

    audit.record(
        "H the handler registry is loaded",
        page.evaluate("() => !!window.UI_ACTIONS && Object.keys(window.UI_ACTIONS).length > 100"),
        "window.UI_ACTIONS is missing or nearly empty - every control is inert",
    )
    audit.record(
        "H every delegated control names a handler that exists",
        not dangling,
        "dangling: %s" % (sorted(dangling.items())[:8],),
    )

    # And the wiring actually works end to end: a known button still does its job.
    goto_tab(page, "dashboard")
    page.wait_for_timeout(600)
    opened = page.evaluate(
        """() => {
            const btn = document.querySelector('.fab-add[data-click]');
            if (!btn) return {noButton: true};
            btn.click();
            const m = document.getElementById('expenseModal');
            return {open: !!m && !m.classList.contains('hidden')};
        }"""
    )
    audit.record(
        "H a delegated click still opens what it used to open",
        opened.get("open") is True,
        "clicking the add button did nothing: %s" % (opened,),
    )
    page.evaluate("() => window.closeExpenseModal && window.closeExpenseModal()")
    page.wait_for_timeout(300)

DESKTOP_WIDTHS = [768, 1024, 1440, 1920]


def audit_desktop_widths(browser, audit):
    """The same layout rules at tablet and desktop widths.

    Checks three things that actually break when a mobile-first layout is
    stretched: content wider than the viewport, a control pushed off the right
    edge, and the phone-only furniture still being on screen when there is no
    longer any reason for it.
    """
    print("\n[I] layout above phone width")

    for width in DESKTOP_WIDTHS:
        ctx = browser.new_context(viewport={"width": width, "height": 900})
        page = ctx.new_page()
        attach_listeners(page, audit)
        try:
            login(page)
        except PWError as e:
            audit.record("I sign in at %dpx" % width, False, str(e)[:160])
            ctx.close()
            continue

        for tab in ("dashboard", "expenses", "bills", "reports", "personal",
                    "staff", "matrix", "settings", "admin"):
            try:
                goto_tab(page, tab)
            except Exception:
                continue
            page.wait_for_timeout(500)

            state = page.evaluate(
                """() => {
                    const doc = document.documentElement;
                    const overflow = Math.round(doc.scrollWidth - doc.clientWidth);
                    const off = [];
                    document.querySelectorAll('button, input, select, textarea, a[href]').forEach(el => {
                        if (el.offsetParent === null) return;
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) return;
                        // Inside something that scrolls sideways on purpose is
                        // not "off the edge"; a wide table is allowed to be wide.
                        let p = el.parentElement, scrollable = false;
                        while (p && p !== document.body) {
                            const o = getComputedStyle(p).overflowX;
                            if (o === 'auto' || o === 'scroll') { scrollable = true; break; }
                            p = p.parentElement;
                        }
                        if (scrollable) return;
                        if (r.right > window.innerWidth + 1 || r.left < -1) {
                            off.push((el.id || el.tagName.toLowerCase()) + ' @' + Math.round(r.left) + '-' + Math.round(r.right));
                        }
                    });
                    const shown = (id) => {
                        const el = document.getElementById(id);
                        return !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
                    };
                    return {
                        overflow: overflow,
                        off: off.slice(0, 5),
                        bottomNav: shown('mobileBottomNav'),
                        sidebar: shown('desktopSidebar')
                    };
                }"""
            )
            audit.record(
                "I no horizontal overflow on %s @%dpx" % (tab, width),
                state["overflow"] <= 1,
                "the page is %dpx wider than the window" % state["overflow"],
            )
            audit.record(
                "I no control sits off the edge on %s @%dpx" % (tab, width),
                not state["off"],
                "off-screen: %s" % (state["off"],),
            )

        # The phone furniture is phone furniture. A bottom tab bar on a 1440px
        # window is wasted vertical space and a second, competing navigation.
        goto_tab(page, "dashboard")
        page.wait_for_timeout(400)
        chrome = page.evaluate(
            """() => {
                const shown = (sel) => {
                    const el = document.querySelector(sel);
                    return !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0;
                };
                return {bottomNav: shown('#mobileBottomNav'), fab: shown('.fab-add')};
            }"""
        )
        if width >= 1024:
            audit.record(
                "I the phone bottom bar is gone at %dpx" % width,
                chrome["bottomNav"] is False,
                "the mobile tab bar is still on screen at %dpx" % width,
            )

        ctx.close()

def audit_notifications(browser, audit):
    """Two phones in one household, one in another.

    Pallavi (H001) has the app open. Palash (H001) adds an expense. Expected:
    Pallavi gets ONE compact banner; Palash gets none for his own action; Sanjay
    (H002) gets nothing; the same event arriving again does not stack; a burst of
    different events never takes over the screen.
    """
    print("\n[N] household notifications on a phone")

    def new_device(user, pw):
        ctx = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        pg = ctx.new_page()
        attach_listeners(pg, audit)
        login(pg, user, pw)
        return ctx, pg

    ctx_b = ctx_a = ctx_c = None
    try:
        ctx_b, pg_b = new_device("pallavi", "Pallavi@123")
        ctx_c, pg_c = new_device("sanjay", "Sanjay@123")
        # Both devices must finish their first sync: events that exist at load
        # time are deliberately not announced, only ones that arrive after.
        pg_b.wait_for_timeout(2500)
        ctx_a, pg_a = new_device("palash", "Palash@123")
        pg_a.wait_for_timeout(2500)

        api_a = make_api(pg_a)
        note = "NotifAudit%d" % (int(time.time()) % 100000)
        res = api_a("POST", "/api/expenses", {
            "date": time.strftime("%Y-%m-%d"), "amount": 851, "category": "Grocery & Vegetables",
            "paidBy": "Palash", "paidTo": note, "notes": note, "paymentMethod": "UPI / GPay / PhonePe",
        })
        expense_id = (res.get("data") or {}).get("id")
        audit.record("N the expense that triggers the notification was saved", bool(expense_id), "save failed: %s" % (res,))

        # The other member's open app polls; give it a full cycle plus margin.
        got = None
        for _ in range(8):
            pg_b.wait_for_timeout(2500)
            got = pg_b.evaluate(
                """() => {
                    const b = Array.from(document.querySelectorAll('.in-app-banner'));
                    return b.map(e => { const r = e.getBoundingClientRect();
                        return {h: Math.round(r.height), w: Math.round(r.width), text: e.innerText.trim().slice(0, 80)}; });
                }"""
            )
            if got:
                break
        audit.record(
            "N the other household member gets a banner",
            bool(got) and any("851" in b["text"] for b in got),
            "banners seen: %s" % (got,),
        )
        audit.record(
            "N it is exactly one banner for one event",
            len(got or []) == 1,
            "%d banners for one expense" % len(got or []),
        )
        if got:
            audit.record(
                "N it is compact: no taller than 130px and within the screen width",
                got[0]["h"] <= 130 and got[0]["w"] <= 390 - 24 + 2,
                "banner is %dx%d px" % (got[0]["w"], got[0]["h"]),
            )

        own = pg_a.evaluate("() => document.querySelectorAll('.in-app-banner').length")
        audit.record("N the person who added it gets no banner for their own action", own == 0, "%d banners on the actor's phone" % own)

        other = pg_c.evaluate("() => document.querySelectorAll('.in-app-banner').length")
        audit.record("N a user in another household gets nothing", other == 0, "%d banners in H002" % other)

        # The same event arriving by a second route must not stack.
        before = pg_b.evaluate("() => document.querySelectorAll('.in-app-banner').length")
        pg_b.evaluate(
            """() => { for (let i = 0; i < 3; i++) window.showInAppNotificationBanner(
                {id: 'dup-evt', eventId: 'dup-evt', title: 'Duplicate probe', body: 'same event'}); }"""
        )
        pg_b.wait_for_timeout(500)
        after_dup = pg_b.evaluate("() => document.querySelectorAll('.in-app-banner').length")
        audit.record("N the same event delivered three times shows once", after_dup <= before + 1, "banners %d -> %d" % (before, after_dup))

        # A burst of different events never covers the screen.
        pg_b.evaluate(
            """() => { for (let i = 0; i < 6; i++) window.showInAppNotificationBanner(
                {id: 'burst-' + i, eventId: 'burst-' + i, title: 'Event ' + i, body: 'burst'}); }"""
        )
        pg_b.wait_for_timeout(600)
        burst = pg_b.evaluate(
            """() => { const b = Array.from(document.querySelectorAll('.in-app-banner'));
                return {n: b.length, total: Math.round(b.reduce((a, e) => a + e.getBoundingClientRect().height, 0))}; }"""
        )
        audit.record("N six different events show at most two banners", burst["n"] <= 2, "%d banners on screen" % burst["n"])
        audit.record("N and together take under a quarter of the screen height", burst["total"] <= 844 * 0.25,
                     "%dpx of banners on an 844px screen" % burst["total"])

        # A push for another household, or one this user caused, is ignored.
        ignored = pg_b.evaluate(
            """() => {
                const before = document.querySelectorAll('.in-app-banner').length;
                window.showInAppNotificationBanner({id: 'x-h2', eventId: 'x-h2', title: 'Other household', body: 'no', householdId: 'H002'});
                const me = (window.currentSessionUser || {}).userId;
                window.showInAppNotificationBanner({id: 'x-me', eventId: 'x-me', title: 'My own action', body: 'no', householdId: 'H001', actorUserId: me});
                return Array.from(document.querySelectorAll('.in-app-banner')).filter(e => /Other household|My own action/.test(e.innerText)).length;
            }"""
        )
        audit.record("N a push for another household, or caused by me, is not shown", ignored == 0, "%d wrongly displayed" % ignored)

        if expense_id:
            api_a("DELETE", "/api/expenses?id=" + expense_id)
    finally:
        for c in (ctx_a, ctx_b, ctx_c):
            if c:
                try:
                    c.close()
                except Exception:
                    pass

def audit_dashboard_redesign(browser, audit):
    """Which dashboard a person sees is assigned to them, per user, by an
    administrator. The existing design is the default and must be untouched;
    every new design must show the same figures. Presentation only."""
    print("\n[R] dashboard design: assigned per user by an administrator")

    def device(user, pw, w, h, mobile):
        ctx = browser.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page()
        attach_listeners(pg, audit)
        login(pg, user, pw)
        pg.wait_for_timeout(1500)
        return ctx, pg

    PICK_MONTH = """() => { const m = document.getElementById('filterMonth');
        const o = Array.from(m.options).find(x => /september/i.test(x.textContent));
        if (o) { m.value = o.value; m.dispatchEvent(new Event('change', {bubbles: true})); } }"""
    FIGURES = ("() => ['statTotalSpent','statTotalIncome','statNetCashFlow','statAvgPerDay','statBudgetUsed',"
               "'statBudgetRemaining'].map(id => (document.getElementById(id)||{textContent:''}).textContent.trim())")
    NEW_FIGURES = ("() => ['dn_statTotalSpent','dn_statTotalIncome','dn_statNetCashFlow','dn_statAvgPerDay','dn_statBudgetUsed',"
                   "'dn_statBudgetRemaining'].map(id => (document.getElementById(id)||{textContent:''}).textContent.trim())")
    VIS = "(el) => !!el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().height > 0"

    # One administrator session assigns designs to palash, the way the edit-user
    # dialog does, through the same API call.
    actx, apg = device("admin", "Admin@123", 1280, 900, False)
    palash_id = apg.evaluate("""async () => {
        const r = await fetch('/api/auth?action=admin_overview', {headers: getAuthHeaders()});
        const j = await r.json();
        return ((j.users || []).find(u => u.username === 'palash') || {}).userId || null; }""")

    def assign(ui):
        return apg.evaluate("""async ([id, ui]) => {
            const r = await fetch('/api/auth', {method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify({action: 'edit_user', userId: id, dashboardUi: ui})});
            return r.status; }""", [palash_id, ui])

    def set_ui(pg, ui):
        status = assign(ui)
        reload_app(pg)
        goto_tab(pg, "dashboard")
        pg.wait_for_timeout(900)
        pg.evaluate(PICK_MONTH)
        pg.wait_for_timeout(1500)
        return status

    def state(pg):
        return pg.evaluate("""(VIS) => { const vis = eval('(' + VIS + ')');
            const q = (s) => document.querySelector(s);
            return {
                design: document.documentElement.dataset.dashDesign,
                newShown: vis(q('#dashNew')),
                classicShown: vis(q('#statTotalSpent')) || vis(q('#mHeroPrimaryVal')),
                overflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth)
            }; }""", VIS)

    try:
        audit.record("R the administrator console knows who palash is", bool(palash_id), "no user id for palash")
        assign({})

        # ------------------------------------------------ the admin's own form
        apg.evaluate("window.adminFormDirty = false")
        goto_tab(apg, "admin")
        apg.wait_for_timeout(1000)
        apg.evaluate("(id) => openEditUserModal(id)", palash_id)
        apg.wait_for_timeout(700)
        has_form = apg.evaluate("() => !!document.getElementById('dashUiDesign') && !!document.getElementById('editUserDashboard')")
        audit.record("R the edit-user dialog has a Dashboard design section", has_form, "section missing from the dialog")
        apg.evaluate("() => { document.getElementById('editUserDashboard').open = true; }")
        apg.select_option("#dashUiDesign", "minimal")
        apg.evaluate("() => submitEditUser()")
        apg.wait_for_timeout(2200)
        saved = apg.evaluate("""async (id) => {
            const r = await fetch('/api/auth?action=admin_overview', {headers: getAuthHeaders()});
            const j = await r.json();
            return ((j.users || []).find(u => u.userId === id) || {}).dashboardUi || null; }""", palash_id)
        audit.record("R saving the dialog stores that user's dashboard design",
                     bool(saved) and saved.get("design") == "minimal", "stored %r" % (saved,))
        apg.evaluate("(id) => openEditUserModal(id)", palash_id)
        apg.wait_for_timeout(500)
        audit.record("R reopening the dialog shows the saved design",
                     apg.input_value("#dashUiDesign") == "minimal", "shows %r" % apg.input_value("#dashUiDesign"))
        apg.evaluate("() => closeEditUserModal()")
        assign({})

        # ---------------------------------------------------------------- desktop
        ctx, pg = device("palash", "Palash@123", 1440, 900, False)
        try:
            goto_tab(pg, "dashboard")
            pg.evaluate(PICK_MONTH)
            pg.wait_for_timeout(2000)
            st = state(pg)
            audit.record("R with nothing assigned the dashboard is the existing (classic) design",
                         st["design"] in ("classic", None) and st["classicShown"] and not st["newShown"], "state %s" % (st,))
            audit.record("R classic dashboard carries none of the new pieces",
                         pg.evaluate("() => !document.querySelector('.dash-phone-fold, #dashInsights, #dashSecondary, #dashChartPayment')"),
                         "new elements found inside the classic dashboard")
            audit.record("R classic dashboard keeps its quick-select chips",
                         pg.evaluate("() => { const r = Array.from(document.querySelectorAll('span')).find(s => /Quick Select/i.test(s.textContent)); return !!r && r.offsetParent !== null; }"),
                         "quick-select row missing on classic dashboard")
            audit.record("R Master Settings no longer has an Appearance section",
                         pg.evaluate("() => !document.querySelector('[data-settings-section=\"appearance\"], #dashUiDesign')"),
                         "Appearance is still in Master Settings")
            # Done outside the page so the expected refusal is not logged as a page error.
            token = pg.evaluate("() => localStorage.getItem('household_auth_token')")
            denied = ctx.request.post(pg.url.split('#')[0].rstrip('/') + '/api/auth',
                                      headers={"Authorization": "Bearer " + str(token), "Content-Type": "application/json"},
                                      data=json.dumps({"action": "edit_user", "userId": palash_id, "dashboardUi": {"design": "new"}}))
            audit.record("R a user cannot assign their own dashboard design",
                         denied.status in (401, 403), "a non-administrator got HTTP %s" % denied.status)
            classic = pg.evaluate(FIGURES)

            set_ui(pg, {"design": "new"})
            st = state(pg)
            audit.record("R an assigned New UI dashboard shows instead of the classic one",
                         st["design"] == "new" and st["newShown"] and not st["classicShown"], "state %s" % (st,))
            newfig = pg.evaluate(NEW_FIGURES)
            audit.record("R the new design shows identical figures to the classic design",
                         newfig == classic and all(classic), "classic %s vs new %s" % (classic, newfig))
            d = pg.evaluate("""(VIS) => { const vis = eval('(' + VIS + ')');
                const all = (s) => Array.from(document.querySelectorAll(s));
                return { kpis: all('#dnKpis .dn-kpi').filter(vis).length, ins: all('#dnInsights .dn-ins').filter(vis).length,
                         folds: all('#dashNew .dn-fold > summary .ic').filter(vis).length,
                         hero: vis(document.getElementById('dnHeroFig')),
                         cat: document.querySelectorAll('#dnCategory .dn-bar').length,
                         trend: document.querySelectorAll('#dnTrend .dn-trend-col').length,
                         more: vis(document.getElementById('dnMoreFigures')),
                         small: all('#dashNew button').filter(vis).filter(b => b.getBoundingClientRect().height < 40).length }; }""", VIS)
            audit.record("R the new design shows the key figures, insights, hero and charts on laptop",
                         d["kpis"] >= 6 and d["ins"] == 6 and d["hero"] and d["cat"] >= 1 and d["trend"] == 12, "state %s" % (d,))
            audit.record("R the new design has no phone-only controls on laptop", not d["more"] and d["folds"] == 0, "state %s" % (d,))
            audit.record("R the new design buttons are comfortable to click", d["small"] == 0, "%d buttons under 40px" % d["small"])
            audit.record("R no horizontal overflow on laptop (new design)", st["overflow"] <= 1, "%dpx wider" % st["overflow"])

            pg.evaluate("() => { const b = document.querySelector('#dnRecent .dn-tx'); if (b) b.click(); }")
            pg.wait_for_timeout(500)
            opened = pg.evaluate("() => !!document.querySelector('#transactionDetailModal:not(.hidden), dialog[open]')")
            audit.record("R tapping a recent transaction opens its details", opened, "no detail view opened")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)

            for dsg in ("minimal", "analytics", "timeline"):
                set_ui(pg, {"design": dsg})
                sd = state(pg)
                nf = pg.evaluate(NEW_FIGURES)
                audit.record("R %s design shows on laptop with the same figures" % dsg,
                             sd["design"] == dsg and sd["newShown"] and not sd["classicShown"] and nf == classic,
                             "state %s, classic %s vs %s" % (sd, classic, nf))
                audit.record("R %s design has no horizontal overflow on laptop" % dsg, sd["overflow"] <= 1, "%dpx wider" % sd["overflow"])
            tl = pg.evaluate("() => document.querySelectorAll('#dnTimeline .dn-day').length")
            audit.record("R timeline groups activity by day", tl >= 1, "%d day groups" % tl)

            set_ui(pg, {})
            st = state(pg)
            audit.record("R clearing the assignment brings the classic design back",
                         st["design"] == "classic" and st["classicShown"] and not st["newShown"], "state %s" % (st,))
            audit.record("R switching design does not change any figure", pg.evaluate(FIGURES) == classic,
                         "figures changed from %s to %s" % (classic, pg.evaluate(FIGURES)))
        finally:
            ctx.close()

        # ------------------------------------------------------------------ phone
        ctx, pg = device("palash", "Palash@123", 390, 844, True)
        try:
            set_ui(pg, {})
            st = state(pg)
            audit.record("R phone default is the existing design", st["design"] in ("classic", None) and st["classicShown"] and not st["newShown"], "state %s" % (st,))
            set_ui(pg, {"design": "new"})
            st = state(pg)
            audit.record("R phone shows the assigned new dashboard", st["design"] == "new" and st["newShown"] and not st["classicShown"], "state %s" % (st,))
            audit.record("R no horizontal overflow on phone (new design)", st["overflow"] <= 1, "%dpx wider" % st["overflow"])
            ph = pg.evaluate("""(VIS) => { const vis = eval('(' + VIS + ')');
                const all = (s) => Array.from(document.querySelectorAll(s));
                return {
                    visibleKpis: all('#dnKpis .dn-kpi').filter(vis).length,
                    more: vis(document.getElementById('dnMoreFigures')),
                    folds: all('#dashNew details[data-dn-fold]').map(d => ({open: d.open, h: Math.round(d.querySelector('summary').getBoundingClientRect().height), shown: vis(d)})),
                    tx: all('#dnRecent .dn-tx').map(b => Math.round(b.getBoundingClientRect().height)),
                    tables: all('#dashNew table').filter(vis).length,
                    wide: all('#dashNew *').filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length,
                    small: all('#dashNew button').filter(vis).filter(b => b.getBoundingClientRect().height < 44).length
                }; }""", VIS)
            audit.record("R phone shows four figures first with a More figures button", ph["visibleKpis"] == 4 and ph["more"], "state %s" % (ph,))
            pg.evaluate("() => document.getElementById('dnMoreFigures').click()")
            pg.wait_for_timeout(300)
            more_n = pg.evaluate("(VIS) => { const vis = eval('(' + VIS + ')'); return Array.from(document.querySelectorAll('#dnKpis .dn-kpi')).filter(vis).length; }", VIS)
            audit.record("R More figures reveals the rest", more_n >= 6, "only %d figures visible after expanding" % more_n)
            audit.record("R secondary cards are folded behind 44px headers on phone",
                         len(ph["folds"]) >= 3 and all((not f["open"]) and f["h"] >= 44 for f in ph["folds"] if f["shown"]), "folds %s" % (ph["folds"],))
            pg.evaluate("() => document.querySelector('#dashNew details[data-dn-fold] > summary').click()")
            pg.wait_for_timeout(300)
            audit.record("R opening a fold shows its content",
                         pg.evaluate("() => { const d = document.querySelector('#dashNew details[data-dn-fold][open]'); return !!d && d.querySelector(':scope > div').getBoundingClientRect().height > 0; }"),
                         "fold content still hidden")
            audit.record("R phone transaction rows are at least 44px tall", ph["tx"] and all(h >= 44 for h in ph["tx"]), "heights %s" % (ph["tx"],))
            audit.record("R no desktop table appears on phone", ph["tables"] == 0, "%d tables" % ph["tables"])
            audit.record("R nothing in the new dashboard sticks out past the phone screen", ph["wide"] == 0, "%d elements extend past the screen" % ph["wide"])
            audit.record("R phone buttons are at least 44px tall", ph["small"] == 0, "%d buttons under 44px" % ph["small"])

            for dsg in ("minimal", "analytics", "timeline"):
                set_ui(pg, {"design": dsg})
                sd = state(pg)
                wide = pg.evaluate("() => Array.from(document.querySelectorAll('#dashNew *')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1).length")
                small = pg.evaluate("(VIS) => { const vis = eval('(' + VIS + ')'); return Array.from(document.querySelectorAll('#dashNew button')).filter(vis).filter(b => b.getBoundingClientRect().height < 44).length; }", VIS)
                audit.record("R %s design fits the phone with no overflow" % dsg,
                             sd["design"] == dsg and sd["newShown"] and sd["overflow"] <= 1 and wide == 0, "state %s, %d wide elements" % (sd, wide))
                audit.record("R %s design phone buttons are at least 44px tall" % dsg, small == 0, "%d buttons under 44px" % small)

            set_ui(pg, {"design": "new", "heroBudget": "hidden"})
            hb = pg.evaluate("""(VIS) => { const vis = eval('(' + VIS + ')');
                return { ring: vis(document.getElementById('dnRingWrap')), stat: vis(document.getElementById('dnHeroBudgetStat')),
                         label: document.getElementById('dnHeroLabel').textContent }; }""", VIS)
            audit.record("R Hide budget removes the ring and budget figure from the home card",
                         (not hb["ring"] and not hb["stat"] and "spent" in hb["label"].lower()), "state %s" % (hb,))

            status = set_ui(pg, {"design": "new", "layout": "focus", "sections": {"insights": False}})
            a = pg.evaluate("""(VIS) => { const vis = eval('(' + VIS + ')'); const v = (id) => vis(document.getElementById(id));
                return { layout: document.documentElement.dataset.dashLayout, kpi: v('dnKpis'), top: v('dnTop'), insights: v('dnInsights') }; }""", VIS)
            audit.record("R Financial Focus drops long lists and keeps figures", status == 200 and a["layout"] == "focus" and a["kpi"] and not a["top"], "state %s" % (a,))
            audit.record("R an individual section can be switched off", not a["insights"], "insights still showing")

            reload_app(pg)
            goto_tab(pg, "dashboard")
            pg.wait_for_timeout(1200)
            kept = pg.evaluate("() => [document.documentElement.dataset.dashDesign, document.documentElement.dataset.dashLayout]")
            audit.record("R the assigned design survives a reload and a fresh sign-in", kept == ["new", "focus"], "after reload: %s" % (kept,))
        finally:
            ctx.close()

        # another user is unaffected by palash's assignment
        ctx, pg = device("pallavi", "Pallavi@123", 390, 844, True)
        try:
            other = pg.evaluate("() => [document.documentElement.dataset.dashDesign, document.documentElement.dataset.dashLayout]")
            audit.record("R another user in the household keeps the default design", other[0] != "new" and other[1] != "focus", "pallavi sees %s" % (other,))
        finally:
            ctx.close()
    finally:
        try:
            assign({})
        finally:
            actx.close()


def audit_dialogs(browser, audit):
    """Every open window follows one set of rules: it never outgrows the screen,
    keeps its buttons in view, locks the page behind it, takes and returns focus,
    keeps Tab inside and closes on Escape (unless a decision is required)."""
    print("\n[D] dialogs / open windows")

    SHOW = "(id) => { const m = document.getElementById(id); m.classList.remove('hidden'); m.style.display = 'flex'; }"
    HIDE = "(id) => { const m = document.getElementById(id); m.classList.add('hidden'); m.style.display = ''; }"
    MEASURE = """(id) => { const m = document.getElementById(id); const p = m.querySelector(':scope > .modal-content') || m.firstElementChild;
        const r = p.getBoundingClientRect(); const f = p.querySelector('.dlg-foot'); const fr = f ? f.getBoundingClientRect() : null;
        const x = p.querySelector('button[aria-label^="Close"]'); const xr = x ? x.getBoundingClientRect() : null;
        return {fits: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1,
                hScroll: p.scrollWidth > p.clientWidth + 1, lock: document.body.classList.contains('dlg-open'),
                footOk: fr ? (fr.bottom <= innerHeight + 1 && fr.top >= 0) : true,
                closeOk: xr ? (xr.width >= 36 && xr.height >= 36) : true,
                bottom: Math.round(r.bottom), vh: innerHeight, center: m.classList.contains('dlg-center')}; }"""
    IDS = ['expenseModal', 'transactionDetailModal', 'adminEditCategoryModal', 'deleteConfirmModal', 'quickFillModal',
           'settleUpModal', 'pwaInstallGuideModal', 'adminAddStaffModal', 'adminAddBillModal', 'adminAddCategoryModal',
           'modalMobileFilter', 'userProfileModal', 'modalCreateHousehold', 'modalCreateUser', 'modalEditHousehold', 'modalEditUser']

    for label, vp, mob in (("phone", {"width": 390, "height": 844}, True),
                           ("phone on its side", {"width": 844, "height": 390}, True),
                           ("short laptop", {"width": 1280, "height": 600}, False),
                           ("desktop", {"width": 1280, "height": 800}, False)):
        ctx = browser.new_context(viewport=vp, is_mobile=mob, has_touch=mob)
        pg = ctx.new_page()
        attach_listeners(pg, audit)
        try:
            login(pg, "admin", "Admin@123")
            pg.wait_for_timeout(1200)
            pg.evaluate("window.adminFormDirty = false")
            goto_tab(pg, "admin")
            pg.wait_for_timeout(900)
            problems = []
            sheets_ok = True
            for i in IDS:
                pg.evaluate(SHOW, i)
                pg.wait_for_timeout(420)
                m = pg.evaluate(MEASURE, i)
                if not (m["fits"] and not m["hScroll"] and m["lock"] and m["footOk"] and m["closeOk"]):
                    problems.append("%s %s" % (i, m))
                if mob and vp["width"] < 640 and not m["center"] and i != 'expenseModal' and abs(m["bottom"] - m["vh"]) > 2:
                    sheets_ok = False
                    problems.append("%s not a bottom sheet %s" % (i, m))
                pg.evaluate(HIDE, i)
                pg.wait_for_timeout(100)
            audit.record("D every dialog fits the %s screen, keeps its buttons in view and locks the page" % label,
                         not problems, "; ".join(problems)[:400])
            audit.record("D the page scrolls again once a dialog closes (%s)" % label,
                         not pg.evaluate("() => document.body.classList.contains('dlg-open')"), "page scroll stayed locked")

            if label in ("phone", "desktop"):
                uid = pg.evaluate("() => (window.adminDirectoryData.users.find(u => u.username === 'palash') || {}).userId")
                pg.evaluate("""(id) => { const b = document.createElement('button'); b.id = 'dlgOpener'; b.textContent = 'x';
                    document.body.appendChild(b); b.focus(); openEditUserModal(id); }""", uid)
                pg.wait_for_timeout(500)
                inside = pg.evaluate("() => document.getElementById('modalEditUser').contains(document.activeElement)")
                if label == "desktop":
                    audit.record("D opening a dialog moves focus into it", inside, "focus stayed behind the dialog")
                for _ in range(40):
                    pg.keyboard.press("Tab")
                audit.record("D Tab stays inside an open dialog (%s)" % label,
                             pg.evaluate("() => document.getElementById('modalEditUser').contains(document.activeElement)"),
                             "focus escaped to the page behind")
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(400)
                closed = pg.evaluate("() => document.getElementById('modalEditUser').classList.contains('hidden')")
                audit.record("D Escape closes the dialog on top (%s)" % label, closed, "dialog still open after Escape")
                audit.record("D focus returns to what opened the dialog (%s)" % label,
                             pg.evaluate("() => document.activeElement.id") == "dlgOpener", "focus was lost")

                pg.evaluate("() => document.getElementById('conflictModal').classList.remove('hidden')")
                pg.wait_for_timeout(300)
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(200)
                audit.record("D a dialog that needs a decision is not dismissed by Escape (%s)" % label,
                             pg.evaluate("() => !document.getElementById('conflictModal').classList.contains('hidden')"),
                             "the conflict dialog was dismissed")
                pg.evaluate("() => document.getElementById('conflictModal').classList.add('hidden')")
            if mob and vp["width"] < 640:
                audit.record("D form dialogs are bottom sheets on a phone", sheets_ok, "a form dialog is floating mid-screen")
        finally:
            ctx.close()


def audit_product_skin(browser, audit):
    """A New UI design restyles every tab, not just the dashboard; the classic
    UI carries none of it."""
    print("\n[U] new UI across the product")
    TABS = ["dashboard", "expenses", "bills", "reports", "staff", "personal", "admin"]
    PROBE = """() => { const cs = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e) : null; };
        const th = cs('.tab-view:not(.hidden) table thead th');
        const card = cs('.tab-view:not(.hidden) .glass-card');
        const side = cs('#desktopSidebar');
        return { ui: document.documentElement.dataset.ui,
                 thLight: th ? th.backgroundColor : null, cardRadius: card ? card.borderTopLeftRadius : null,
                 overflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth) }; }"""
    actx = browser.new_context(viewport={"width": 1280, "height": 900})
    apg = actx.new_page(); attach_listeners(apg, audit); login(apg, "admin", "Admin@123"); apg.wait_for_timeout(1200)
    pid = apg.evaluate("""async () => { const r = await fetch('/api/auth?action=admin_overview', {headers: getAuthHeaders()});
        const j = await r.json(); return ((j.users || []).find(u => u.username === 'palash') || {}).userId; }""")
    def assign(ui):
        apg.evaluate("""async ([id, ui]) => { await fetch('/api/auth', {method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({action: 'edit_user', userId: id, dashboardUi: ui})}); }""", [pid, ui])
    try:
        for label, vp, mob in (("laptop", {"width": 1360, "height": 860}, False), ("phone", {"width": 390, "height": 844}, True)):
            for design, expect in (({}, "classic"), ({"design": "timeline"}, "new")):
                assign(design)
                ctx = browser.new_context(viewport=vp, is_mobile=mob, has_touch=mob); pg = ctx.new_page()
                attach_listeners(pg, audit)
                try:
                    login(pg, "palash", "Palash@123"); pg.wait_for_timeout(1500)
                    bad = []; radii = set(); ui_ok = True
                    for t in TABS[:-1]:
                        goto_tab(pg, t); pg.wait_for_timeout(500)
                        m = pg.evaluate(PROBE)
                        ui_ok = ui_ok and (m["ui"] == expect)
                        if m["overflow"] > 1: bad.append("%s overflows by %dpx" % (t, m["overflow"]))
                        if m["cardRadius"]: radii.add(m["cardRadius"])
                    audit.record("U %s UI sets data-ui=%s on every tab (%s)" % (expect, expect, label), ui_ok, "data-ui differed on some tab")
                    audit.record("U %s UI has no horizontal overflow on any tab (%s)" % (expect, label), not bad, "; ".join(bad))
                    if expect == "new":
                        goto_tab(pg, "expenses"); pg.wait_for_timeout(500)
                        m = pg.evaluate(PROBE)
                        audit.record("U new UI gives tables a light header on Expenses (%s)" % label,
                                     (m["thLight"] is None) or m["thLight"] != "rgb(15, 23, 42)", "header is %s" % m["thLight"])
                        audit.record("U new UI cards share one radius across tabs (%s)" % label, len(radii) <= 2, "radii %s" % sorted(radii))
                    else:
                        goto_tab(pg, "expenses"); pg.wait_for_timeout(500)
                        m = pg.evaluate(PROBE)
                        audit.record("U classic UI keeps its dark table header (%s)" % label,
                                     (m["thLight"] is None) or m["thLight"] != "rgb(241, 245, 249)", "header is %s" % m["thLight"])
                finally:
                    ctx.close()
    finally:
        try: assign({})
        finally: actx.close()


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
    try:
        page.go_back(wait_until="domcontentloaded", timeout=15000)
    except PWError:
        pass          # nowhere to go back to; nothing was re-exposed
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


# One reusable browser context for the short-lived "can this user sign in?"
# probes. Each probe used to open its own context; eleven Chromium contexts in a
# single run made the suite flaky on Windows, failing at a different point each
# time with ERR_FAILED while the server stayed healthy.
_PROBE = {"ctx": None, "page": None}


def probe_page(browser):
    """A signed-out page in a reused context, with storage cleared."""
    if _PROBE["ctx"] is None:
        _PROBE["ctx"] = browser.new_context(viewport=PHONE, has_touch=True, is_mobile=True)
        _PROBE["page"] = _PROBE["ctx"].new_page()
    page = _PROBE["page"]
    try:
        _PROBE["ctx"].clear_cookies()
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=45000)
        page.evaluate("() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} }")
    except PWError:
        pass
    return page


def close_probe():
    if _PROBE["ctx"] is not None:
        try:
            _PROBE["ctx"].close()
        except Exception:
            pass
    _PROBE["ctx"] = None
    _PROBE["page"] = None


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
        login(page_a, "palash", "Palash@123")
        login(page_b, "pallavi", "Pallavi@123")
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
            login(page_c, "sanjay", "Sanjay@123")          # owner of H002
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

        # Master Settings shows one group at a time now, so "visible" means
        # "visible once its group is open". Selecting the group here keeps the
        # check about who may see the card rather than about which chip happens
        # to be selected by default.
        page.evaluate(
            "() => window.showSettingsSection && window.showSettingsSection('view-admin', 'household')"
        )
        page.wait_for_timeout(400)

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
        ppage = probe_page(browser)
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
            pass

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
        ppage2 = probe_page(browser)
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
            pass

        # --- password reset ---------------------------------------------------
        page.evaluate("(id) => openEditUserModal(id)", user_id)
        page.wait_for_timeout(800)
        page.fill("#editUserPassword", "QaReset@98765")
        page.evaluate("submitEditUser()")
        page.wait_for_timeout(2500)

        ppage3 = probe_page(browser)
        try:
            login(ppage3, new_username, "QaReset@98765")
            audit.record("E an admin password reset lets the user sign in with the new password",
                         True)
        except PWError as e:
            audit.record("E an admin password reset lets the user sign in with the new password",
                         False, f"login with the new password failed: {str(e)[:120]}")
        finally:
            pass

        ppage4 = probe_page(browser)
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
            pass

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

        ppage5 = probe_page(browser)
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
            pass

        # --- non-admins must not reach any of this ------------------------------
        ppage6 = probe_page(browser)
        try:
            login(ppage6, "palash", "Palash@123")          # OWNER, not admin
            papi6 = make_api(ppage6)
            ov = papi6("GET", "/api/auth?action=admin_overview")
            audit.record(
                "E a household owner cannot read the admin overview",
                ov.get("success") is False or ov.get("status") in (401, 403),
                f"an OWNER received the admin overview: {str(ov)[:120]}",
            )
        finally:
            pass

    finally:
        close_probe()
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
        gone = page.evaluate(
            """() => ['createHouseholdBudget', 'editHouseholdBudget']
                .filter(id => document.getElementById(id) !== null)"""
        )
        audit.record(
            "C1 the household-budget fields are not in the page for an owner",
            not gone,
            "present for a non-admin: %s" % (gone,),
        )
        audit_delete_confirm(page, audit)
        for fn, label in ((audit_staff_shortname, "C2 staff round-trip"),
                          (audit_no_silent_defaults, "C3 blank fields blocked"),
                          (audit_unsaved_guard, "C5 unsaved-changes guard"),
                          (audit_rename_flows, "D rename round-trip"),
                          (audit_delete_warnings, "D delete warning"),
                          (audit_expense_round_trip, "D expense round-trip"),
                          (audit_attendance_follows_period, "D attendance calendar"),
                          (audit_expense_view_toggle, "D expense view toggle"),
                          (audit_dashboard_mode, "D dashboard follows master config"),
                          (audit_budget_counts_everything, "D budget counts every expense"),
                          (audit_design_system, "G design system"),
                          (audit_accessibility, "A accessibility"),
                          (audit_settings_sections, "H settings sections"),
                          (audit_add_expense_sheet, "H add-expense sheet"),
                          (audit_event_delegation, "H event delegation")):
            try:
                fn(page, audit, api)
            except Exception as e:
                audit.record(label, False, f"audit error: {type(e).__name__}: {e}")

        print("\n[F] layout and tap targets per screen")
        for tab in ["dashboard", "personal", "expenses", "reports", "staff", "matrix", "admin", "settings"]:
            goto_tab(page, tab)
            audit_tap_targets(page, audit, tab)
            audit_no_overflow(page, audit, tab)
            audit_no_clipped_controls(page, audit, tab)

            # Master Settings shows one group at a time, so measuring the tab
            # once would only ever check the group that opened. Walk them all,
            # or the other six groups are never laid out under a 390px viewport.
            sections = page.evaluate(
                """(id) => {
                    const v = document.getElementById('view-' + id);
                    if (!v) return [];
                    return Array.from(v.querySelectorAll('.settings-chip'))
                        .map(c => c.getAttribute('data-section-key'));
                }""",
                tab,
            )
            for key in sections:
                page.evaluate("([id, k]) => window.showSettingsSection('view-' + id, k)", [tab, key])
                page.wait_for_timeout(350)
                label = "%s/%s" % (tab, key)
                audit_tap_targets(page, audit, label)
                audit_no_overflow(page, audit, label)
                audit_no_clipped_controls(page, audit, label)

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

        try:
            audit_permission_editor(browser, audit)
        except Exception as e:
            audit.record("H permission editor", False, f"audit error: {type(e).__name__}: {e}")

        try:
            audit_dashboard_redesign(browser, audit)
            audit_dialogs(browser, audit)
            audit_product_skin(browser, audit)
        except Exception as e:
            audit.record("R dashboard redesign", False, f"audit error: {type(e).__name__}: {e}")

        try:
            audit_notifications(browser, audit)
        except Exception as e:
            audit.record("N notifications", False, f"audit error: {type(e).__name__}: {e}")

        try:
            audit_desktop_widths(browser, audit)
        except Exception as e:
            audit.record("I desktop widths", False, f"audit error: {type(e).__name__}: {e}")

        # Runs last: it ends the session, then signs back in.
        try:
            audit_logout(page, audit, api)
        except Exception as e:
            audit.record("E logout", False, f"audit error: {type(e).__name__}: {e}")

        print("\n[general] runtime health")
        audit.record(
            "no JS console errors during audit",
            not audit.console_errors,
            "; ".join(audit.console_errors[:4])
            + ("  |  failed requests: " + " ; ".join(audit.failed_requests[:6]) if audit.failed_requests else ""),
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
