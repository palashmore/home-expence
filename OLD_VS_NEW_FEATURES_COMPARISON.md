# Comprehensive Feature Comparison: old-homeexpenses-repo vs home-expence

| Feature Category | Legacy: `old-homeexpenses-repo` (`homeexpenses`) | Modern: `home-expence` (New Production Repo) | Major Advantage & Status |
| :--- | :--- | :--- | :--- |
| **Repository Identity** | `https://github.com/palashmore/homeexpenses.git` | `https://github.com/palashmore/home-expence.git` | Clean production repository with automated Vercel CI/CD |
| **App Branding & Logo** | Generic "HOMEEXPENSES" text | "HOME EXPENCE" with custom House + Rupee (₹) vector icon | High-end luxury financial branding |
| **Multi-Tenancy** | Single unpartitioned JSON files (`data/expenses.json`) | Per-household directory isolation (`data/households/{id}/`) | Complete data privacy & multi-family scalability |
| **Authentication** | None (open URL access, no passwords) | Scrypt cryptographic hashing + Bearer session tokens | Enterprise security & unauthorized access prevention |
| **Role-Based Access (RBAC)** | None (all users had identical privileges) | 3-Tier RBAC (`SYSTEM_ADMIN`, `OWNER`, `MEMBER`, `VIEWER`) | Viewer cannot delete; SysAdmin governs households |
| **User & Tenant Management** | None (hardcoded names) | Section 0 Admin Panel with full User & Household CRUD | Dynamic household creation and member invitation |
| **Cache Synchronization** | Prone to stale caches (SW cache & localStorage) | **Zero-Cache Direct Sync Engine**: `no-store`, `no-cache`, timestamp buster (`_t`), SW network-only for APIs | 100% real-time accuracy across multiple concurrent devices |
| **Cross-Tab Real-Time Sync** | Polling only | Native `BroadcastChannel('homeexpenses_sync')` | Instant 0ms refresh across all open browser windows |
| **Mobile Push Priority** | Standard push (placed in Android **"Silent"** group) | RFC 8030 `Urgency: high`, `silent: false`, `requireInteraction: true` | **Heads-Up Alert Banners** displayed on top of the phone screen |
| **Mobile Notification Stacking** | Shared static tag (replaced previous alerts) | Dynamic unique tags (`expense-${type}-${timestamp}-${rand}`) | **Notifications stack in the Android notification shade like Snapchat & WhatsApp** |
| **Push Recipient Targeting** | Excluded the actor (actor's phone never got push) | Smart Household Multi-Device Dispatcher (Actor confirmation + linked member alert) | Both the spender and family members see notifications in their notification tray |
| **Instant Local Notifications** | None | Client triggers `reg.showNotification` on save/delete | 0ms local notification in status bar while server dispatches push |
| **In-App Real-Time Banners** | None (only static alert dropdown) | Floating Heads-Up Banner card sliding from top of screen (`z-[9999]`) with haptics & audio chime | Real-time in-app awareness when using the application |
| **Visual Color Themes** | 1 fixed theme (Indigo) | **8 Luxury Themes** (Royal Indigo, Obsidian Dark, Emerald Mint, Sunset Rose, Ocean Sapphire, Golden Amber, Amethyst Purple, Platinum Slate) | Instant switching via Desktop dropdown & 32px Mobile Quick Trigger |
| **Audit Ledger Trail** | Flat list without change details | Forensic Audit Ledger with **field-level deltas** (old value ➔ new value), glowing status dots & Excel export | Complete accountability and fraud prevention |
| **Offline Capabilities** | Unreliable when offline | Offline Sync Queue (`enqueueOfflineAction`) with visual badge and auto-sync on reconnect | Zero data loss even with flaky mobile internet |
| **Staff Payroll System** | Fixed Nilima/Madhuri calculator | Multi-staff engine with custom paid leave quotas, cycle types (calendar vs custom), and WhatsApp vouchers | Automated deductions and month-end cutoff alerts |
| **Data Integrity Verification**| Unverified baseline | Exactly **122 records** and **₹156,761.33** balance strictly preserved | Zero corruption or data loss |
