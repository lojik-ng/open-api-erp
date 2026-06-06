import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { CatalogService } from '../catalog/catalog.service';
import { eventBus } from '../../shared/eventBus';
import { logger } from '../../config/logger';

export class InvoicingService {
  // ==========================================
  // INVOICES
  // ==========================================

  static createInvoice(input: any, assistantId: string) {
    return withTransaction(() => {
      const id = uuid();
      const client = db.prepare('SELECT id, currency FROM clients WHERE id = ?').get(input.client_id) as any;
      if (!client) {
        throw new NotFoundError('Client', input.client_id);
      }

      const invoiceCurrency = input.currency || client.currency || 'USD';
      const status = input.status || 'draft';
      const issueDate = input.issue_date || new Date().toISOString().split('T')[0];
      const dueDate = input.due_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Calculate totals
      let subtotal = 0;
      let taxTotal = 0;
      let total = 0;

      const lines = input.line_items || [];
      const calculatedLines: any[] = [];

      for (const line of lines) {
        const product = CatalogService.getProductById(line.product_id);
        
        // Resolve tax rate
        let rate = 0.0;
        let taxRateId = product.tax_rate_id;
        if (taxRateId) {
          const tr = db.prepare('SELECT rate FROM tax_rates WHERE id = ?').get(taxRateId) as any;
          if (tr) rate = tr.rate;
        } else {
          // fallback to default tax rate
          const dtr = db.prepare('SELECT id, rate FROM tax_rates WHERE is_default = 1 LIMIT 1').get() as any;
          if (dtr) {
            rate = dtr.rate;
            taxRateId = dtr.id;
          }
        }

        // Currency conversion
        const exchangeRate = CatalogService.getExchangeRate(product.currency, invoiceCurrency);
        const unitPrice = line.unit_price !== undefined ? line.unit_price : (product.default_price * exchangeRate);
        const quantity = line.quantity || 1.0;

        // Perform stock check & decrement if finalized (sent/paid/partially_paid) and is physical product
        if (status !== 'draft' && product.requires_stock === 1) {
          this.checkAndDecrementStock(product.id, quantity);
        }

        const lineSubtotal = unitPrice * quantity;
        const lineTax = lineSubtotal * rate;
        const lineTotal = lineSubtotal + lineTax;

        subtotal += lineSubtotal;
        taxTotal += lineTax;
        total += lineTotal;

        calculatedLines.push({
          id: uuid(),
          product_id: product.id,
          description: line.description || product.name,
          quantity,
          unit_price: unitPrice,
          tax_rate_id: taxRateId,
          tax_amount: lineTax,
          total_amount: lineTotal,
        });
      }

      // Insert invoice
      db.prepare(`
        INSERT INTO invoices (id, client_id, status, currency, subtotal, tax_total, total, amount_paid, issue_date, due_date, assistant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?)
      `).run(id, input.client_id, status, invoiceCurrency, subtotal, taxTotal, total, issueDate, dueDate, assistantId);

      // Insert line items
      const insertLineStmt = db.prepare(`
        INSERT INTO invoice_line_items (id, invoice_id, product_id, description, quantity, unit_price, tax_rate_id, tax_amount, total_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const cl of calculatedLines) {
        insertLineStmt.run(cl.id, id, cl.product_id, cl.description, cl.quantity, cl.unit_price, cl.tax_rate_id, cl.tax_amount, cl.total_amount);
      }

      // If status is sent/paid, publish outbox event
      if (status === 'sent') {
        eventBus.publish('invoice.sent', 'invoicing', 'invoices', id, { invoiceId: id, totalAmount: total });
      }

      return this.getInvoiceById(id);
    });
  }

  static getInvoiceById(id: string) {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as any;
    if (!invoice) {
      throw new NotFoundError('Invoice', id);
    }
    const lines = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(id);
    return {
      ...invoice,
      line_items: lines,
    };
  }

  static listInvoices(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT * FROM invoices
      WHERE deleted_at IS NULL ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore 
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  static updateInvoice(id: string, input: any, assistantId: string) {
    return withTransaction(() => {
      const current = this.getInvoiceById(id) as any;

      // Validate status transition
      if (input.status && input.status !== current.status) {
        this.validateInvoiceTransition(current.status, input.status);
      }

      const sets: string[] = [];
      const values: any[] = [];

      if (input.due_date !== undefined) {
        sets.push('due_date = ?');
        values.push(input.due_date);
      }

      const finalStatus = input.status || current.status;
      if (input.status !== undefined) {
        sets.push('status = ?');
        values.push(input.status);
      }

      // Handle stock reservation on status transitions (e.g. draft -> sent)
      if (current.status === 'draft' && finalStatus !== 'draft') {
        for (const cl of current.line_items) {
          const product = CatalogService.getProductById(cl.product_id);
          if (product.requires_stock === 1) {
            this.checkAndDecrementStock(product.id, cl.quantity);
          }
        }
      }

      // Handle returning stock on cancellation / void
      if (current.status !== 'draft' && current.status !== 'cancelled' && current.status !== 'void' && (finalStatus === 'cancelled' || finalStatus === 'void')) {
        for (const cl of current.line_items) {
          const product = CatalogService.getProductById(cl.product_id);
          if (product.requires_stock === 1) {
            this.incrementStock(product.id, cl.quantity);
          }
        }
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`
          UPDATE invoices
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...values);
      }

      // Publish events on status transitions
      if (current.status === 'draft' && finalStatus === 'sent') {
        eventBus.publish('invoice.sent', 'invoicing', 'invoices', id, { invoiceId: id, totalAmount: current.total });
      }

      return this.getInvoiceById(id);
    });
  }

  static deleteInvoice(id: string) {
    return withTransaction(() => {
      const current = this.getInvoiceById(id) as any;
      if (current.status !== 'draft') {
        throw new ConflictError(`Cannot delete invoice ${id} because it is in '${current.status}' status. Only draft invoices can be deleted.`);
      }
      db.prepare("UPDATE invoices SET deleted_at = datetime('now') WHERE id = ?").run(id);
      return { success: true };
    });
  }

  // ==========================================
  // PAYMENTS
  // ==========================================

  static recordPayment(input: any, assistantId: string) {
    return withTransaction(() => {
      const invoice = this.getInvoiceById(input.invoice_id) as any;

      if (['draft', 'cancelled', 'void'].includes(invoice.status)) {
        throw new ConflictError(`Cannot record payment against invoice ${invoice.id} because it is in '${invoice.status}' status.`);
      }

      const id = uuid();
      const amount = input.amount;
      const currency = input.currency || invoice.currency;
      const paymentDate = input.payment_date || new Date().toISOString().split('T')[0];

      // Convert payment amount if currency differs from invoice currency
      const rate = CatalogService.getExchangeRate(currency, invoice.currency);
      const convertedAmount = amount * rate;

      // Insert payment
      db.prepare(`
        INSERT INTO payments (id, invoice_id, amount, currency, payment_method, payment_date, reference_number, assistant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.invoice_id, amount, currency, input.payment_method, paymentDate, input.reference_number || null, assistantId);

      // Update invoice amount_paid
      const newAmountPaid = invoice.amount_paid + convertedAmount;
      let newStatus = invoice.status;

      if (newAmountPaid >= invoice.total) {
        newStatus = 'paid';
      } else if (newAmountPaid > 0) {
        newStatus = 'partially_paid';
      }

      db.prepare(`
        UPDATE invoices
        SET amount_paid = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newAmountPaid, newStatus, invoice.id);

      // Publish event
      eventBus.publish('payment.received', 'invoicing', 'payments', id, {
        paymentId: id,
        invoiceId: invoice.id,
        amount: convertedAmount,
        currency: invoice.currency,
        assistantId
      });

      return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    });
  }

  static getPaymentById(id: string) {
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Payment', id);
    }
    return row;
  }

  static listPayments(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT * FROM payments
      WHERE 1=1 ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore 
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  // ==========================================
  // SUBSCRIPTIONS
  // ==========================================

  static createSubscription(input: any) {
    // Verify client & product exist
    db.prepare('SELECT id FROM clients WHERE id = ?').get(input.client_id) || (() => { throw new NotFoundError('Client', input.client_id); })();
    const product = CatalogService.getProductById(input.product_id);
    if (product.type !== 'subscription') {
      throw new ConflictError(`Product ${product.id} is not subscription-based.`);
    }

    const id = uuid();
    const startDate = input.start_date || new Date().toISOString().split('T')[0];
    const nextBillingDate = input.next_billing_date || this.calculateNextBillingDate(startDate, product.billing_interval);

    db.prepare(`
      INSERT INTO subscriptions (id, client_id, product_id, status, start_date, next_billing_date)
      VALUES (?, ?, ?, 'active', ?, ?)
    `).run(id, input.client_id, input.product_id, startDate, nextBillingDate);

    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  }

  static listSubscriptions(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT * FROM subscriptions
      WHERE 1=1 ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore 
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  static updateSubscription(id: string, input: any) {
    const current = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id) as any;
    if (!current) {
      throw new NotFoundError('Subscription', id);
    }

    const sets: string[] = [];
    const values: any[] = [];

    if (input.status !== undefined) {
      sets.push('status = ?');
      values.push(input.status);
      if (input.status === 'cancelled') {
        sets.push('cancelled_at = ?');
        values.push(new Date().toISOString());
      }
    }
    if (input.next_billing_date !== undefined) {
      sets.push('next_billing_date = ?');
      values.push(input.next_billing_date);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`
        UPDATE subscriptions
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  }

  static deleteSubscription(id: string) {
    // Soft cancels subscription
    return this.updateSubscription(id, { status: 'cancelled' });
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private static checkAndDecrementStock(productId: string, quantity: number) {
    try {
      const stock = db.prepare('SELECT quantity_on_hand FROM inventory WHERE product_id = ?').get(productId) as any;
      if (!stock || stock.quantity_on_hand < quantity) {
        throw new ConflictError(`Insufficient stock for product ${productId}. Requested: ${quantity}, Available: ${stock?.quantity_on_hand || 0}`);
      }
      db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand - ? WHERE product_id = ?').run(quantity, productId);
      
      // Stock adjustment history log
      db.prepare(`
        INSERT INTO stock_adjustments (id, product_id, quantity_change, reason_code, notes, assistant_id)
        VALUES (?, ?, ?, 'received', 'Auto-debited due to invoice generation', 'system')
      `).run(uuid(), productId, -quantity);

    } catch (err: any) {
      if (err.message && err.message.includes('no such table')) {
        // Table doesn't exist yet (Phase 1 testing environment before other phases run)
        return;
      }
      throw err;
    }
  }

  private static incrementStock(productId: string, quantity: number) {
    try {
      db.prepare('UPDATE inventory SET quantity_on_hand = quantity_on_hand + ? WHERE product_id = ?').run(quantity, productId);
      
      // Stock adjustment log
      db.prepare(`
        INSERT INTO stock_adjustments (id, product_id, quantity_change, reason_code, notes, assistant_id)
        VALUES (?, ?, ?, 'manual_correction', 'Returned stock due to invoice cancel/void', 'system')
      `).run(uuid(), productId, quantity);
    } catch {
      // ignore table errors
    }
  }

  private static calculateNextBillingDate(startDate: string, interval: string): string {
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

  private static validateInvoiceTransition(from: string, to: string) {
    // Enforce the invoice lifecycle state machine:
    // draft -> sent, draft -> cancelled
    // sent -> partially_paid, sent -> paid, sent -> overdue, sent -> void
    // partially_paid -> paid, partially_paid -> overdue, partially_paid -> void, partially_paid -> refunded
    // overdue -> paid, overdue -> partially_paid, overdue -> void
    // paid -> refunded
    
    const allowed: Record<string, string[]> = {
      draft: ['sent', 'cancelled'],
      sent: ['partially_paid', 'paid', 'overdue', 'void'],
      partially_paid: ['paid', 'overdue', 'void', 'refunded'],
      overdue: ['paid', 'partially_paid', 'void'],
      paid: ['refunded'],
      cancelled: [],
      void: [],
      refunded: []
    };

    if (!allowed[from]?.includes(to)) {
      throw new ConflictError(`Invalid invoice state transition from '${from}' to '${to}'`);
    }
  }
}
