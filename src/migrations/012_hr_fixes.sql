-- 012_hr_fixes.sql
-- Addresses issues #3, #4, #13, #14, #16, #20, #21 from the HR module critique.

-- ============================================
-- #16: Add indexes on frequently queried FK columns
-- ============================================

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_period ON payslips(employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_reviews(employee_id);

-- ============================================
-- #13: Add UNIQUE constraint on employees.email
-- (SQLite allows multiple NULLs in UNIQUE columns, which is correct behavior)
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email_unique ON employees(email) WHERE email IS NOT NULL;

-- ============================================
-- #3: Add UNIQUE constraint on payslips to prevent duplicate payroll runs
-- ============================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_payslips_unique_period ON payslips(employee_id, period_start, period_end);

-- ============================================
-- #4: Rename `approved_by` to `actioned_by` in leave_requests
-- SQLite does not support RENAME COLUMN in older versions, so we
-- recreate the table. This is safe because we use IF NOT EXISTS
-- on the new table and migrate data.
-- ============================================

-- Create new table with corrected column name
CREATE TABLE IF NOT EXISTS leave_requests_new (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
    start_date TEXT NOT NULL,          -- YYYY-MM-DD
    end_date TEXT NOT NULL,            -- YYYY-MM-DD
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    actioned_by TEXT REFERENCES employees(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migrate existing data (approved_by → actioned_by)
INSERT OR IGNORE INTO leave_requests_new (id, employee_id, leave_type_id, start_date, end_date, status, reason, actioned_by, created_at, updated_at)
SELECT id, employee_id, leave_type_id, start_date, end_date, status, reason, approved_by, created_at, updated_at
FROM leave_requests;

-- Swap tables
DROP TABLE IF EXISTS leave_requests;
ALTER TABLE leave_requests_new RENAME TO leave_requests;

-- Recreate the index on the new table
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);

-- ============================================
-- #14: Recreate attendance_records with ON DELETE CASCADE
-- ============================================

CREATE TABLE IF NOT EXISTS attendance_records_new (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date TEXT NOT NULL,                -- YYYY-MM-DD
    clock_in TEXT,                     -- HH:MM:SS
    clock_out TEXT,                    -- HH:MM:SS
    hours_worked REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO attendance_records_new (id, employee_id, date, clock_in, clock_out, hours_worked, created_at)
SELECT id, employee_id, date, clock_in, clock_out, hours_worked, created_at
FROM attendance_records;

DROP TABLE IF EXISTS attendance_records;
ALTER TABLE attendance_records_new RENAME TO attendance_records;

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(employee_id, date);

-- ============================================
-- #14: Recreate payslips with ON DELETE CASCADE
-- ============================================

CREATE TABLE IF NOT EXISTS payslips_new (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    base_salary REAL NOT NULL DEFAULT 0.0,
    allowances REAL NOT NULL DEFAULT 0.0,
    deductions REAL NOT NULL DEFAULT 0.0,
    net_pay REAL NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'paid')),
    payment_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(employee_id, period_start, period_end)
);

INSERT OR IGNORE INTO payslips_new (id, employee_id, period_start, period_end, base_salary, allowances, deductions, net_pay, currency, status, payment_date, created_at)
SELECT id, employee_id, period_start, period_end, base_salary, allowances, deductions, net_pay, currency, status, payment_date, created_at
FROM payslips;

DROP TABLE IF EXISTS payslips;
ALTER TABLE payslips_new RENAME TO payslips;

CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_period ON payslips(employee_id, period_start, period_end);

-- ============================================
-- #14 + #20: Recreate performance_reviews with ON DELETE CASCADE and updated_at
-- ============================================

CREATE TABLE IF NOT EXISTS performance_reviews_new (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    review_period TEXT NOT NULL,       -- e.g., '2026-Q1', '2026-Annual'
    rating REAL CHECK (rating >= 1.0 AND rating <= 5.0),
    feedback_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO performance_reviews_new (id, employee_id, reviewer_id, review_period, rating, feedback_notes, created_at, updated_at)
SELECT id, employee_id, reviewer_id, review_period, rating, feedback_notes, created_at, created_at
FROM performance_reviews;

DROP TABLE IF EXISTS performance_reviews;
ALTER TABLE performance_reviews_new RENAME TO performance_reviews;

CREATE INDEX IF NOT EXISTS idx_performance_reviews_employee ON performance_reviews(employee_id);

-- ============================================
-- #21: Add updated_at and deleted_at to leave_types
-- (SQLite 3.35+ supports ADD COLUMN)
-- ============================================

ALTER TABLE leave_types ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));
ALTER TABLE leave_types ADD COLUMN deleted_at TEXT;
