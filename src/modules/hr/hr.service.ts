import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { eventBus } from '../../shared/eventBus';
import type {
  CreateEmployeeInput,
  UpdateEmployeeInput,
  ClockInput,
  LeaveRequestInput,
  LeaveTypeInput,
  PerformanceReviewInput,
} from './hr.routes';

// Frozen field allowlists for dynamic UPDATE queries (#2 — prevent SQL injection surface)
const EMPLOYEE_UPDATABLE_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'department', 'role',
  'start_date', 'employment_type', 'status', 'base_salary', 'currency',
  'date_of_birth', 'end_date', 'address', 'salary_period',
] as const;

export class HrService {
  // ==========================================
  // EMPLOYEES
  // ==========================================

  static createEmployee(input: CreateEmployeeInput) {
    return withTransaction(() => {
      const id = uuid();
      db.prepare(`
        INSERT INTO employees (id, first_name, last_name, email, phone, department, role, date_of_birth, address, start_date, employment_type, status, base_salary, currency, salary_period)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding', ?, ?, ?)
      `).run(
        id,
        input.first_name,
        input.last_name,
        input.email ?? null,
        input.phone ?? null,
        input.department ?? null,
        input.role ?? null,
        input.date_of_birth ?? null,
        input.address ?? null,
        input.start_date,
        input.employment_type,
        input.base_salary ?? 0.0,
        input.currency ?? 'USD',
        input.salary_period ?? 'Monthly'
      );

      // Populate initial salary history
      const salary = input.base_salary ?? 0.0;
      const currency = input.currency ?? 'USD';
      const historyId = uuid();
      db.prepare(`
        INSERT INTO salary_history (id, employee_id, effective_date, amount, currency, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(historyId, id, input.start_date, salary, currency, 'initial');

      return this.getEmployeeById(id);
    });
  }

  static listEmployees(query: { cursor?: string; limit?: number; includeDeleted?: boolean }) {
    const limit = query.limit ?? 25;
    const cursor = query.cursor;
    const { clause, params } = cursorWhereClause(cursor);

    const softDeleteClause = query.includeDeleted ? '' : 'AND deleted_at IS NULL';

    const rows = db.prepare(`
      SELECT * FROM employees
      WHERE 1=1 ${softDeleteClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...params, limit + 1) as any[];

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

  static getEmployeeById(id: string) {
    const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!row) {
      throw new NotFoundError('Employee', id);
    }
    return row;
  }

  static updateEmployee(id: string, input: UpdateEmployeeInput) {
    return withTransaction(() => {
      const existing = this.getEmployeeById(id) as any;

      const sets: string[] = [];
      const values: any[] = [];

      for (const field of EMPLOYEE_UPDATABLE_FIELDS) {
        if (input[field] !== undefined) {
          sets.push(`${field} = ?`);
          values.push(input[field]);
        }
      }

      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')");
        values.push(id);
        db.prepare(`
          UPDATE employees
          SET ${sets.join(', ')}
          WHERE id = ?
        `).run(...values);
      }

      // Check if salary or currency has changed compared to current values in DB
      const currentSalary = existing.base_salary;
      const currentCurrency = existing.currency;

      const newSalary = input.base_salary !== undefined ? input.base_salary : currentSalary;
      const newCurrency = input.currency !== undefined ? input.currency : currentCurrency;

      const salaryChanged = (input.base_salary !== undefined && input.base_salary !== currentSalary) ||
                            (input.currency !== undefined && input.currency !== currentCurrency);

      if (salaryChanged) {
        const today = new Date().toISOString().split('T')[0];
        const historyId = uuid();
        db.prepare(`
          INSERT INTO salary_history (id, employee_id, effective_date, amount, currency, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(historyId, id, today, newSalary, newCurrency, 'update');
      }

      return this.getEmployeeById(id);
    });
  }

  static deleteEmployee(id: string) {
    const result = db.prepare("UPDATE employees SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Employee', id);
    }
    return { success: true };
  }

  static getSalaryHistory(employeeId: string) {
    this.getEmployeeById(employeeId);
    return db.prepare(`
      SELECT * FROM salary_history
      WHERE employee_id = ?
      ORDER BY effective_date DESC, created_at DESC
    `).all(employeeId);
  }

  // ==========================================
  // ATTENDANCE
  // ==========================================

  static clockIn(employeeId: string, date?: string) {
    this.getEmployeeById(employeeId);

    // Use client-provided date to avoid timezone issues (#5), fall back to server UTC
    const today = date ?? new Date().toISOString().split('T')[0];
    
    // Check if already clocked in today
    const existing = db.prepare(`
      SELECT id, clock_in, clock_out FROM attendance_records
      WHERE employee_id = ? AND date = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(employeeId, today) as any;

    if (existing && !existing.clock_out) {
      throw new ConflictError(`Employee ${employeeId} is already clocked in for ${today}.`);
    }

    const id = uuid();
    const nowTime = new Date().toISOString().split('T')[1].substring(0, 8); // HH:MM:SS

    db.prepare(`
      INSERT INTO attendance_records (id, employee_id, date, clock_in)
      VALUES (?, ?, ?, ?)
    `).run(id, employeeId, today, nowTime);

    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  }

  static clockOut(employeeId: string, date?: string) {
    this.getEmployeeById(employeeId);

    // Use client-provided date to avoid timezone issues (#5), fall back to server UTC
    const today = date ?? new Date().toISOString().split('T')[0];

    // Get active clock in
    const active = db.prepare(`
      SELECT id, clock_in FROM attendance_records
      WHERE employee_id = ? AND date = ? AND clock_out IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(employeeId, today) as any;

    if (!active) {
      throw new ConflictError(`Employee ${employeeId} is not clocked in for ${today}, or has already clocked out.`);
    }

    const clockOutTime = new Date().toISOString().split('T')[1].substring(0, 8); // HH:MM:SS

    // Calculate hours worked
    const parseTime = (timeStr: string) => {
      const [h, m, s] = timeStr.split(':').map(Number);
      return h + m / 60 + s / 3600;
    };
    
    const hours = parseTime(clockOutTime) - parseTime(active.clock_in);
    const hoursWorked = Math.max(0, Number(hours.toFixed(2)));

    db.prepare(`
      UPDATE attendance_records
      SET clock_out = ?, hours_worked = ?
      WHERE id = ?
    `).run(clockOutTime, hoursWorked, active.id);

    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(active.id);
  }

  static listAttendance(query: { employee_id?: string; cursor?: string; limit?: number }) {
    const limit = query.limit ?? 25;
    const { clause, params } = cursorWhereClause(query.cursor);

    const employeeClause = query.employee_id ? 'AND employee_id = ?' : '';
    const employeeParams = query.employee_id ? [query.employee_id] : [];

    const rows = db.prepare(`
      SELECT * FROM attendance_records
      WHERE 1=1 ${employeeClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...employeeParams, ...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  // ==========================================
  // LEAVES
  // ==========================================

  static createLeaveRequest(input: LeaveRequestInput) {
    this.getEmployeeById(input.employee_id);

    // Verify leave type
    const lt = db.prepare('SELECT id FROM leave_types WHERE id = ?').get(input.leave_type_id);
    if (!lt) {
      throw new NotFoundError('LeaveType', input.leave_type_id);
    }

    const id = uuid();
    db.prepare(`
      INSERT INTO leave_requests (id, employee_id, leave_type_id, start_date, end_date, status, reason)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, input.employee_id, input.leave_type_id, input.start_date, input.end_date, input.reason ?? null);

    return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  }

  static approveLeaveRequest(id: string, approvedByEmployeeId: string) {
    this.getEmployeeById(approvedByEmployeeId);

    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!request) {
      throw new NotFoundError('LeaveRequest', id);
    }
    if (request.status !== 'pending') {
      throw new ConflictError(`Leave request is already ${request.status}.`);
    }

    // Prevent self-approval (#7)
    if (request.employee_id === approvedByEmployeeId) {
      throw new ConflictError('Cannot approve your own leave request.');
    }

    db.prepare(`
      UPDATE leave_requests
      SET status = 'approved', actioned_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(approvedByEmployeeId, id);

    return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  }

  static rejectLeaveRequest(id: string, rejectedByEmployeeId: string) {
    this.getEmployeeById(rejectedByEmployeeId);

    const request = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id) as any;
    if (!request) {
      throw new NotFoundError('LeaveRequest', id);
    }
    if (request.status !== 'pending') {
      throw new ConflictError(`Leave request is already ${request.status}.`);
    }

    // Prevent self-rejection (#7)
    if (request.employee_id === rejectedByEmployeeId) {
      throw new ConflictError('Cannot reject your own leave request.');
    }

    db.prepare(`
      UPDATE leave_requests
      SET status = 'rejected', actioned_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(rejectedByEmployeeId, id);

    return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  }

  static listLeaves(query: { employee_id?: string; cursor?: string; limit?: number }) {
    const limit = query.limit ?? 25;
    const { clause, params } = cursorWhereClause(query.cursor);

    const employeeClause = query.employee_id ? 'AND employee_id = ?' : '';
    const employeeParams = query.employee_id ? [query.employee_id] : [];

    const rows = db.prepare(`
      SELECT * FROM leave_requests
      WHERE 1=1 ${employeeClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...employeeParams, ...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  // ==========================================
  // PAYROLL & RUN
  // ==========================================

  static runPayroll(periodStart: string, periodEnd: string, assistantId: string) {
    return withTransaction(() => {
      // Guard against duplicate payroll runs for the same period (#3)
      const existingPayslips = db.prepare(`
        SELECT COUNT(*) as count FROM payslips
        WHERE period_start = ? AND period_end = ?
      `).get(periodStart, periodEnd) as any;

      if (existingPayslips.count > 0) {
        throw new ConflictError(`Payroll has already been processed for period ${periodStart} to ${periodEnd}. Found ${existingPayslips.count} existing payslip(s).`);
      }

      // Find all active employees eligible for payroll
      const activeEmployees = db.prepare(`
        SELECT id, base_salary, currency FROM employees
        WHERE status = 'active' AND deleted_at IS NULL
      `).all() as any[];

      if (activeEmployees.length === 0) {
        throw new ConflictError('No active employees found to process payroll.');
      }

      // Group payroll by currency to avoid mixed-currency arithmetic (#11)
      const byCurrency: Record<string, { total: number; payslips: any[] }> = {};

      for (const emp of activeEmployees) {
        const salary = emp.base_salary ?? 0.0;
        const allowances = 0.0;
        const deductions = 0.0;
        const netPay = salary + allowances - deductions;
        const currency = emp.currency ?? 'USD';

        const payslipId = uuid();
        db.prepare(`
          INSERT INTO payslips (id, employee_id, period_start, period_end, base_salary, allowances, deductions, net_pay, currency, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed')
        `).run(payslipId, emp.id, periodStart, periodEnd, salary, allowances, deductions, netPay, currency);

        if (!byCurrency[currency]) {
          byCurrency[currency] = { total: 0, payslips: [] };
        }
        byCurrency[currency].total += netPay;
        byCurrency[currency].payslips.push({
          id: payslipId,
          employee_id: emp.id,
          net_pay: netPay,
          currency,
        });
      }

      // Build per-currency totals for the response
      const currencyTotals = Object.entries(byCurrency).map(([currency, data]) => ({
        currency,
        total: data.total,
        employee_count: data.payslips.length,
      }));

      // Flatten all payslips for backward-compatible response
      const allPayslips = Object.values(byCurrency).flatMap(d => d.payslips);

      // Use the primary currency (most employees) for the event
      const primaryCurrency = currencyTotals.sort((a, b) => b.employee_count - a.employee_count)[0]?.currency ?? 'USD';
      const totalPayrollAmount = byCurrency[primaryCurrency]?.total ?? 0;

      // Publish event trigger for automated bookkeeping
      eventBus.publish('payroll.processed', 'hr', 'payslips', periodStart, {
        periodStart,
        periodEnd,
        totalAmount: totalPayrollAmount,
        currency: primaryCurrency,
        currencyTotals,
        assistantId
      });

      return {
        processed_count: activeEmployees.length,
        total_payroll: totalPayrollAmount,
        currency: primaryCurrency,
        currency_totals: currencyTotals,
        payslips: allPayslips,
      };
    });
  }

  static listPayslips(query: { employee_id?: string; cursor?: string; limit?: number }) {
    const limit = query.limit ?? 25;
    const { clause, params } = cursorWhereClause(query.cursor);

    const employeeClause = query.employee_id ? 'AND employee_id = ?' : '';
    const employeeParams = query.employee_id ? [query.employee_id] : [];

    const rows = db.prepare(`
      SELECT * FROM payslips
      WHERE 1=1 ${employeeClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...employeeParams, ...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  // ==========================================
  // PERFORMANCE REVIEWS
  // ==========================================

  static createPerformanceReview(input: PerformanceReviewInput) {
    this.getEmployeeById(input.employee_id);
    this.getEmployeeById(input.reviewer_id);

    const id = uuid();
    db.prepare(`
      INSERT INTO performance_reviews (id, employee_id, reviewer_id, review_period, rating, feedback_notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.employee_id, input.reviewer_id, input.review_period, input.rating, input.feedback_notes ?? null);

    return db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id);
  }

  static listReviews(query: { employee_id?: string; cursor?: string; limit?: number }) {
    const limit = query.limit ?? 25;
    const { clause, params } = cursorWhereClause(query.cursor);

    const employeeClause = query.employee_id ? 'AND employee_id = ?' : '';
    const employeeParams = query.employee_id ? [query.employee_id] : [];

    const rows = db.prepare(`
      SELECT * FROM performance_reviews
      WHERE 1=1 ${employeeClause} ${clause}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...employeeParams, ...params, limit + 1) as any[];

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? encodeCursor(data[data.length - 1].created_at, data[data.length - 1].id)
      : null;

    return {
      data,
      meta: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  // ==========================================
  // LEAVE TYPES
  // ==========================================

  static createLeaveType(input: LeaveTypeInput) {
    const id = uuid();
    db.prepare(`
      INSERT INTO leave_types (id, name, description, annual_entitlement, requires_approval)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name, input.description ?? null, input.annual_entitlement ?? 0.0, input.requires_approval ? 1 : 0);
    return db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id);
  }

  static listLeaveTypes() {
    return db.prepare('SELECT * FROM leave_types ORDER BY name ASC').all();
  }
}
