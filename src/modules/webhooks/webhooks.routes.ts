import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { WebhooksService } from './webhooks.service';
import { rbac } from '../../middleware/rbac';
import { audit } from '../../middleware/audit';
import { registry } from '../../shared/openapi';

export const webhooksRouter = Router();

const RegisterWebhookSchema = z.object({
  url: z.string().url(),
  eventType: z.string().min(1),
});

const WebhookSubscriptionResponseSchema = registry.register('WebhookSubscriptionResponse', z.object({
  id: z.string().uuid(),
  assistant_id: z.string().uuid(),
  url: z.string(),
  event_type: z.string(),
  secret: z.string(),
  status: z.string(),
}));

registry.registerPath({
  method: 'post',
  path: '/webhooks',
  summary: 'Register webhook subscription',
  tags: ['Webhooks'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RegisterWebhookSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Webhook registered successfully',
      content: {
        'application/json': {
          schema: WebhookSubscriptionResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/webhooks',
  summary: 'List registered webhooks for assistant',
  tags: ['Webhooks'],
  responses: {
    200: {
      description: 'List of webhook subscriptions',
      content: {
        'application/json': {
          schema: z.array(z.object({
            id: z.string().uuid(),
            url: z.string(),
            event_type: z.string(),
            status: z.string(),
            created_at: z.string(),
          })),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/webhooks/{id}',
  summary: 'Delete webhook subscription',
  tags: ['Webhooks'],
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
  ],
  responses: {
    200: {
      description: 'Webhook subscription deleted successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.boolean() }),
        },
      },
    },
  },
});

// Express route handlers
webhooksRouter.post('/', rbac('write:webhooks'), audit('webhook_subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = RegisterWebhookSchema.parse(req.body);
    const result = WebhooksService.register(validated, req.assistant!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

webhooksRouter.get('/', rbac('read:webhooks'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = WebhooksService.list(req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

webhooksRouter.delete('/:id', rbac('write:webhooks'), audit('webhook_subscriptions'), (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = WebhooksService.delete(req.params.id, req.assistant!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
