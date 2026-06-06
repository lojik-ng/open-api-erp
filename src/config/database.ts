import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from './env';

// Ensure the data directory exists
const dbDir = path.dirname(env.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite Database
export const db = new Database(env.DB_PATH);

// Configure database pragmas for concurrency, integrity, and performance
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

/**
 * Execute a sequence of SQL queries within a database transaction.
 * Automatically rolls back changes if any query throws an error.
 */
export function withTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
}
