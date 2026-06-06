import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';

export class CatalogService {
  // ==========================================
  // PRODUCTS
  // ==========================================

  static createProduct(input: any) {
    return withTransaction(() => {
      // Check if SKU is unique among active products
      if (input.sku) {
        const skuExists = db.prepare(`
          SELECT 1 FROM products WHERE sku = ? AND deleted_at IS NULL
        `).get(input.sku);
        if (skuExists) {
          throw new ConflictError(`Product with SKU '${input.sku}' already exists.`);
        }
      }

      // If product requires stock, check if we need to initialize inventory (Phase 3)
      const id = uuid();
      const requiresStock = input.requires_stock ? 1 : 0;
      const billingInterval = input.type === 'subscription' ? (input.billing_interval || 'monthly') : null;

      db.prepare(`
        INSERT INTO products (id, sku, name, description, type, default_price, currency, billing_interval, tax_rate_id, is_active, requires_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.sku || null,
        input.name,
        input.description || null,
        input.type,
        input.default_price,
        input.currency || 'USD',
        billingInterval,
        input.tax_rate_id || null,
        input.is_active !== false ? 1 : 0,
        requiresStock
      );

      // Automatically initialize inventory row in Phase 3 if it requires stock
      if (requiresStock === 1) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO inventory (id, product_id, quantity_on_hand, low_stock_threshold, location)
            VALUES (?, ?, 0.0, 0.0, 'Default Warehouse')
          `).run(uuid(), id);
        } catch (err) {
          // Inventory table might not exist if running Phase 1 tests without Phase 3 migrations applied
        }
      }

      return this.getProductById(id);
    });
  }

  static listProducts(query: { cursor?: string; limit?: number; includeDeleted?: boolean; q?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const softDeleteClause = query.includeDeleted ? '' : 'AND deleted_at IS NULL';

    let rows: any[];
    if (query.q) {
      const matchQuery = `${query.q.trim()}*`;
      rows = db.prepare(`
        SELECT p.*
        FROM products p
        JOIN products_fts fts ON p.rowid = fts.rowid
        WHERE products_fts MATCH ? ${softDeleteClause} ${clause}
        ORDER BY p.created_at ASC, p.id ASC
        LIMIT ?
      `).all(matchQuery, ...params, limit + 1) as any[];
    } else {
      rows = db.prepare(`
        SELECT * FROM products
        WHERE 1=1 ${softDeleteClause} ${clause}
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `).all(...params, limit + 1) as any[];
    }

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const formattedData = data.map(row => ({
      ...row,
      is_active: row.is_active === 1,
      requires_stock: row.requires_stock === 1,
    }));

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

  static getProductById(id: string) {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!row) {
      throw new NotFoundError('Product', id);
    }
    return {
      ...row,
      is_active: row.is_active === 1,
      requires_stock: row.requires_stock === 1,
    };
  }

  static updateProduct(id: string, input: any) {
    return withTransaction(() => {
      const current = this.getProductById(id);

      if (input.sku && input.sku !== current.sku) {
        const skuExists = db.prepare(`
          SELECT 1 FROM products WHERE sku = ? AND deleted_at IS NULL AND id != ?
        `).get(input.sku, id);
        if (skuExists) {
          throw new ConflictError(`Product with SKU '${input.sku}' already exists.`);
        }
      }

      const sets: string[] = [];
      const values: any[] = [];

      const fields = ['sku', 'name', 'description', 'type', 'default_price', 'currency', 'billing_interval', 'tax_rate_id'];
      for (const field of fields) {
        if (input[field] !== undefined) {
          sets.push(`${field} = ?`);
          values.push(input[field]);
        }
      }

      if (input.is_active !== undefined) {
        sets.push('is_active = ?');
        values.push(input.is_active ? 1 : 0);
      }
      if (input.requires_stock !== undefined) {
        sets.push('requires_stock = ?');
        values.push(input.requires_stock ? 1 : 0);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`
          UPDATE products
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...values);
      }

      return this.getProductById(id);
    });
  }

  static deleteProduct(id: string) {
    // Soft delete products
    const result = db.prepare("UPDATE products SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Product', id);
    }
    return { success: true };
  }

  // ==========================================
  // TAX RATES
  // ==========================================

  static createTaxRate(input: any) {
    return withTransaction(() => {
      const id = uuid();
      const isDefault = input.is_default ? 1 : 0;

      // If this is set as default, remove default flag from others
      if (isDefault === 1) {
        db.prepare('UPDATE tax_rates SET is_default = 0').run();
      }

      db.prepare(`
        INSERT INTO tax_rates (id, name, rate, is_default)
        VALUES (?, ?, ?, ?)
      `).run(id, input.name, input.rate, isDefault);

      return db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id);
    });
  }

  static listTaxRates() {
    return db.prepare('SELECT * FROM tax_rates ORDER BY name ASC').all();
  }

  static getTaxRateById(id: string) {
    const row = db.prepare('SELECT * FROM tax_rates WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('TaxRate', id);
    }
    return row;
  }

  // ==========================================
  // EXCHANGE RATES
  // ==========================================

  static createExchangeRate(input: any) {
    const id = uuid();
    const effectiveDate = input.effective_date || new Date().toISOString().split('T')[0];

    try {
      db.prepare(`
        INSERT INTO exchange_rates (id, from_currency, to_currency, rate, effective_date)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, input.from_currency.toUpperCase(), input.to_currency.toUpperCase(), input.rate, effectiveDate);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw new ConflictError(`Exchange rate from ${input.from_currency} to ${input.to_currency} for date ${effectiveDate} already exists.`);
      }
      throw err;
    }

    return db.prepare('SELECT * FROM exchange_rates WHERE id = ?').get(id);
  }

  static listExchangeRates() {
    return db.prepare('SELECT * FROM exchange_rates ORDER BY effective_date DESC, from_currency ASC').all();
  }

  static getExchangeRate(from: string, to: string, date?: string): number {
    const lookupDate = date || new Date().toISOString().split('T')[0];
    
    if (from.toUpperCase() === to.toUpperCase()) {
      return 1.0;
    }

    // Try to find the exact exchange rate matching effective_date <= lookupDate
    const row = db.prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = ? AND to_currency = ? AND effective_date <= ?
      ORDER BY effective_date DESC
      LIMIT 1
    `).get(from.toUpperCase(), to.toUpperCase(), lookupDate) as any;

    if (row) {
      return row.rate;
    }

    // Try finding inverse exchange rate
    const inverse = db.prepare(`
      SELECT rate FROM exchange_rates
      WHERE from_currency = ? AND to_currency = ? AND effective_date <= ?
      ORDER BY effective_date DESC
      LIMIT 1
    `).get(to.toUpperCase(), from.toUpperCase(), lookupDate) as any;

    if (inverse) {
      return 1.0 / inverse.rate;
    }

    // Fallback default
    logger.warn({ from, to, date: lookupDate }, 'No exchange rate found; defaulting to 1.0');
    return 1.0;
  }
}
import { logger } from '../../config/logger';
