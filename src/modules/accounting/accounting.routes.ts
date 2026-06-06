import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AccountingService } from './accounting.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const accountingRouter = Router();

// Zod validation schemas
const CreateAccountSchema = z.object({
  parent_account_id: z.string().uuid().optional().nullable(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().min(3).max(3).optional(),
});

const JournalLineSchema = z.object({
  account_id: z.string().uuid(),
  description: z.string().optional(),
  debit: z.number().nonnegative().default(0.0),
  credit: z.number().nonnegative().default(0.0),
});

const CreateJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  description: z.string().min(1),
  lines: z.array(JournalLineSchema).min(2, 'Journal entry must have at least 2 lines'),
});

const ClosePeriodSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  notes: z.string().optional(),
});

// Register OpenAPI schemas
const OpenAPIAccount = registry.register('Account', z.object({
  id: z.string().uuid(),
  parent_account_id: z.string().uuid().nullable(),
  type: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
}));

const OpenAPIJournalLine = registry.register('JournalLine', z.object({
  id: z.string().uuid(),
  journal_entry_id: z.string().uuid(),
  account_id: z.string().uuid(),
  description: z.string().nullable(),
  debit: z.number(),
  credit: z.number(),
  created_at: z.string(),
}));

const OpenAPIJournalEntry = registry.register('JournalEntry', z.object({
  id: z.string().uuid(),
  date: z.string(),
  description: z.string(),
  reversal_of: z.string().uuid().nullable(),
  assistant_id: z.string().uuid(),
  created_at: z.string(),
  lines: z.array(OpenAPIJournalLine).optional(),
}));

const OpenAPIPeriod = registry.register('ClosedPeriod', z.object({
  id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  closed_by: z.string().uuid(),
  closed_at: z.string(),
  notes: z.string().nullable(),
}));

// OpenAPI registrations
registry.registerPath({
  method: 'post',
  path: '/accounting/accounts',
  summary: 'Create a new general ledger account',
  tags: ['Accounting'],
  request: {
    body: { content: { 'application/json': { schema: CreateAccountSchema } } },
  },
  responses: {
    201: { description: 'Account created', content: { 'application/json': { schema: OpenAPIAccount } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/accounting/journal-entries',
  summary: 'Create a manual journal entry',
  tags: ['Accounting'],
  request: {
    body: { content: { 'application/json': { schema: CreateJournalEntrySchema } } },
  },
  responses: {
    201: { description: 'Journal entry created', content: { 'application/json': { schema: OpenAPIJournalEntry } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/accounting/journal-entries/{id}/reverse',
  summary: 'Reverse a journal entry',
  tags: ['Accounting'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
  responses: {
    200: { description: 'Reversing entry created', content: { 'application/json': { schema: OpenAPIJournalEntry } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/accounting/periods/close',
  summary: 'Close a financial period',
  tags: ['Accounting'],
  request: {
    body: { content: { 'application/json': { schema: ClosePeriodSchema } } },
  },
  responses: {
    200: { description: 'Period successfully closed' },
  },
});

// Express route handlers

// ACCOUNTS
accountingRouter.post('/accounts', rbac('write:accounts'), audit('accounts'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateAccountSchema.parse(req.body);
    const result = AccountingService.createAccount(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.get('/accounts', rbac('read:accounts'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.listAccounts();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.get('/accounts/:id', rbac('read:accounts'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.getAccountById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PERIODS
accountingRouter.post('/periods/close', rbac('close:period'), audit('closed_periods'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ClosePeriodSchema.parse(req.body);
    const result = AccountingService.closePeriod(validated.start_date, validated.end_date, req.assistant!.id, validated.notes);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.get('/periods', rbac('read:periods'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.listPeriods();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// JOURNAL ENTRIES
accountingRouter.post('/journal-entries', rbac('write:journal_entries'), audit('journal_entries'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateJournalEntrySchema.parse(req.body);
    const result = AccountingService.createJournalEntry(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.get('/journal-entries', rbac('read:journal_entries'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = AccountingService.listJournalEntries(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.get('/journal-entries/:id', rbac('read:journal_entries'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.getJournalEntryById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

accountingRouter.post('/journal-entries/:id/reverse', rbac('reverse:journal'), audit('journal_entries'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.reverseJournalEntry(req.params.id, req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// REPORTS
accountingRouter.get('/reports/ar-aging', rbac('read:journal_entries'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AccountingService.getArAgingReport();
    res.json(result);
  } catch (err) {
    next(err);
  }
});
