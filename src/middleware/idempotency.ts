import { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { logger } from '../config/logger';

/**
 * Middleware to support idempotent operations on state-changing API endpoints.
 */
export function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'];

  // Only apply to mutating methods and when an idempotency key is supplied
  if (!key || typeof key !== 'string' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const assistantId = req.assistant?.id;
  if (!assistantId) {
    return next();
  }

  try {
    // Check if the key has already been processed for this assistant
    const record = db.prepare(`
      SELECT response_status, response_body
      FROM idempotency_keys
      WHERE key = ? AND assistant_id = ?
    `).get(key, assistantId) as any;

    if (record) {
      logger.info({ key, path: req.path, assistantId }, 'Idempotency match found. Replaying response.');
      res.setHeader('X-Cache-Lookup', 'HIT - Idempotent Request');
      return res.status(record.response_status).json(JSON.parse(record.response_body));
    }

    // Intercept response to store the result on completion
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Avoid caching internal server errors (500)
      if (res.statusCode < 500) {
        try {
          db.prepare(`
            INSERT INTO idempotency_keys (key, assistant_id, request_method, request_path, response_status, response_body)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(key, assistantId, req.method, req.path, res.statusCode, JSON.stringify(body));
        } catch (err) {
          logger.error({ err, key }, 'Failed to cache idempotency key response');
        }
      }
      return originalJson(body);
    };
  } catch (err) {
    logger.error({ err, key }, 'Error processing idempotency check');
  }

  next();
}
export default idempotency;
