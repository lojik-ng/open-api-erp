import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';

export class AccountingService {
  // ==========================================
  // ACCOUNTS
  // ==========================================

  static createAccount(input: any) {
    return withTransaction(() => {
      // Check if code is unique
      const existing = db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(input.code);
      if (existing) {
        throw new ConflictError(`Account with code '${input.code}' already exists.`);
      }

      // Check parent if provided
      if (input.parent_account_id) {
        const parent = db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(input.parent_account_id);
        if (!parent) {
          throw new NotFoundError('ParentAccount', input.parent_account_id);
        }
      }

      const id = uuid();
      db.prepare(`
        INSERT INTO accounts (id, parent_account_id, type, code, name, description, currency)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.parent_account_id || null,
        input.type,
        input.code,
        input.name,
        input.description || null,
        input.currency || 'USD'
      );

      return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    });
  }

  static listAccounts() {
    return db.prepare('SELECT * FROM accounts ORDER BY code ASC').all();
  }

  static getAccountById(id: string) {
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Account', id);
    }
    return row;
  }

  // ==========================================
  // CLOSED PERIODS
  // ==========================================

  static closePeriod(startDate: string, endDate: string, assistantId: string, notes?: string) {
    return withTransaction(() => {
      // Check for overlaps
      const overlap = db.prepare(`
        SELECT 1 FROM closed_periods
        WHERE start_date <= ? AND end_date >= ?
        LIMIT 1
      `).get(endDate, startDate);

      if (overlap) {
        throw new ConflictError('The specified date range overlaps with an already closed period.');
      }

      const id = uuid();
      db.prepare(`
        INSERT INTO closed_periods (id, start_date, end_date, closed_by, notes)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, startDate, endDate, assistantId, notes || null);

      return { id, startDate, endDate };
    });
  }

  static listPeriods() {
    return db.prepare('SELECT * FROM closed_periods ORDER BY start_date DESC').all();
  }

  static assertPeriodOpen(entryDate: string) {
    const conflict = db.prepare(`
      SELECT start_date, end_date FROM closed_periods
      WHERE ? >= start_date AND ? <= end_date
      LIMIT 1
    `).get(entryDate, entryDate) as any;

    if (conflict) {
      throw new ConflictError(`Cannot modify entries: The period from ${conflict.start_date} to ${conflict.end_date} is closed.`);
    }
  }

  // ==========================================
  // JOURNAL ENTRIES
  // ==========================================

