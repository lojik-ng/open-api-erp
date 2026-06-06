import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { app } from '../src/app';
import { db } from '../src/config/database';

function seedTestAssistant(name: string, permissions: string[], isAdmin = false) {
  const id = uuid();
  const apiKey = `erp_test_${crypto.randomBytes(16).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const apiKeyPrefix = apiKey.substring(0, 8);

  db.prepare(`
    INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, is_admin)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, apiKeyHash, apiKeyPrefix, isAdmin ? 1 : 0);

  const insertPerm = db.prepare(`
    INSERT INTO assistant_permissions (id, assistant_id, permission)
    VALUES (?, ?, ?)
  `);
  for (const perm of permissions) {
    insertPerm.run(uuid(), id, perm);
  }

  return { id, apiKey };
}

describe('Open API ERP API tests', () => {
  describe('Public health check', () => {
    it('returns healthy status without authentication', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });
  });

  describe('Authentication and authorization (RBAC)', () => {
    it('returns 401 when no x-api-key is sent', async () => {
      const res = await request(app).get('/v1/crm/leads');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when invalid key is sent', async () => {
      const res = await request(app)
        .get('/v1/crm/leads')
        .set('x-api-key', 'erp_invalidkey');
      expect(res.status).toBe(401);
    });

    it('returns 403 when assistant lacks permissions', async () => {
      const { apiKey } = seedTestAssistant('CRM Assistant Lacking Perms', []);
      const res = await request(app)
        .get('/v1/crm/leads')
        .set('x-api-key', apiKey);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows access when assistant has required permission', async () => {
      const { apiKey } = seedTestAssistant('Sales Bot', ['read:leads']);
      const res = await request(app)
        .get('/v1/crm/leads')
        .set('x-api-key', apiKey);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });
  });

  describe('Idempotency', () => {
    it('returns the same response on duplicate POST with same Idempotency-Key', async () => {
      const { apiKey } = seedTestAssistant('Sales Bot', ['write:leads', 'read:leads']);
      const idempotencyKey = uuid();
      const payload = {
        first_name: 'John',
        last_name: 'Doe',
        email: 'john.doe@example.com'
      };

      // First request
      const res1 = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', apiKey)
        .set('idempotency-key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const leadId = res1.body.id;
      expect(leadId).toBeDefined();

      // Second request
      const res2 = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', apiKey)
        .set('idempotency-key', idempotencyKey)
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.id).toBe(leadId);
      expect(res2.headers['x-cache-lookup']).toContain('HIT');
    });
  });

  describe('Audit logging', () => {
    it('logs mutating operations to the audit_log table', async () => {
      const { apiKey, id: assistantId } = seedTestAssistant('Sales Bot', ['write:leads', 'read:leads']);
      const payload = {
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane.smith@example.com'
      };

      const res = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', apiKey)
        .send(payload);

      expect(res.status).toBe(201);
      const leadId = res.body.id;

      // Verify record exists in audit_logs
      const auditLog = db.prepare('SELECT * FROM audit_logs WHERE resource_id = ?').get(leadId) as any;
      expect(auditLog).toBeDefined();
      expect(auditLog.action).toBe('CREATE');
      expect(auditLog.resource_type).toBe('leads');
      expect(auditLog.assistant_id).toBe(assistantId);
      expect(JSON.parse(auditLog.after_state).first_name).toBe('Jane');
    });
  });

  describe('Rate Limiting', () => {
    it('blocks request when exceeding assistant minute rate limit', async () => {
      const id = uuid();
      const apiKey = `erp_test_${crypto.randomBytes(16).toString('hex')}`;
      const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const apiKeyPrefix = apiKey.substring(0, 8);

      // Seed assistant with rate limit = 2
      db.prepare(`
        INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, rate_limit_per_minute)
        VALUES (?, 'Rate Limited Bot', ?, ?, 2)
      `).run(id, apiKeyHash, apiKeyPrefix);

      db.prepare(`
        INSERT INTO assistant_permissions (id, assistant_id, permission)
        VALUES (?, ?, 'read:leads')
      `).run(uuid(), id);

      // 1st request
      let res = await request(app).get('/v1/crm/leads').set('x-api-key', apiKey);
      expect(res.status).toBe(200);

      // 2nd request
      res = await request(app).get('/v1/crm/leads').set('x-api-key', apiKey);
      expect(res.status).toBe(200);

      // 3rd request - blocked!
      res = await request(app).get('/v1/crm/leads').set('x-api-key', apiKey);
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  describe('CRM Lead Conversion', () => {
    it('converts a lead into active client B2B/B2C successfully', async () => {
      const { apiKey } = seedTestAssistant('Sales Admin', ['write:leads', 'read:leads', 'convert:lead', 'read:clients']);
      
      const resLead = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', apiKey)
        .send({
          first_name: 'LeadFirst',
          last_name: 'LeadLast',
          email: 'lead@corp.com',
          company_name: 'Lead Corp'
        });

      const leadId = resLead.body.id;

      // Convert
      const resConvert = await request(app)
        .post(`/v1/crm/leads/${leadId}/convert`)
        .set('x-api-key', apiKey);

      expect(resConvert.status).toBe(200);
      expect(resConvert.body.name).toBe('Lead Corp');
      expect(resConvert.body.type).toBe('b2b');

      // Verify client details in db
      const client = db.prepare('SELECT * FROM clients WHERE lead_id = ?').get(leadId) as any;
      expect(client).toBeDefined();
      expect(client.status).toBe('active');
    });
  });
});
