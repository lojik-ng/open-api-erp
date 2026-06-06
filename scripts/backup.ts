import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { env } from '../src/config/env';

const SOURCE_DB = env.DB_PATH;
const BACKUP_DIR = './data/backups';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(BACKUP_DIR, `erp-${timestamp}.db`);

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Open database in read-only mode to perform the streaming backup
const db = new Database(SOURCE_DB, { readonly: true });

console.log(`Starting database backup of ${SOURCE_DB}...`);

db.backup(backupPath)
  .then(() => {
    console.log(`✅ Backup successfully created: ${backupPath}`);
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Backup failed:', err);
    db.close();
    process.exit(1);
  });
