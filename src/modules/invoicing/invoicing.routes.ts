import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { InvoicingService } from './invoicing.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const invoicingRouter = Router();

// Zod validation schemas
const InvoiceLineSchema = z.object({
  product_id: z.string().uuid(),
  description: z.string().optional(),
  quantity: z.number().positive().default(1.0),
  unit_price: z.number().nonnegative().optional(),
});

const CreateInvoiceSchema = z.object({
  client_id: z.string().uuid(),
  status: z.enum(['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded', 'void']).optional(),
  currency: z.string().min(3).max(3).optional(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  line_items: z.array(InvoiceLineSchema).min(1, 'Invoice must have at least one line item'),
});

const UpdateInvoiceSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled', 'refunded', 'void']).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

const CreatePaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).optional(),
  payment_method: z.enum(['bank_transfer', 'card', 'cash', 'credit_note', 'other']),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  reference_number: z.string().optional(),
});

const CreateSubscriptionSchema = z.object({
  client_id: z.string().uuid(),
  product_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  next_billing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

const UpdateSubscriptionSchema = z.object({
  status: z.enum(['active', 'past_due', 'paused', 'cancelled']).optional(),
  next_billing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
});

// Register OpenAPI schemas
const OpenAPIInvoiceLine = registry.register('InvoiceLine', z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  product_id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  tax_rate_id: z.string().uuid().nullable(),
  tax_amount: z.number(),
  total_amount: z.number(),
}));

const OpenAPIInvoice = registry.register('Invoice', z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  status: z.string(),
  currency: z.string(),
  subtotal: z.number(),
  tax_total: z.number(),
  total: z.number(),
  amount_paid: z.number(),
  issue_date: z.string().nullable(),
  due_date: z.string().nullable(),
  assistant_id: z.string().uuid(),
  deleted_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  line_items: z.array(OpenAPIInvoiceLine).optional(),
}));

const OpenAPIPayment = registry.register('Payment', z.object({
  id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  amount: z.number(),
  currency: z.string(),
  payment_method: z.string(),
  payment_date: z.string(),
  reference_number: z.string().nullable(),
  assistant_id: z.string().uuid(),
  created_at: z.string(),
}));

const OpenAPISubscription = registry.register('Subscription', z.object({
  id: z.string().uuid(),
  client_id: z.string().uuid(),
  product_id: z.string().uuid(),
  status: z.string(),
  start_date: z.string(),
  next_billing_date: z.string(),
  cancelled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

// OpenAPI registrations
registry.registerPath({
  method: 'post',
  path: '/invoicing/invoices',
  summary: 'Issue a new invoice',
  tags: ['Invoicing'],
  request: {
    body: { content: { 'application/json': { schema: CreateInvoiceSchema } } },
  },
  responses: {
    201: { description: 'Invoice issued', content: { 'application/json': { schema: OpenAPIInvoice } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/invoicing/invoices',
  summary: 'List invoices',
  tags: ['Invoicing'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated list of invoices',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIInvoice),
            meta: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/invoicing/payments',
  summary: 'Record payment against invoice',
  tags: ['Invoicing'],
  request: {
    body: { content: { 'application/json': { schema: CreatePaymentSchema } } },
  },
  responses: {
    201: { description: 'Payment recorded', content: { 'application/json': { schema: OpenAPIPayment } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/invoicing/subscriptions',
  summary: 'List subscriptions',
  tags: ['Invoicing'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated list of active subscriptions',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPISubscription),
            meta: z.object({ next_cursor: z.string().nullable(), has_more: z.boolean() }),
          }),
        },
      },
    },
  },
});

// Express route handlers

// INVOICES
invoicingRouter.post('/invoices', rbac('write:invoices'), audit('invoices'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateInvoiceSchema.parse(req.body);
    const result = InvoicingService.createInvoice(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.get('/invoices', rbac('read:invoices'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = InvoicingService.listInvoices(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.get('/invoices/:id', rbac('read:invoices', 'invoices'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InvoicingService.getInvoiceById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.put('/invoices/:id', rbac('write:invoices', 'invoices'), audit('invoices'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateInvoiceSchema.parse(req.body);
    const result = InvoicingService.updateInvoice(req.params.id, validated, req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.delete('/invoices/:id', rbac('write:invoices', 'invoices'), audit('invoices'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InvoicingService.deleteInvoice(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PAYMENTS
invoicingRouter.post('/payments', rbac('write:payments'), audit('payments'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreatePaymentSchema.parse(req.body);
    const result = InvoicingService.recordPayment(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.get('/payments', rbac('read:payments'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = InvoicingService.listPayments(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.get('/payments/:id', rbac('read:payments'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InvoicingService.getPaymentById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// SUBSCRIPTIONS
invoicingRouter.post('/subscriptions', rbac('write:subscriptions'), audit('subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateSubscriptionSchema.parse(req.body);
    const result = InvoicingService.createSubscription(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.get('/subscriptions', rbac('read:subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = InvoicingService.listSubscriptions(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.put('/subscriptions/:id', rbac('write:subscriptions', 'subscriptions'), audit('subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateSubscriptionSchema.parse(req.body);
    const result = InvoicingService.updateSubscription(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

invoicingRouter.delete('/subscriptions/:id', rbac('write:subscriptions', 'subscriptions'), audit('subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = InvoicingService.deleteSubscription(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
