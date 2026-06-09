import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ColdMarketingService } from './coldMarketing.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const coldMarketingRouter = Router();

// Zod validation schemas
const ColdMarketingEntrySchema = z.object({
  company_name: z.string().min(1, 'company_name is required'),
  contact_name: z.string().min(1, 'contact_name is required'),
  email: z.string().email('Must be a valid email address'),
  phone: z.string().min(1, 'phone is required'),
  status: z.enum(['New', 'Used']).optional(),
  notes: z.string().optional().nullable(),
});

// Register Model in OpenAPI Spec
const OpenAPIColdMarketingEntry = registry.register('ColdMarketingEntry', z.object({
  id: z.string().uuid(),
  company_name: z.string(),
  contact_name: z.string(),
  email: z.string(),
  phone: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}));

// OpenAPI Path Registrations
registry.registerPath({
  method: 'post',
  path: '/cold-marketing',
  summary: 'Create a new cold marketing contact',
  tags: ['Cold Marketing'],
  request: {
    body: { content: { 'application/json': { schema: ColdMarketingEntrySchema } } },
  },
  responses: {
    201: {
      description: 'Contact created successfully',
      content: { 'application/json': { schema: OpenAPIColdMarketingEntry } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/cold-marketing',
  summary: 'List cold marketing contacts',
  tags: ['Cold Marketing'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'status', in: 'query', schema: { type: 'string' } },
    { name: 'q', in: 'query', schema: { type: 'string' } },
  ],
  responses: {
    200: {
      description: 'Paginated and filterable list of contacts',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIColdMarketingEntry),
            meta: z.object({
              next_cursor: z.string().nullable(),
              has_more: z.boolean(),
            }),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/cold-marketing/{id}',
  summary: 'Get details of a cold marketing contact',
  tags: ['Cold Marketing'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Contact details',
      content: { 'application/json': { schema: OpenAPIColdMarketingEntry } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/cold-marketing/{id}',
  summary: 'Update a cold marketing contact',
  tags: ['Cold Marketing'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: { content: { 'application/json': { schema: ColdMarketingEntrySchema.partial() } } },
  },
  responses: {
    200: {
      description: 'Contact updated successfully',
      content: { 'application/json': { schema: OpenAPIColdMarketingEntry } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/cold-marketing/{id}',
  summary: 'Delete a cold marketing contact',
  tags: ['Cold Marketing'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Contact deleted successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

// Express route handlers

coldMarketingRouter.post('/', rbac('write:cold_marketing'), audit('cold_marketing_list'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ColdMarketingEntrySchema.parse(req.body);
    const result = ColdMarketingService.create(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

coldMarketingRouter.get('/', rbac('read:cold_marketing'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const status = req.query.status as string | undefined;
    const q = req.query.q as string | undefined;
    const result = ColdMarketingService.list({ cursor, limit, status, q });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

coldMarketingRouter.get('/:id', rbac('read:cold_marketing'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = ColdMarketingService.getById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

coldMarketingRouter.put('/:id', rbac('write:cold_marketing'), audit('cold_marketing_list'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = ColdMarketingEntrySchema.partial().parse(req.body);
    const result = ColdMarketingService.update(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

coldMarketingRouter.delete('/:id', rbac('write:cold_marketing'), audit('cold_marketing_list'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = ColdMarketingService.delete(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
