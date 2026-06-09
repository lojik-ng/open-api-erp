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

describe('Cold Marketing List Integration Tests', () => {
  let readOnlyKey: string;
  let writeOnlyKey: string;
  let noPermKey: string;

  beforeEach(() => {
    ({ apiKey: readOnlyKey } = seedTestAssistant('Cold Reader', ['read:cold_marketing']));
    ({ apiKey: writeOnlyKey } = seedTestAssistant('Cold Writer', ['write:cold_marketing']));
    ({ apiKey: noPermKey } = seedTestAssistant('No Perms', []));
  });

  it('enforces RBAC and manages the complete lifecycle of cold marketing targets', async () => {
    const payload = {
      company_name: 'Stark Industries',
      contact_name: 'Tony Stark',
      email: 'tony@stark.com',
      phone: '+1-555-0199',
      notes: 'High value prospect',
    };

    // 1. POST: Create contact without permission (403)
    const resPost403 = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', readOnlyKey)
      .send(payload);
    expect(resPost403.status).toBe(403);

    // 2. POST: Create contact with permission (201)
    const resPostOk = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send(payload);
    expect(resPostOk.status).toBe(201);
    expect(resPostOk.body.id).toBeDefined();
    expect(resPostOk.body.contact_name).toBe('Tony Stark');
    expect(resPostOk.body.status).toBe('New');
    const targetId = resPostOk.body.id;

    // 3. POST: Create invalid contact (missing name/invalid email) (422)
    const resPostInvalid = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({ email: 'not-an-email' });
    expect(resPostInvalid.status).toBe(422);

    // 3a. POST: Create contact with missing company_name (422)
    const resPostMissingCompany = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({
        contact_name: 'Tony Stark',
        email: 'tony2@stark.com',
        phone: '+1-555-0299',
      });
    expect(resPostMissingCompany.status).toBe(422);

    // 3b. POST: Create contact with missing phone (422)
    const resPostMissingPhone = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({
        company_name: 'Stark Industries 2',
        contact_name: 'Tony Stark',
        email: 'tony2@stark.com',
      });
    expect(resPostMissingPhone.status).toBe(422);

    // 3c. POST: Create contact with duplicate company_name (409)
    const resPostDupCompany = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({
        company_name: 'Stark Industries', // Duplicate
        contact_name: 'Pepper Potts',
        email: 'pepper@stark.com',
        phone: '+1-555-0200',
      });
    expect(resPostDupCompany.status).toBe(409);

    // 3d. POST: Create contact with duplicate phone (409)
    const resPostDupPhone = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({
        company_name: 'Stark Industries 3',
        contact_name: 'Pepper Potts',
        email: 'pepper@stark.com',
        phone: '+1-555-0199', // Duplicate
      });
    expect(resPostDupPhone.status).toBe(409);

    // 4. GET: List contacts without permission (403)
    const resList403 = await request(app)
      .get('/v1/cold-marketing')
      .set('x-api-key', noPermKey);
    expect(resList403.status).toBe(403);

    // 5. GET: List all contacts (200)
    const resListAll = await request(app)
      .get('/v1/cold-marketing')
      .set('x-api-key', readOnlyKey);
    expect(resListAll.status).toBe(200);
    expect(resListAll.body.data.length).toBe(1);
    expect(resListAll.body.data[0].id).toBe(targetId);

    // 6. GET: List contacts matching search query q
    const resListSearch = await request(app)
      .get('/v1/cold-marketing?q=Stark')
      .set('x-api-key', readOnlyKey);
    expect(resListSearch.status).toBe(200);
    expect(resListSearch.body.data.length).toBe(1);

    const resListSearchNoMatch = await request(app)
      .get('/v1/cold-marketing?q=Wayne')
      .set('x-api-key', readOnlyKey);
    expect(resListSearchNoMatch.status).toBe(200);
    expect(resListSearchNoMatch.body.data.length).toBe(0);

    // 7. GET: List contacts filtering by status
    const resListFilterStatus = await request(app)
      .get('/v1/cold-marketing?status=New')
      .set('x-api-key', readOnlyKey);
    expect(resListFilterStatus.status).toBe(200);
    expect(resListFilterStatus.body.data.length).toBe(1);

    const resListFilterStatusNoMatch = await request(app)
      .get('/v1/cold-marketing?status=Used')
      .set('x-api-key', readOnlyKey);
    expect(resListFilterStatusNoMatch.status).toBe(200);
    expect(resListFilterStatusNoMatch.body.data.length).toBe(0);

    // 8. GET: Get specific details (200)
    const resGetOk = await request(app)
      .get(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetOk.status).toBe(200);
    expect(resGetOk.body.contact_name).toBe('Tony Stark');

    // 9. PUT: Update contact details (200)
    const resUpdateOk = await request(app)
      .put(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', writeOnlyKey)
      .send({ status: 'Used', notes: 'Spoke on the phone' });
    expect(resUpdateOk.status).toBe(200);
    expect(resUpdateOk.body.status).toBe('Used');
    expect(resUpdateOk.body.notes).toBe('Spoke on the phone');

    // 9a. Create another contact to test update conflicts
    const resPostSecond = await request(app)
      .post('/v1/cold-marketing')
      .set('x-api-key', writeOnlyKey)
      .send({
        company_name: 'Oscorp',
        contact_name: 'Norman Osborn',
        email: 'norman@oscorp.com',
        phone: '+1-555-0800',
      });
    expect(resPostSecond.status).toBe(201);
    const secondId = resPostSecond.body.id;

    // 9b. PUT: Update Stark contact to Oscorp company_name (409)
    const resUpdateDupCompany = await request(app)
      .put(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', writeOnlyKey)
      .send({ company_name: 'Oscorp' });
    expect(resUpdateDupCompany.status).toBe(409);

    // 9c. PUT: Update Stark contact to Oscorp phone (409)
    const resUpdateDupPhone = await request(app)
      .put(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', writeOnlyKey)
      .send({ phone: '+1-555-0800' });
    expect(resUpdateDupPhone.status).toBe(409);

    // 9d. Clean up second contact
    const resDeleteSecond = await request(app)
      .delete(`/v1/cold-marketing/${secondId}`)
      .set('x-api-key', writeOnlyKey);
    expect(resDeleteSecond.status).toBe(200);

    // 10. Verify audit logging
    const auditLog = db.prepare('SELECT * FROM audit_logs WHERE resource_id = ? AND action = ?').get(targetId, 'UPDATE') as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.resource_type).toBe('cold_marketing_list');

    // 11. DELETE: Delete contact (200)
    const resDeleteOk = await request(app)
      .delete(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', writeOnlyKey);
    expect(resDeleteOk.status).toBe(200);
    expect(resDeleteOk.body.success).toBe(true);

    // 12. GET: Get deleted contact details (404)
    const resGetDeleted = await request(app)
      .get(`/v1/cold-marketing/${targetId}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetDeleted.status).toBe(404);
  });
});
