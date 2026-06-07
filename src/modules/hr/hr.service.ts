import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { encodeCursor, cursorWhereClause } from '../../shared/pagination';
import { eventBus } from '../../shared/eventBus';

export class HrService {
  // ==========================================
  // EMPLOYEES
  // ==========================================

  static createEmployee(input: any) {
    const id = uuid();
    db.prepare(`
      INSERT INTO employees (id, first_name, last_name, email, phone, department, role, start_date, employment_type, status, base_salary, currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding', ?, ?)
    `).run(
      id,
      input.first_name,
      input.last_name,
      input.email || null,
      input.phone || null,
      input.department || null,
      input.role || null,
      input.start_date,
      input.employment_type,
      input.base_salary || 0.0,
      input.currency || 'USD'
    );
    return this.getEmployeeById(id);
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

  static updateEmployee(id: string, input: any) {
    this.getEmployeeById(id);

    const sets: string[] = [];
    const values: any[] = [];

    const fields = ['first_name', 'last_name', 'email', 'phone', 'department', 'role', 'start_date', 'employment_type', 'status', 'base_salary', 'currency'];
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
        UPDATE employees
        SET ${sets.join(', ')}
        WHERE id = ?
      `).run(...values);
    }

    return this.getEmployeeById(id);
  }

  static deleteEmployee(id: string) {
    const result = db.prepare("UPDATE employees SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
    if (result.changes === 0) {
      throw new NotFoundError('Employee', id);
    }
    return { success: true };
  }

  // ==========================================
  // ATTENDANCE
  // ==========================================

  static clockIn(employeeId: string) {
    this.getEmployeeById(employeeId);

    const today = new Date().toISOString().split('T')[0];
    
    // Check if already clocked in today
    const existing = db.prepare(`
      SELECT id, clock_in, clock_out FROM attendance_records
      WHERE employee_id = ? AND date = ?
    `).get(employeeId, today) as any;

    if (existing && !existing.clock_out) {
      throw new ConflictError(`Employee ${employeeId} is already clocked in today.`);
    }

    const id = uuid();
    const nowTime = new Date().toISOString().split('T')[1].substring(0, 8); // HH:MM:SS

    if (existing && existing.clock_out) {
      // Re-clock in is possible if they already clocked out; update or create new? Let's create new.
    }

    db.prepare(`
      INSERT INTO attendance_records (id, employee_id, date, clock_in)
      VALUES (?, ?, ?, ?)
    `).run(id, employeeId, today, nowTime);

    return db.prepare('SELECT * FROM attendance_records WHERE id = ?').get(id);
  }

  static clockOut(employeeId: string) {
    this.getEmployeeById(employeeId);

    const today = new Date().toISOString().split('T')[0];

    // Get active clock in
    const active = db.prepare(`
      SELECT id, clock_in FROM attendance_records
      WHERE employee_id = ? AND date = ? AND clock_out IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(employeeId, today) as any;

    if (!active) {
      throw new ConflictError(`Employee ${employeeId} is not clocked in today, or has already clocked out.`);
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

  static listAttendance(employeeId?: string) {
    if (employeeId) {
      return db.prepare('SELECT * FROM attendance_records WHERE employee_id = ? ORDER BY date DESC').all(employeeId);
    }
    return db.prepare('SELECT * FROM attendance_records ORDER BY date DESC').all();
  }

  // ==========================================
  // LEAVES
  // ==========================================

  static createLeaveRequest(input: any) {
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
    `).run(id, input.employee_id, input.leave_type_id, input.start_date, input.end_date, input.reason || null);

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

    db.prepare(`
      UPDATE leave_requests
      SET status = 'approved', approved_by = ?, updated_at = datetime('now')
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

    db.prepare(`
      UPDATE leave_requests
      SET status = 'rejected', approved_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(rejectedByEmployeeId, id);

    return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  }

  static listLeaves(employeeId?: string) {
    if (employeeId) {
      return db.prepare('SELECT * FROM leave_requests WHERE employee_id = ? ORDER BY start_date DESC').all(employeeId);
    }
    return db.prepare('SELECT * FROM leave_requests ORDER BY start_date DESC').all();
  }

  // ==========================================
  // PAYROLL & RUN
  // ==========================================

  static runPayroll(periodStart: string, periodEnd: string, assistantId: string) {
    return withTransaction(() => {
      // Find all active employees eligible for payroll
      const activeEmployees = db.prepare(`
        SELECT id, base_salary, currency FROM employees
        WHERE status = 'active' AND deleted_at IS NULL
      `).all() as any[];

      if (activeEmployees.length === 0) {
        throw new ConflictError('No active employees found to process payroll.');
      }

      const generatedPayslips: any[] = [];
      let totalPayrollAmount = 0.0;
      let primaryCurrency = 'USD'; // default

      for (const emp of activeEmployees) {
        const salary = emp.base_salary || 0.0;
        const allowances = 0.0;
        const deductions = 0.0; // simplistic deduction rule
        const netPay = salary + allowances - deductions;

        const payslipId = uuid();
        db.prepare(`
          INSERT INTO payslips (id, employee_id, period_start, period_end, base_salary, allowances, deductions, net_pay, currency, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processed')
        `).run(payslipId, emp.id, periodStart, periodEnd, salary, allowances, deductions, netPay, emp.currency);

        totalPayrollAmount += netPay;
        primaryCurrency = emp.currency;

        generatedPayslips.push({
          id: payslipId,
          employee_id: emp.id,
          net_pay: netPay,
          currency: emp.currency
        });
      }

      // Publish event trigger for automated bookkeeping
      eventBus.publish('payroll.processed', 'hr', 'payslips', periodStart, {
        periodStart,
        periodEnd,
        totalAmount: totalPayrollAmount,
        currency: primaryCurrency,
        assistantId
      });

      return {
        processed_count: activeEmployees.length,
        total_payroll: totalPayrollAmount,
        currency: primaryCurrency,
        payslips: generatedPayslips
      };
    });
  }

  static listPayslips(employeeId?: string) {
    if (employeeId) {
      return db.prepare('SELECT * FROM payslips WHERE employee_id = ? ORDER BY period_end DESC').all(employeeId);
    }
    return db.prepare('SELECT * FROM payslips ORDER BY period_end DESC').all();
  }

  // ==========================================
  // PERFORMANCE REVIEWS
  // ==========================================

  static createPerformanceReview(input: any) {
    this.getEmployeeById(input.employee_id);
    this.getEmployeeById(input.reviewer_id);

    const id = uuid();
    db.prepare(`
      INSERT INTO performance_reviews (id, employee_id, reviewer_id, review_period, rating, feedback_notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.employee_id, input.reviewer_id, input.review_period, input.rating, input.feedback_notes || null);

    return db.prepare('SELECT * FROM performance_reviews WHERE id = ?').get(id);
  }

  static listReviews(employeeId?: string) {
    if (employeeId) {
      return db.prepare('SELECT * FROM performance_reviews WHERE employee_id = ? ORDER BY created_at DESC').all(employeeId);
    }
    return db.prepare('SELECT * FROM performance_reviews ORDER BY created_at DESC').all();
  }

  static createLeaveType(input: any) {
    const id = uuid();
    db.prepare(`
      INSERT INTO leave_types (id, name, description, annual_entitlement, requires_approval)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name, input.description || null, input.annual_entitlement || 0.0, input.requires_approval ? 1 : 0);
    return db.prepare('SELECT * FROM leave_types WHERE id = ?').get(id);
  }

  static listLeaveTypes() {
    return db.prepare('SELECT * FROM leave_types ORDER BY name ASC').all();
  }
}
