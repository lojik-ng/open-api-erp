import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HrService } from './hr.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';
import { ForbiddenError } from '../../shared/errors';

export const hrRouter = Router();

// ==========================================
// Zod Validation Schemas
// ==========================================

const CreateEmployeeSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  address: z.string().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  employment_type: z.enum(['full_time', 'part_time', 'contractor']),
  base_salary: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  salary_period: z.literal('Monthly').optional().default('Monthly'),
});

const UpdateEmployeeSchema = CreateEmployeeSchema.partial().extend({
  status: z.enum(['onboarding', 'active', 'on_leave', 'terminated']).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

const ClockSchema = z.object({
  employee_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

const LeaveRequestSchema = z.object({
  employee_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  reason: z.string().optional(),
});

const LeaveTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  annual_entitlement: z.number().nonnegative().optional(),
  requires_approval: z.boolean().optional(),
});

const LeaveActionSchema = z.object({
  manager_id: z.string().uuid(),
});

const PayrollRunSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

const PerformanceReviewSchema = z.object({
  employee_id: z.string().uuid(),
  reviewer_id: z.string().uuid(),
  review_period: z.string().min(1),
  rating: z.number().min(1.0).max(5.0),
  feedback_notes: z.string().optional(),
});

// ==========================================
// Exported types for the service layer (#9)
// ==========================================

export type CreateEmployeeInput = z.infer<typeof CreateEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeSchema>;
export type ClockInput = z.infer<typeof ClockSchema>;
export type LeaveRequestInput = z.infer<typeof LeaveRequestSchema>;
export type LeaveTypeInput = z.infer<typeof LeaveTypeSchema>;
export type PerformanceReviewInput = z.infer<typeof PerformanceReviewSchema>;

// ==========================================
// OpenAPI Schema Registrations
// ==========================================

const OpenAPIEmployee = registry.register('Employee', z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  department: z.string().nullable(),
  role: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  address: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  employment_type: z.string(),
  status: z.string(),
  base_salary: z.number(),
  currency: z.string(),
  salary_period: z.string(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPISalaryHistory = registry.register('SalaryHistory', z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  effective_date: z.string(),
  amount: z.number(),
  currency: z.string(),
  reason: z.string().nullable(),
  created_at: z.string(),
}));

const OpenAPIPayslip = registry.register('Payslip', z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  period_start: z.string(),
  period_end: z.string(),
  base_salary: z.number(),
  allowances: z.number(),
  deductions: z.number(),
  net_pay: z.number(),
  currency: z.string(),
  status: z.string(),
  payment_date: z.string().nullable(),
  created_at: z.string(),
}));

const OpenAPILeaveType = registry.register('LeaveType', z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  annual_entitlement: z.number(),
  requires_approval: z.boolean(),
  created_at: z.string(),
}));

const OpenAPIAttendanceRecord = registry.register('AttendanceRecord', z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  date: z.string(),
  clock_in: z.string().nullable(),
  clock_out: z.string().nullable(),
  hours_worked: z.number().nullable(),
  created_at: z.string(),
}));

const OpenAPILeaveRequest = registry.register('LeaveRequest', z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  actioned_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPIPerformanceReview = registry.register('PerformanceReview', z.object({
  id: z.string().uuid(),
  employee_id: z.string().uuid(),
  reviewer_id: z.string().uuid(),
  review_period: z.string(),
  rating: z.number(),
  feedback_notes: z.string().nullable(),
  created_at: z.string(),
}));

const PaginatedMeta = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

// ==========================================
// OpenAPI Path Registrations (#10 — all endpoints)
// ==========================================

// --- EMPLOYEES ---

registry.registerPath({
  method: 'post',
  path: '/hr/employees',
  summary: 'Create employee',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: CreateEmployeeSchema } } },
  },
  responses: {
    201: { description: 'Employee created', content: { 'application/json': { schema: OpenAPIEmployee } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/employees',
  summary: 'List employees',
  tags: ['HR'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'include_deleted', in: 'query', schema: { type: 'boolean' } },
  ],
  responses: {
    200: {
      description: 'Paginated employee list',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIEmployee),
            meta: PaginatedMeta,
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/employees/{id}',
  summary: 'Get employee by ID',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: { description: 'Employee details', content: { 'application/json': { schema: OpenAPIEmployee } } },
    404: { description: 'Employee not found' },
  },
});

