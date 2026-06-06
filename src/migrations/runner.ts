import fs from 'fs';
import path from 'path';
import { db, withTransaction } from '../config/database';
import { logger } from '../config/logger';

export function runMigrations(): void {
  logger.info('Starting database migrations...');

  // Ensure migrations table exists
  db.prepare(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `).run();

  const migrationsDir = path.join(__dirname);
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const appliedMigrations = db.prepare('SELECT name FROM migrations').all() as { name: string }[];
  const appliedSet = new Set(appliedMigrations.map(m => m.name));

  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.debug(`Migration ${file} already applied.`);
      continue;
    }

    logger.info(`Applying migration: ${file}`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    try {
      withTransaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
      });
      logger.info(`Successfully applied migration: ${file}`);
    } catch (err) {
      logger.error(err, `❌ Migration failed on file ${file}`);
      throw err;
    }
  }

  logger.info('Database migrations complete.');
}

// Support direct invocation
if (require.main === module) {
  try {
    runMigrations();
    process.exit(0);
  } catch (err) {
    console.error('Migration runner failed:', err);
    process.exit(1);
  }
}
