# Features Specification: home-expence (Current Production Repository)
**Repository**: `palashmore/home-expence.git`  
**Branding**: `HOME EXPENCE · Household Financial & Staff Payroll Command Center`  
**Current Release**: `v5.5.0 Production` (Commit `c370ed9`)  
**Architectural Paradigm**: Multi-Tenant Isolated Ledger Engine with Zero-Cache Real-Time Synchronization & High-Priority Web Push  

---

## 1. Executive Summary & Architectural Overview
`home-expence` is an enterprise-grade, mobile-first progressive web application (PWA) designed for modern multi-user households and family offices. It completely re-engineers the legacy system by introducing:
- **Full Multi-Tenant Ledger Isolation** with per-household directory partitioning.
- **Scrypt Cryptographic Authentication** and 3-Tier Role-Based Access Control (RBAC).
- **Zero-Cache Direct Synchronization** across all APIs, Service Worker, and browser instances.
- **Cross-Platform Heads-Up Notification Banners**: System-level notifications in Android status bars (matching Snapchat & WhatsApp) plus real-time in-app floating alert cards.
- **Enterprise Forensic Audit Ledger** with field-level change deltas and visual timelines.
- **8 Luxury Visual Themes** with instantaneous live switching across desktop and mobile.

```
data/
├── households/
│   ├── H001/                        <-- Tenant 1 (Isolated Household Ledger)
│   │   ├── expenses.json            <-- Scoped financial records (122 records, ₹156,761.33)
│   │   ├── config.json              <-- Custom household settings, categories, rules
│   │   ├── attendance.json          <-- Domestic staff attendance & paid leaves
│   │   ├── audit_log.json           <-- Household forensic audit trail
│   │   └── notifications.json       <-- In-app alert history
│   └── H002/                        <-- Tenant 2 (Completely Isolated)
│       └── ...
├── users.json                       <-- Scrypt-hashed user credentials & RBAC roles
├── households.json                  <-- Household registry & tenancy mapping
├── vapid_keys.json                  <-- Web Push VAPID cryptographic keypair
└── push_subscriptions.json          <-- Tenant-scoped device push subscriptions
```

---

## 2. Complete Features List

### A. Multi-Tenant Ledger & Household Isolation
- **Per-Household Database Partitioning**:
  - Every household operates in a strictly isolated directory (`data/households/{householdId}/`).
  - Users belonging to Household A can never read, modify, or delete records from Household B.
- **Multi-Household Support**:
  - System supports concurrent households (e.g. `H001` - More Family, `H002` - Executive Retreat, etc.).
- **Household & User Management (Section 0)**:
  - System Administrators can create new households, edit household details, and assign owners.
  - User accounts can be created, updated, role-modified, or deleted with immediate credential invalidation.
- **User Profile & Household Switcher**:
  - Interactive modal accessible via the user avatar in the header on mobile and desktop.
  - Displays user profile, assigned household, role badge, and 1-tap sign-out action.

### B. Enterprise Authentication & Role-Based Access Control (RBAC)
- **Scrypt Cryptographic Security**:
  - Passwords hashed using industry-standard `crypto.scrypt` with cryptographic salts.
  - Secure Bearer token sessions with strict request validation on all `/api/*` endpoints.
- **Three-Tier Access Permissions**:
  1. **System Administrator (`SYSTEM_ADMIN`)**:
     - Global system governance.
     - Access to Section 0 Household & User Management.
     - Can provision households, manage system users, and inspect cross-household integrity.
  2. **Household Owner (`OWNER`)**:
     - Full read/write management of the household's ledger, categories, staff, budgets, and recurring bills.
     - Can manage member access within their household.
  3. **Household Member (`MEMBER`) & Viewer (`VIEWER`)**:
     - `MEMBER`: Full expense recording and editing rights within the household.
     - `VIEWER`: Read-only ledger inspection; delete and administrative modification actions are blocked (HTTP 403 Forbidden).
- **Session Protection**:
  - Protected API routes reject unauthenticated requests with clean HTTP 401/403 responses.
  - Auto-login token persistence in localStorage with silent background validation.

