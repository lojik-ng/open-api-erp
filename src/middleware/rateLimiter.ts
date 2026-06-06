import { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../shared/errors';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Rate Limiting Middleware.
 * Limits API calls per assistant according to the limit defined in the database.
 */
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  const assistant = req.assistant;

  // If request has not been authenticated, bypass rate limiter (auth handles authentication check)
  if (!assistant) {
    return next();
  }

  const limit = assistant.rate_limit_per_minute;
  const now = Date.now();
  const windowMs = 60000; // 1-minute tracking window

  let record = rateLimitStore.get(assistant.id);

  if (!record || now >= record.resetTime) {
    // Window expired or no record exists; start a new window
    record = {
      count: 1,
      resetTime: now + windowMs
    };
    rateLimitStore.set(assistant.id, record);
  } else {
    record.count++;
  }

  const remaining = Math.max(0, limit - record.count);
  const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

  // Set standard rate limit headers
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

  if (record.count > limit) {
    res.setHeader('Retry-After', resetSeconds.toString());
    return next(new RateLimitError(resetSeconds));
  }

  next();
}
export default rateLimiter;
