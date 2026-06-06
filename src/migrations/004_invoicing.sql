-- 004_invoicing.sql

CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,               -- UUID
    client_id TEXT NOT NULL REFERENCES clients(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'paused', 'cancelled')),
    start_date TEXT NOT NULL,          -- YYYY-MM-DD
    next_billing_date TEXT NOT NULL,   -- YYYY-MM-DD
    cancelled_at TEXT,                 -- ISO timestamp
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,               -- UUID
    client_id TEXT NOT NULL REFERENCES clients(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'refunded', 'void')),
    currency TEXT NOT NULL DEFAULT 'USD',
    subtotal REAL NOT NULL DEFAULT 0.0,
    tax_total REAL NOT NULL DEFAULT 0.0,
    total REAL NOT NULL DEFAULT 0.0,
    amount_paid REAL NOT NULL DEFAULT 0.0,
    issue_date TEXT,                   -- YYYY-MM-DD
    due_date TEXT,                     -- YYYY-MM-DD
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    deleted_at TEXT,                   -- Soft delete for drafts only
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
    id TEXT PRIMARY KEY,               -- UUID
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1.0,
    unit_price REAL NOT NULL DEFAULT 0.0,
    tax_rate_id TEXT REFERENCES tax_rates(id),
    tax_amount REAL NOT NULL DEFAULT 0.0,
    total_amount REAL NOT NULL DEFAULT 0.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,               -- UUID
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    amount REAL NOT NULL DEFAULT 0.0,
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method TEXT NOT NULL CHECK (payment_method IN ('bank_transfer', 'card', 'cash', 'credit_note', 'other')),
    payment_date TEXT NOT NULL,        -- YYYY-MM-DD
    reference_number TEXT,
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
