-- =====================================================================
-- HOUSEHOLD EXPENSE TRACKER - DATABASE SCHEMA & MIGRATION SCRIPT
-- =====================================================================

-- 1. PostgreSQL / Supabase Table Definition
CREATE TABLE IF NOT EXISTS household_expenses (
    id VARCHAR(100) PRIMARY KEY,
    date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    category VARCHAR(100) NOT NULL,
    paid_to VARCHAR(255),
    payment_method VARCHAR(100) DEFAULT 'UPI',
    notes TEXT,
    billing_cycle VARCHAR(50),
    receipt_id VARCHAR(100),
    receipt_data TEXT, -- Base64 encoded receipt image blob
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version INT DEFAULT 1
);

-- Index for date filtering & performance
CREATE INDEX IF NOT EXISTS idx_expenses_date ON household_expenses(date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON household_expenses(category);

-- 2. Google Sheets Columns Structure (Sheet: "Transactions")
-- Column A: ID (e.g. nilima-01, exp-1727170000000)
-- Column B: Date (YYYY-MM-DD)
-- Column C: Amount (INR)
-- Column D: Category
-- Column E: Paid To
-- Column F: Payment Method
-- Column G: Notes / Remarks
-- Column H: Billing Cycle (e.g. 2026-08-21, 2026-09-30)
-- Column I: Receipt ID / URL
-- Column J: Updated At (ISO 8601 Timestamp)
