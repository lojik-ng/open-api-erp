import { v4 as uuid } from 'uuid';
import { db } from '../../config/database';
import { NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { CrmService } from '../crm/crm.service';

export class DocumentsService {
  static create(input: {
    title: string;
    details?: string | null;
    filepath: string;
    lead_id?: string | null;
    client_id?: string | null;
  }) {
    // 1. Validate that at least one of lead_id or client_id is provided
    if (!input.lead_id && !input.client_id) {
      throw new Error('Document must be attached to a lead or a client.');
    }

    // 2. Verify lead exists if lead_id is provided
    if (input.lead_id) {
      CrmService.getLeadById(input.lead_id);
    }

    // 3. Verify client exists if client_id is provided
    if (input.client_id) {
      CrmService.getClientById(input.client_id);
    }

    const id = uuid();
    db.prepare(`
      INSERT INTO documents (id, title, details, filepath, lead_id, client_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.details ?? null,
      input.filepath,
      input.lead_id ?? null,
      input.client_id ?? null
    );

    return this.getById(id);
  }

  static getById(id: string) {
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Document', id);
    }
    return row;
  }

  static list(query: { cursor?: string; limit?: number; lead_id?: string; client_id?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const filterClauses: string[] = [];
    const filterParams: any[] = [];

    if (query.lead_id) {
      filterClauses.push('lead_id = ?');
      filterParams.push(query.lead_id);
    }

    if (query.client_id) {
      filterClauses.push('client_id = ?');
      filterParams.push(query.client_id);
    }

    const whereClause = filterClauses.length > 0 
      ? `AND ${filterClauses.join(' AND ')}` 
      : '';

    const rows = db.prepare(`
      SELECT * FROM documents
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

  static delete(id: string) {
    // Check if it exists first (will throw NotFoundError if not)
    this.getById(id);

    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { success: true };
  }
}
