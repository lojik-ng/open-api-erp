import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DocumentsService } from './documents.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const documentsRouter = Router();

// Zod schema for request validation
const DocumentCreateSchema = z.object({
  title: z.string().min(1, 'title is required'),
  details: z.string().optional().nullable(),
  filepath: z.string().min(1, 'filepath is required'),
  lead_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
}).refine(data => data.lead_id || data.client_id, {
  message: "At least one of 'lead_id' or 'client_id' must be provided",
  path: ['lead_id'],
});

// Register Model in OpenAPI Spec
const OpenAPIDocument = registry.register('Document', z.object({
  id: z.string().uuid(),
  title: z.string(),
  details: z.string().nullable(),
  filepath: z.string(),
  lead_id: z.string().uuid().nullable(),
  client_id: z.string().uuid().nullable(),
  created_at: z.string(),
}));

// OpenAPI Path Registrations
registry.registerPath({
  method: 'post',
  path: '/documents',
  summary: 'Create/Attach a new document to a lead or client',
  tags: ['Documents'],
  request: {
    body: { content: { 'application/json': { schema: DocumentCreateSchema } } },
  },
  responses: {
    201: {
      description: 'Document successfully attached',
      content: { 'application/json': { schema: OpenAPIDocument } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/documents',
  summary: 'List documents',
  tags: ['Documents'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'lead_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
    { name: 'client_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Paginated and filterable list of documents',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPIDocument),
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
  path: '/documents/{id}',
  summary: 'Get details of a document',
  tags: ['Documents'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Document details',
      content: { 'application/json': { schema: OpenAPIDocument } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/documents/{id}',
  summary: 'Delete a document',
  tags: ['Documents'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Document deleted successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

// Express route handlers

documentsRouter.post('/', rbac('write:documents'), audit('documents'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = DocumentCreateSchema.parse(req.body);
    const result = DocumentsService.create(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/', rbac('read:documents'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const lead_id = req.query.lead_id as string | undefined;
    const client_id = req.query.client_id as string | undefined;
    const result = DocumentsService.list({ cursor, limit, lead_id, client_id });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

documentsRouter.get('/:id', rbac('read:documents'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = DocumentsService.getById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

documentsRouter.delete('/:id', rbac('write:documents'), audit('documents'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = DocumentsService.delete(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
