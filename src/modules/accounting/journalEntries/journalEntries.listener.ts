import { eventBus } from '../../../shared/eventBus';
import { AccountingService } from '../accounting.service';
import { db } from '../../../config/database';
import { logger } from '../../../config/logger';

// Helper to look up account ID by code
function getAccountIdByCode(code: string): string {
  const row = db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as any;
  if (!row) {
    throw new Error(`General Ledger account with code '${code}' not found. Please seed the Chart of Accounts.`);
  }
  return row.id;
}

// 1. Invoice Sent: Debit Accounts Receivable (1200), Credit Revenue (4000)
eventBus.on('invoice.sent', async ({ eventId, resourceId, payload }) => {
  try {
    const arAccount = getAccountIdByCode('1200');
    const revenueAccount = getAccountIdByCode('4000');

    AccountingService.createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `Automated entry: Invoice ${resourceId} sent`,
      lines: [
        { account_id: arAccount, debit: payload.totalAmount, credit: 0.0, description: 'Accounts Receivable Debit' },
        { account_id: revenueAccount, debit: 0.0, credit: payload.totalAmount, description: 'Revenue Credit' }
      ]
    }, 'system');

    eventBus.markCompleted(eventId);
  } catch (err: any) {
    logger.error({ err, eventId }, 'Failed to process invoice.sent journal entry listener');
    eventBus.markFailed(eventId, err);
  }
});

// 2. Payment Received: Debit Cash/Bank (1000), Credit Accounts Receivable (1200)
eventBus.on('payment.received', async ({ eventId, resourceId, payload }) => {
  try {
    const cashAccount = getAccountIdByCode('1000');
    const arAccount = getAccountIdByCode('1200');

    AccountingService.createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `Automated entry: Payment ${resourceId} received`,
      lines: [
        { account_id: cashAccount, debit: payload.amount, credit: 0.0, description: 'Cash/Bank Debit' },
        { account_id: arAccount, debit: 0.0, credit: payload.amount, description: 'Accounts Receivable Credit' }
      ]
    }, 'system');

    eventBus.markCompleted(eventId);
  } catch (err: any) {
    logger.error({ err, eventId }, 'Failed to process payment.received journal entry listener');
    eventBus.markFailed(eventId, err);
  }
});

// 3. Payroll Processed: Debit Salary Expense (5000), Credit Cash/Bank (1000)
eventBus.on('payroll.processed', async ({ eventId, resourceId, payload }) => {
  try {
    const salaryExpense = getAccountIdByCode('5000');
    const cashAccount = getAccountIdByCode('1000');

    AccountingService.createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `Automated entry: Payroll processed for period starting ${payload.periodStart}`,
      lines: [
        { account_id: salaryExpense, debit: payload.totalAmount, credit: 0.0, description: 'Salary Expense Debit' },
        { account_id: cashAccount, debit: 0.0, credit: payload.totalAmount, description: 'Cash/Bank Credit' }
      ]
    }, 'system');

    eventBus.markCompleted(eventId);
  } catch (err: any) {
    logger.error({ err, eventId }, 'Failed to process payroll.processed journal entry listener');
    eventBus.markFailed(eventId, err);
  }
});

// 4. Inventory Purchased: Debit Inventory Asset (1300), Credit Cash/Bank (1000)
eventBus.on('inventory.purchased', async ({ eventId, resourceId, payload }) => {
  try {
    const inventoryAsset = getAccountIdByCode('1300');
    const cashAccount = getAccountIdByCode('1000');

    AccountingService.createJournalEntry({
      date: new Date().toISOString().split('T')[0],
      description: `Automated entry: Purchase Order ${resourceId} received`,
      lines: [
        { account_id: inventoryAsset, debit: payload.totalAmount, credit: 0.0, description: 'Inventory Asset Debit' },
        { account_id: cashAccount, debit: 0.0, credit: payload.totalAmount, description: 'Cash/Bank Credit' }
      ]
    }, 'system');

    eventBus.markCompleted(eventId);
  } catch (err: any) {
    logger.error({ err, eventId }, 'Failed to process inventory.purchased journal entry listener');
    eventBus.markFailed(eventId, err);
  }
});
