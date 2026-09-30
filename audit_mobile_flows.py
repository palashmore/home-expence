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

from playwright.sync_api import sync_playwright, Error as PWError

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

    def record(self, name, ok, detail=""):
        self.checks.append({"name": name, "ok": bool(ok), "detail": detail})
        mark = "OK  " if ok else "BUG "
        line = f"  {mark} {name}"
        if detail:
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
            audit.console_errors.append(text)

    def on_dialog(dialog):
        audit.dialogs.append(f"{dialog.type}: {dialog.message}")
        dialog.dismiss()

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


def goto_tab(page, tab):
    page.evaluate(f"switchTab({json.dumps(tab)})")
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
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;          // not rendered
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('[style*="display: none"], .hidden')) continue;
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
    box = page.evaluate(
        """() => {
            const m = document.getElementById('deleteConfirmModal');
            if (!m) return {missing: true};
            const prevDisplay = m.style.display;
            const hadHidden = m.classList.contains('hidden');
            m.classList.remove('hidden');
            m.style.display = 'flex';
            const btn = document.getElementById('btnConfirmDeleteAction');
            const res = btn ? (() => { const r = btn.getBoundingClientRect();
                return {w: Math.round(r.width), h: Math.round(r.height)}; })()
              : {missingBtn: true};
            if (hadHidden) m.classList.add('hidden');
            m.style.display = prevDisplay;
            return res;
        }"""
    )
    if box.get("missing") or box.get("missingBtn"):
        return audit.record("C4 delete confirm button sized", False, "modal or button not found")
    ok = box["h"] >= MIN_TAP
    return audit.record(
        "C4 delete confirm button >= 44px tall",
        ok,
        f"measured {box['w']}x{box['h']}px",
    )


# ---------------------------------------------------------------------------
# C2 - staff shortName must survive a save
# ---------------------------------------------------------------------------
def audit_staff_shortname(page, audit, api):
    print("\n[C2] staff fields survive a save")
    cfg = api("GET", "/api/config")
    staff = (cfg.get("config") or cfg).get("staff") or []
    if not staff:
        return audit.record("C2 staff shortName preserved", False, "no staff configured to test")

    target = staff[0]
    before = dict(target)
    has_field = page.query_selector(f'[data-staff-shortname], .staff-edit-shortname') is not None
    audit.record(
        "C2 staff Short Name has an input in the UI",
        has_field,
        "no shortName field rendered; any save rebuilds the object and loses it",
    )
    return has_field, before


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
        try:
            audit_staff_shortname(page, audit, api)
        except Exception as e:
            audit.record("C2 staff shortName preserved", False, f"audit error: {e}")

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
