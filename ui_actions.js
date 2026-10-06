// Generated from the inline handlers that used to live in index.html.
//
// Each entry is the original expression, unchanged, lifted out of the markup
// and given a name. One listener per event type looks up data-click,
// data-change, data-submit or data-input and calls the matching entry with
// `this` bound to the element, exactly as an inline attribute did.
//
// This is ordinary source once generated, so editing it is fine - but new
// markup should add a data-click attribute and an entry here rather than an
// onclick, so the page keeps working under a strict Content-Security-Policy.

(function () {
    "use strict";

    const ACTIONS = {
        a001: function (event) { installPwaApp(); },
        a002: function (event) { dismissMobilePwaBanner(); },
        a003: function (event) { openUserProfileModal(); },
        a004: function (event) { changeTheme(this.value); },
        a005: function (event) { toggleNotificationCenter(); },
        a006: function (event) { syncOfflineQueue(); },
        a007: function (event) { toggleMobileActionMenu(); },
        a008: function (event) { signOut(); toggleMobileActionMenu(); },
        a009: function (event) { openUserProfileModal(); toggleMobileActionMenu(); },
        a010: function (event) { installPwaApp(); toggleMobileActionMenu(); },
        a011: function (event) { resetToCurrentMonth(); toggleMobileActionMenu(); },
        a012: function (event) { generateExecutiveReport(); toggleMobileActionMenu(); },
        a013: function (event) { exportToExcel('filtered'); toggleMobileActionMenu(); },
        a014: function (event) { exportToExcel('all'); toggleMobileActionMenu(); },
        a015: function (event) { importFromExcel(event); toggleMobileActionMenu(); },
        a016: function (event) { switchTab('audit'); toggleMobileActionMenu(); },
        a017: function (event) { toggleExportMenu(); },
        a018: function (event) { exportToExcel('filtered'); toggleExportMenu(); },
        a019: function (event) { exportToExcel('all'); toggleExportMenu(); },
        a020: function (event) { generateExecutiveReport(); toggleExportMenu(); },
        a021: function (event) { importFromExcel(event); toggleExportMenu(); },
        a022: function (event) { installPwaApp(); toggleExportMenu(); },
        a023: function (event) { resetToCurrentMonth(); toggleExportMenu(); },
        a024: function (event) { openExpenseModal(); },
        a025: function (event) { signOut(); },
        a026: function (event) { requestPushNotificationPermission(); },
        a027: function (event) { switchNotificationFilter('action'); },
        a028: function (event) { switchNotificationFilter('upcoming'); },
        a029: function (event) { switchNotificationFilter('all'); },
        a030: function (event) { clearAllDismissedNotifications(); },
        a031: function (event) { dismissAllNotifications(); },
        a032: function (event) { switchTab('dashboard'); },
        a033: function (event) { switchTab('expenses'); },
        a034: function (event) { switchTab('staff'); },
        a035: function (event) { switchTab('reports'); },
        a036: function (event) { switchTab('matrix'); },
        a037: function (event) { switchTab('personal'); },
        a038: function (event) { switchTab('admin'); },
        a039: function (event) { switchTab('audit'); },
        a040: function (event) { switchTab('settings'); },
        a041: function (event) { openMobileFilterSheet(); },
        a042: function (event) { resetAllFilters(); },
        a043: function (event) { onFilterChange(); },
        a044: function (event) { toggleCustomDateRange(); },
        a045: function (event) { applyCustomDateRange(); },
        a046: function (event) { clearCustomDateRange(); },
        a047: function (event) { quickFilterPeriod('this-month'); },
        a048: function (event) { quickFilterPeriod('last-month'); },
        a049: function (event) { quickFilterPeriod('this-year'); },
        a050: function (event) { quickFilterPeriod('all-time'); },
        a051: function (event) { quickFilterFlow('expense'); },
        a052: function (event) { quickFilterFlow('income'); },
        a053: function (event) { exportToExcel('filtered'); },
        a054: function (event) { quickFilterPeriod('today'); },
        a055: function (event) { quickFilterPeriod('this-week'); },
        a056: function (event) { dismissAnomalyBanner(); },
        a057: function (event) { setTrendGranularity('monthly'); },
        a058: function (event) { setTrendGranularity('quarterly'); },
        a059: function (event) { openQuickFillModal(); },
        a060: function (event) { openSettleUpModal(); },
        a061: function (event) { setPersonalViewFilter('all'); },
        a062: function (event) { openPersonalExpenseModal(); },
        a063: function (event) { renderPersonalExpensesDashboard(); },
        a064: function (event) { applyFilters(); },
        a065: function (event) { setExpenseView('timeline'); },
        a066: function (event) { setExpenseView('table'); },
        a067: function (event) { renderAttendanceCalendar(); },
        a068: function (event) { generateWhatsAppVoucher(); },
        a069: function (event) { quickPayCalculatedSalary(); },
        a070: function (event) { exportToExcel('all'); },
        a071: function (event) { triggerDataHealthScan(); },
        a072: function (event) { createInstantBackupSnapshot(); },
        a073: function (event) { downloadFullBackupJson(); },
        a074: function (event) { restoreBackupFromFile(event); },
        a075: function (event) { loadBackupSnapshots(); },
        a076: function (event) { repairDataHealthIssues(); },
        a077: function (event) { importFromExcel(event); },
        a078: function (event) { saveAdminConfigFromUI(); },
        a079: function (event) { resetAdminConfigToDefaults(); },
        a080: function (event) { togglePasswordVisibility('pwCurrent', this); },
        a081: function (event) { togglePasswordVisibility('pwNew', this); },
        a082: function (event) { togglePasswordVisibility('pwConfirm', this); },
        a083: function (event) { submitPasswordChange(); },
        a084: function (event) { openCreateHouseholdModal(); },
        a085: function (event) { openCreateUserModal(); },
        a086: function (event) { loadAdminConsoleData(true); },
        a087: function (event) { openAdminAddStaffModal(); },
        a088: function (event) { openAdminAddBillModal(); },
        a089: function (event) { openAdminAddCategoryModal(); },
        a090: function (event) { adminAddFamilyMember(); },
        a091: function (event) { adminAddPaymentMethod(); },
        a092: function (event) { onAdminCycleTypeChange(); },
        a093: function (event) { adminSaveBudget(); },
        a094: function (event) { adminAddSplitRule(); },
        a095: function (event) { window.renderAuditView(); },
        a096: function (event) { window.exportAuditToExcel(); },
        a097: function (event) { window.exportAuditToJson(); },
        a098: function (event) { window.filterInAppAuditLogs(); },
        a099: function (event) { document.getElementById('inAppAuditSearch').value=''; window.filterInAppAuditLogs(); },
        a100: function (event) { window.setInAppAuditFilter('ALL'); },
        a101: function (event) { window.setInAppAuditFilter('UPDATE_EXPENSE'); },
        a102: function (event) { window.setInAppAuditFilter('UPDATE_CONFIG'); },
        a103: function (event) { window.setInAppAuditFilter('CREATE_EXPENSE'); },
        a104: function (event) { window.setInAppAuditFilter('DELETE_EXPENSE'); },
        a105: function (event) { window.filterInAppAuditLogs(); },
        a106: function (event) { window.setAuditLayoutMode('timeline'); },
        a107: function (event) { window.setAuditLayoutMode('table'); },
        a108: function (event) { switchTab('bills'); },
        a109: function (event) { openMobileMoreSheet(); },
        a110: function (event) { closeMobileMoreSheet(); },
        a111: function (event) { closeExpenseModal(); },
        a112: function (event) { saveExpense(event); },
        a113: function (event) { if(window.promptNewCategoryForExpense) window.promptNewCategoryForExpense(); },
        a114: function (event) { onCategoryChange(); },
        a115: function (event) { document.getElementById('inputReceipt').click(); },
        a116: function (event) { previewReceiptInput(event); },
        a117: function (event) { removeReceiptInput(event); },
        a118: function (event) { closeTransactionDetailModal(); },
        a119: function (event) { viewReceiptFull(this.src); },
        a120: function (event) { closeAdminEditCategoryModal(); },
        a121: function (event) { submitAdminEditCategory(); },
        a122: function (event) { closeDeleteConfirmModal(); },
        a123: function (event) { resolveConflictKeepServer(); },
        a124: function (event) { resolveConflictOverwrite(); },
        a125: function (event) { closeConflictModal(); },
        a126: function (event) { closeQuickFillModal(); },
        a127: function (event) { closeReceiptModal(); },
        a128: function (event) { event.stopPropagation(); },
        a129: function (event) { closeSettleUpModal(); },
        a130: function (event) { onSettleAmountChange(); },
        a131: function (event) { executeSettleUpTransaction(); },
        a132: function (event) { closePwaGuideModal(); },
        a133: function (event) { closeAdminAddStaffModal(); },
        a134: function (event) { adminSaveNewStaff(event); },
        a135: function (event) { closeAdminAddBillModal(); },
        a136: function (event) { adminSaveNewBill(event); },
        a137: function (event) { closeAdminAddCategoryModal(); },
        a138: function (event) { adminSaveNewCategory(event); },
        a139: function (event) { closeMobileFilterSheet(); },
        a140: function (event) { syncMobileFilterToDesktop('month'); },
        a141: function (event) { syncMobileFilterToDesktop('year'); },
        a142: function (event) { syncMobileFilterToDesktop('category'); },
        a143: function (event) { syncMobileFilterToDesktop('paidBy'); },
        a144: function (event) { syncMobileFilterToDesktop('expenseType'); },
        a145: function (event) { syncMobileFilterToDesktop('paymentMethod'); },
        a146: function (event) { quickFilterPeriod('this-month'); closeMobileFilterSheet(); },
        a147: function (event) { quickFilterPeriod('last-month'); closeMobileFilterSheet(); },
        a148: function (event) { quickFilterPeriod('this-year'); closeMobileFilterSheet(); },
        a149: function (event) { quickFilterPeriod('all-time'); closeMobileFilterSheet(); },
        a150: function (event) { resetAllFilters(); closeMobileFilterSheet(); },
        a151: function (event) { applyMobileFiltersAndClose(); },
        a152: function (event) { closeLoginModal(); },
        a153: function (event) { handleLoginFormSubmit(event); },
        a154: function (event) { togglePasswordVisibility('loginPassword', this); },
        a155: function (event) { closeUserProfileModal(); },
        a156: function (event) { signOut(); closeUserProfileModal(); },
        a157: function (event) { closeCreateHouseholdModal(); },
        a158: function (event) { event.preventDefault(); submitCreateHousehold(); },
        a159: function (event) { closeCreateUserModal(); },
        a160: function (event) { event.preventDefault(); submitCreateUser(); },
        a161: function (event) { closeEditHouseholdModal(); },
        a162: function (event) { event.preventDefault(); submitEditHousehold(); },
        a163: function (event) { closeEditUserModal(); },
        a164: function (event) { event.preventDefault(); submitEditUser(); },
        a165: function (event) { toggleUserPermissionEditor(); },
        a166: function (event) { setAllUserPermissions(true); },
        a167: function (event) { setAllUserPermissions(false); },
        a168: function (event) { resetUserPermissionsToRole(); },
    };

    // A click lands on the icon inside a button, not on the button, so the
    // lookup walks up from the target instead of reading event.target directly.
    //
    // Only the innermost match runs. That is what the old markup did too: a
    // modal body carrying event.stopPropagation() existed purely to stop the
    // backdrop's handler firing after it, and here there is nothing to stop.
    function dispatch(type, attr) {
        document.addEventListener(type, function (event) {
            const target = event.target;
            if (!target || !target.closest) return;
            const el = target.closest("[" + attr + "]");
            if (!el) return;
            const fn = ACTIONS[el.getAttribute(attr)];
            if (!fn) return;
            fn.call(el, event);
        }, false);
    }

    dispatch("click", "data-click");
    dispatch("change", "data-change");
    dispatch("submit", "data-submit");
    dispatch("input", "data-input");

    // Exposed so the audit can assert the registry covers the markup, rather
    // than inferring that from the markup itself.
    window.UI_ACTIONS = ACTIONS;
})();
