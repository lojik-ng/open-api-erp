import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { MonitoredCommunicationsService } from './monitoredCommunications.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const monitoredCommunicationsRouter = Router();

// Zod schemas for validation
const CommunicationSchema = z.object({
  client_name: z.string().min(1, 'client_name is required'),
  contact_name: z.string().min(1, 'contact_name is required'),
  channel: z.enum(['email', 'whatsapp', 'call', 'physical']),
  channel_address: z.string().optional().nullable(),
  conversation_date: z.string().min(1, 'conversation_date is required'),
});

// Register model in OpenAPI Spec
const OpenAPICommunication = registry.register('MonitoredCommunication', z.object({
  id: z.string().uuid(),
  client_name: z.string(),
  contact_name: z.string(),
  channel: z.string(),
  channel_address: z.string().nullable(),
  conversation_date: z.string(),
  created_at: z.string(),
}));

// OpenAPI routes registration
registry.registerPath({
  method: 'post',
  path: '/monitored-communications',
  summary: 'Create a new monitored communication log',
  tags: ['Monitored Communications'],
  request: {
    body: { content: { 'application/json': { schema: CommunicationSchema } } },
  },
  responses: {
    201: {
      description: 'Communication log created',
      content: { 'application/json': { schema: OpenAPICommunication } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/monitored-communications',
  summary: 'List monitored communication logs',
  tags: ['Monitored Communications'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'Paginated list of communication logs',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(OpenAPICommunication),
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
  path: '/monitored-communications/{id}',
  summary: 'Get details of a monitored communication log',
  tags: ['Monitored Communications'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Communication log details',
      content: { 'application/json': { schema: OpenAPICommunication } },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/monitored-communications/{id}',
  summary: 'Update a monitored communication log',
  tags: ['Monitored Communications'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: { content: { 'application/json': { schema: CommunicationSchema.partial() } } },
  },
  responses: {
    200: {
      description: 'Communication log updated',
      content: { 'application/json': { schema: OpenAPICommunication } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/monitored-communications/{id}',
  summary: 'Delete a monitored communication log',
  tags: ['Monitored Communications'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Communication log deleted successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

// Express route handlers
monitoredCommunicationsRouter.post('/', rbac('write:monitored_communications'), audit('monitored_communications'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CommunicationSchema.parse(req.body);
    const result = MonitoredCommunicationsService.create(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

monitoredCommunicationsRouter.get('/', rbac('read:monitored_communications'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = MonitoredCommunicationsService.list({ cursor, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

monitoredCommunicationsRouter.get('/:id', rbac('read:monitored_communications'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = MonitoredCommunicationsService.getById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

monitoredCommunicationsRouter.put('/:id', rbac('write:monitored_communications'), audit('monitored_communications'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CommunicationSchema.partial().parse(req.body);
    const result = MonitoredCommunicationsService.update(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

monitoredCommunicationsRouter.delete('/:id', rbac('write:monitored_communications'), audit('monitored_communications'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = MonitoredCommunicationsService.delete(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
