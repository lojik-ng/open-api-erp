import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { eventBus } from '../../shared/eventBus';

export class InventoryService {
  // ==========================================
  // STOCK & ADJUSTMENTS
  // ==========================================

  static listStock(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT i.*, p.sku, p.name as product_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE p.deleted_at IS NULL ${clause}
      ORDER BY i.created_at ASC, i.id ASC
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

  static getStockByProductId(productId: string) {
    const row = db.prepare(`
      SELECT i.*, p.sku, p.name as product_name
      FROM inventory i
      JOIN products p ON i.product_id = p.id
      WHERE i.product_id = ?
    `).get(productId);

    if (!row) {
      throw new NotFoundError('InventoryStock', productId);
    }
    return row;
  }

  static createAdjustment(input: any, assistantId: string) {
    return withTransaction(() => {
      // Verify product exists
      const product = db.prepare('SELECT id FROM products WHERE id = ? AND deleted_at IS NULL').get(input.product_id);
      if (!product) {
        throw new NotFoundError('Product', input.product_id);
      }

      // Get or create inventory row
      let inventory = db.prepare('SELECT id, quantity_on_hand FROM inventory WHERE product_id = ?').get(input.product_id) as any;
      if (!inventory) {
        const invId = uuid();
        db.prepare(`
          INSERT INTO inventory (id, product_id, quantity_on_hand, low_stock_threshold, location)
          VALUES (?, ?, 0.0, 0.0, 'Default Warehouse')
        `).run(invId, input.product_id);
        inventory = { id: invId, quantity_on_hand: 0.0 };
      }

      const change = Number(input.quantity_change);
      const newQty = inventory.quantity_on_hand + change;

      if (newQty < 0) {
        throw new ConflictError(`Cannot adjust stock below 0. Current: ${inventory.quantity_on_hand}, Change: ${change}`);
      }

      // Update stock
      db.prepare(`
        UPDATE inventory
        SET quantity_on_hand = ?, updated_at = datetime('now')
        WHERE product_id = ?
      `).run(newQty, input.product_id);

      // Log adjustment
      const adjId = uuid();
      db.prepare(`
        INSERT INTO stock_adjustments (id, product_id, quantity_change, reason_code, notes, assistant_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(adjId, input.product_id, change, input.reason_code, input.notes || null, assistantId);

      return db.prepare('SELECT * FROM stock_adjustments WHERE id = ?').get(adjId);
    });
  }

  static listAdjustments(productId?: string) {
    if (productId) {
      return db.prepare('SELECT * FROM stock_adjustments WHERE product_id = ? ORDER BY created_at DESC').all(productId);
    }
    return db.prepare('SELECT * FROM stock_adjustments ORDER BY created_at DESC').all();
  }

  // ==========================================
  // SUPPLIERS
  // ==========================================

  static createSupplier(input: any) {
    const id = uuid();
    db.prepare(`
      INSERT INTO suppliers (id, name, contact_name, email, phone, address, payment_terms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.contact_name || null,
      input.email || null,
      input.phone || null,
      input.address || null,
      input.payment_terms || null
    );
    return this.getSupplierById(id);
  }

  static listSuppliers() {
    return db.prepare('SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY name ASC').all();
  }

  static getSupplierById(id: string) {
    const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Supplier', id);
    }
    return row;
  }

  static updateSupplier(id: string, input: any) {
    this.getSupplierById(id);

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['name', 'contact_name', 'email', 'phone', 'address', 'payment_terms'];
    for (const field of fields) {
      if (input[field] !== undefined) {
        sets.push(`${field} = ?`);
        values.push(input[field]);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(id);
      db.prepare(`
        UPDATE suppliers
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return this.getSupplierById(id);
  }

  static deleteSupplier(id: string) {
    const result = db.prepare("UPDATE suppliers SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Supplier', id);
    }
    return { success: true };
  }

  // ==========================================
  // PURCHASE ORDERS
  // ==========================================

  static createPurchaseOrder(input: any, assistantId: string) {
    return withTransaction(() => {
      // Verify supplier exists
      this.getSupplierById(input.supplier_id);

      const id = uuid();
      const orderDate = input.order_date || new Date().toISOString().split('T')[0];
      const currency = input.currency || 'USD';

      let total = 0;
      const lines = input.line_items || [];
      const calculatedLines: any[] = [];

      for (const line of lines) {
        // Verify product
        const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND deleted_at IS NULL').get(line.product_id) as any;
        if (!product) {
          throw new NotFoundError('Product', line.product_id);
        }

        const quantity = Number(line.quantity || 1.0);
        const unitPrice = Number(line.unit_price || 0.0);
        const lineTotal = quantity * unitPrice;
        total += lineTotal;

        calculatedLines.push({
          id: uuid(),
          product_id: product.id,
          description: line.description || product.name,
          quantity,
          unit_price: unitPrice,
          total_amount: lineTotal,
        });
      }

      db.prepare(`
        INSERT INTO purchase_orders (id, supplier_id, status, total_amount, currency, order_date, expected_delivery_date, assistant_id)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)
      `).run(id, input.supplier_id, total, currency, orderDate, input.expected_delivery_date || null, assistantId);

      const insertLineStmt = db.prepare(`
        INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, description, quantity, unit_price, total_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const cl of calculatedLines) {
        insertLineStmt.run(cl.id, id, cl.product_id, cl.description, cl.quantity, cl.unit_price, cl.total_amount);
      }

      return this.getPurchaseOrderById(id);
    });
  }

  static getPurchaseOrderById(id: string) {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id) as any;
    if (!po) {
      throw new NotFoundError('PurchaseOrder', id);
    }
    const lines = db.prepare('SELECT * FROM purchase_order_lines WHERE purchase_order_id = ?').all(id);
    return {
      ...po,
      line_items: lines,
    };
  }

  static listPurchaseOrders() {
    return db.prepare('SELECT * FROM purchase_orders ORDER BY order_date DESC').all();
  }

  static receiveGoods(id: string, assistantId: string) {
    return withTransaction(() => {
      const po = this.getPurchaseOrderById(id) as any;
      if (po.status === 'received') {
        throw new ConflictError(`Purchase Order ${id} is already fully received.`);
      }
      if (po.status === 'cancelled') {
        throw new ConflictError(`Cannot receive cancelled Purchase Order ${id}.`);
      }

      // Mark PO as received
      db.prepare(`
        UPDATE purchase_orders
        SET status = 'received', updated_at = datetime('now')
        WHERE id = ?
      `).run(id);

      // Increment stock for each PO line item
      for (const line of po.line_items) {
        this.createAdjustment({
          product_id: line.product_id,
          quantity_change: line.quantity,
          reason_code: 'received',
          notes: `Goods received from PO ${id}`
        }, assistantId);
      }

      // Publish event
      eventBus.publish('inventory.purchased', 'inventory', 'purchase_orders', id, {
        purchaseOrderId: id,
        totalAmount: po.total_amount,
        currency: po.currency,
        assistantId
      });

      return this.getPurchaseOrderById(id);
    });
  }
}
