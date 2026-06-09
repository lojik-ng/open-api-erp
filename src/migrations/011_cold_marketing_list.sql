-- 011_cold_marketing_list.sql

DROP TABLE IF EXISTS cold_marketing_list;

CREATE TABLE IF NOT EXISTS cold_marketing_list (
    id TEXT PRIMARY KEY,               -- UUID
    company_name TEXT NOT NULL UNIQUE, -- Required and Unique
    contact_name TEXT NOT NULL,        -- Required
    email TEXT NOT NULL,               -- Required
    phone TEXT NOT NULL UNIQUE,        -- Required and Unique
    status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Used')),
    notes TEXT,                        -- Optional
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cold_mkt_email ON cold_marketing_list(email);
CREATE INDEX IF NOT EXISTS idx_cold_mkt_status ON cold_marketing_list(status);
CREATE INDEX IF NOT EXISTS idx_cold_mkt_contact_name ON cold_marketing_list(contact_name);
