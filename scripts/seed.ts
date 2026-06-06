import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../src/config/database';

function seed() {
  console.log('Seeding database...');

  // Ensure migrations are run first or just run schema setup
  db.prepare(`
    CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        api_key_prefix TEXT NOT NULL,
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
        is_admin INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS assistant_permissions (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
        permission TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(assistant_id, permission)
    );
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        parent_account_id TEXT REFERENCES accounts(id),
        type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        currency TEXT NOT NULL DEFAULT 'USD',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `).run();

  withTransaction(() => {
    // 1. Create System Admin Assistant
    const adminId = uuid();
    const apiKey = `erp_${crypto.randomBytes(32).toString('hex')}`;
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const apiKeyPrefix = apiKey.substring(0, 8);

    db.prepare(`
      INSERT OR IGNORE INTO assistants (id, name, api_key_hash, api_key_prefix, is_admin, status)
      VALUES (?, 'System Admin', ?, ?, 1, 'active')
    `).run(adminId, apiKeyHash, apiKeyPrefix);

    // Grant all standard permissions
    const allPermissions = [
      'read:assistants', 'write:assistants',
      'read:leads', 'write:leads', 'convert:lead',
      'read:clients', 'write:clients',
      'read:interactions', 'write:interactions',
      'read:scheduled_events', 'write:scheduled_events',
      'read:products', 'write:products',
      'read:tax_rates', 'write:tax_rates',
      'read:exchange_rates', 'write:exchange_rates',
      'read:invoices', 'write:invoices',
      'read:payments', 'write:payments',
      'read:subscriptions', 'write:subscriptions',
      'read:accounts', 'write:accounts',
      'read:journal_entries', 'write:journal_entries', 'reverse:journal',
      'read:periods', 'write:periods', 'close:period',
      'read:inventory', 'write:inventory', 'write:stock_adjustments',
      'read:suppliers', 'write:suppliers',
      'read:purchase_orders', 'write:purchase_orders',
      'read:employees', 'write:employees',
      'read:attendance', 'write:attendance',
      'read:leaves', 'write:leaves',
      'read:payroll', 'process:payroll',
      'read:performance', 'write:performance',
      'read:deleted', 'read:audit_logs'
    ];

    const insertPermStmt = db.prepare(`
      INSERT OR IGNORE INTO assistant_permissions (id, assistant_id, permission)
      VALUES (?, ?, ?)
    `);

    for (const perm of allPermissions) {
      insertPermStmt.run(uuid(), adminId, perm);
    }

    // 2. Seed Chart of Accounts
    const defaultAccounts = [
      { code: '1000', name: 'Cash/Bank', type: 'asset', description: 'Primary cash and bank accounts' },
      { code: '1200', name: 'Accounts Receivable', type: 'asset', description: 'Outstanding invoices receivable' },
      { code: '1300', name: 'Inventory Asset', type: 'asset', description: 'Valuation of physical stock on hand' },
      { code: '4000', name: 'Revenue', type: 'revenue', description: 'Product sales and consulting services' },
      { code: '5000', name: 'Salary Expense', type: 'expense', description: 'Employee salaries and labor costs' }
    ];

    const insertAccountStmt = db.prepare(`
      INSERT OR IGNORE INTO accounts (id, type, code, name, description, currency)
      VALUES (?, ?, ?, ?, ?, 'USD')
    `);

    for (const acc of defaultAccounts) {
      insertAccountStmt.run(uuid(), acc.type, acc.code, acc.name, acc.description);
    }

    console.log('\n=========================================');
    console.log('✅ Seeding complete.');
    console.log('-----------------------------------------');
    console.log(`API Key: ${apiKey}`);
    console.log('Store this key safely! It will NOT be shown again.');
    console.log('=========================================\n');
  });
}

try {
  seed();
} catch (err) {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
}