### C. Zero-Cache Real-Time Synchronization Engine
- **Stale Cache Elimination**:
  - All financial endpoints (`/api/expenses`, `/api/config`, `/api/attendance`, `/api/notifications`) enforce:
    ```http
    Cache-Control: no-cache, no-store, must-revalidate
    Pragma: no-cache
    Expires: 0
    ```
  - Dynamic timestamp cache busting (`_t=${Date.now()}`) appended to all AJAX requests.
- **Service Worker Network-Only Routing**:
  - Service Worker (`sw.js`) explicitly bypasses cache for all `/api/*` network requests.
- **Cross-Tab Real-Time Broadcast**:
  - Uses `BroadcastChannel('homeexpenses_sync')` to instantly update all open browser tabs and windows the millisecond a transaction is saved or deleted.
- **Multi-Device Concurrency Polling**:
  - Fast 7-second background polling cycle.
  - Instant re-sync on `visibilitychange` (bringing the mobile app from background to foreground) and window `focus`.

### D. High-Priority Mobile Push & Notification Shade Alerts
- **Mobile Notification Shade Alerts (Android / Realme / iOS)**:
  - Configured with RFC 8030 High-Priority Push Options:
    ```javascript
    {
      TTL: 86400,
      urgency: 'high',
      headers: { 'Urgency': 'high', 'Topic': 'household_updates' }
    }
    ```
  - Service Worker `showNotification` properties configured to bypass silent notification channels:
    - `requireInteraction: true` (ensures prominent heads-up alerts on mobile).
    - `silent: false` (disables silent classification).
    - `vibrate: [300, 100, 300, 100, 300]` (rich haptic vibration pattern).
    - Dynamic unique tags (`expense-${type}-${timestamp}-${rand}`) allowing multiple notifications to **stack and remain visible in the phone's notification tray under "Home Expence" alongside Snapchat and WhatsApp**.
- **Smart Household Multi-Device Dispatcher**:
  - Sends notifications to **ALL devices registered to the household**:
    - **Actor Device (Confirmation)**:
      - `💰 Expense Added: ₹475.25` • `Grocery & Vegetables • Paid by Palash`
      - `✏️ Expense Updated: ₹520`
      - `🗑️ Expense Deleted: ₹520`
    - **Linked Household Member Devices**:
      - `💰 Palash added expense: ₹475.25` • `Grocery & Vegetables • Paid by Palash`
      - `✏️ Palash updated an expense: ₹520`
      - `🗑️ Palash deleted an expense`
- **Instantaneous 0ms Local System Notification**:
  - The client triggers `navigator.serviceWorker.ready.then(reg => reg.showNotification(...))` immediately when saving or deleting an expense, ensuring zero delay on the active device.
- **Android Notification Settings Helper**:
  - Inline guidance card inside the alert drawer explaining how to allow "Banners / Alerting" on Realme UI / ColorOS / Android if the phone default placed it in Silent.

### E. In-App Real-Time Heads-Up Floating Banners
- **Floating Banner Card (`#inAppNotificationBannerContainer`)**:
  - Fixed at `top: 12px`, centered horizontally on mobile and anchored top-right on desktop (`z-[9999]`).
  - Dark glassmorphism card with live pulsing indicator (`Home Expence • Live`), category icon, title, body, and action buttons.
- **Audio & Haptic Feedback**:
  - Gentle unobtrusive audio synthesizer chime generated in real time via the Web Audio API.
  - Mobile haptics via `navigator.vibrate([120, 60, 120])`.
- **Interactive Routing**:
  - "View Update" button automatically navigates to the relevant tab (Expenses, Staff, Settings).
  - Auto-dismisses smoothly after 6.5 seconds or on tap.
- **One-Tap "Test Banner" Trigger**:
  - Dedicated test button in the notification drawer footer to instantly preview the in-app floating banner.

### F. Core Financial Ledger & Concurrency
- **122 Baseline Transactions Preserved**:
  - Exact financial total of **₹156,761.33** verified with 100% integrity.
- **Expense Categorization**:
  - Full CRUD operations with auto-sync to Master Settings when a new category is used.
  - Payer attribution linked to household users.
