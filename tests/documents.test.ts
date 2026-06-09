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

describe('Documents Module Integration Tests', () => {
  let readOnlyKey: string;
  let writeOnlyKey: string;
  let noPermKey: string;
  let testLeadId: string;
  let testClientId: string;

  beforeEach(() => {
    // Seed test assistants
    ({ apiKey: readOnlyKey } = seedTestAssistant('Doc Reader', ['read:documents']));
    ({ apiKey: writeOnlyKey } = seedTestAssistant('Doc Writer', ['write:documents']));
    ({ apiKey: noPermKey } = seedTestAssistant('No Perms', []));

    // Seed test Lead
    testLeadId = uuid();
    db.prepare(`
      INSERT INTO leads (id, first_name, last_name, stage)
      VALUES (?, 'Document', 'Lead', 'new')
    `).run(testLeadId);

    // Seed test Client
    testClientId = uuid();
    db.prepare(`
      INSERT INTO clients (id, type, name, status, currency)
      VALUES (?, 'b2c', 'Document Client', 'active', 'USD')
    `).run(testClientId);
  });

  it('enforces RBAC and manages document lifecycle correctly', async () => {
    // 1. POST: Try creating document without permission (403)
    const payloadLead = {
      title: 'Contract PDF',
      details: 'Draft version of lead contract',
      filepath: '/uploads/leads/contract-draft.pdf',
      lead_id: testLeadId,
    };

    const resPost403 = await request(app)
      .post('/v1/documents')
      .set('x-api-key', readOnlyKey)
      .send(payloadLead);
    expect(resPost403.status).toBe(403);

    // 2. POST: Create document attached to lead with permission (201)
    const resPostLead = await request(app)
      .post('/v1/documents')
      .set('x-api-key', writeOnlyKey)
      .send(payloadLead);
    expect(resPostLead.status).toBe(201);
    expect(resPostLead.body.id).toBeDefined();
    expect(resPostLead.body.title).toBe(payloadLead.title);
    expect(resPostLead.body.lead_id).toBe(testLeadId);
    expect(resPostLead.body.client_id).toBeNull();
    const leadDocId = resPostLead.body.id;

    // 3. POST: Create document attached to client with permission (201)
    const payloadClient = {
      title: 'Tax Document',
      details: 'W9 for corporate client',
      filepath: '/uploads/clients/tax-w9.pdf',
      client_id: testClientId,
    };
    const resPostClient = await request(app)
      .post('/v1/documents')
      .set('x-api-key', writeOnlyKey)
      .send(payloadClient);
    expect(resPostClient.status).toBe(201);
    expect(resPostClient.body.id).toBeDefined();
    expect(resPostClient.body.client_id).toBe(testClientId);
    expect(resPostClient.body.lead_id).toBeNull();
    const clientDocId = resPostClient.body.id;

    // 4. POST: Validate check constraints (require at least lead_id or client_id)
    const invalidPayload = {
      title: 'Orphan Document',
      filepath: '/uploads/orphan.txt',
    };
    const resPostInvalid = await request(app)
      .post('/v1/documents')
      .set('x-api-key', writeOnlyKey)
      .send(invalidPayload);
    expect(resPostInvalid.status).toBe(422); // Validation error (Zod refinement)

    // 5. POST: Validate foreign keys (404 on non-existent lead_id or client_id)
    const badFkPayload = {
      title: 'Bad FK Doc',
      filepath: '/uploads/bad.txt',
      lead_id: uuid(),
    };
    const resPostBadFk = await request(app)
      .post('/v1/documents')
      .set('x-api-key', writeOnlyKey)
      .send(badFkPayload);
    expect(resPostBadFk.status).toBe(404);

    // 6. GET: Try listing without permission (403)
    const resList403 = await request(app)
      .get('/v1/documents')
      .set('x-api-key', noPermKey);
    expect(resList403.status).toBe(403);

    // 7. GET: List all documents (200)
    const resListAll = await request(app)
      .get('/v1/documents')
      .set('x-api-key', readOnlyKey);
    expect(resListAll.status).toBe(200);
    expect(resListAll.body.data.length).toBeGreaterThanOrEqual(2);

    // 8. GET: List documents filter by lead_id
    const resListLead = await request(app)
      .get(`/v1/documents?lead_id=${testLeadId}`)
      .set('x-api-key', readOnlyKey);
    expect(resListLead.status).toBe(200);
    expect(resListLead.body.data.length).toBe(1);
    expect(resListLead.body.data[0].id).toBe(leadDocId);

    // 9. GET: List documents filter by client_id
    const resListClient = await request(app)
      .get(`/v1/documents?client_id=${testClientId}`)
      .set('x-api-key', readOnlyKey);
    expect(resListClient.status).toBe(200);
    expect(resListClient.body.data.length).toBe(1);
    expect(resListClient.body.data[0].id).toBe(clientDocId);

    // 10. GET: Fetch document by ID (200)
    const resGetDoc = await request(app)
      .get(`/v1/documents/${leadDocId}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetDoc.status).toBe(200);
    expect(resGetDoc.body.title).toBe('Contract PDF');

    // 11. GET: Fetch non-existent document by ID (404)
    const resGetDoc404 = await request(app)
      .get(`/v1/documents/${uuid()}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetDoc404.status).toBe(404);

    // 12. DELETE: Try deleting without permission (403)
    const resDel403 = await request(app)
      .delete(`/v1/documents/${leadDocId}`)
      .set('x-api-key', readOnlyKey);
    expect(resDel403.status).toBe(403);

    // 13. DELETE: Delete document with permission (200)
    const resDelOk = await request(app)
      .delete(`/v1/documents/${leadDocId}`)
      .set('x-api-key', writeOnlyKey);
    expect(resDelOk.status).toBe(200);
    expect(resDelOk.body.success).toBe(true);

    // 14. GET: Fetch deleted document (404)
    const resGetDeleted = await request(app)
      .get(`/v1/documents/${leadDocId}`)
      .set('x-api-key', readOnlyKey);
    expect(resGetDeleted.status).toBe(404);

    // 15. Verify audit logging
    const auditLog = db.prepare('SELECT * FROM audit_logs WHERE resource_id = ? AND action = ?').get(leadDocId, 'DELETE') as any;
    expect(auditLog).toBeDefined();
    expect(auditLog.resource_type).toBe('documents');
  });

  it('automatically cascade deletes documents when the parent lead or client is deleted', async () => {
    // Create new document attached to lead
    const payloadLead = {
      title: 'Lead Attachment',
      filepath: '/lead/doc.pdf',
      lead_id: testLeadId,
    };
    const resPost = await request(app)
      .post('/v1/documents')
      .set('x-api-key', writeOnlyKey)
      .send(payloadLead);
    expect(resPost.status).toBe(201);
    const newDocId = resPost.body.id;

    // Delete parent lead directly
    db.prepare('DELETE FROM leads WHERE id = ?').run(testLeadId);

    // Document should be deleted cascade automatically
    const docRow = db.prepare('SELECT * FROM documents WHERE id = ?').get(newDocId);
    expect(docRow).toBeUndefined();
  });
});
