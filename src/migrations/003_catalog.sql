-- 003_catalog.sql

CREATE TABLE IF NOT EXISTS tax_rates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,                -- e.g., 'Standard VAT', 'Zero-Rated'
    rate REAL NOT NULL,                -- e.g., 0.20 for 20%
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('subscription', 'one_time_service', 'one_time_product')),
    default_price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    billing_interval TEXT CHECK (
        (type = 'subscription' AND billing_interval IN ('monthly', 'quarterly', 'annually'))
        OR (type != 'subscription' AND billing_interval IS NULL)
    ),
    tax_rate_id TEXT REFERENCES tax_rates(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    requires_stock INTEGER NOT NULL DEFAULT 0,  -- true for one_time_product
    deleted_at TEXT,                    -- Soft delete (null = active)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_active ON products(sku) WHERE deleted_at IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    name, 
    description, 
    content=products, 
    content_rowid=rowid
);

-- Triggers to keep products_fts synchronized
CREATE TRIGGER IF NOT EXISTS products_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, name, description) 
  VALUES (new.rowid, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS products_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description) 
  VALUES ('delete', old.rowid, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS products_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, name, description) 
  VALUES ('delete', old.rowid, old.name, old.description);
  INSERT INTO products_fts(rowid, name, description) 
  VALUES (new.rowid, new.name, new.description);
END;

CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    effective_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(from_currency, to_currency, effective_date)
);
