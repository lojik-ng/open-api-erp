import { v4 as uuid } from 'uuid';
import { db } from '../../config/database';
import { NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';

export class MonitoredCommunicationsService {
  static create(input: {
    client_name: string;
    contact_name: string;
    channel: 'email' | 'whatsapp' | 'call' | 'physical';
    channel_address?: string | null;
    conversation_date: string;
  }) {
    const id = uuid();
    db.prepare(`
      INSERT INTO monitored_communications (id, client_name, contact_name, channel, channel_address, conversation_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.client_name,
      input.contact_name,
      input.channel,
      input.channel_address ?? null,
      input.conversation_date
    );
    return this.getById(id);
  }

  static list(query: { cursor?: string; limit?: number }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const rows = db.prepare(`
      SELECT * FROM monitored_communications
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

  static getById(id: string) {
    const row = db.prepare('SELECT * FROM monitored_communications WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('MonitoredCommunication', id);
    }
    return row;
  }

  static update(id: string, input: {
    client_name?: string;
    contact_name?: string;
    channel?: 'email' | 'whatsapp' | 'call' | 'physical';
    channel_address?: string | null;
    conversation_date?: string;
  }) {
    // Verify it exists first
    this.getById(id);

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['client_name', 'contact_name', 'channel', 'channel_address', 'conversation_date'];
    for (const field of fields) {
      if (input[field as keyof typeof input] !== undefined) {
        sets.push(`${field} = ?`);
        values.push(input[field as keyof typeof input]);
      }
    }

    if (sets.length > 0) {
      values.push(id);
      db.prepare(`
        UPDATE monitored_communications
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return this.getById(id);
  }

  static delete(id: string) {
    const result = db.prepare('DELETE FROM monitored_communications WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('MonitoredCommunication', id);
    }
    return { success: true };
  }
}
