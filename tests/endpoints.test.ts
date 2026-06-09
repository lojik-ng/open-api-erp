import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { app } from '../src/app';
import { db } from '../src/config/database';

function seedTestAdmin() {
  const id = uuid();
  const apiKey = `erp_test_admin_${crypto.randomBytes(16).toString('hex')}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const apiKeyPrefix = apiKey.substring(0, 8);

  db.prepare(`
    INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, is_admin)
    VALUES (?, 'Test Admin', ?, ?, 1)
  `).run(id, apiKeyHash, apiKeyPrefix);

  return { id, apiKey };
}

describe('Open API ERP Complete Endpoint Coverage Tests', () => {
  describe('1. Health Check & OpenAPI Document', () => {
    it('should query health and openapi endpoints', async () => {
      const admin = seedTestAdmin();

      // GET /health
      const resHealth = await request(app).get('/health');
      expect(resHealth.status).toBe(200);
      expect(resHealth.body.status).toBe('healthy');

      // GET /v1/api-docs/openapi.json
      const resOpenApi = await request(app)
        .get('/v1/api-docs/openapi.json')
        .set('x-api-key', admin.apiKey);
      expect(resOpenApi.status).toBe(200);
      expect(resOpenApi.body.openapi).toBeDefined();
    });
  });

  describe('2. Assistants Module', () => {
    it('should call all Assistants endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/assistants
      const resPost = await request(app)
        .post('/v1/assistants')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Temp Bot', permissions: ['read:leads'] });
      expect(resPost.status).toBe(201);
      const testAssistantId = resPost.body.id;
      expect(testAssistantId).toBeDefined();

      // GET /v1/assistants
      const resGetList = await request(app)
        .get('/v1/assistants')
        .set('x-api-key', admin.apiKey);
      expect(resGetList.status).toBe(200);
      expect(resGetList.body.data).toBeInstanceOf(Array);

      // GET /v1/assistants/:id
      const resGetById = await request(app)
        .get(`/v1/assistants/${testAssistantId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetById.status).toBe(200);
      expect(resGetById.body.name).toBe('Temp Bot');

      // PUT /v1/assistants/:id
      const resPut = await request(app)
        .put(`/v1/assistants/${testAssistantId}`)
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Updated Bot' });
      expect(resPut.status).toBe(200);
      expect(resPut.body.name).toBe('Updated Bot');

      // POST /v1/assistants/:id/scopes
      const resPostScope = await request(app)
        .post(`/v1/assistants/${testAssistantId}/scopes`)
        .set('x-api-key', admin.apiKey)
        .send({ resource_type: 'leads', resource_id: uuid() });
      expect(resPostScope.status).toBe(201);
      const scopeId = resPostScope.body.id;
      expect(scopeId).toBeDefined();

      // GET /v1/assistants/:id/scopes
      const resGetScopes = await request(app)
        .get(`/v1/assistants/${testAssistantId}/scopes`)
        .set('x-api-key', admin.apiKey);
      expect(resGetScopes.status).toBe(200);
      expect(resGetScopes.body.length).toBe(1);

      // DELETE /v1/assistants/:id/scopes/:scopeId
      const resDelScope = await request(app)
        .delete(`/v1/assistants/${testAssistantId}/scopes/${scopeId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelScope.status).toBe(200);
      expect(resDelScope.body.success).toBe(true);

      // DELETE /v1/assistants/:id
      const resDel = await request(app)
        .delete(`/v1/assistants/${testAssistantId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDel.status).toBe(200);
      expect(resDel.body.success).toBe(true);
    });
  });

  describe('3. CRM Module', () => {
    it('should call all CRM endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/crm/leads
      const resPostLead = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'LeadFirst', last_name: 'LeadLast', company_name: 'CRM Corp', stage: 'new' });
      expect(resPostLead.status).toBe(201);
      const testLeadId = resPostLead.body.id;

      // GET /v1/crm/leads
      const resGetLeads = await request(app)
        .get('/v1/crm/leads')
        .set('x-api-key', admin.apiKey);
      expect(resGetLeads.status).toBe(200);

      // GET /v1/crm/leads/:id
      const resGetLead = await request(app)
        .get(`/v1/crm/leads/${testLeadId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetLead.status).toBe(200);

      // PUT /v1/crm/leads/:id
      const resPutLead = await request(app)
        .put(`/v1/crm/leads/${testLeadId}`)
        .set('x-api-key', admin.apiKey)
        .send({ stage: 'negotiation' });
      expect(resPutLead.status).toBe(200);

      // POST /v1/crm/leads/:id/convert
      const resConvert = await request(app)
        .post(`/v1/crm/leads/${testLeadId}/convert`)
        .set('x-api-key', admin.apiKey);
      expect(resConvert.status).toBe(200);
      let testClientId = resConvert.body.id;

      // DELETE /v1/crm/leads/:id
      const resDelLead = await request(app)
        .delete(`/v1/crm/leads/${testLeadId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelLead.status).toBe(200);

      // POST /v1/crm/clients
      const resPostClient = await request(app)
        .post('/v1/crm/clients')
        .set('x-api-key', admin.apiKey)
        .send({ type: 'b2b', name: 'Direct B2B Client', currency: 'EUR' });
      expect(resPostClient.status).toBe(201);
      testClientId = resPostClient.body.id;

      // GET /v1/crm/clients
      const resGetClients = await request(app)
        .get('/v1/crm/clients')
        .set('x-api-key', admin.apiKey);
      expect(resGetClients.status).toBe(200);

      // GET /v1/crm/clients/:id
      const resGetClient = await request(app)
        .get(`/v1/crm/clients/${testClientId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetClient.status).toBe(200);

      // PUT /v1/crm/clients/:id
      const resPutClient = await request(app)
        .put(`/v1/crm/clients/${testClientId}`)
        .set('x-api-key', admin.apiKey)
        .send({ address: '123 CRM Way' });
      expect(resPutClient.status).toBe(200);

      // POST /v1/crm/clients/:clientId/contacts
      const resPostContact = await request(app)
        .post(`/v1/crm/clients/${testClientId}/contacts`)
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'ContactFirst', last_name: 'ContactLast', email: 'c@client.com', role: 'Billing' });
      expect(resPostContact.status).toBe(201);
      const testContactId = resPostContact.body.id;

      // GET /v1/crm/clients/:clientId/contacts
      const resGetContacts = await request(app)
        .get(`/v1/crm/clients/${testClientId}/contacts`)
        .set('x-api-key', admin.apiKey);
      expect(resGetContacts.status).toBe(200);

      // PUT /v1/crm/contacts/:id
      const resPutContact = await request(app)
        .put(`/v1/crm/contacts/${testContactId}`)
        .set('x-api-key', admin.apiKey)
        .send({ role: 'CEO' });
      expect(resPutContact.status).toBe(200);

      // DELETE /v1/crm/contacts/:id
      const resDelContact = await request(app)
        .delete(`/v1/crm/contacts/${testContactId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelContact.status).toBe(200);

      // POST /v1/crm/interactions
      const resPostInter = await request(app)
        .post('/v1/crm/interactions')
        .set('x-api-key', admin.apiKey)
        .send({ client_id: testClientId, type: 'call', subject: 'Initial intro', body: 'Spoke with CFO' });
      expect(resPostInter.status).toBe(201);
      const testInteractionId = resPostInter.body.id;

      // GET /v1/crm/interactions
      const resGetInter = await request(app)
        .get('/v1/crm/interactions')
        .set('x-api-key', admin.apiKey);
      expect(resGetInter.status).toBe(200);

      // DELETE /v1/crm/interactions/:id
      const resDelInter = await request(app)
        .delete(`/v1/crm/interactions/${testInteractionId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelInter.status).toBe(200);

      // POST /v1/crm/scheduled-events
      const resPostEvent = await request(app)
        .post('/v1/crm/scheduled-events')
        .set('x-api-key', admin.apiKey)
        .send({ title: 'Intro call', event_type: 'call', start_time: new Date().toISOString(), client_id: testClientId });
      expect(resPostEvent.status).toBe(201);
      const testEventId = resPostEvent.body.id;

      // GET /v1/crm/scheduled-events
      const resGetEvents = await request(app)
        .get('/v1/crm/scheduled-events')
        .set('x-api-key', admin.apiKey);
      expect(resGetEvents.status).toBe(200);

      // PUT /v1/crm/scheduled-events/:id
      const resPutEvent = await request(app)
        .put(`/v1/crm/scheduled-events/${testEventId}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'completed' });
      expect(resPutEvent.status).toBe(200);

      // DELETE /v1/crm/scheduled-events/:id
      const resDelEvent = await request(app)
        .delete(`/v1/crm/scheduled-events/${testEventId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelEvent.status).toBe(200);

      // DELETE /v1/crm/clients/:id
      const resDelClient = await request(app)
        .delete(`/v1/crm/clients/${testClientId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelClient.status).toBe(200);
    });

    it('should delete a lead that has associated interactions without CHECK constraint failure', async () => {
      const admin = seedTestAdmin();

      // Create a lead
      const resLead = await request(app)
        .post('/v1/crm/leads')
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'LeadA', last_name: 'LeadB', stage: 'new' });
      expect(resLead.status).toBe(201);
      const leadId = resLead.body.id;

      // Create an interaction linked ONLY to this lead
      const resInter = await request(app)
        .post('/v1/crm/interactions')
        .set('x-api-key', admin.apiKey)
        .send({ lead_id: leadId, type: 'note', subject: 'Note on lead', body: 'Lead interaction only' });
      expect(resInter.status).toBe(201);
      const interId = resInter.body.id;

      // Delete the lead (which should successfully cascade delete the interaction due to our pre-cleanup logic)
      const resDelLead = await request(app)
        .delete(`/v1/crm/leads/${leadId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelLead.status).toBe(200);

      // Verify the interaction is deleted as well
      const interactionInDb = db.prepare('SELECT * FROM interactions WHERE id = ?').get(interId);
      expect(interactionInDb).toBeUndefined();
    });
  });

  describe('4. Catalog Module', () => {
    it('should call all Catalog endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/catalog/tax-rates
      const resTax = await request(app)
        .post('/v1/catalog/tax-rates')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Vat Standard', rate: 0.20, is_default: true });
      expect(resTax.status).toBe(201);
      const testTaxRateId = resTax.body.id;

      // GET /v1/catalog/tax-rates
      const resGetTaxes = await request(app)
        .get('/v1/catalog/tax-rates')
        .set('x-api-key', admin.apiKey);
      expect(resGetTaxes.status).toBe(200);

      // POST /v1/catalog/exchange-rates
      const resEx = await request(app)
        .post('/v1/catalog/exchange-rates')
        .set('x-api-key', admin.apiKey)
        .send({ from_currency: 'EUR', to_currency: 'USD', rate: 1.10, effective_date: '2026-06-01' });
      expect(resEx.status).toBe(201);

      // GET /v1/catalog/exchange-rates
      const resGetEx = await request(app)
        .get('/v1/catalog/exchange-rates')
        .set('x-api-key', admin.apiKey);
      expect(resGetEx.status).toBe(200);

      // POST /v1/catalog/products
      const resProd = await request(app)
        .post('/v1/catalog/products')
        .set('x-api-key', admin.apiKey)
        .send({ sku: 'SUB-PRO-01', name: 'Premium Cloud ERP Sub', type: 'subscription', default_price: 150.0, currency: 'USD', billing_interval: 'monthly', tax_rate_id: testTaxRateId });
      expect(resProd.status).toBe(201);
      const testProductId = resProd.body.id;

      // GET /v1/catalog/products
      const resGetProds = await request(app)
        .get('/v1/catalog/products')
        .set('x-api-key', admin.apiKey);
      expect(resGetProds.status).toBe(200);

      // GET /v1/catalog/products/:id
      const resGetProd = await request(app)
        .get(`/v1/catalog/products/${testProductId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetProd.status).toBe(200);

      // PUT /v1/catalog/products/:id
      const resPutProd = await request(app)
        .put(`/v1/catalog/products/${testProductId}`)
        .set('x-api-key', admin.apiKey)
        .send({ default_price: 180.0 });
      expect(resPutProd.status).toBe(200);

      // DELETE /v1/catalog/products/:id
      const resDelProd = await request(app)
        .delete(`/v1/catalog/products/${testProductId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelProd.status).toBe(200);
    });
  });

  describe('5. Invoicing Module', () => {
    it('should call all Invoicing endpoints', async () => {
      const admin = seedTestAdmin();

      // Seed core Accounts
      const accounts = [
        { id: uuid(), code: '1000', name: 'Cash', type: 'asset', currency: 'USD' },
        { id: uuid(), code: '1200', name: 'AR', type: 'asset', currency: 'USD' },
        { id: uuid(), code: '4000', name: 'Revenue', type: 'revenue', currency: 'USD' }
      ];
      for (const a of accounts) {
        db.prepare("INSERT OR IGNORE INTO accounts (id, code, name, type, currency) VALUES (?, ?, ?, ?, ?)").run(a.id, a.code, a.name, a.type, a.currency);
      }

      // Seed client & product
      const client = await request(app)
        .post('/v1/crm/clients')
        .set('x-api-key', admin.apiKey)
        .send({ type: 'b2c', name: 'Invoice Client' });
      const testClientId = client.body.id;

      const tax = await request(app)
        .post('/v1/catalog/tax-rates')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Tax 5', rate: 0.05 });
      
      const product = await request(app)
        .post('/v1/catalog/products')
        .set('x-api-key', admin.apiKey)
        .send({ sku: 'INV-TEST', name: 'Billable Product', type: 'subscription', default_price: 100.0, billing_interval: 'monthly', tax_rate_id: tax.body.id });
      const testProductId = product.body.id;

      // POST /v1/invoicing/invoices
      const resInvoice = await request(app)
        .post('/v1/invoicing/invoices')
        .set('x-api-key', admin.apiKey)
        .send({
          client_id: testClientId,
          status: 'draft',
          currency: 'USD',
          line_items: [{ product_id: testProductId, quantity: 2.0 }]
        });
      expect(resInvoice.status).toBe(201);
      const testInvoiceId = resInvoice.body.id;

      // GET /v1/invoicing/invoices
      const resGetInvoices = await request(app)
        .get('/v1/invoicing/invoices')
        .set('x-api-key', admin.apiKey);
      expect(resGetInvoices.status).toBe(200);

      // GET /v1/invoicing/invoices/:id
      const resGetInvoice = await request(app)
        .get(`/v1/invoicing/invoices/${testInvoiceId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetInvoice.status).toBe(200);

      // PUT /v1/invoicing/invoices/:id
      const resPutInvoice = await request(app)
        .put(`/v1/invoicing/invoices/${testInvoiceId}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'sent' });
      expect(resPutInvoice.status).toBe(200);

      // POST /v1/invoicing/payments
      const resPayment = await request(app)
        .post('/v1/invoicing/payments')
        .set('x-api-key', admin.apiKey)
        .send({ invoice_id: testInvoiceId, amount: 210.0, payment_method: 'cash' });
      expect(resPayment.status).toBe(201);

      // GET /v1/invoicing/payments
      const resGetPayments = await request(app)
        .get('/v1/invoicing/payments')
        .set('x-api-key', admin.apiKey);
      expect(resGetPayments.status).toBe(200);

      // POST /v1/invoicing/subscriptions
      const resSub = await request(app)
        .post('/v1/invoicing/subscriptions')
        .set('x-api-key', admin.apiKey)
        .send({ client_id: testClientId, product_id: testProductId, start_date: '2026-06-01' });
      expect(resSub.status).toBe(201);
      const testSubscriptionId = resSub.body.id;

      // GET /v1/invoicing/subscriptions
      const resGetSubs = await request(app)
        .get('/v1/invoicing/subscriptions')
        .set('x-api-key', admin.apiKey);
      expect(resGetSubs.status).toBe(200);

      // PUT /v1/invoicing/subscriptions/:id
      const resPutSub = await request(app)
        .put(`/v1/invoicing/subscriptions/${testSubscriptionId}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'paused' });
      expect(resPutSub.status).toBe(200);

      // DELETE /v1/invoicing/subscriptions/:id
      const resDelSub = await request(app)
        .delete(`/v1/invoicing/subscriptions/${testSubscriptionId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelSub.status).toBe(200);

      // DELETE /v1/invoicing/invoices/:id
      const draft = await request(app)
        .post('/v1/invoicing/invoices')
        .set('x-api-key', admin.apiKey)
        .send({ client_id: testClientId, status: 'draft', line_items: [{ product_id: testProductId }] });
      const resDelInvoice = await request(app)
        .delete(`/v1/invoicing/invoices/${draft.body.id}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelInvoice.status).toBe(200);
    });
  });

  describe('6. Accounting Module', () => {
    it('should call all Accounting endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/accounting/accounts
      const resAccount = await request(app)
        .post('/v1/accounting/accounts')
        .set('x-api-key', admin.apiKey)
        .send({ type: 'asset', code: '1020', name: 'Savings Account', currency: 'USD' });
      expect(resAccount.status).toBe(201);
      const testAccountId = resAccount.body.id;

      // GET /v1/accounting/accounts
      const resGetAccounts = await request(app)
        .get('/v1/accounting/accounts')
        .set('x-api-key', admin.apiKey);
      expect(resGetAccounts.status).toBe(200);

      // GET /v1/accounting/accounts/:id
      const resGetAccount = await request(app)
        .get(`/v1/accounting/accounts/${testAccountId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetAccount.status).toBe(200);

      // Seed Cash & AR sub accounts
      const cash = await request(app)
        .post('/v1/accounting/accounts')
        .set('x-api-key', admin.apiKey)
        .send({ type: 'asset', code: '1000', name: 'Cash', currency: 'USD' });
      const ar = await request(app)
        .post('/v1/accounting/accounts')
        .set('x-api-key', admin.apiKey)
        .send({ type: 'asset', code: '1200', name: 'Accounts Receivable', currency: 'USD' });

      // POST /v1/accounting/journal-entries
      const resEntry = await request(app)
        .post('/v1/accounting/journal-entries')
        .set('x-api-key', admin.apiKey)
        .send({
          description: 'Initial balance transfer',
          date: '2026-06-01',
          lines: [
            { account_id: cash.body.id, debit: 500.0, credit: 0.0 },
            { account_id: ar.body.id, debit: 0.0, credit: 500.0 }
          ]
        });
      expect(resEntry.status).toBe(201);
      const testJournalEntryId = resEntry.body.id;

      // GET /v1/accounting/journal-entries
      const resGetEntries = await request(app)
        .get('/v1/accounting/journal-entries')
        .set('x-api-key', admin.apiKey);
      expect(resGetEntries.status).toBe(200);

      // GET /v1/accounting/journal-entries/:id
      const resGetEntry = await request(app)
        .get(`/v1/accounting/journal-entries/${testJournalEntryId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetEntry.status).toBe(200);

      // POST /v1/accounting/journal-entries/:id/reverse
      const resReverse = await request(app)
        .post(`/v1/accounting/journal-entries/${testJournalEntryId}/reverse`)
        .set('x-api-key', admin.apiKey);
      expect(resReverse.status).toBe(200);

      // POST /v1/accounting/periods/close
      const resClose = await request(app)
        .post('/v1/accounting/periods/close')
        .set('x-api-key', admin.apiKey)
        .send({ start_date: '2026-03-01', end_date: '2026-03-31', notes: 'Closing March' });
      expect(resClose.status).toBe(200);

      // GET /v1/accounting/periods
      const resGetPeriods = await request(app)
        .get('/v1/accounting/periods')
        .set('x-api-key', admin.apiKey);
      expect(resGetPeriods.status).toBe(200);

      // GET /v1/accounting/reports/ar-aging
      const resAging = await request(app)
        .get('/v1/accounting/reports/ar-aging')
        .set('x-api-key', admin.apiKey);
      expect(resAging.status).toBe(200);
    });
  });

  describe('7. Inventory Module', () => {
    it('should call all Inventory endpoints', async () => {
      const admin = seedTestAdmin();

      // Seed product
      const product = await request(app)
        .post('/v1/catalog/products')
        .set('x-api-key', admin.apiKey)
        .send({ sku: 'PHYS-XYZ', name: 'Inventory Item', type: 'one_time_product', default_price: 20.0, requires_stock: true });
      const testProductId = product.body.id;

      // GET /v1/inventory/stock
      const resStock = await request(app)
        .get('/v1/inventory/stock')
        .set('x-api-key', admin.apiKey);
      expect(resStock.status).toBe(200);

      // GET /v1/inventory/stock/:productId
      const resGetStock = await request(app)
        .get(`/v1/inventory/stock/${testProductId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetStock.status).toBe(200);

      // POST /v1/inventory/adjustments
      const resAdj = await request(app)
        .post('/v1/inventory/adjustments')
        .set('x-api-key', admin.apiKey)
        .send({ product_id: testProductId, quantity_change: 100.0, reason_code: 'manual_correction' });
      expect(resAdj.status).toBe(201);

      // GET /v1/inventory/adjustments
      const resGetAdj = await request(app)
        .get('/v1/inventory/adjustments')
        .set('x-api-key', admin.apiKey);
      expect(resGetAdj.status).toBe(200);

      // Test non-admin permissions for stock adjustments
      const seedNonAdmin = (name: string, permissions: string[]) => {
        const id = uuid();
        const apiKey = `erp_test_${crypto.randomBytes(16).toString('hex')}`;
        const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const apiKeyPrefix = apiKey.substring(0, 8);

        db.prepare(`
          INSERT INTO assistants (id, name, api_key_hash, api_key_prefix, is_admin)
          VALUES (?, ?, ?, ?, 0)
        `).run(id, name, apiKeyHash, apiKeyPrefix);

        const insertPerm = db.prepare(`
          INSERT INTO assistant_permissions (id, assistant_id, permission)
          VALUES (?, ?, ?)
        `);
        for (const perm of permissions) {
          insertPerm.run(uuid(), id, perm);
        }

        return { id, apiKey };
      };

      const inventoryUser = seedNonAdmin('Inventory Bot', ['read:inventory', 'write:inventory']);

      // 1. Post stock adjustment as non-admin with write:inventory (should succeed)
      const resAdjNonAdmin = await request(app)
        .post('/v1/inventory/adjustments')
        .set('x-api-key', inventoryUser.apiKey)
        .send({ product_id: testProductId, quantity_change: 50.0, reason_code: 'manual_correction' });
      expect(resAdjNonAdmin.status).toBe(201);

      // 2. Get stock adjustments as non-admin with read:inventory (should succeed)
      const resGetAdjNonAdmin = await request(app)
        .get('/v1/inventory/adjustments')
        .set('x-api-key', inventoryUser.apiKey);
      expect(resGetAdjNonAdmin.status).toBe(200);

      // 3. Get specific product stock details as non-admin with read:inventory (should succeed)
      const resGetStockNonAdmin = await request(app)
        .get(`/v1/inventory/stock/${testProductId}`)
        .set('x-api-key', inventoryUser.apiKey);
      expect(resGetStockNonAdmin.status).toBe(200);

      // POST /v1/inventory/suppliers
      const resSupplier = await request(app)
        .post('/v1/inventory/suppliers')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Primary Supplier', payment_terms: 'NET15' });
      expect(resSupplier.status).toBe(201);
      const testSupplierId = resSupplier.body.id;

      // GET /v1/inventory/suppliers
      const resGetSuppliers = await request(app)
        .get('/v1/inventory/suppliers')
        .set('x-api-key', admin.apiKey);
      expect(resGetSuppliers.status).toBe(200);

      // PUT /v1/inventory/suppliers/:id
      const resPutSupplier = await request(app)
        .put(`/v1/inventory/suppliers/${testSupplierId}`)
        .set('x-api-key', admin.apiKey)
        .send({ payment_terms: 'NET30' });
      expect(resPutSupplier.status).toBe(200);

      // POST /v1/inventory/purchase-orders
      const resPO = await request(app)
        .post('/v1/inventory/purchase-orders')
        .set('x-api-key', admin.apiKey)
        .send({
          supplier_id: testSupplierId,
          line_items: [{ product_id: testProductId, quantity: 20, unit_price: 15.0 }]
        });
      expect(resPO.status).toBe(201);
      const testPOId = resPO.body.id;

      // GET /v1/inventory/purchase-orders
      const resGetPOs = await request(app)
        .get('/v1/inventory/purchase-orders')
        .set('x-api-key', admin.apiKey);
      expect(resGetPOs.status).toBe(200);

      // GET /v1/inventory/purchase-orders/:id
      const resGetPO = await request(app)
        .get(`/v1/inventory/purchase-orders/${testPOId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetPO.status).toBe(200);

      // Seed accounts needed by PO receive
      const assetAcc = db.prepare("SELECT id FROM accounts WHERE code = '1300'").get() as any;
      if (!assetAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '1300', 'Inventory Asset', 'asset', 'USD')").run(uuid());
      }
      const cashAcc = db.prepare("SELECT id FROM accounts WHERE code = '1000'").get() as any;
      if (!cashAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '1000', 'Cash', 'asset', 'USD')").run(uuid());
      }

      // POST /v1/inventory/purchase-orders/:id/receive
      const resRec = await request(app)
        .post(`/v1/inventory/purchase-orders/${testPOId}/receive`)
        .set('x-api-key', admin.apiKey);
      expect(resRec.status).toBe(200);

      // DELETE /v1/inventory/suppliers/:id
      const resDelSupplier = await request(app)
        .delete(`/v1/inventory/suppliers/${testSupplierId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelSupplier.status).toBe(200);
    });
  });

  describe('8. HR Module', () => {
    it('should call all HR endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/hr/employees
      const resEmp = await request(app)
        .post('/v1/hr/employees')
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'EmployeeOne', last_name: 'Corp', start_date: '2026-01-01', employment_type: 'full_time', base_salary: 2000.0, currency: 'USD' });
      expect(resEmp.status).toBe(201);
      const testEmployeeId = resEmp.body.id;

      // GET /v1/hr/employees
      const resGetEmps = await request(app)
        .get('/v1/hr/employees')
        .set('x-api-key', admin.apiKey);
      expect(resGetEmps.status).toBe(200);

      // GET /v1/hr/employees/:id
      const resGetEmp = await request(app)
        .get(`/v1/hr/employees/${testEmployeeId}`)
        .set('x-api-key', admin.apiKey);
      expect(resGetEmp.status).toBe(200);

      // PUT /v1/hr/employees/:id
      const resPutEmp = await request(app)
        .put(`/v1/hr/employees/${testEmployeeId}`)
        .set('x-api-key', admin.apiKey)
        .send({ role: 'Manager' });
      expect(resPutEmp.status).toBe(200);

      // POST /v1/hr/attendance/clock-in
      const resClockIn = await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: testEmployeeId });
      expect(resClockIn.status).toBe(200);

      // POST /v1/hr/attendance/clock-out
      const resClockOut = await request(app)
        .post('/v1/hr/attendance/clock-out')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: testEmployeeId });
      expect(resClockOut.status).toBe(200);

      // GET /v1/hr/attendance
      const resGetAtt = await request(app)
        .get('/v1/hr/attendance')
        .set('x-api-key', admin.apiKey);
      expect(resGetAtt.status).toBe(200);

      // POST /v1/hr/leave-types
      const resLt = await request(app)
        .post('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Sick Leave', annual_entitlement: 10.0 });
      expect(resLt.status).toBe(201);
      const testLeaveTypeId = resLt.body.id;

      // GET /v1/hr/leave-types
      const resGetLts = await request(app)
        .get('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey);
      expect(resGetLts.status).toBe(200);

      // POST /v1/hr/leaves
      const resLeave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: testEmployeeId, leave_type_id: testLeaveTypeId, start_date: '2026-12-01', end_date: '2026-12-03' });
      expect(resLeave.status).toBe(201);
      const testLeaveRequestId = resLeave.body.id;

      // GET /v1/hr/leaves
      const resGetLeaves = await request(app)
        .get('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey);
      expect(resGetLeaves.status).toBe(200);

      // POST /v1/hr/leaves/:id/approve
      // Seed a manager
      const mgr = await request(app)
        .post('/v1/hr/employees')
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'Manager', last_name: 'Boss', start_date: '2025-01-01', employment_type: 'full_time' });
      
      const resApprove = await request(app)
        .post(`/v1/hr/leaves/${testLeaveRequestId}/approve`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgr.body.id });
      expect(resApprove.status).toBe(200);

      // Reject test (requires a new leave request)
      const leave2 = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: testEmployeeId, leave_type_id: testLeaveTypeId, start_date: '2026-12-10', end_date: '2026-12-12' });
      const resReject = await request(app)
        .post(`/v1/hr/leaves/${leave2.body.id}/reject`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgr.body.id });
      expect(resReject.status).toBe(200);

      // POST /v1/hr/payroll/run
      // Seed accounts needed by payroll run event listeners
      const expAcc = db.prepare("SELECT id FROM accounts WHERE code = '5000'").get() as any;
      if (!expAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '5000', 'Payroll Expense', 'expense', 'USD')").run(uuid());
      }
      const cashAcc = db.prepare("SELECT id FROM accounts WHERE code = '1000'").get() as any;
      if (!cashAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '1000', 'Cash', 'asset', 'USD')").run(uuid());
      }
      
      // Update employee status to active to make them eligible for payroll
      await request(app)
        .put(`/v1/hr/employees/${testEmployeeId}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'active' });

      const resPayroll = await request(app)
        .post('/v1/hr/payroll/run')
        .set('x-api-key', admin.apiKey)
        .send({ period_start: '2026-06-01', period_end: '2026-06-30' });
      expect(resPayroll.status).toBe(200);

      // GET /v1/hr/payroll/payslips
      const resGetPayslips = await request(app)
        .get('/v1/hr/payroll/payslips')
        .set('x-api-key', admin.apiKey);
      expect(resGetPayslips.status).toBe(200);

      // POST /v1/hr/performance-reviews
      const resReview = await request(app)
        .post('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: testEmployeeId, reviewer_id: mgr.body.id, review_period: '2026-Q2', rating: 5.0 });
      expect(resReview.status).toBe(201);

      // GET /v1/hr/performance-reviews
      const resGetReviews = await request(app)
        .get('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey);
      expect(resGetReviews.status).toBe(200);

      // DELETE /v1/hr/employees/:id
      const resDelEmp = await request(app)
        .delete(`/v1/hr/employees/${testEmployeeId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDelEmp.status).toBe(200);
    });
  });

  describe('9. Webhooks Module', () => {
    it('should call all Webhooks endpoints', async () => {
      const admin = seedTestAdmin();

      // POST /v1/webhooks
      const resPost = await request(app)
        .post('/v1/webhooks')
        .set('x-api-key', admin.apiKey)
        .send({ url: 'https://example.com/erp-events', eventType: 'invoice.paid' });
      expect(resPost.status).toBe(201);
      const testWebhookId = resPost.body.id;

      // GET /v1/webhooks
      const resGet = await request(app)
        .get('/v1/webhooks')
        .set('x-api-key', admin.apiKey);
      expect(resGet.status).toBe(200);

      // DELETE /v1/webhooks/:id
      const resDel = await request(app)
        .delete(`/v1/webhooks/${testWebhookId}`)
        .set('x-api-key', admin.apiKey);
      expect(resDel.status).toBe(200);
      expect(resDel.body.success).toBe(true);
    });
  });
});
