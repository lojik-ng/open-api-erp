import express, { Request, Response, NextFunction } from 'express';
import swaggerUi from 'swagger-ui-express';
import { db } from './config/database';
import { requestLogger } from './middleware/requestLogger';
import { auth } from './middleware/auth';
import { rateLimiter } from './middleware/rateLimiter';
import { idempotency } from './middleware/idempotency';
import { errorHandler } from './middleware/errorHandler';
import { getFullOpenAPISpec, getScopedSpec } from './shared/openapi';
import { eventBus } from './shared/eventBus';

// Import event listeners to register them with the Event Bus
import './modules/accounting/journalEntries/journalEntries.listener';

// Import routers
import { assistantsRouter } from './modules/assistants/assistants.routes';
import { crmRouter } from './modules/crm/crm.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { invoicingRouter } from './modules/invoicing/invoicing.routes';
import { accountingRouter } from './modules/accounting/accounting.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { hrRouter } from './modules/hr/hr.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';
import { monitoredCommunicationsRouter } from './modules/monitoredCommunications/monitoredCommunications.routes';

export const app = express();

// Enable express json parsing
app.use(express.json());

// CORS middleware supporting all origins (required for autonomous AI assistants)
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, Idempotency-Key');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Standard HTTP security headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// 1. Mount request logger (logs duration and method metrics)
app.use(requestLogger);

// Public health check route (bypasses authentication)
app.get('/health', (req: Request, res: Response) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
  }
});

// Dynamic scoped OpenAPI spec JSON endpoint
app.get('/v1/api-docs/openapi.json', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && typeof apiKey === 'string') {
    try {
      const crypto = require('crypto');
      const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
      const assistant = db.prepare('SELECT id, is_admin FROM assistants WHERE api_key_hash = ? AND status = "active"').get(hashedKey) as any;
      if (assistant) {
        const permissions = db.prepare('SELECT permission FROM assistant_permissions WHERE assistant_id = ?').all(assistant.id).map((p: any) => p.permission);
        const spec = getScopedSpec(permissions, assistant.is_admin === 1);
        return res.json(spec);
      }
    } catch (err) {
      // fallback
    }
  }
  // Return full spec for anonymous request or invalid key
  return res.json(getFullOpenAPISpec());
});

// Swagger UI mount
app.use('/v1/api-docs', swaggerUi.serve, swaggerUi.setup(undefined, {
  swaggerOptions: {
    url: '/v1/api-docs/openapi.json',
  },
}));

// 2. Mount security and infrastructure middlewares
app.use(auth);
app.use(idempotency);
app.use(rateLimiter);

// 3. Mount module API routers
app.use('/v1/assistants', assistantsRouter);
app.use('/v1/crm', crmRouter);
app.use('/v1/catalog', catalogRouter);
app.use('/v1/invoicing', invoicingRouter);
app.use('/v1/accounting', accountingRouter);
app.use('/v1/inventory', inventoryRouter);
app.use('/v1/hr', hrRouter);
app.use('/v1/webhooks', webhooksRouter);
app.use('/v1/monitored-communications', monitoredCommunicationsRouter);

// Global error handler (must be registered last)
app.use(errorHandler);
