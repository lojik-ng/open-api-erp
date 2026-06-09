import { v4 as uuid } from 'uuid';
import { db } from '../../config/database';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';

export class ColdMarketingService {
  static create(input: {
    company_name: string;
    contact_name: string;
    email: string;
    phone: string;
    status?: 'New' | 'Used';
    notes?: string | null;
  }) {
    const id = uuid();
    try {
      db.prepare(`
        INSERT INTO cold_marketing_list (id, company_name, contact_name, email, phone, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.company_name,
        input.contact_name,
        input.email,
        input.phone,
        input.status ?? 'New',
        input.notes ?? null
      );
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        if (err.message.includes('company_name')) {
          throw new ConflictError(`Cold marketing entry with company name '${input.company_name}' already exists.`);
        }
        if (err.message.includes('phone')) {
          throw new ConflictError(`Cold marketing entry with phone '${input.phone}' already exists.`);
        }
        throw new ConflictError('Cold marketing entry with duplicate company_name or phone already exists.');
      }
      throw err;
    }
    return this.getById(id);
  }

  static getById(id: string) {
    const row = db.prepare('SELECT * FROM cold_marketing_list WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('ColdMarketingEntry', id);
    }
    return row;
  }

  static list(query: { cursor?: string; limit?: number; status?: string; q?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const filterClauses: string[] = [];
    const filterParams: any[] = [];

    if (query.status) {
      filterClauses.push('status = ?');
      filterParams.push(query.status);
    }

    if (query.q) {
      filterClauses.push('(company_name LIKE ? OR contact_name LIKE ? OR email LIKE ?)');
      const searchVal = `%${query.q.trim()}%`;
      filterParams.push(searchVal, searchVal, searchVal);
    }

    const whereClause = filterClauses.length > 0 
      ? `AND ${filterClauses.join(' AND ')}` 
      : '';

    const rows = db.prepare(`
      SELECT * FROM cold_marketing_list
      WHERE 1=1 ${whereClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...filterParams, ...params, limit + 1) as any[];

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

  static update(id: string, input: {
    company_name?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    status?: 'New' | 'Used';
    notes?: string | null;
  }) {
    this.getById(id); // Throws 404 if not found

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['company_name', 'contact_name', 'email', 'phone', 'status', 'notes'];
    for (const field of fields) {
      if (input[field as keyof typeof input] !== undefined) {
        sets.push(`${field} = ?`);
        values.push(input[field as keyof typeof input]);
      }
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(id);
      try {
        db.prepare(`
          UPDATE cold_marketing_list
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...values);
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          if (err.message.includes('company_name')) {
            throw new ConflictError(`Cold marketing entry with company name '${input.company_name}' already exists.`);
          }
          if (err.message.includes('phone')) {
            throw new ConflictError(`Cold marketing entry with phone '${input.phone}' already exists.`);
          }
          throw new ConflictError('Cold marketing entry with duplicate company_name or phone already exists.');
        }
        throw err;
      }
    }

    return this.getById(id);
  }

  static delete(id: string) {
    this.getById(id); // Throws 404 if not found

    db.prepare('DELETE FROM cold_marketing_list WHERE id = ?').run(id);
    return { success: true };
  }
}
