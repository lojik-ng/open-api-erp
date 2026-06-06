import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AssistantsService } from './assistants.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const assistantsRouter = Router();

// Zod Schemas for input validation & OpenAPI registration
const CreateAssistantSchema = z.object({
  name: z.string().min(1),
  rateLimitPerMinute: z.number().int().positive().optional(),
  isAdmin: z.boolean().optional(),
  permissions: z.array(z.string()).optional(),
});

const UpdateAssistantSchema = z.object({
  name: z.string().min(1).optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
  status: z.enum(['active', 'suspended', 'revoked']).optional(),
  permissions: z.array(z.string()).optional(),
});

const AssistantResponseSchema = registry.register('AssistantResponse', z.object({
  id: z.string().uuid(),
  name: z.string(),
  api_key_prefix: z.string(),
  rate_limit_per_minute: z.number(),
  is_admin: z.boolean(),
  status: z.string(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}));

const AssistantWithKeyResponseSchema = registry.register('AssistantWithKeyResponse', AssistantResponseSchema.extend({
  apiKey: z.string(),
}));

// OpenAPI registrations
registry.registerPath({
  method: 'post',
  path: '/assistants',
  summary: 'Create assistant (Admin only)',
  tags: ['Core'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateAssistantSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Assistant created successfully. Raw API Key returned once.',
      content: {
        'application/json': {
          schema: AssistantWithKeyResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/assistants',
  summary: 'List assistants (Admin only)',
  tags: ['Core'],
  parameters: [
    { name: 'cursor', in: 'query', schema: { type: 'string' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
  ],
  responses: {
    200: {
      description: 'List of assistants',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(AssistantResponseSchema),
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
  path: '/assistants/{id}',
  summary: 'Get assistant by ID (Admin only)',
  tags: ['Core'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Assistant details with permissions list',
      content: {
        'application/json': {
          schema: AssistantResponseSchema.extend({
            permissions: z.array(z.string()),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'put',
  path: '/assistants/{id}',
  summary: 'Update assistant details (Admin only)',
  tags: ['Core'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateAssistantSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated assistant details',
      content: {
        'application/json': {
          schema: AssistantResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/assistants/{id}',
  summary: 'Delete assistant (Admin only)',
  tags: ['Core'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Deletion confirmation status',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

// Express route bindings
assistantsRouter.post('/', rbac('write:assistants'), audit('assistants'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = CreateAssistantSchema.parse(req.body);
    const result = AssistantsService.create(validated);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

assistantsRouter.get('/', rbac('read:assistants'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const cursor = req.query.cursor as string | undefined;
    const result = AssistantsService.list(cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

assistantsRouter.get('/:id', rbac('read:assistants'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AssistantsService.getById(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

assistantsRouter.put('/:id', rbac('write:assistants'), audit('assistants'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = UpdateAssistantSchema.parse(req.body);
    const result = AssistantsService.update(req.params.id, validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

assistantsRouter.delete('/:id', rbac('write:assistants'), audit('assistants'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = AssistantsService.delete(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