registry.registerPath({
  method: 'put',
  path: '/hr/employees/{id}',
  summary: 'Update employee',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: { content: { 'application/json': { schema: UpdateEmployeeSchema } } },
  },
  responses: {
    200: { description: 'Employee updated', content: { 'application/json': { schema: OpenAPIEmployee } } },
    404: { description: 'Employee not found' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/hr/employees/{id}',
  summary: 'Soft-delete employee',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: { description: 'Employee soft-deleted', content: { 'application/json': { schema: z.object({ success: z.boolean() }) } } },
    404: { description: 'Employee not found' },
  },
});

// --- ATTENDANCE ---

registry.registerPath({
  method: 'post',
  path: '/hr/attendance/clock-in',
  summary: 'Clock in an employee',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: ClockSchema } } },
  },
  responses: {
    200: { description: 'Clock-in recorded', content: { 'application/json': { schema: OpenAPIAttendanceRecord } } },
    409: { description: 'Already clocked in' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/hr/attendance/clock-out',
  summary: 'Clock out an employee',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: ClockSchema } } },
  },
  responses: {
    200: { description: 'Clock-out recorded', content: { 'application/json': { schema: OpenAPIAttendanceRecord } } },
    409: { description: 'Not clocked in' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/attendance',
  summary: 'List attendance records',
  tags: ['HR'],
  parameters: [
    { name: 'employee_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by employee ID' },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated attendance records',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(OpenAPIAttendanceRecord), meta: PaginatedMeta }),
        },
      },
    },
  },
});

// --- LEAVES ---

registry.registerPath({
  method: 'post',
  path: '/hr/leaves',
  summary: 'Create leave request',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: LeaveRequestSchema } } },
  },
  responses: {
    201: { description: 'Leave request created', content: { 'application/json': { schema: OpenAPILeaveRequest } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/leaves',
  summary: 'List leave requests',
  tags: ['HR'],
  parameters: [
    { name: 'employee_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by employee ID' },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated leave requests',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(OpenAPILeaveRequest), meta: PaginatedMeta }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/hr/leaves/{id}/approve',
  summary: 'Approve leave request',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: { content: { 'application/json': { schema: LeaveActionSchema } } },
  },
  responses: {
    200: { description: 'Leave request approved', content: { 'application/json': { schema: OpenAPILeaveRequest } } },
    409: { description: 'Leave request already actioned or self-approval' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/hr/leaves/{id}/reject',
  summary: 'Reject leave request',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: { content: { 'application/json': { schema: LeaveActionSchema } } },
  },
  responses: {
    200: { description: 'Leave request rejected', content: { 'application/json': { schema: OpenAPILeaveRequest } } },
    409: { description: 'Leave request already actioned or self-rejection' },
  },
});

// --- LEAVE TYPES ---

registry.registerPath({
  method: 'post',
  path: '/hr/leave-types',
  summary: 'Create leave type (Admin only)',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: LeaveTypeSchema } } },
  },
  responses: {
    201: { description: 'Leave type created', content: { 'application/json': { schema: OpenAPILeaveType } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/leave-types',
  summary: 'List leave types',
  tags: ['HR'],
  responses: {
    200: { description: 'List of leave types', content: { 'application/json': { schema: z.array(OpenAPILeaveType) } } },
  },
});

// --- PAYROLL ---

registry.registerPath({
  method: 'post',
  path: '/hr/payroll/run',
  summary: 'Run payroll for period',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: PayrollRunSchema } } },
  },
  responses: {
    200: {
      description: 'Processed payroll result details',
      content: {
        'application/json': {
          schema: z.object({
            processed_count: z.number(),
            total_payroll: z.number(),
            currency: z.string(),
            currency_totals: z.array(z.object({
              currency: z.string(),
              total: z.number(),
              employee_count: z.number(),
            })),
            payslips: z.array(z.object({
              id: z.string().uuid(),
              employee_id: z.string().uuid(),
              net_pay: z.number(),
              currency: z.string(),
            })),
          }),
        },
      },
    },
    409: { description: 'Payroll already processed for this period' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/payroll/payslips',
  summary: 'List payslips',
  tags: ['HR'],
  parameters: [
    { name: 'employee_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by employee ID' },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated list of payslips',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(OpenAPIPayslip), meta: PaginatedMeta }),
        },
      },
    },
  },
});

// --- SALARY HISTORY ---

registry.registerPath({
  method: 'get',
  path: '/hr/employees/{id}/salary-history',
  summary: 'Get salary history for an employee',
  tags: ['HR'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Salary change history (newest first)',
      content: {
        'application/json': {
          schema: z.array(OpenAPISalaryHistory),
        },
      },
    },
    404: { description: 'Employee not found' },
  },
});

