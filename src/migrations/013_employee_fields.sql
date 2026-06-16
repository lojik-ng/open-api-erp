-- 013_employee_fields.sql
-- Adds date_of_birth, end_date, address to employees.
-- Creates salary_history table for audit trail.

-- ============================================
-- New columns on employees
-- ============================================

ALTER TABLE employees ADD COLUMN date_of_birth TEXT;      -- YYYY-MM-DD
ALTER TABLE employees ADD COLUMN end_date TEXT;            -- YYYY-MM-DD (when employment ended)
ALTER TABLE employees ADD COLUMN address TEXT;             -- Free-form address
ALTER TABLE employees ADD COLUMN salary_period TEXT NOT NULL DEFAULT 'Monthly';

-- ============================================
-- Salary history table
-- Auto-populated by the service layer whenever base_salary or currency changes.
-- ============================================

CREATE TABLE IF NOT EXISTS salary_history (
    id TEXT PRIMARY KEY,                                    -- UUID
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_date TEXT NOT NULL,                           -- YYYY-MM-DD
    amount REAL NOT NULL,                                  -- Salary amount
    currency TEXT NOT NULL DEFAULT 'USD',
    reason TEXT,                                            -- e.g. 'promotion', 'annual_review', 'initial'
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON salary_history(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_history_effective ON salary_history(employee_id, effective_date);
