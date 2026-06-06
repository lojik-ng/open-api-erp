// Force test configuration
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

import { db } from '../src/config/database';
import { runMigrations } from '../src/migrations/runner';

// Initialize the database schema for testing
runMigrations();

// Clear data from all tables between tests to ensure isolation
beforeEach(() => {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
      AND name NOT LIKE 'sqlite_%' 
      AND name != 'migrations'
      AND name NOT LIKE '%_fts%'
  `).all() as { name: string }[];

  db.prepare('PRAGMA foreign_keys = OFF').run();
  for (const table of tables) {
    db.prepare(`DELETE FROM ${table.name}`).run();
  }
  db.prepare('PRAGMA foreign_keys = ON').run();
});
