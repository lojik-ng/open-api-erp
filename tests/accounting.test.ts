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

describe('Accounting & Periods tests', () => {
  let assistant: any;
  let cashAccount: string;
  let arAccount: string;
  let revenueAccount: string;

  beforeEach(() => {
    assistant = seedTestAssistant('Finance Officer', [
      'read:accounts', 'write:accounts',
      'read:journal_entries', 'write:journal_entries', 'reverse:journal',
      'read:periods', 'write:periods', 'close:period'
    ]);

    // Seed test accounts
    cashAccount = uuid();
    db.prepare(`
      INSERT INTO accounts (id, type, code, name, currency)
      VALUES (?, 'asset', '1000', 'Cash Test', 'USD')
    `).run(cashAccount);

    arAccount = uuid();
    db.prepare(`
      INSERT INTO accounts (id, type, code, name, currency)
      VALUES (?, 'asset', '1200', 'AR Test', 'USD')
    `).run(arAccount);

    revenueAccount = uuid();
    db.prepare(`
      INSERT INTO accounts (id, type, code, name, currency)
      VALUES (?, 'revenue', '4000', 'Revenue Test', 'USD')
    `).run(revenueAccount);
  });

  describe('Double-Entry Balance Check', () => {
    it('fails when journal entry debits and credits do not balance', async () => {
      const res = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', assistant.apiKey)
        .send({
          description: 'Unbalanced payment entry',
          date: '2026-06-01',
          lines: [
            { account_id: cashAccount, debit: 150.0, credit: 0.0, description: 'Debit 150' },
            { account_id: arAccount, debit: 0.0, credit: 100.0, description: 'Credit 100' }
          ]
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('unbalanced');
    });

    it('creates journal entry successfully when balanced', async () => {
      const res = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', assistant.apiKey)
        .send({
          description: 'Balanced payment entry',
          date: '2026-06-01',
          lines: [
            { account_id: cashAccount, debit: 100.0, credit: 0.0 },
            { account_id: arAccount, debit: 0.0, credit: 100.0 }
          ]
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });
  });

  describe('Closed Periods Locking', () => {
    it('blocks journal entry creation if period is locked', async () => {
      // Close period 2026-05-01 to 2026-05-31
      await request(app)
        .post('/v1/accounting/periods/close')
        .set('x-api-key', assistant.apiKey)
        .send({
          start_date: '2026-05-01',
          end_date: '2026-05-31',
          notes: 'Month-end close'
        });

      // Try posting entry in locked period
      const res = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', assistant.apiKey)
        .send({
          date: '2026-05-15',
          description: 'Late adjustment',
          lines: [
            { account_id: cashAccount, debit: 50.0, credit: 0.0 },
            { account_id: arAccount, debit: 0.0, credit: 50.0 }
          ]
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('closed');
    });

    it('blocks duplicate overlapping period closures', async () => {
      // Close first period
      await request(app)
        .post('/v1/accounting/periods/close')
        .set('x-api-key', assistant.apiKey)
        .send({ start_date: '2026-01-01', end_date: '2026-01-31' });

      // Overlapping period close attempt - blocked!
      const res = await request(app)
        .post('/v1/accounting/periods/close')
        .set('x-api-key', assistant.apiKey)
        .send({ start_date: '2026-01-15', end_date: '2026-02-15' });

      expect(res.status).toBe(409);
    });
  });

  describe('Journal Entry Reversal', () => {
    it('creates opposite entry on reversal and flags reversal origin', async () => {
      // Post original entry
      const originalRes = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', assistant.apiKey)
        .send({
          date: '2026-06-01',
          description: 'Original sale entry',
          lines: [
            { account_id: arAccount, debit: 500.0, credit: 0.0 },
            { account_id: revenueAccount, debit: 0.0, credit: 500.0 }
          ]
        });

      const entryId = originalRes.body.id;

      // Reverse it
      const reverseRes = await request(app)
        .post(`/v1/accounting/journal-entries/${entryId}/reverse`)
        .set('x-api-key', assistant.apiKey);

      expect(reverseRes.status).toBe(200);
      expect(reverseRes.body.reversal_of).toBe(entryId);
      
      // Debit/Credit should be flipped
      const lines = reverseRes.body.lines;
      const arLine = lines.find((l: any) => l.account_id === arAccount);
      const revLine = lines.find((l: any) => l.account_id === revenueAccount);

      expect(arLine.credit).toBe(500.0);
      expect(arLine.debit).toBe(0.0);
      expect(revLine.debit).toBe(500.0);
      expect(revLine.credit).toBe(0.0);
    });

    it('blocks double reversal on the same entry', async () => {
      const originalRes = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', assistant.apiKey)
        .send({
          date: '2026-06-01',
          description: 'Entry to reverse twice',
          lines: [
            { account_id: arAccount, debit: 100.0, credit: 0.0 },
            { account_id: revenueAccount, debit: 0.0, credit: 100.0 }
          ]
        });

      const entryId = originalRes.body.id;

      // First reversal
      await request(app)
        .post(`/v1/accounting/journal-entries/${entryId}/reverse`)
        .set('x-api-key', assistant.apiKey);

      // Second reversal - blocked!
      const res = await request(app)
        .post(`/v1/accounting/journal-entries/${entryId}/reverse`)
        .set('x-api-key', assistant.apiKey);

      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('already been reversed');
    });
  });
});
