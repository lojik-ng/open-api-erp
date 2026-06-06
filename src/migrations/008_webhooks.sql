-- 008_webhooks.sql

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id TEXT PRIMARY KEY,               -- UUID
    assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,                 -- Destination URL
    event_type TEXT NOT NULL,          -- e.g., 'invoice.sent', '*'
    secret TEXT NOT NULL,              -- Secret key for HMAC signature verification
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assistant_id, url, event_type)
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_assistant ON webhook_subscriptions(assistant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subs_event_type ON webhook_subscriptions(event_type);
