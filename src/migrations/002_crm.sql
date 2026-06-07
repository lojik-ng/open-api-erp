-- 002_crm.sql

CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    source TEXT,                        -- e.g., 'website', 'referral', 'cold_call'
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company_name TEXT,
    stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
    assigned_assistant_id TEXT REFERENCES assistants(id),
    notes TEXT,
    converted_client_id TEXT,          -- Set when lead is converted
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS leads_fts USING fts5(
    first_name, 
    last_name, 
    email, 
    company_name, 
    notes, 
    content=leads, 
    content_rowid=rowid
);

-- Triggers to keep leads_fts synchronized
CREATE TRIGGER IF NOT EXISTS leads_ai AFTER INSERT ON leads BEGIN
  INSERT INTO leads_fts(rowid, first_name, last_name, email, company_name, notes) 
  VALUES (new.rowid, new.first_name, new.last_name, new.email, new.company_name, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS leads_ad AFTER DELETE ON leads BEGIN
  INSERT INTO leads_fts(leads_fts, rowid, first_name, last_name, email, company_name, notes) 
  VALUES ('delete', old.rowid, old.first_name, old.last_name, old.email, old.company_name, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS leads_au AFTER UPDATE ON leads BEGIN
  INSERT INTO leads_fts(leads_fts, rowid, first_name, last_name, email, company_name, notes) 
  VALUES ('delete', old.rowid, old.first_name, old.last_name, old.email, old.company_name, old.notes);
  INSERT INTO leads_fts(rowid, first_name, last_name, email, company_name, notes) 
  VALUES (new.rowid, new.first_name, new.last_name, new.email, new.company_name, new.notes);
END;

CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('b2c', 'b2b')),
    name TEXT NOT NULL,                -- Individual name or company name
    email TEXT,
    phone TEXT,
    address TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'churned')),
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL, -- Original lead (for attribution)
    currency TEXT NOT NULL DEFAULT 'USD',
    deleted_at TEXT,                    -- Soft delete (null = active)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_email_active ON clients(email) WHERE deleted_at IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS clients_fts USING fts5(
    name, 
    email, 
    phone, 
    address, 
    content=clients, 
    content_rowid=rowid
);

-- Triggers to keep clients_fts synchronized
CREATE TRIGGER IF NOT EXISTS clients_ai AFTER INSERT ON clients BEGIN
  INSERT INTO clients_fts(rowid, name, email, phone, address) 
  VALUES (new.rowid, new.name, new.email, new.phone, new.address);
END;

CREATE TRIGGER IF NOT EXISTS clients_ad AFTER DELETE ON clients BEGIN
  INSERT INTO clients_fts(clients_fts, rowid, name, email, phone, address) 
  VALUES ('delete', old.rowid, old.name, old.email, old.phone, old.address);
END;

CREATE TRIGGER IF NOT EXISTS clients_au AFTER UPDATE ON clients BEGIN
  INSERT INTO clients_fts(clients_fts, rowid, name, email, phone, address) 
  VALUES ('delete', old.rowid, old.name, old.email, old.phone, old.address);
  INSERT INTO clients_fts(rowid, name, email, phone, address) 
  VALUES (new.rowid, new.name, new.email, new.phone, new.address);
END;

CREATE TABLE IF NOT EXISTS contact_persons (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,                          -- e.g., 'CEO', 'Procurement Manager'
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    client_id TEXT REFERENCES clients(id),
    type TEXT NOT NULL CHECK (type IN ('call', 'email', 'meeting', 'note', 'other')),
    subject TEXT,
    body TEXT,
    interaction_date TEXT NOT NULL DEFAULT (datetime('now')),
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL)  -- Must link to at least one
);

CREATE TABLE IF NOT EXISTS scheduled_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN ('meeting', 'call', 'task', 'reminder', 'other')),
    start_time TEXT NOT NULL,
    end_time TEXT,
    lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
    client_id TEXT REFERENCES clients(id),
    employee_id TEXT,                  -- FK added in HR module migration
    assistant_id TEXT NOT NULL REFERENCES assistants(id),
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
