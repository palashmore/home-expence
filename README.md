# HOMEEXPENSES · Luxury Household Finance & Staff Payroll Command Center

A high-performance, modern, mobile-first PWA and web application designed for complete household financial tracking, domestic staff payroll management (with attendance & leave quotas), utility due date radar, 1-click Splitwise reimbursement, and Excel import/export persistence.

---

## 🌟 Key Features

1. **Mobile-First Responsive PWA**:
   - 100% responsive across all mobile screens (320px iPhone SE, 360px Samsung Galaxy A-series, tablets, desktop).
   - Horizontal swipeable top navigation + native bottom mobile navigation bar with 1-thumb center Quick Add (+) action.
   - PWA installable on iOS Safari ("Add to Home Screen") and Android Chrome ("Install App") for a full-screen, offline-capable mobile experience.

2. **Domestic Staff Attendance & Leave Payroll Suite**:
   - Interactive calendar for **Chef (Nilima Nikose)** and **Maid (Madhuri)**.
   - Configurable paid leave quotas (e.g. 4 free paid leaves for Chef, 2 for Maid) before salary deductions apply.
   - 1-click WhatsApp payment voucher generation and payroll settlement.

3. **Household Reimbursement & Splitwise Matrix**:
   - Tracks payer and household allocation with 100% reimbursement model (Palash reimburses Pallavi).
   - 1-Click "Settle Up" action that logs reimbursement and instantly brings balance to ₹0.

4. **Utility Due Date Radar & 15-Day Cash Runway**:
   - Real-time countdown for upcoming recurring bills (MSCB Electricity, Maintenance, WiFi, DTH, Salaries).
   - Color-coded status (Paid, Due Soon, Scheduled).

5. **⚙️ Admin & Master Settings Tab**:
   - Zero-friction configuration without passwords or auth barriers.
   - Customize staff salaries, leave quotas, paydays, recurring bills, categories, and family members ("Paid By").

6. **Full Persistence & Microsoft Excel Integration**:
   - Multi-sheet Excel export (Transactions, Monthly Matrix, Staff Ledger, Category Summary) and import.
   - Dual-mode server persistence (Node.js REST API + `/tmp` serverless support on Vercel).

---

## 🚀 Running Locally

```bash
npm install
node server.js
```
Then open `http://localhost:8000/` in your browser.

---

## ☁️ Deploying to Vercel

1. **Connect GitHub**:
   - Import `palashmore/homeexpenses` on [vercel.com](https://vercel.com).
   - Framework Preset: **Other**.
   - Output Directory: `./`.
   - Deploy!
2. **Or deploy via ZIP**:
   - Upload `household-expense-tracker-vercel.zip` directly to Vercel.
