import path from 'path';
import fs from 'fs';
import { db, withTransaction } from './config/database';
import { InvoicingService } from './modules/invoicing/invoicing.service';
import { logger } from './config/logger';

let workerInterval: NodeJS.Timeout | null = null;
let lastBackupDate: string | null = null;

async function runDatabaseBackup(todayDateStr: string) {
  const BACKUP_DIR = './data/backups';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `erp-${timestamp}.db`);

  logger.info(`Starting scheduled daily database backup to ${backupPath}...`);
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    await db.backup(backupPath);
    logger.info(`✅ Scheduled daily database backup successfully created: ${backupPath}`);
  } catch (err) {
    logger.error(err, '❌ Scheduled daily database backup failed');
    // Reset backup date on failure so the worker can retry on the next cycle
    lastBackupDate = null;
  }
}

/**
 * Main worker loop executed every 5 seconds.
 */
export async function runWorkerIteration() {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Check if daily backup is due (runs during the 1 AM hour, once per day)
    if (now.getHours() === 1 && lastBackupDate !== todayStr) {
      lastBackupDate = todayStr;
      runDatabaseBackup(todayStr).catch(err => {
        logger.error(err, 'Error running daily database backup task');
      });
    }

    // Find subscriptions that are active and whose next billing date is due
    const dueSubscriptions = db.prepare(`
      SELECT s.id, s.client_id, s.product_id, s.next_billing_date, p.billing_interval, p.currency
      FROM subscriptions s
      JOIN products p ON s.product_id = p.id
      WHERE s.status = 'active' AND s.next_billing_date <= ? AND p.deleted_at IS NULL
    `).all(todayStr) as any[];

    for (const sub of dueSubscriptions) {
      logger.info({ subscriptionId: sub.id, clientId: sub.client_id }, 'Processing subscription renewal billing...');
      
      try {
        withTransaction(() => {
          // Generate the renewal invoice
          InvoicingService.createInvoice({
            client_id: sub.client_id,
            status: 'sent', // Issued invoice immediately
            currency: sub.currency,
            issue_date: todayStr,
            due_date: calculateNextBillingDate(todayStr, 'monthly'), // Due in 30 days
            line_items: [
              {
                product_id: sub.product_id,
                quantity: 1.0,
                description: `Recurring renewal invoice for subscription`
              }
            ]
          }, 'system');

          // Update subscription next billing date
          const nextDate = calculateNextBillingDate(sub.next_billing_date, sub.billing_interval);
          db.prepare(`
            UPDATE subscriptions
            SET next_billing_date = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(nextDate, sub.id);

          logger.info({ subscriptionId: sub.id, nextBillingDate: nextDate }, 'Subscription renewed successfully');
        });
      } catch (err: any) {
        logger.error({ err, subscriptionId: sub.id }, 'Failed to process subscription renewal invoice generation');
        
        // Update subscription to past_due on failure (such as closed periods or other issues)
        try {
          db.prepare("UPDATE subscriptions SET status = 'past_due' WHERE id = ?").run(sub.id);
        } catch (updateErr) {
          logger.error(updateErr, 'Failed to update subscription to past_due status');
        }
      }
    }
  } catch (err) {
    logger.error(err, 'Error running worker iteration');
  }
}

/**
 * Starts the periodic background worker.
 */
export function startWorker() {
  if (workerInterval) return;
  logger.info('Starting background worker loop (5 seconds)...');
  workerInterval = setInterval(runWorkerIteration, 5000);
}

/**
 * Stops the background worker.
 */
export function stopWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info('Background worker loop stopped.');
  }
}

function calculateNextBillingDate(startDate: string, interval: string): string {
  const date = new Date(startDate);
  if (interval === 'annually') {
    date.setFullYear(date.getFullYear() + 1);
  } else if (interval === 'quarterly') {
    date.setMonth(date.getMonth() + 3);
  } else {
    // default monthly
    date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString().split('T')[0];
}
