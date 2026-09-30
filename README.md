# HOME EXPENCE · Household Financial & Staff Payroll Command Center

A high-performance, modern, mobile-first PWA and web application designed for complete household financial tracking, multi-user role management, domestic staff payroll management (with attendance & leave quotas), utility due date radar, 1-click Splitwise reimbursement, and Excel import/export persistence.

---

## 🌟 Key Features

1. **Mobile-First Responsive PWA**:
   - 100% responsive across all mobile screens (320px iPhone SE, 360px Samsung Galaxy A-series, tablets, desktop).
   - Horizontal swipeable top navigation + native bottom mobile navigation bar with 1-thumb center Quick Add (+) action.
   - PWA installable on iOS Safari ("Add to Home Screen") and Android Chrome ("Install App") for a full-screen, offline-capable mobile experience.
   - Custom GharKhata Logo featuring an authentic house silhouette with an inner Indian Rupee symbol (₹).

2. **Multi-Household & Dynamic User Scoping**:
   - Real-time scoped filters for family members, categories, payment methods, and personal expense tracking.
   - Granular RBAC (System Administrator, Owner, Member) with isolated household ledgers.

3. **Domestic Staff Attendance & Leave Payroll Suite**:
   - Interactive calendar for staff (Chef, Maid, etc.).
   - Configurable paid leave quotas before salary deductions apply.
   - 1-click WhatsApp payment voucher generation and payroll settlement.

4. **Household Reimbursement & Splitwise Matrix**:
   - Tracks payer and household allocation with automatic balance reconciliation.
   - 1-Click "Settle Up" action that logs reimbursement and instantly brings balance to ₹0.

5. **Utility Due Date Radar & Cash Runway**:
   - Real-time countdown for upcoming recurring bills (Electricity, Maintenance, WiFi, DTH, Salaries).
   - Color-coded status (Paid, Due Soon, Scheduled).

6. **⚙️ Master Configuration & Admin Access**:
   - Easily configure household categories, staff, recurring bills, monthly budgets, and user permissions.

7. **Full Persistence & Microsoft Excel Integration**:
   - Multi-sheet Excel export and import.
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
   - Import `palashmore/home-expence` on [vercel.com](https://vercel.com).
   - Framework Preset: **Other**.
   - Output Directory: `./`.
   - Deploy!
2. **Or deploy via Vercel CLI**:
   - Run `npx vercel --prod` in the project root directory.
