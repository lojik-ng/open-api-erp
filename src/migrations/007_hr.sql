-- 007_hr.sql

CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,               -- UUID
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    department TEXT,
    role TEXT,
    start_date TEXT NOT NULL,          -- YYYY-MM-DD
    employment_type TEXT NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contractor')),
    status TEXT NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'on_leave', 'terminated')),
    base_salary REAL,
    currency TEXT DEFAULT 'USD',
    deleted_at TEXT,                   -- Soft delete
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_records (
    id TEXT PRIMARY KEY,               -- UUID
    employee_id TEXT NOT NULL REFERENCES employees(id),
    date TEXT NOT NULL,                -- YYYY-MM-DD
    clock_in TEXT,                     -- HH:MM:SS
    clock_out TEXT,                    -- HH:MM:SS
    hours_worked REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_types (
    id TEXT PRIMARY KEY,               -- UUID
    name TEXT NOT NULL,                -- e.g. 'Annual Leave', 'Sick Leave'
    description TEXT,
    annual_entitlement REAL NOT NULL DEFAULT 0.0,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id TEXT PRIMARY KEY,               -- UUID
    employee_id TEXT NOT NULL REFERENCES employees(id),
    leave_type_id TEXT NOT NULL REFERENCES leave_types(id),
    start_date TEXT NOT NULL,          -- YYYY-MM-DD
    end_date TEXT NOT NULL,            -- YYYY-MM-DD
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reason TEXT,
    approved_by TEXT REFERENCES employees(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payslips (
    id TEXT PRIMARY KEY,               -- UUID
    employee_id TEXT NOT NULL REFERENCES employees(id),
    period_start TEXT NOT NULL,        -- YYYY-MM-DD
    period_end TEXT NOT NULL,          -- YYYY-MM-DD
    base_salary REAL NOT NULL DEFAULT 0.0,
    allowances REAL NOT NULL DEFAULT 0.0,
    deductions REAL NOT NULL DEFAULT 0.0,
    net_pay REAL NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processed', 'paid')),
    payment_date TEXT,                 -- YYYY-MM-DD
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS performance_reviews (
    id TEXT PRIMARY KEY,               -- UUID
    employee_id TEXT NOT NULL REFERENCES employees(id),
    reviewer_id TEXT NOT NULL REFERENCES employees(id),
    review_period TEXT NOT NULL,       -- e.g., '2026-Q1', '2026-Annual'
    rating REAL CHECK (rating >= 1.0 AND rating <= 5.0),
    feedback_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
