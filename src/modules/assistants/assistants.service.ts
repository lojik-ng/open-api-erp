import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';

export interface CreateAssistantInput {
  name: string;
  rateLimitPerMinute?: number;
  isAdmin?: boolean;
  permissions?: string[];
}

export interface UpdateAssistantInput {
  name?: string;
  rateLimitPerMinute?: number;
  status?: 'active' | 'suspended' | 'revoked';
  permissions?: string[];
}

export class AssistantsService {
  static create(input: CreateAssistantInput) {
    return withTransaction(() => {
      const id = uuid();
      const rawKey = `erp_${crypto.randomBytes(32).toString('hex')}`;
      const api_key_hash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const api_key_prefix = rawKey.substring(0, 8);
      const rateLimit = input.rateLimitPerMinute ?? 60;
      const isAdmin = input.isAdmin ? 1 : 0;

      // Insert assistant
      db.prepare(`
        INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, rate_limit_per_minute, is_admin, status)
        VALUES (?, ?, ?, ?, ?, ?, 'active')
      `).run(id, input.name, api_key_hash, api_key_prefix, rateLimit, isAdmin);

      // Insert permissions if any
      if (input.permissions && input.permissions.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO assistant_permissions (id, assistant_id, permission)
          VALUES (?, ?, ?)
        `);
        for (const perm of input.permissions) {
          stmt.run(uuid(), id, perm);
        }
      }

      return {
        id,
        name: input.name,
        api_key_prefix,
        rate_limit_per_minute: rateLimit,
        is_admin: input.isAdmin || false,
        status: 'active',
        apiKey: rawKey, // Raw key returned ONCE at creation time
      };
    });
  }

  static list(cursor?: string, limit = 25) {
    const { clause, params } = cursorWhereClause(cursor);
    const rows = db.prepare(`
      SELECT id, name, api_key_prefix, rate_limit_per_minute, is_admin, status, created_at, updated_at
      FROM assistants
      WHERE 1=1 ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    
    // Map is_admin to boolean
    const formattedData = data.map(row => ({
      ...row,
      is_admin: row.is_admin === 1,
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

  static getById(id: string) {
    const row = db.prepare(`
      SELECT id, name, api_key_prefix, rate_limit_per_minute, is_admin, status, created_at, updated_at
      FROM assistants
      WHERE id = ?
    `).get(id) as any;

    if (!row) {
      throw new NotFoundError('Assistant', id);
    }

    const permissions = db.prepare(`
      SELECT permission FROM assistant_permissions WHERE assistant_id = ?
    `).all(id).map((p: any) => p.permission);

    return {
      ...row,
      is_admin: row.is_admin === 1,
      permissions,
    };
  }

  static update(id: string, input: UpdateAssistantInput) {
    return withTransaction(() => {
      const current = db.prepare('SELECT id FROM assistants WHERE id = ?').get(id);
      if (!current) {
        throw new NotFoundError('Assistant', id);
      }

      // Build dynamic update
      const sets: string[] = [];
      const values: any[] = [];

      if (input.name !== undefined) {
        sets.push('name = ?');
        values.push(input.name);
      }
      if (input.rateLimitPerMinute !== undefined) {
        sets.push('rate_limit_per_minute = ?');
        values.push(input.rateLimitPerMinute);
      }
      if (input.status !== undefined) {
        sets.push('status = ?');
        values.push(input.status);
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`
          UPDATE assistants
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...values);
      }

      // Update permissions if provided
      if (input.permissions !== undefined) {
        db.prepare('DELETE FROM assistant_permissions WHERE assistant_id = ?').run(id);
        const stmt = db.prepare(`
          INSERT INTO assistant_permissions (id, assistant_id, permission)
          VALUES (?, ?, ?)
        `);
        for (const perm of input.permissions) {
          stmt.run(uuid(), id, perm);
        }
      }

      return this.getById(id);
    });
  }

  static delete(id: string) {
    const result = db.prepare('DELETE FROM assistants WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Assistant', id);
    }
    return { success: true };
  }

  static addScope(assistantId: string, resourceType: string, resourceId: string) {
    const assistant = db.prepare('SELECT id FROM assistants WHERE id = ?').get(assistantId);
    if (!assistant) {
      throw new NotFoundError('Assistant', assistantId);
    }
    const id = uuid();
    try {
      db.prepare(`
        INSERT INTO assistant_scopes (id, assistant_id, resource_type, resource_id)
        VALUES (?, ?, ?, ?)
      `).run(id, assistantId, resourceType, resourceId);
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw new ConflictError(`Scope for resource type '${resourceType}' and ID '${resourceId}' already exists for this assistant.`);
      }
      throw err;
    }
    return { id, assistant_id: assistantId, resource_type: resourceType, resource_id: resourceId };
  }

  static deleteScope(assistantId: string, scopeId: string) {
    const result = db.prepare('DELETE FROM assistant_scopes WHERE id = ? AND assistant_id = ?').run(scopeId, assistantId);
    if (result.changes === 0) {
      throw new NotFoundError('Scope', scopeId);
    }
    return { success: true };
  }

  static listScopes(assistantId: string) {
    const assistant = db.prepare('SELECT id FROM assistants WHERE id = ?').get(assistantId);
    if (!assistant) {
      throw new NotFoundError('Assistant', assistantId);
    }
    return db.prepare('SELECT * FROM assistant_scopes WHERE assistant_id = ?').all(assistantId);
  }
}
