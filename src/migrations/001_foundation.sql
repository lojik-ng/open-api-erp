-- 001_foundation.sql

-- Polymorphic file attachments
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,               -- UUID
    resource_type TEXT NOT NULL,       -- e.g., 'clients', 'invoices'
    resource_id TEXT NOT NULL,         -- UUID of the specific record
    file_url TEXT NOT NULL,            -- Storage path or cloud URL
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL REFERENCES assistants(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_resource ON documents(resource_type, resource_id);

-- CLI AI assistant identities
CREATE TABLE IF NOT EXISTS assistants (
    id TEXT PRIMARY KEY,               -- UUID
    name TEXT NOT NULL,
    api_key_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the API key
    api_key_prefix TEXT NOT NULL,       -- First 8 chars of key (for identification, e.g., 'erp_a1b2')
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
    is_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assistants_api_key_hash ON assistants(api_key_hash);

-- Granular permissions per assistant
CREATE TABLE IF NOT EXISTS assistant_permissions (
    id TEXT PRIMARY KEY,               -- UUID
    assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,          -- e.g., 'read:invoices', 'write:clients'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assistant_id, permission)
);
CREATE INDEX IF NOT EXISTS idx_perms_assistant ON assistant_permissions(assistant_id);

-- Optional row-level scoping
CREATE TABLE IF NOT EXISTS assistant_scopes (
    id TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,       -- e.g., 'clients', 'invoices'
    resource_id TEXT NOT NULL,         -- UUID of the specific record
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(assistant_id, resource_type, resource_id)
);

-- Append-only audit trail
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,               -- UUID
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    action TEXT NOT NULL,              -- 'CREATE', 'UPDATE', 'DELETE'
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    before_state TEXT,                 -- JSON
    after_state TEXT,                  -- JSON
    idempotency_key TEXT,
    ip_address TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_assistant ON audit_logs(assistant_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);

-- Idempotency cache
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    request_method TEXT NOT NULL,
    request_path TEXT NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,        -- JSON
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Internal event bus (persistent store)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,               -- UUID
    event_type TEXT NOT NULL,          -- e.g., 'invoice.sent', 'payment.received'
    source_module TEXT NOT NULL,       -- e.g., 'invoicing'
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    payload TEXT NOT NULL,             -- JSON
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(status, created_at);
