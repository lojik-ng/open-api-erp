import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError, ForbiddenError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { eventBus } from '../../shared/eventBus';

export class CrmService {
  // ==========================================
  // LEADS
  // ==========================================

  static createLead(input: any) {
    const id = uuid();
    db.prepare(`
      INSERT INTO leads (id, source, first_name, last_name, email, phone, company_name, stage, assigned_assistant_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.source || null,
      input.first_name,
      input.last_name,
      input.email || null,
      input.phone || null,
      input.company_name || null,
      input.stage || 'new',
      input.assigned_assistant_id || null,
      input.notes || null
    );
    return this.getLeadById(id);
  }

  static listLeads(query: { cursor?: string; limit?: number; q?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    let rows: any[];
    if (query.q) {
      // Clean up search query for MATCH
      const matchQuery = `${query.q.trim()}*`;
      rows = db.prepare(`
        SELECT l.*
        FROM leads l
        JOIN leads_fts fts ON l.rowid = fts.rowid
        WHERE leads_fts MATCH ? ${clause}
        ORDER BY l.created_at ASC, l.id ASC
        LIMIT ?
      `).all(matchQuery, ...params, limit + 1) as any[];
    } else {
      rows = db.prepare(`
        SELECT * FROM leads
        WHERE 1=1 ${clause}
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `).all(...params, limit + 1) as any[];
    }

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

  static getLeadById(id: string) {
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Lead', id);
    }
    return row;
  }

  static updateLead(id: string, input: any) {
    const lead = this.getLeadById(id);

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['source', 'first_name', 'last_name', 'email', 'phone', 'company_name', 'stage', 'assigned_assistant_id', 'notes'];
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
        UPDATE leads
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return this.getLeadById(id);
  }

  static deleteLead(id: string) {
    return withTransaction(() => {
      // First delete interactions linked only to this lead to prevent CHECK constraint violation
      db.prepare('DELETE FROM interactions WHERE lead_id = ? AND client_id IS NULL').run(id);

      const result = db.prepare('DELETE FROM leads WHERE id = ?').run(id);
      if (result.changes === 0) {
        throw new NotFoundError('Lead', id);
      }
      return { success: true };
    });
  }

  static convertLead(id: string, assistantId: string) {
    return withTransaction(() => {
      const lead = this.getLeadById(id) as any;

      if (lead.stage === 'won' && lead.converted_client_id) {
        throw new ConflictError(`Lead ${id} is already converted to client ${lead.converted_client_id}`);
      }

      // Update lead stage to won
      const clientId = uuid();
      db.prepare(`
        UPDATE leads
        SET stage = 'won', converted_client_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(clientId, id);

      // Create client
      const clientName = lead.company_name || `${lead.first_name} ${lead.last_name}`;
      const clientType = lead.company_name ? 'b2b' : 'b2c';

      db.prepare(`
        INSERT INTO clients (id, type, name, email, phone, status, lead_id, currency)
        VALUES (?, ?, ?, ?, ?, 'active', ?, 'USD')
      `).run(clientId, clientType, clientName, lead.email, lead.phone, id);

      // Create contact person if B2B
      if (clientType === 'b2b') {
        db.prepare(`
          INSERT INTO contact_persons (id, client_id, first_name, last_name, email, phone, role, is_primary)
          VALUES (?, ?, ?, ?, ?, ?, 'Primary Contact', 1)
        `).run(uuid(), clientId, lead.first_name, lead.last_name, lead.email, lead.phone);
      }

      // Emit lead.converted event
      eventBus.publish('lead.converted', 'crm', 'leads', id, {
        leadId: id,
        clientId,
        assistantId
      });

      return db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    });
  }

  // ==========================================
  // CLIENTS
  // ==========================================

  static createClient(input: any) {
    const id = uuid();
    db.prepare(`
      INSERT INTO clients (id, type, name, email, phone, address, status, lead_id, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.type,
      input.name,
      input.email || null,
      input.phone || null,
      input.address || null,
      input.status || 'active',
      input.lead_id || null,
      input.currency || 'USD'
    );
    return this.getClientById(id);
  }

  static listClients(query: { cursor?: string; limit?: number; includeDeleted?: boolean; q?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const softDeleteClause = query.includeDeleted ? '' : 'AND deleted_at IS NULL';

    let rows: any[];
    if (query.q) {
      const matchQuery = `${query.q.trim()}*`;
      rows = db.prepare(`
        SELECT c.*
        FROM clients c
        JOIN clients_fts fts ON c.rowid = fts.rowid
        WHERE clients_fts MATCH ? ${softDeleteClause} ${clause}
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT ?
      `).all(matchQuery, ...params, limit + 1) as any[];
    } else {
      rows = db.prepare(`
        SELECT * FROM clients
        WHERE 1=1 ${softDeleteClause} ${clause}
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `).all(...params, limit + 1) as any[];
    }

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

  static getClientById(id: string) {
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Client', id);
    }
    return row;
  }

  static updateClient(id: string, input: any) {
    const client = this.getClientById(id);

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['type', 'name', 'email', 'phone', 'address', 'status', 'currency'];
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
        UPDATE clients
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return this.getClientById(id);
  }

  static deleteClient(id: string) {
    // Soft delete clients
    const result = db.prepare("UPDATE clients SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Client', id);
    }
    return { success: true };
  }

  // ==========================================
  // CONTACT PERSONS
  // ==========================================

  static createContact(clientId: string, input: any) {
    // Verify client exists
    this.getClientById(clientId);

    const id = uuid();
    db.prepare(`
      INSERT INTO contact_persons (id, client_id, first_name, last_name, email, phone, role, is_primary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      clientId,
      input.first_name,
      input.last_name,
      input.email || null,
      input.phone || null,
      input.role || null,
      input.is_primary ? 1 : 0
    );
    return db.prepare('SELECT * FROM contact_persons WHERE id = ?').get(id);
  }

  static listContacts(clientId: string) {
    this.getClientById(clientId);
    return db.prepare('SELECT * FROM contact_persons WHERE client_id = ?').all(clientId);
  }

  static updateContact(id: string, input: any) {
    const contact = db.prepare('SELECT * FROM contact_persons WHERE id = ?').get(id);
    if (!contact) {
      throw new NotFoundError('ContactPerson', id);
    }

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['first_name', 'last_name', 'email', 'phone', 'role', 'is_primary'];
    for (const field of fields) {
      if (input[field] !== undefined) {
        sets.push(`${field} = ?`);
        values.push(field === 'is_primary' ? (input[field] ? 1 : 0) : input[field]);
      }
    }

    if (sets.length > 0) {
      values.push(id);
      db.prepare(`
        UPDATE contact_persons
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return db.prepare('SELECT * FROM contact_persons WHERE id = ?').get(id);
  }

  static deleteContact(id: string) {
    const result = db.prepare('DELETE FROM contact_persons WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('ContactPerson', id);
    }
    return { success: true };
  }

  // ==========================================
  // INTERACTIONS
  // ==========================================

  static createInteraction(input: any, assistantId: string) {
    if (input.lead_id) this.getLeadById(input.lead_id);
    if (input.client_id) this.getClientById(input.client_id);

    const id = uuid();
    db.prepare(`
      INSERT INTO interactions (id, lead_id, client_id, type, subject, body, interaction_date, assistant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.lead_id || null,
      input.client_id || null,
      input.type,
      input.subject || null,
      input.body || null,
      input.interaction_date || new Date().toISOString(),
      assistantId
    );
    return db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
  }

  static listInteractions(query: { lead_id?: string; client_id?: string; limit?: number; cursor?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const conditions: string[] = [];
    const bindValues: any[] = [];

    if (query.lead_id) {
      conditions.push('lead_id = ?');
      bindValues.push(query.lead_id);
    }
    if (query.client_id) {
      conditions.push('client_id = ?');
      bindValues.push(query.client_id);
    }

    const whereStr = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT * FROM interactions
      WHERE 1=1 ${whereStr} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...bindValues, ...params, limit + 1) as any[];

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

  static deleteInteraction(id: string) {
    const result = db.prepare('DELETE FROM interactions WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Interaction', id);
    }
    return { success: true };
  }

  // ==========================================
  // SCHEDULED EVENTS
  // ==========================================

  static createEvent(input: any, assistantId: string) {
    if (input.lead_id) this.getLeadById(input.lead_id);
    if (input.client_id) this.getClientById(input.client_id);

    const id = uuid();
    db.prepare(`
      INSERT INTO scheduled_events (id, title, description, event_type, start_time, end_time, lead_id, client_id, employee_id, assistant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.title,
      input.description || null,
      input.event_type,
      input.start_time,
      input.end_time || null,
      input.lead_id || null,
      input.client_id || null,
      input.employee_id || null,
      assistantId,
      input.status || 'scheduled'
    );
    return db.prepare('SELECT * FROM scheduled_events WHERE id = ?').get(id);
  }

  static listEvents(query: { lead_id?: string; client_id?: string; employee_id?: string; limit?: number; cursor?: string }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const conditions: string[] = [];
    const bindValues: any[] = [];

    if (query.lead_id) {
      conditions.push('lead_id = ?');
      bindValues.push(query.lead_id);
    }
    if (query.client_id) {
      conditions.push('client_id = ?');
      bindValues.push(query.client_id);
    }
    if (query.employee_id) {
      conditions.push('employee_id = ?');
      bindValues.push(query.employee_id);
    }

    const whereStr = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT * FROM scheduled_events
      WHERE 1=1 ${whereStr} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...bindValues, ...params, limit + 1) as any[];

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

  static updateEvent(id: string, input: any) {
    const event = db.prepare('SELECT * FROM scheduled_events WHERE id = ?').get(id);
    if (!event) {
      throw new NotFoundError('ScheduledEvent', id);
    }

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['title', 'description', 'event_type', 'start_time', 'end_time', 'lead_id', 'client_id', 'employee_id', 'status'];
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
        UPDATE scheduled_events
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return db.prepare('SELECT * FROM scheduled_events WHERE id = ?').get(id);
  }

  static deleteEvent(id: string) {
    const result = db.prepare('DELETE FROM scheduled_events WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('ScheduledEvent', id);
    }
    return { success: true };
  }
}
