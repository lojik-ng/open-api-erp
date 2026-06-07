-- 009_monitored_communications.sql

CREATE TABLE IF NOT EXISTS monitored_communications (
    id TEXT PRIMARY KEY,               -- UUID
    client_name TEXT NOT NULL,         -- Required
    contact_name TEXT NOT NULL,        -- Required
    channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'call', 'physical')),
    channel_address TEXT,              -- Optional (phone number or email address)
    conversation_date TEXT NOT NULL,   -- Required (ISO 8601 string or date)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitored_comm_client_name ON monitored_communications(client_name);
CREATE INDEX IF NOT EXISTS idx_monitored_comm_contact_name ON monitored_communications(contact_name);
CREATE INDEX IF NOT EXISTS idx_monitored_comm_channel ON monitored_communications(channel);
CREATE INDEX IF NOT EXISTS idx_monitored_comm_date ON monitored_communications(conversation_date);
