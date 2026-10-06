// Permission registry — the single place that says what a role may do.
//
// The application had 30 ad-hoc role comparisons spread across six API files
// (`session.role === 'ADMIN'`, `!== 'OWNER'`, and so on). Nothing listed the
// capabilities that existed, so a new endpoint was gated by whatever its author
// remembered - which is how /api/migrate shipped with no check at all and the
// audit trail stayed readable by every signed-in member.
//
// A role still supplies the defaults, and a user record with no `permissions`
// field behaves exactly as it did before - which is every user in the existing
// data. An administrator can now pin an explicit list on one user, and that
// list wins. The field is written only when somebody deliberately sets it, so
// no stored document has to be migrated to adopt this.

const PERMISSIONS = {
    DASHBOARD_VIEW: 'dashboard.view',

    EXPENSE_VIEW: 'expense.view',
    EXPENSE_CREATE: 'expense.create',
    EXPENSE_EDIT: 'expense.edit',
    EXPENSE_DELETE: 'expense.delete',

    BILL_VIEW: 'bill.view',
    BILL_MANAGE: 'bill.manage',

    PERSONAL_VIEW: 'personal.view',

    REPORTS_VIEW: 'reports.view',
    MATRIX_VIEW: 'matrix.view',
    SETTLEMENT_VIEW: 'settlement.view',

    STAFF_VIEW: 'staff.view',
    ATTENDANCE_MANAGE: 'attendance.manage',
    PAYROLL_VIEW: 'payroll.view',

    EXCEL_IMPORT: 'excel.import',
    EXCEL_EXPORT: 'excel.export',
    BACKUP_MANAGE: 'backup.manage',
    RESTORE_MANAGE: 'restore.manage',

    AUDIT_VIEW: 'audit.view',

    USERS_VIEW: 'users.view',
    USERS_MANAGE: 'users.manage',

    HOUSEHOLD_VIEW: 'household.view',
    HOUSEHOLD_MANAGE: 'household.manage',

    SETTINGS_VIEW: 'settings.view',
    SETTINGS_MANAGE: 'settings.manage'
};

const P = PERMISSIONS;

// A VIEWER reads their household and nothing administrative.
const VIEWER = [
    P.DASHBOARD_VIEW, P.EXPENSE_VIEW, P.BILL_VIEW, P.PERSONAL_VIEW,
    P.REPORTS_VIEW, P.STAFF_VIEW, P.HOUSEHOLD_VIEW, P.SETTINGS_VIEW,
    P.EXCEL_EXPORT
];

// A MEMBER keeps their own books: full expense lifecycle, no administration.
const MEMBER = VIEWER.concat([
    P.EXPENSE_CREATE, P.EXPENSE_EDIT, P.EXPENSE_DELETE,
    P.MATRIX_VIEW, P.SETTLEMENT_VIEW
]);

// An OWNER runs the household: staff, bills, settings, its audit trail.
const OWNER = MEMBER.concat([
    P.BILL_MANAGE, P.ATTENDANCE_MANAGE, P.PAYROLL_VIEW,
    P.EXCEL_IMPORT, P.BACKUP_MANAGE, P.RESTORE_MANAGE,
    P.AUDIT_VIEW, P.USERS_VIEW, P.SETTINGS_MANAGE
]);

// An ADMIN additionally manages users and households across the system.
const ADMIN = OWNER.concat([P.USERS_MANAGE, P.HOUSEHOLD_MANAGE]);

const ROLE_PERMISSIONS = {
    VIEWER: VIEWER,
    MEMBER: MEMBER,
    OWNER: OWNER,
    ADMIN: ADMIN,
    SYSTEM_ADMIN: ADMIN
};

// Every code that exists, for validating anything an administrator submits.
const ALL_PERMISSIONS = Object.keys(PERMISSIONS).map(k => PERMISSIONS[k]);

// The named starting points an administrator picks from before adjusting
// individual boxes. These are explicit lists, not aliases of the role defaults:
// a preset is a suggestion the admin can edit, whereas a role is what the
// account falls back to when no explicit list is stored.
const ROLE_PRESETS = {
    MEMBER: {
        label: 'Member',
        description: 'Records and edits expenses. No administration.',
        permissions: MEMBER.slice()
    },
    FINANCE_MANAGER: {
        label: 'Finance Manager',
        description: 'Everything about money: bills, budgets, backups, reports.',
        permissions: MEMBER.concat([
            P.BILL_MANAGE, P.EXCEL_IMPORT, P.BACKUP_MANAGE, P.RESTORE_MANAGE,
            P.AUDIT_VIEW, P.SETTINGS_MANAGE
        ])
    },
    STAFF_MANAGER: {
        label: 'Staff Manager',
        description: 'Attendance and payroll, plus the everyday expense work.',
        permissions: MEMBER.concat([
            P.ATTENDANCE_MANAGE, P.PAYROLL_VIEW
        ])
    },
    ADMINISTRATOR: {
        label: 'Administrator',
        description: 'Full access, including users and households.',
        permissions: ADMIN.slice()
    }
};

// Keep only codes this build knows about, in registry order, without
// duplicates. Anything unrecognised is dropped rather than stored, so a typo or
// a tampered request cannot park an unknown string in the user record where a
// later version might give it meaning.
function sanitizePermissions(list) {
    if (!Array.isArray(list)) return null;
    const wanted = new Set(list.map(v => String(v || '').trim()).filter(Boolean));
    return ALL_PERMISSIONS.filter(p => wanted.has(p));
}

// Accepts a role string or a user record. A user record carrying a non-empty
// `permissions` array is authoritative; anything else falls back to the role.
//
// Unknown roles get nothing. Failing closed matters more than being lenient to
// a role somebody mistyped.
function permissionsFor(roleOrUser) {
    if (roleOrUser && typeof roleOrUser === 'object') {
        const explicit = sanitizePermissions(roleOrUser.permissions);
        if (explicit && explicit.length) return explicit;
        return ROLE_PERMISSIONS[String(roleOrUser.role || '').toUpperCase()] || [];
    }
    return ROLE_PERMISSIONS[String(roleOrUser || '').toUpperCase()] || [];
}

// True when the subject holds an explicit list rather than inheriting one.
function hasExplicitPermissions(user) {
    const explicit = user && sanitizePermissions(user.permissions);
    return !!(explicit && explicit.length);
}

function roleHas(roleOrUser, permission) {
    return permissionsFor(roleOrUser).indexOf(permission) !== -1;
}

function roleHasAny(roleOrUser, permissions) {
    const held = permissionsFor(roleOrUser);
    return (permissions || []).some(p => held.indexOf(p) !== -1);
}

function roleHasAll(roleOrUser, permissions) {
    const held = permissionsFor(roleOrUser);
    return (permissions || []).every(p => held.indexOf(p) !== -1);
}

module.exports = {
    PERMISSIONS,
    ALL_PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLE_PRESETS,
    sanitizePermissions,
    hasExplicitPermissions,
    permissionsFor,
    roleHas,
    roleHasAny,
    roleHasAll
};
