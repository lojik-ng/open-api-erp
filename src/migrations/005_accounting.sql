-- 005_accounting.sql

CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,               -- UUID
    parent_account_id TEXT REFERENCES accounts(id),
    type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
    code TEXT NOT NULL UNIQUE,         -- Account code (e.g. '1000', '1010')
    name TEXT NOT NULL,
    description TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,               -- UUID
    date TEXT NOT NULL,                -- YYYY-MM-DD
    description TEXT NOT NULL,
    reversal_of TEXT REFERENCES journal_entries(id),
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,               -- UUID
    journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    description TEXT,                  -- Optional line-specific note
    debit REAL NOT NULL DEFAULT 0.0,
    credit REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS closed_periods (
    id TEXT PRIMARY KEY,               -- UUID
    start_date TEXT NOT NULL,          -- YYYY-MM-DD
    end_date TEXT NOT NULL,            -- YYYY-MM-DD
    closed_by TEXT NOT NULL REFERENCES assistants(id),
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    notes TEXT,
    UNIQUE(start_date, end_date)
);