- **Concurrency Conflict Resolution**:
  - Conflict detection on concurrent edits (`handleExpenseConflict`), prompting the user with a side-by-side diff modal before overwriting.
- **Offline Sync Queue**:
  - If network connectivity is lost, transactions are saved locally in `offlineQueue` and tagged with `temp_` IDs.
  - Auto-syncs to the server when connection is restored, with animated badge indicator in the header.

### G. 8 Luxury Responsive Themes
- Full CSS token variable system supporting 8 luxury themes:
  1. ✨ **Royal Indigo** (Default)
  2. 🌙 **Obsidian Dark**
  3. 🌿 **Emerald Mint**
  4. 🌅 **Sunset Rose**
  5. 🌊 **Ocean Sapphire**
  6. 👑 **Golden Amber**
  7. 🔮 **Amethyst Purple**
  8. ⚙️ **Platinum Slate**
- **Mobile Compact Palette Trigger**:
  - Custom 32px rounded trigger in mobile header (`#mobileThemeSelector`) for seamless 1-tap theme switching.
- **Desktop Theme Dropdown**:
  - Luxury styled dropdown in header with instant preview.

### H. Forensic Audit Ledger & Live Timeline
- **Field-Level Change Deltas**:
  - Records Actor, Action (`CREATE`, `UPDATE`, `DELETE`), Timestamp, and precise before/after changes (e.g., `amount: 500 ➔ 475.25`, `category: Food ➔ Groceries`).
- **Visual Status & Glowing Timeline**:
  - Color-coded glowing status dots for operations (Emerald for Create, Amber for Update, Rose for Delete).
  - Responsive table ledger and mobile card timeline layout.
- **Excel Audit Export**:
  - Dedicated button to export complete audit trails to spreadsheet format.

### I. Domestic Staff Attendance & Payroll Suite
- **Multi-Staff Management**:
  - Dedicated tracking for **Chef (Nilima Nikose)**, **Maid (Madhuri)**, and unlimited custom staff.
- **Custom Leave Quotas & Formulas**:
  - Configurable paid leaves quota per staff with automated salary deduction formulas.
  - Billing cycle day options (e.g., 21st for Maid, 30th for Chef) and cycle types (Calendar Month vs Custom Cycle).
- **Interactive Calendar Ledger**:
  - Visual monthly attendance matrix with Present, Absent, Half-Day, and Paid-Leave states.
- **1-Click WhatsApp Payment Slip**:
  - Instant formatted payment receipt with working days, leaves taken, deductions, and net payable salary.

### J. Utility Due Date Radar & Bill Tracking
- **Automated Bills Radar**:
  - Monitors Electricity, Maintenance, WiFi, DTH, and Staff Salaries.
  - Real-time countdowns (`PAID`, `DUE_TODAY`, `OVERDUE`, `UPCOMING in X days`).
- **1-Click Settlement**:
  - "Pay Now" pre-fills the expense modal with the bill's approx amount and category.

### K. 100% Reimbursement & Splitwise Settle-Up
- **Reimbursement Calculator**:
  - Automatically calculates net balances between household partners (e.g. Palash & Pallavi).
- **1-Click Settle-Up**:
  - Generates balancing transaction and resets outstanding balances to zero.

### L. Executive Reports & Microsoft Excel Integration
- **Executive PDF Report**:
  - High-resolution, printable executive financial summary with monthly analytics.
- **Multi-Mode Excel Exports**:
  - Export Filtered View (active month/filter).
  - Export Complete History (all-time historical ledger).
- **Excel Import**:
  - Full spreadsheet importer with column auto-mapping and duplicate prevention.

### M. Mobile-First Progressive Web App (PWA)
- **Installable PWA**:
  - Standalone app mode (`display-mode: standalone`) on Android and iOS.
  - Custom Home Expence Logo featuring an authentic house silhouette with an inner Indian Rupee symbol (₹).
  - Service Worker cache `homeexpenses-v10` with network-first strategy for static assets and network-only for APIs.
- **Mobile Bottom Navigation Bar**:
  - Fixed native bottom tab bar (`Home`, `Personal`, `Quick Add (+)`, `Expenses`, `Staff`, `More`).
  - Ergonomic 1-thumb Quick Add button with haptic feedback.
