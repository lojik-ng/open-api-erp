import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { db } from '../config/database';
import { logger } from '../config/logger';

const ALLOWED_TABLES = new Set([
  'assistants', 'leads', 'clients', 'contact_persons', 'interactions', 'scheduled_events',
  'products', 'tax_rates', 'exchange_rates', 'subscriptions', 'invoices', 'invoice_line_items',
  'payments', 'accounts', 'journal_entries', 'closed_periods', 'inventory', 'stock_adjustments',
  'suppliers', 'purchase_orders', 'purchase_order_lines', 'employees', 'attendance_records',
  'leave_types', 'leave_requests', 'payslips', 'performance_reviews', 'assistant_scopes', 'webhook_subscriptions',
  'monitored_communications', 'documents'
]);

function getResourceById(resourceType: string, id: string): any | null {
  if (!ALLOWED_TABLES.has(resourceType)) {
    return null;
  }
  try {
    return db.prepare(`SELECT * FROM ${resourceType} WHERE id = ?`).get(id) || null;
  } catch (err) {
    logger.error({ err, resourceType, id }, 'Error retrieving resource for audit before-state');
    return null;
  }
}

/**
 * Recursively redacts sensitive keys to prevent raw keys/secrets leaking in audit logs.
 */
function sanitizeForAudit(state: any): any {
  if (!state || typeof state !== 'object') {
    return state;
  }
  const clean = Array.isArray(state) ? [...state] : { ...state };
  
  const sensitiveKeys = ['apikey', 'api_key', 'secret', 'password', 'token', 'key'];
  
  for (const k of Object.keys(clean)) {
    if (sensitiveKeys.some(sk => k.toLowerCase().includes(sk))) {
      clean[k] = '[REDACTED]';
    } else if (clean[k] && typeof clean[k] === 'object') {
      clean[k] = sanitizeForAudit(clean[k]);
    }
  }
  return clean;
}

export function audit(resourceType: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only audit mutating requests
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const resourceId = req.params.id;
    let beforeState: any = null;

    // Retrieve original state before handler execution
    if (resourceId && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      beforeState = getResourceById(resourceType, resourceId);
    }

    // Intercept response json method
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only audit successful mutations (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const action = req.method === 'POST' ? 'CREATE'
                       : req.method === 'DELETE' ? 'DELETE'
                       : 'UPDATE';

          // Extract resource ID from response body if not present in request params
          const finalResourceId = resourceId || body?.id || body?.data?.id || null;

          const afterState = req.method !== 'DELETE' ? (body?.data ?? body) : null;
          const assistantId = req.assistant?.id || 'system';

          db.prepare(`
            INSERT INTO audit_logs (
              id, assistant_id, action, resource_type, resource_id,
              before_state, after_state, idempotency_key, ip_address, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          `).run(
            uuid(),
            assistantId,
            action,
            resourceType,
            finalResourceId,
            beforeState ? JSON.stringify(sanitizeForAudit(beforeState)) : null,
            afterState ? JSON.stringify(sanitizeForAudit(afterState)) : null,
            req.headers['idempotency-key'] || null,
            req.ip || null
          );
        } catch (err) {
          logger.error({ err, url: req.url }, 'Failed to write audit log entry');
        }
      }
      return originalJson(body);
    };

    next();
  };
}
export default audit;
