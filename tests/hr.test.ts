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

function seedNonAdmin(name: string, permissions: string[]) {
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
}

async function createEmployee(apiKey: string, overrides: Record<string, any> = {}) {
  const defaults = {
    first_name: 'John',
    last_name: 'Doe',
    start_date: '2026-01-01',
    employment_type: 'full_time' as const,
    base_salary: 3000.0,
    currency: 'USD',
  };
  const res = await request(app)
    .post('/v1/hr/employees')
    .set('x-api-key', apiKey)
    .send({ ...defaults, ...overrides });
  return res;
}

describe('HR Module', () => {

  // ==========================================
  // EMPLOYEE CRUD
  // ==========================================

  describe('Employee CRUD', () => {
    it('should create an employee with valid data', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey);
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.first_name).toBe('John');
      expect(res.body.status).toBe('onboarding');
      expect(res.body.base_salary).toBe(3000.0);
      expect(res.body.currency).toBe('USD');
    });

    it('should reject creation with missing required fields', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .post('/v1/hr/employees')
        .set('x-api-key', admin.apiKey)
        .send({ first_name: 'Only' }); // missing last_name, start_date, employment_type
      expect(res.status).toBe(422);
    });

    it('should reject invalid employment_type', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, { employment_type: 'intern' });
      expect(res.status).toBe(422);
    });

    it('should reject invalid start_date format', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, { start_date: '01-01-2026' });
      expect(res.status).toBe(422);
    });

    it('should reject invalid email format', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, { email: 'not-an-email' });
      expect(res.status).toBe(422);
    });

    it('should create employee with base_salary of 0 (not coerced)', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, { base_salary: 0 });
      expect(res.status).toBe(201);
      expect(res.body.base_salary).toBe(0);
    });

    it('should list employees with pagination', async () => {
      const admin = seedTestAdmin();
      await createEmployee(admin.apiKey, { first_name: 'A' });
      await createEmployee(admin.apiKey, { first_name: 'B' });
      await createEmployee(admin.apiKey, { first_name: 'C' });

      const page1 = await request(app)
        .get('/v1/hr/employees?limit=2')
        .set('x-api-key', admin.apiKey);
      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.has_more).toBe(true);
      expect(page1.body.meta.next_cursor).toBeDefined();

      const page2 = await request(app)
        .get(`/v1/hr/employees?limit=2&cursor=${page1.body.meta.next_cursor}`)
        .set('x-api-key', admin.apiKey);
      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
      expect(page2.body.meta.has_more).toBe(false);
    });

    it('should get employee by ID', async () => {
      const admin = seedTestAdmin();
      const created = await createEmployee(admin.apiKey);
      const res = await request(app)
        .get(`/v1/hr/employees/${created.body.id}`)
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.body.id);
    });

    it('should return 404 for non-existent employee', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .get(`/v1/hr/employees/${uuid()}`)
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(404);
    });

    it('should update employee fields', async () => {
      const admin = seedTestAdmin();
      const created = await createEmployee(admin.apiKey);
      const res = await request(app)
        .put(`/v1/hr/employees/${created.body.id}`)
        .set('x-api-key', admin.apiKey)
        .send({ role: 'Manager', status: 'active' });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Manager');
      expect(res.body.status).toBe('active');
    });

    it('should support date_of_birth, end_date, address, and salary_period', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, {
        date_of_birth: '1990-05-15',
        address: '123 Main St, Anytown',
      });
      expect(res.status).toBe(201);
      expect(res.body.date_of_birth).toBe('1990-05-15');
      expect(res.body.address).toBe('123 Main St, Anytown');
      expect(res.body.salary_period).toBe('Monthly');

      // Update end_date and address
      const updateRes = await request(app)
        .put(`/v1/hr/employees/${res.body.id}`)
        .set('x-api-key', admin.apiKey)
        .send({
          end_date: '2026-12-31',
          address: '456 Oak St, Anytown',
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.end_date).toBe('2026-12-31');
      expect(updateRes.body.address).toBe('456 Oak St, Anytown');
    });

    it('should track salary history changes', async () => {
      const admin = seedTestAdmin();
      const res = await createEmployee(admin.apiKey, {
        base_salary: 3000.0,
        currency: 'USD',
      });
      expect(res.status).toBe(201);
      
      const empId = res.body.id;

      // Verify initial salary history is created
      const hist1 = await request(app)
        .get(`/v1/hr/employees/${empId}/salary-history`)
        .set('x-api-key', admin.apiKey);
      expect(hist1.status).toBe(200);
      expect(hist1.body.length).toBe(1);
      expect(hist1.body[0].amount).toBe(3000.0);
      expect(hist1.body[0].currency).toBe('USD');
      expect(hist1.body[0].reason).toBe('initial');

      // Update salary
      const updateRes = await request(app)
        .put(`/v1/hr/employees/${empId}`)
        .set('x-api-key', admin.apiKey)
        .send({ base_salary: 3500.0 });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.base_salary).toBe(3500.0);

      // Verify updated salary history is created
      const hist2 = await request(app)
        .get(`/v1/hr/employees/${empId}/salary-history`)
        .set('x-api-key', admin.apiKey);
      expect(hist2.status).toBe(200);
      expect(hist2.body.length).toBe(2);
      expect(hist2.body[0].amount).toBe(3500.0);
      expect(hist2.body[0].currency).toBe('USD');
      expect(hist2.body[0].reason).toBe('update');
      
      expect(hist2.body[1].amount).toBe(3000.0);
      expect(hist2.body[1].reason).toBe('initial');
    });

    it('should soft-delete an employee', async () => {
      const admin = seedTestAdmin();
      const created = await createEmployee(admin.apiKey);
      const res = await request(app)
        .delete(`/v1/hr/employees/${created.body.id}`)
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Should not appear in normal list
      const list = await request(app)
        .get('/v1/hr/employees')
        .set('x-api-key', admin.apiKey);
      expect(list.body.data.length).toBe(0);
    });

    it('should return 404 when deleting non-existent employee', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .delete(`/v1/hr/employees/${uuid()}`)
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(404);
    });

    it('should return 404 when double-deleting an employee', async () => {
      const admin = seedTestAdmin();
      const created = await createEmployee(admin.apiKey);
      await request(app)
        .delete(`/v1/hr/employees/${created.body.id}`)
        .set('x-api-key', admin.apiKey);
      const res = await request(app)
        .delete(`/v1/hr/employees/${created.body.id}`)
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // ATTENDANCE
  // ==========================================

  describe('Attendance', () => {
    it('should clock in and clock out', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);

      const clockIn = await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id });
      expect(clockIn.status).toBe(200);
      expect(clockIn.body.clock_in).toBeDefined();
      expect(clockIn.body.clock_out).toBeNull();

      const clockOut = await request(app)
        .post('/v1/hr/attendance/clock-out')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id });
      expect(clockOut.status).toBe(200);
      expect(clockOut.body.clock_out).toBeDefined();
      expect(clockOut.body.hours_worked).toBeGreaterThanOrEqual(0);
    });

    it('should accept an explicit date for clock-in', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);

      const res = await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id, date: '2026-06-15' });
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2026-06-15');
    });

    it('should reject duplicate clock-in for the same day', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);

      await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id, date: '2026-06-15' });

      const duplicate = await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id, date: '2026-06-15' });
      expect(duplicate.status).toBe(409);
    });

    it('should reject clock-out when not clocked in', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);

      const res = await request(app)
        .post('/v1/hr/attendance/clock-out')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id });
      expect(res.status).toBe(409);
    });

    it('should reject clock-in for non-existent employee', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .post('/v1/hr/attendance/clock-in')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: uuid() });
      expect(res.status).toBe(404);
    });

    it('should list attendance with pagination', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);

      // Create multiple attendance records on different days
      for (let i = 1; i <= 3; i++) {
        const day = String(i).padStart(2, '0');
        await request(app)
          .post('/v1/hr/attendance/clock-in')
          .set('x-api-key', admin.apiKey)
          .send({ employee_id: emp.body.id, date: `2026-06-${day}` });
        await request(app)
          .post('/v1/hr/attendance/clock-out')
          .set('x-api-key', admin.apiKey)
          .send({ employee_id: emp.body.id, date: `2026-06-${day}` });
      }

      const res = await request(app)
        .get('/v1/hr/attendance?limit=2')
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.has_more).toBe(true);
    });
  });

  // ==========================================
  // LEAVE MANAGEMENT
  // ==========================================

  describe('Leave Management', () => {
    async function createLeaveFixture(apiKey: string) {
      const emp = await createEmployee(apiKey);
      const mgr = await createEmployee(apiKey, { first_name: 'Manager', last_name: 'Boss' });
      const lt = await request(app)
        .post('/v1/hr/leave-types')
        .set('x-api-key', apiKey)
        .send({ name: 'Annual Leave', annual_entitlement: 20 });
      return { empId: emp.body.id, mgrId: mgr.body.id, leaveTypeId: lt.body.id };
    }

    it('should create and list leave types', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .post('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Sick Leave', annual_entitlement: 10, requires_approval: true });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Sick Leave');

      const list = await request(app)
        .get('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey);
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should create a leave request', async () => {
      const admin = seedTestAdmin();
      const { empId, leaveTypeId } = await createLeaveFixture(admin.apiKey);

      const res = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({
          employee_id: empId,
          leave_type_id: leaveTypeId,
          start_date: '2026-12-01',
          end_date: '2026-12-05',
          reason: 'Holiday',
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
    });

    it('should reject leave request with invalid leave type', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);
      const res = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({
          employee_id: emp.body.id,
          leave_type_id: uuid(),
          start_date: '2026-12-01',
          end_date: '2026-12-05',
        });
      expect(res.status).toBe(404);
    });

    it('should approve a leave request', async () => {
      const admin = seedTestAdmin();
      const { empId, mgrId, leaveTypeId } = await createLeaveFixture(admin.apiKey);

      const leave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: empId, leave_type_id: leaveTypeId, start_date: '2026-12-01', end_date: '2026-12-03' });

      const res = await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/approve`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgrId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
    });

    it('should reject a leave request', async () => {
      const admin = seedTestAdmin();
      const { empId, mgrId, leaveTypeId } = await createLeaveFixture(admin.apiKey);

      const leave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: empId, leave_type_id: leaveTypeId, start_date: '2026-12-10', end_date: '2026-12-12' });

      const res = await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/reject`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgrId });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('rejected');
    });

    it('should prevent self-approval (#7)', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);
      const lt = await request(app)
        .post('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Self Leave', annual_entitlement: 5 });

      const leave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id, leave_type_id: lt.body.id, start_date: '2026-12-01', end_date: '2026-12-02' });

      const res = await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/approve`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: emp.body.id }); // same employee!
      expect(res.status).toBe(409);
    });

    it('should prevent self-rejection (#7)', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);
      const lt = await request(app)
        .post('/v1/hr/leave-types')
        .set('x-api-key', admin.apiKey)
        .send({ name: 'Self Leave 2', annual_entitlement: 5 });

      const leave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: emp.body.id, leave_type_id: lt.body.id, start_date: '2026-12-01', end_date: '2026-12-02' });

      const res = await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/reject`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: emp.body.id });
      expect(res.status).toBe(409);
    });

    it('should prevent double-approval (409 conflict)', async () => {
      const admin = seedTestAdmin();
      const { empId, mgrId, leaveTypeId } = await createLeaveFixture(admin.apiKey);

      const leave = await request(app)
        .post('/v1/hr/leaves')
        .set('x-api-key', admin.apiKey)
        .send({ employee_id: empId, leave_type_id: leaveTypeId, start_date: '2026-12-01', end_date: '2026-12-03' });

      await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/approve`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgrId });

      const res = await request(app)
        .post(`/v1/hr/leaves/${leave.body.id}/approve`)
        .set('x-api-key', admin.apiKey)
        .send({ manager_id: mgrId });
      expect(res.status).toBe(409);
    });

    it('should list leaves with pagination', async () => {
      const admin = seedTestAdmin();
      const { empId, leaveTypeId } = await createLeaveFixture(admin.apiKey);

      for (let i = 1; i <= 3; i++) {
        const day = String(i * 5).padStart(2, '0');
        await request(app)
          .post('/v1/hr/leaves')
          .set('x-api-key', admin.apiKey)
          .send({ employee_id: empId, leave_type_id: leaveTypeId, start_date: `2026-12-${day}`, end_date: `2026-12-${day}` });
      }

      const res = await request(app)
        .get('/v1/hr/leaves?limit=2')
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.has_more).toBe(true);
    });
  });

  // ==========================================
  // PAYROLL
  // ==========================================

  describe('Payroll', () => {
    it('should run payroll for active employees', async () => {
      const admin = seedTestAdmin();

      // Seed payroll expense and cash accounts
      const expAcc = db.prepare("SELECT id FROM accounts WHERE code = '5000'").get() as any;
      if (!expAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '5000', 'Payroll Expense', 'expense', 'USD')").run(uuid());
      }
      const cashAcc = db.prepare("SELECT id FROM accounts WHERE code = '1000'").get() as any;
      if (!cashAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '1000', 'Cash', 'asset', 'USD')").run(uuid());
      }

      const emp = await createEmployee(admin.apiKey, { base_salary: 5000 });
      // Activate employee
      await request(app)
        .put(`/v1/hr/employees/${emp.body.id}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'active' });

      const res = await request(app)
        .post('/v1/hr/payroll/run')
        .set('x-api-key', admin.apiKey)
        .send({ period_start: '2026-06-01', period_end: '2026-06-30' });

      expect(res.status).toBe(200);
      expect(res.body.processed_count).toBe(1);
      expect(res.body.payslips.length).toBe(1);
      expect(res.body.payslips[0].net_pay).toBe(5000);
      expect(res.body.currency_totals).toBeDefined();
    });

    it('should prevent duplicate payroll runs (#3)', async () => {
      const admin = seedTestAdmin();

      const emp = await createEmployee(admin.apiKey, { base_salary: 3000 });
      await request(app)
        .put(`/v1/hr/employees/${emp.body.id}`)
        .set('x-api-key', admin.apiKey)
        .send({ status: 'active' });

      // Seed accounts
      const expAcc = db.prepare("SELECT id FROM accounts WHERE code = '5000'").get() as any;
      if (!expAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '5000', 'Payroll Expense', 'expense', 'USD')").run(uuid());
      }
      const cashAcc = db.prepare("SELECT id FROM accounts WHERE code = '1000'").get() as any;
      if (!cashAcc) {
        db.prepare("INSERT INTO accounts (id, code, name, type, currency) VALUES (?, '1000', 'Cash', 'asset', 'USD')").run(uuid());
      }

      await request(app)
        .post('/v1/hr/payroll/run')
        .set('x-api-key', admin.apiKey)
        .send({ period_start: '2026-07-01', period_end: '2026-07-31' });

      const dup = await request(app)
        .post('/v1/hr/payroll/run')
        .set('x-api-key', admin.apiKey)
        .send({ period_start: '2026-07-01', period_end: '2026-07-31' });
      expect(dup.status).toBe(409);
    });

    it('should return 409 when no active employees exist', async () => {
      const admin = seedTestAdmin();
      // Create employee but don't activate
      await createEmployee(admin.apiKey);

      const res = await request(app)
        .post('/v1/hr/payroll/run')
        .set('x-api-key', admin.apiKey)
        .send({ period_start: '2026-08-01', period_end: '2026-08-31' });
      expect(res.status).toBe(409);
    });

    it('should list payslips with pagination', async () => {
      const admin = seedTestAdmin();
      const res = await request(app)
        .get('/v1/hr/payroll/payslips')
        .set('x-api-key', admin.apiKey);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.meta).toBeDefined();
    });
  });

  // ==========================================
  // PERFORMANCE REVIEWS
  // ==========================================

  describe('Performance Reviews', () => {
    it('should create and list performance reviews', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);
      const reviewer = await createEmployee(admin.apiKey, { first_name: 'Reviewer' });

      const res = await request(app)
        .post('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey)
        .send({
          employee_id: emp.body.id,
          reviewer_id: reviewer.body.id,
          review_period: '2026-Q2',
          rating: 4.5,
          feedback_notes: 'Great work!',
        });
      expect(res.status).toBe(201);
      expect(res.body.rating).toBe(4.5);

      const list = await request(app)
        .get('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBe(1);
    });

    it('should reject rating out of range', async () => {
      const admin = seedTestAdmin();
      const emp = await createEmployee(admin.apiKey);
      const reviewer = await createEmployee(admin.apiKey, { first_name: 'Reviewer' });

      const res = await request(app)
        .post('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey)
        .send({
          employee_id: emp.body.id,
          reviewer_id: reviewer.body.id,
          review_period: '2026-Q2',
          rating: 6.0, // exceeds max of 5
        });
      expect(res.status).toBe(422);
    });

    it('should return 404 for non-existent employee in review', async () => {
      const admin = seedTestAdmin();
      const reviewer = await createEmployee(admin.apiKey, { first_name: 'Reviewer' });

      const res = await request(app)
        .post('/v1/hr/performance-reviews')
        .set('x-api-key', admin.apiKey)
        .send({
          employee_id: uuid(),
          reviewer_id: reviewer.body.id,
          review_period: '2026-Q2',
          rating: 3.0,
        });
      expect(res.status).toBe(404);
    });
  });

  // ==========================================
  // PERMISSION ENFORCEMENT
  // ==========================================

  describe('Permission Enforcement', () => {
    it('should deny access without correct permissions', async () => {
      const user = seedNonAdmin('HR Read Only', ['read:employees']);

      const res = await request(app)
        .post('/v1/hr/employees')
        .set('x-api-key', user.apiKey)
        .send({ first_name: 'Blocked', last_name: 'User', start_date: '2026-01-01', employment_type: 'full_time' });
      expect(res.status).toBe(403);
    });

    it('should allow access with correct permissions', async () => {
      const user = seedNonAdmin('HR Writer', ['write:employees', 'read:employees']);

      const res = await request(app)
        .post('/v1/hr/employees')
        .set('x-api-key', user.apiKey)
        .send({ first_name: 'Allowed', last_name: 'User', start_date: '2026-01-01', employment_type: 'full_time' });
      expect(res.status).toBe(201);
    });

    it('should deny include_deleted without read:deleted permission', async () => {
      const user = seedNonAdmin('HR Basic', ['read:employees']);

      const res = await request(app)
        .get('/v1/hr/employees?include_deleted=true')
        .set('x-api-key', user.apiKey);
      expect(res.status).toBe(403);
    });
  });
});
