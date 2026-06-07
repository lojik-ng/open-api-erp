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

describe('Monitored Communications Module', () => {
  it('enforces RBAC for monitored communications and handles CRUD lifecycle', async () => {
    const { apiKey: readOnlyKey } = seedTestAssistant('Reader Bot', ['read:monitored_communications']);
    const { apiKey: writeOnlyKey } = seedTestAssistant('Writer Bot', ['write:monitored_communications']);
    const { apiKey: noPermKey } = seedTestAssistant('No Perm Bot', []);

    const payload = {
      client_name: 'Acme Corp',
      contact_name: 'John Doe',
      channel: 'email',
      channel_address: 'john@acme.com',
      conversation_date: '2026-06-07T12:00:00Z',
    };

    // 1. Try creating without permission (should fail)
    const resCreateFail = await request(app)
      .post('/v1/monitored-communications')
      .set('x-api-key', readOnlyKey)
      .send(payload);
    expect(resCreateFail.status).toBe(403);

    // 2. Create with permission (should succeed)
    const resCreateOk = await request(app)
      .post('/v1/monitored-communications')
      .set('x-api-key', writeOnlyKey)
      .send(payload);
    expect(resCreateOk.status).toBe(201);
    expect(resCreateOk.body.id).toBeDefined();
    expect(resCreateOk.body.client_name).toBe('Acme Corp');
    const commId = resCreateOk.body.id;

    // 3. Try reading list without permission (should fail)
    const resListFail = await request(app)
      .get('/v1/monitored-communications')
      .set('x-api-key', noPermKey);
    expect(resListFail.status).toBe(403);

    // 4. Read list with permission (should succeed)
    const resListOk = await request(app)
      .get('/v1/monitored-communications')
      .set('x-api-key', readOnlyKey);
    expect(resListOk.status).toBe(200);
    expect(resListOk.body.data.length).toBe(1);
    expect(resListOk.body.data[0].id).toBe(commId);

    // 5. Update record
    const resUpdate = await request(app)
      .put(`/v1/monitored-communications/${commId}`)
      .set('x-api-key', writeOnlyKey)
      .send({ client_name: 'Acme LLC' });
    expect(resUpdate.status).toBe(200);
    expect(resUpdate.body.client_name).toBe('Acme LLC');

    // 6. Verify audit logging
    const auditLog = db.prepare('SELECT * FROM audit_logs WHERE resource_id = ? AND action = ?').get(commId, 'UPDATE') as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.resource_type).toBe('monitored_communications');

    // 7. Delete record
    const resDelete = await request(app)
      .delete(`/v1/monitored-communications/${commId}`)
      .set('x-api-key', writeOnlyKey);
    expect(resDelete.status).toBe(200);
    expect(resDelete.body.success).toBe(true);

    // 8. Try fetching deleted record (should fail with 404)
    const resGetFail = await request(app)
      .get(`/v1/monitored-communications/${commId}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetFail.status).toBe(404);
  });
});