// --- PERFORMANCE REVIEWS ---

registry.registerPath({
  method: 'post',
  path: '/hr/performance-reviews',
  summary: 'Create performance review',
  tags: ['HR'],
  request: {
    body: { content: { 'application/json': { schema: PerformanceReviewSchema } } },
  },
  responses: {
    201: { description: 'Performance review created', content: { 'application/json': { schema: OpenAPIPerformanceReview } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hr/performance-reviews',
  summary: 'List performance reviews',
  tags: ['HR'],
  parameters: [
    { name: 'employee_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filter by employee ID' },
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated performance reviews',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(OpenAPIPerformanceReview), meta: PaginatedMeta }),
        },
      },
    },
  },
});

// ==========================================
// Express Route Handlers
// ==========================================

// --- EMPLOYEES ---

hrRouter.post('/employees', rbac('write:employees'), audit('employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateEmployeeSchema.parse(req.body);
    const result = HrService.createEmployee(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/employees', rbac('read:employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const includeDeleted = req.query.include_deleted === 'true';

    if (includeDeleted && !req.assistant?.is_admin && !req.permissions?.includes('read:deleted')) {
      throw new ForbiddenError('read:deleted');
    }

    const result = HrService.listEmployees({ cursor, limit, includeDeleted });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/employees/:id', rbac('read:employees', 'employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = HrService.getEmployeeById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.put('/employees/:id', rbac('write:employees', 'employees'), audit('employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateEmployeeSchema.parse(req.body);
    const result = HrService.updateEmployee(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.delete('/employees/:id', rbac('write:employees', 'employees'), audit('employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = HrService.deleteEmployee(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- SALARY HISTORY ---

hrRouter.get('/employees/:id/salary-history', rbac('read:employees', 'employees'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = HrService.getSalaryHistory(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- ATTENDANCE ---

hrRouter.post('/attendance/clock-in', rbac('write:attendance'), audit('attendance_records'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ClockSchema.parse(req.body);
    const result = HrService.clockIn(validated.employee_id, validated.date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.post('/attendance/clock-out', rbac('write:attendance'), audit('attendance_records'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ClockSchema.parse(req.body);
    const result = HrService.clockOut(validated.employee_id, validated.date);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/attendance', rbac('read:attendance'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee_id = req.query.employee_id as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = HrService.listAttendance({ employee_id, cursor, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- LEAVES ---

hrRouter.post('/leaves', rbac('write:leaves'), audit('leave_requests'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeaveRequestSchema.parse(req.body);
    const result = HrService.createLeaveRequest(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/leaves', rbac('read:leaves'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee_id = req.query.employee_id as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = HrService.listLeaves({ employee_id, cursor, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.post('/leaves/:id/approve', rbac('write:leaves'), audit('leave_requests'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeaveActionSchema.parse(req.body);
    const result = HrService.approveLeaveRequest(req.params.id, validated.manager_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.post('/leaves/:id/reject', rbac('write:leaves'), audit('leave_requests'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeaveActionSchema.parse(req.body);
    const result = HrService.rejectLeaveRequest(req.params.id, validated.manager_id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- LEAVE TYPES ---

hrRouter.post('/leave-types', rbac('write:leaves'), audit('leave_types'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = LeaveTypeSchema.parse(req.body);
    const result = HrService.createLeaveType(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/leave-types', rbac('read:leaves'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = HrService.listLeaveTypes();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- PAYROLL ---

hrRouter.post('/payroll/run', rbac('process:payroll'), audit('payslips'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PayrollRunSchema.parse(req.body);
    const assistantId = req.assistant?.id;
    if (!assistantId) {
      throw new ForbiddenError('process:payroll');
    }
    const result = HrService.runPayroll(validated.period_start, validated.period_end, assistantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/payroll/payslips', rbac('read:payroll'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee_id = req.query.employee_id as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = HrService.listPayslips({ employee_id, cursor, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- PERFORMANCE REVIEWS ---

hrRouter.post('/performance-reviews', rbac('write:performance'), audit('performance_reviews'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = PerformanceReviewSchema.parse(req.body);
    const result = HrService.createPerformanceReview(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

hrRouter.get('/performance-reviews', rbac('read:performance'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee_id = req.query.employee_id as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = HrService.listReviews({ employee_id, cursor, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
