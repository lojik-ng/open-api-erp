-- 011_cold_marketing_list.sql

CREATE TABLE IF NOT EXISTS cold_marketing_list (
    id TEXT PRIMARY KEY,               -- UUID
    company_name TEXT,                 -- Optional
    contact_name TEXT NOT NULL,        -- Required
    email TEXT NOT NULL,               -- Required
    phone TEXT,                        -- Optional
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'interested', 'not_interested', 'converted')),
    notes TEXT,                        -- Optional
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cold_mkt_email ON cold_marketing_list(email);
CREATE INDEX IF NOT EXISTS idx_cold_mkt_status ON cold_marketing_list(status);
CREATE INDEX IF NOT EXISTS idx_cold_mkt_contact_name ON cold_marketing_list(contact_name);
