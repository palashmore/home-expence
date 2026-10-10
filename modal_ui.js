// Dialog behaviour shared by every open window in the product.
//
// Each screen opens and closes its own dialog by toggling "hidden" on a
// .modal-backdrop, and that stays exactly as it is. This file watches those
// backdrops and adds what none of them did individually: the page behind stops
// scrolling, focus moves into the dialog and comes back to where it was, Tab
// stays inside, Escape closes the top dialog, and every form dialog gets a
// footer that stays in view while the fields scroll. It changes no data and
// makes no requests.
(function () {
    "use strict";

    // Windows that ask a question or show a message are centred on a phone; the
    // rest are bottom sheets, where the thumb is.
    const CENTERED = ['deleteConfirmModal', 'conflictModal', 'quickFillModal', 'pwaInstallGuideModal', 'receiptModal', 'loginModal'];
    // Escape must not dismiss these: one is a required decision, one is the gate.
    const PERSISTENT = ['conflictModal', 'loginModal'];
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

    const seen = new WeakMap();          // backdrop -> was it open last time we looked
    const openers = new WeakMap();       // backdrop -> element that had focus before it opened
    const stack = [];                    // open dialogs, oldest first

    const coarse = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    function isOpen(el) {
        return document.contains(el) && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
    }
    function panelOf(el) { return el.querySelector(':scope > .modal-content') || el.firstElementChild; }
    function focusables(root) {
        return Array.from(root.querySelectorAll(FOCUSABLE)).filter(e => e.offsetParent !== null || e === document.activeElement);
    }

    // Done once per dialog: classification and the sticky footer marker.
    function enhance(el) {
        if (el.dataset.dlg) return;
        el.dataset.dlg = '1';
        if (CENTERED.includes(el.id) || el.getAttribute('role') === 'alertdialog') el.classList.add('dlg-center');
        if (PERSISTENT.includes(el.id)) el.dataset.dlgPersistent = '1';
        if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
        const panel = panelOf(el);
        if (panel && !panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1');
        markFooter(panel);
    }

    // The button row at the end of a form stays pinned while the fields above it
    // scroll. Forms that already lay themselves out with their own footer (the
    // add-expense sheet) are left alone.
    function markFooter(panel) {
        if (!panel) return;
        const form = panel.querySelector(':scope > form');
        if (!form || form.id === 'expenseForm' || /\bflex-col\b/.test(form.className)) return;
        const last = form.lastElementChild;
        if (!last || last.classList.contains('dlg-foot')) return;
        if (!last.querySelector('button')) return;
        const cs = getComputedStyle(form);
        last.classList.add('dlg-foot');
        last.style.setProperty('--dlg-px', cs.paddingLeft);
        last.style.setProperty('--dlg-pb', cs.paddingBottom);
    }

    function lockPage(on) {
        document.documentElement.classList.toggle('dlg-open', on);
        document.body.classList.toggle('dlg-open', on);
    }

    function onOpen(el) {
        enhance(el);
        if (!openers.has(el)) openers.set(el, document.activeElement);
        if (stack.indexOf(el) === -1) stack.push(el);
        lockPage(true);
        const panel = panelOf(el);
        if (!panel) return;
        markFooter(panel);
        panel.scrollTop = 0;
        panel.querySelectorAll(':scope > form, .modal-scroll-body').forEach(b => { b.scrollTop = 0; });
        // On a phone, focusing a field raises the keyboard over the very form the
        // person is about to read; the dialog itself takes focus instead.
        window.requestAnimationFrame(() => {
            if (!isOpen(el)) return;
            const auto = panel.querySelector('[autofocus]');
            const first = !coarse() && (auto || focusables(panel).find(f => !/^(button|summary)$/i.test(f.tagName)));
            try { (first || panel).focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
        });
    }

    function onClose(el) {
        const i = stack.indexOf(el);
        if (i !== -1) stack.splice(i, 1);
        if (!stack.length) lockPage(false);
        const back = openers.get(el);
        openers.delete(el);
        // Only return focus if nothing else has already taken it.
        if (back && document.contains(back) && back.offsetParent !== null
            && (!document.activeElement || document.activeElement === document.body || el.contains(document.activeElement))) {
            try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ }
        }
    }

    function check(el) {
        const now = isOpen(el);
        const before = seen.get(el) === true;
        if (now === before) return;
        seen.set(el, now);
        if (now) onOpen(el); else onClose(el);
    }

    const observer = new MutationObserver(function (records) {
        const touched = new Set();
        records.forEach(r => {
            if (r.type === 'attributes' && r.target.classList && r.target.classList.contains('modal-backdrop')) touched.add(r.target);
            if (r.type === 'childList') {
                r.addedNodes.forEach(n => { if (n.nodeType === 1 && n.classList.contains('modal-backdrop')) watch(n); });
                r.removedNodes.forEach(n => { if (n.nodeType === 1 && n.classList && n.classList.contains('modal-backdrop')) { seen.set(n, false); onClose(n); } });
            }
        });
        touched.forEach(check);
    });
    function watch(el) {
        if (el.dataset.dlgWatched) return;
        el.dataset.dlgWatched = '1';
        enhance(el);
        observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
        check(el);
    }
    function start() {
        document.querySelectorAll('.modal-backdrop').forEach(watch);
        // Dialogs mounted later (the admin ones) are appended straight to <body>.
        observer.observe(document.body, { childList: true });
    }

    // The control a person would press to dismiss this dialog.
    function closeControl(el) {
        const byLabel = el.querySelector('button[aria-label^="Close" i], button[aria-label="Dismiss" i]');
        if (byLabel) return byLabel;
        return Array.from(el.querySelectorAll('button')).find(b => /^\s*(cancel|close|dismiss|got it|no)\s*$/i.test(b.textContent)) || null;
    }

    function closeTop() {
        for (let i = stack.length - 1; i >= 0; i--) {
            const el = stack[i];
            if (!isOpen(el)) { stack.splice(i, 1); continue; }
            if (el.dataset.dlgPersistent) return false;
            const ctl = closeControl(el);
            if (ctl) ctl.click();
            else el.classList.add('hidden');
            return true;
        }
        return false;
    }

    document.addEventListener('keydown', function (ev) {
        if (!stack.length) return;
        const top = stack[stack.length - 1];
        if (!top || !isOpen(top)) return;
        if (ev.key === 'Escape') {
            if (closeTop()) ev.stopPropagation();
            return;
        }
        if (ev.key !== 'Tab') return;
        // Keep Tab inside the dialog on top.
        const panel = panelOf(top);
        const items = focusables(panel);
        if (!items.length) { ev.preventDefault(); panel.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!panel.contains(active)) { ev.preventDefault(); first.focus(); }
        else if (ev.shiftKey && (active === first || active === panel)) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
    }, true);

    window.Dialogs = { closeTop, open: () => stack.slice() };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
