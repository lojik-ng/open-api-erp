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

  describe('Row-Level Scoping', () => {
    it('scopes access strictly to designated resource IDs', async () => {
      // 1. Seed two leads
      const leadAId = uuid();
      const leadBId = uuid();
      db.prepare(`
        INSERT INTO leads (id, first_name, last_name, stage)
        VALUES (?, 'Lead', 'A', 'new'), (?, 'Lead', 'B', 'new')
      `).run(leadAId, leadBId);

      // 2. Provision assistant with read:leads permission
      const { apiKey, id: assistantId } = seedTestAssistant('Scoped Sales Agent', ['read:leads']);

      // 3. Assign row-level scope for Lead A only
      const scopeId = uuid();
      db.prepare(`
        INSERT INTO assistant_scopes (id, assistant_id, resource_type, resource_id)
        VALUES (?, ?, 'leads', ?)
      `).run(scopeId, assistantId, leadAId);

      // 4. Try getting Lead A (should succeed)
      const resA = await request(app)
        .get(`/v1/crm/leads/${leadAId}`)
        .set('x-api-key', apiKey);
      expect(resA.status).toBe(200);
      expect(resA.body.id).toBe(leadAId);

      // 5. Try getting Lead B (should return 404 since it is not scoped for this assistant)
      const resB = await request(app)
        .get(`/v1/crm/leads/${leadBId}`)
        .set('x-api-key', apiKey);
      expect(resB.status).toBe(404);
    });

    it('allows admins to create, list, and delete scopes', async () => {
      const admin = seedTestAssistant('System Administrator', [], true);
      const targetAssistant = seedTestAssistant('Target Sales Assistant', ['read:leads']);

      const scopePayload = {
        resource_type: 'leads',
        resource_id: uuid()
      };

      // Create scope
      const resCreate = await request(app)
        .post(`/v1/assistants/${targetAssistant.id}/scopes`)
        .set('x-api-key', admin.apiKey)
        .send(scopePayload);
      expect(resCreate.status).toBe(201);
      expect(resCreate.body.id).toBeDefined();
      const scopeId = resCreate.body.id;

      // List scopes
      const resList = await request(app)
        .get(`/v1/assistants/${targetAssistant.id}/scopes`)
        .set('x-api-key', admin.apiKey);
      expect(resList.status).toBe(200);
      expect(resList.body.length).toBe(1);
      expect(resList.body[0].resource_id).toBe(scopePayload.resource_id);

      // Delete scope
      const resDelete = await request(app)
        .delete(`/v1/assistants/${targetAssistant.id}/scopes/${scopeId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelete.status).toBe(200);
      expect(resDelete.body.success).toBe(true);
    });
  });

  describe('Webhook Subscriptions', () => {
    it('allows assistants to register, list, and delete webhook subscriptions', async () => {
      const assistant = seedTestAssistant('Webhook Agent', ['write:webhooks', 'read:webhooks']);
      
      const webhookPayload = {
        url: 'https://example.com/webhook-handler',
        eventType: 'invoice.sent'
      };

      // Register webhook
      const resRegister = await request(app)
        .post('/v1/webhooks')
        .set('x-api-key', assistant.apiKey)
        .send(webhookPayload);
      expect(resRegister.status).toBe(201);
      expect(resRegister.body.id).toBeDefined();
      expect(resRegister.body.secret).toContain('whsec_');
      const webhookId = resRegister.body.id;

      // List webhooks
      const resList = await request(app)
        .get('/v1/webhooks')
        .set('x-api-key', assistant.apiKey);
      expect(resList.status).toBe(200);
      expect(resList.body.length).toBe(1);
      expect(resList.body[0].url).toBe(webhookPayload.url);

      // Delete webhook
      const resDelete = await request(app)
        .delete(`/v1/webhooks/${webhookId}`)
        .set('x-api-key', assistant.apiKey);
      expect(resDelete.status).toBe(200);
      expect(resDelete.body.success).toBe(true);
    });
  });

  describe('Security Enhancements', () => {
    it('returns CORS and security headers for requests', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['access-control-allow-origin']).toBe('*');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it('sanitizes raw API keys and secrets in audit logs', async () => {
      const admin = seedTestAssistant('System Admin', ['write:assistants'], true);
      
      // Create a new assistant
      const res = await request(app)
        .post('/v1/assistants')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Bot To Be Audited', permissions: ['read:leads'] });
      
      expect(res.status).toBe(201);
      const botId = res.body.id;
      const rawApiKey = res.body.apiKey;
      expect(rawApiKey).toBeDefined();

      // Retrieve audit log for this assistant creation
      const auditEntry = db.prepare(`
        SELECT after_state FROM audit_logs 
        WHERE resource_type = 'assistants' AND resource_id = ?
      `).get(botId) as any;

      expect(auditEntry).toBeDefined();
      const afterState = JSON.parse(auditEntry.after_state);
      expect(afterState.apiKey).toBe('[REDACTED]');
    });

    it('prevents SSRF by blocking webhook registration to private/local networks', async () => {
      const assistant = seedTestAssistant('Webhook Bot', ['write:webhooks']);
      
      const res = await request(app)
        .post('/v1/webhooks')
        .set('x-api-key', assistant.apiKey)
        .send({
          url: 'http://127.0.0.1/evil-callback',
          eventType: 'invoice.sent'
        });
      
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Background worker daily database backups', () => {
    it('triggers database backup during 1 AM hour and skips otherwise', async () => {
      const { runWorkerIteration } = require('../src/worker');
      const { db: database } = require('../src/config/database');

      // Spy on db.backup
      const backupSpy = jest.spyOn(database, 'backup').mockImplementation(() => Promise.resolve());

      // 1. Mock date to 12:00 PM (hour = 12)
      const mockDateNoon = new Date(2026, 5, 9, 12, 0, 0);
      const OriginalDate = global.Date;
      let activeMockedDate = mockDateNoon;
      
      // Mock global Date
      global.Date = class extends OriginalDate {
        constructor(...args: any[]) {
          if (args.length === 0) {
            super();
            return activeMockedDate;
          }
          // @ts-ignore
          super(...args);
        }
      } as any;

      await runWorkerIteration();
      expect(backupSpy).not.toHaveBeenCalled();

      // 2. Mock date to 1:00 AM (hour = 1)
      const mockDate1AM = new OriginalDate(2026, 5, 9, 1, 0, 0);
      activeMockedDate = mockDate1AM;

      await runWorkerIteration();
      expect(backupSpy).toHaveBeenCalledTimes(1);

      // 3. Running iteration again on same day at 1:05 AM (hour = 1) should not trigger it again
      backupSpy.mockClear();
      const mockDate105AM = new OriginalDate(2026, 5, 9, 1, 5, 0);
      activeMockedDate = mockDate105AM;

      await runWorkerIteration();
      expect(backupSpy).not.toHaveBeenCalled();

      // Restore
      global.Date = OriginalDate;
      backupSpy.mockRestore();
    });
  });
});