  static createJournalEntry(input: any, assistantId: string) {
    return withTransaction(() => {
      const date = input.date || new Date().toISOString().split('T')[0];
      this.assertPeriodOpen(date);

      const lines = input.lines || [];
      if (lines.length < 2) {
        throw new ValidationError({ lines: 'Journal entry must contain at least 2 lines.' });
      }

      // Check balance: sum(debit) must equal sum(credit)
      let totalDebit = 0;
      let totalCredit = 0;

      for (const line of lines) {
        const debit = Number(line.debit || 0);
        const credit = Number(line.credit || 0);

        if (debit < 0 || credit < 0) {
          throw new ValidationError({ amount: 'Debits and credits must be non-negative.' });
        }
        if (debit > 0 && credit > 0) {
          throw new ValidationError({ amount: 'A single line cannot have both a debit and a credit.' });
        }
        if (debit === 0 && credit === 0) {
          throw new ValidationError({ amount: 'Each line must have either a debit or a credit.' });
        }

        totalDebit += debit;
        totalCredit += credit;

        // Verify account exists
        this.getAccountById(line.account_id);
      }

      // Allow slight floating point tolerance (e.g. 0.0001)
      if (Math.abs(totalDebit - totalCredit) > 0.005) {
        throw new ConflictError(`Journal entry is unbalanced. Total Debits: ${totalDebit}, Total Credits: ${totalCredit}`);
      }

      const entryId = uuid();
      db.prepare(`
        INSERT INTO journal_entries (id, date, description, reversal_of, assistant_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(entryId, date, input.description, input.reversal_of || null, assistantId);

      const insertLineStmt = db.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const line of lines) {
        insertLineStmt.run(
          uuid(),
          entryId,
          line.account_id,
          line.description || null,
          Number(line.debit || 0),
          Number(line.credit || 0)
        );
      }

      return this.getJournalEntryById(entryId);
    });
  }

  static getJournalEntryById(id: string) {
    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as any;
    if (!entry) {
      throw new NotFoundError('JournalEntry', id);
    }
    const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ?').all(id);
    return {
      ...entry,
      lines,
    };
  }

  static listJournalEntries(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT * FROM journal_entries
      WHERE 1=1 ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const formattedData = [];
    for (const r of data) {
      const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_entry_id = ?').all(r.id);
      formattedData.push({
        ...r,
        lines,
      });
    }

    const nextCursor = hasMore 
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data: formattedData,
      meta: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  static reverseJournalEntry(originalId: string, assistantId: string) {
    return withTransaction(() => {
      // 1. Prevent infinite reversals
      const alreadyReversed = db.prepare('SELECT 1 FROM journal_entries WHERE reversal_of = ?').get(originalId);
      if (alreadyReversed) {
        throw new ConflictError(`Journal entry ${originalId} has already been reversed.`);
      }

      const original = this.getJournalEntryById(originalId) as any;
      if (original.reversal_of) {
        throw new ConflictError('Cannot reverse a reversing entry.');
      }

      const today = new Date().toISOString().split('T')[0];
      this.assertPeriodOpen(today);

      const reversalId = uuid();
      db.prepare(`
        INSERT INTO journal_entries (id, date, description, reversal_of, assistant_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(reversalId, today, `Reversal of: ${original.description}`, originalId, assistantId);

      const insertLineStmt = db.prepare(`
        INSERT INTO journal_lines (id, journal_entry_id, account_id, description, debit, credit)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const line of original.lines) {
        insertLineStmt.run(
          uuid(),
          reversalId,
          line.account_id,
          line.description || null,
          line.credit, // SWAP DEBIT
          line.debit   // SWAP CREDIT
        );
      }

      return this.getJournalEntryById(reversalId);
    });
  }

  // ==========================================
  // REPORTS
  // ==========================================

  static getArAgingReport() {
    // outstanding invoices grouping by age
    const today = new Date();
    const parseDate = (dStr: string) => new Date(dStr);

    // Get all unpaid / partially paid invoices
    const activeInvoices = db.prepare(`
      SELECT i.id, i.client_id, c.name as client_name, i.total, i.amount_paid, i.due_date
      FROM invoices i
      JOIN clients c ON i.client_id = c.id
      WHERE i.status IN ('sent', 'partially_paid', 'overdue') AND i.deleted_at IS NULL
    `).all() as any[];

    const clientsMap: Record<string, {
      client_id: string;
      client_name: string;
      total_outstanding: number;
      current: number;
      overdue_30: number;
      overdue_60: number;
      overdue_90: number;
      overdue_90_plus: number;
    }> = {};

    for (const inv of activeInvoices) {
      const outstanding = inv.total - inv.amount_paid;
      if (outstanding <= 0) continue;

      if (!clientsMap[inv.client_id]) {
        clientsMap[inv.client_id] = {
          client_id: inv.client_id,
          client_name: inv.client_name,
          total_outstanding: 0,
          current: 0,
          overdue_30: 0,
          overdue_60: 0,
          overdue_90: 0,
          overdue_90_plus: 0,
        };
      }

      const clientRecord = clientsMap[inv.client_id];
      clientRecord.total_outstanding += outstanding;

      const dueDate = parseDate(inv.due_date);
      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        clientRecord.current += outstanding;
      } else if (diffDays <= 30) {
        clientRecord.overdue_30 += outstanding;
      } else if (diffDays <= 60) {
        clientRecord.overdue_60 += outstanding;
      } else if (diffDays <= 90) {
        clientRecord.overdue_90 += outstanding;
      } else {
        clientRecord.overdue_90_plus += outstanding;
      }
    }

    return Object.values(clientsMap);
  }
}
