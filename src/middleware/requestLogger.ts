import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Middleware to log HTTP request execution and performance metrics using Pino.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Assign or extract a request tracking ID
  const reqId = req.headers['x-request-id'] || Math.random().toString(36).substring(7);
  (req as any).id = reqId;

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logger.info({
      reqId,
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      responseTime,
      assistantId: req.assistant?.id || 'unauthenticated'
    }, 'HTTP Request processed');
  });

  next();
}
export default requestLogger;
