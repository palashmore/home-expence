# Features Specification: old-homeexpenses-repo (Legacy Repository)
**Repository**: `palashmore/homeexpenses.git`  
**Branding**: `HOMEEXPENSES · Luxury Household Finance & Staff Payroll Command Center`  
**Reference Commit**: `4fa8061`  
**Architectural Paradigm**: Single-Tenant Flat File System with Shared State  

---

## 1. Executive Summary & Architecture Overview
The legacy `homeexpenses` repository was developed as an open-access, single-household financial tracking and domestic staff management tool. It utilized flat JSON files stored in a single global directory (`data/expenses.json`, `data/config.json`, `data/attendance.json`, `data/audit_log.json`). It was designed primarily for local or simple cloud hosting where all users share a single unpartitioned database ledger without password authentication.

```
data/
├── expenses.json        <-- Single shared ledger for all records
├── config.json          <-- Global master configuration
├── attendance.json      <-- Staff attendance & leave records
├── audit_log.json       <-- Flat audit log array
└── push_subscriptions.json
```

---

## 2. Complete Features List

### A. Core Financial & Ledger Management
- **Single-Household Ledger**: All recorded transactions belong to one global list.
- **Predefined Member Attribution**: Payer selector with predefined names (Palash, Pallavi).
- **CRUD Operations**:
  - Add Expense via modal with Amount, Date, Category, Paid To, and optional Description.
  - Edit Expense by clicking on the transaction row.
  - Delete Expense with confirmation dialog.
- **Categorization**:
  - Pre-seeded categories (Groceries, Vegetables, Utilities, Dining, Staff, Milk, etc.).
- **Monthly Scoping**:
  - Filter transactions by Year and Month.
  - Quick month-selector buttons.

### B. Splitwise & Reimbursement System
- **100% Reimbursement Model**:
  - Assumes a fixed pair (Palash and Pallavi) where Palash reimburses 100% of Pallavi's household expenditures.
- **Net Reimbursement Indicator**:
  - Real-time KPI badge showing how much Palash owes Pallavi.
- **1-Click "Settle Up" Action**:
  - Creates a balancing payment entry to reset the outstanding debt to ₹0.

### C. Domestic Staff Payroll & Attendance Module
- **Staff Profiles**:
  - Hardcoded or flat-configured profiles: **Chef (Nilima Nikose)** and **Maid (Madhuri)**.
- **Attendance Calendar**:
  - Monthly grid tracking Present, Absent, Half-Day, and Paid Leaves.
- **Paid Leave Allowance**:
  - Fixed quota (e.g., 4 free days for Nilima, 2 free days for Madhuri) before daily salary deductions trigger.
- **Salary Calculator**:
  - Computes net payable salary based on base salary minus unexcused unpaid leave deductions.
- **WhatsApp Payment Slip**:
  - Generates a text summary formatted for WhatsApp with total days worked, leaves taken, and final amount.

### D. Utility Bills Due Date Radar
- **Fixed Recurring Bills List**:
  - Tracks MSCB Electricity, Society Maintenance, Airtel Broadband, Tata Play DTH, and Staff Salaries.
- **Due Date Indicator**:
  - Compares the current day against the bill's due day.
  - Highlights bills as "Due Today" or "Overdue".
- **Pay Bill Shortcut**:
  - Clicking on a radar item pre-populates the expense modal with the bill's approx amount and category.

### E. Analytics & Reporting
- **KPI Summary Cards**:
  - Total Monthly Spend, Daily Average, Number of Transactions, and Net Reimbursement Balance.
- **Category Breakdown Chart**:
  - Doughnut chart powered by Chart.js displaying expense distribution.
- **Excel Export**:
  - Generates `.xlsx` workbook containing active filtered transactions.
- **Excel Import**:
  - Parses uploaded spreadsheet and appends records to `expenses.json`.
- **Executive PDF Report**:
  - Formats current view for printing / browser "Save as PDF".

### F. Notifications & System Architecture
- **In-App Notification Drawer**:
  - Modal dropdown showing pending bills, overdue alerts, and staff salary cutoffs.
- **Web Push Notifications**:
  - Standard Service Worker push listener (`sw.js`).
  - Sends web push reminders using basic FCM options.
  - *Limitation*: No RFC 8030 high-urgency headers or heads-up priority flags; notifications were classified under "Silent" by Android/Realme OS.
  - *Limitation*: Excluded the acting user from receiving notifications, preventing self-confirmation on the actor's mobile device.

### G. Security & Access Control
- **Open Access ("No-Auth")**:
  - Designed without authentication barriers; anyone accessing the URL had full read/write access.
  - No user passwords, no JWT session tokens, and no role boundaries.

### H. Data Caching & Concurrency
- **Static Asset Caching**: Service Worker cache `homeexpenses-v7` / `homeexpenses-v8`.
- **Client Cache**: LocalStorage caching of `expenses_data`.
- *Limitation*: Prone to race conditions and stale caches during concurrent edits across different devices.

---

## 3. Summary of Limitations in the Legacy Repo
1. **No User Authentication or RBAC**: Anyone with the link could view or alter all data.
2. **Single Tenant Only**: No support for multiple households or isolated ledgers.
3. **Stale Cache Issues**: Edits made on one device were often masked by browser and service worker caches on other devices.
4. **Silent Push Notifications on Mobile**: Lacked RFC 8030 high-urgency configuration, resulting in notifications landing in the Android "Silent" tray.
5. **Actor Exclusion in Push Dispatch**: The person creating or modifying an expense never received a push confirmation on their own phone.
6. **No Real-Time Floating In-App Banner**: Alerts only appeared inside the notification center dropdown when explicitly opened.
7. **Single Theme**: Fixed default indigo color palette.
