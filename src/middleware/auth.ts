import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { UnauthorizedError } from '../shared/errors';

export interface AssistantPayload {
  id: string;
  name: string;
  api_key_prefix: string;
  rate_limit_per_minute: number;
  is_admin: boolean;
  status: string;
}

declare global {
  namespace Express {
    interface Request {
      assistant?: AssistantPayload;
      permissions?: string[];
      scopes?: Record<string, string[]>; // mapping resource_type -> list of resource_ids
    }
  }
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || typeof apiKey !== 'string') {
    return next(new UnauthorizedError('API key missing or invalid format.'));
  }

  // Compute SHA-256 hash of the incoming API key
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

  // Query assistant from database
  const assistant = db.prepare(`
    SELECT id, name, api_key_prefix, rate_limit_per_minute, is_admin, status
    FROM assistants
    WHERE api_key_hash = ? AND status = 'active'
  `).get(hashedKey) as any;

  if (!assistant) {
    return next(new UnauthorizedError('Authentication failed. Key invalid or assistant inactive.'));
  }

  // Retrieve permissions
  const permissions = db.prepare(`
    SELECT permission FROM assistant_permissions WHERE assistant_id = ?
  `).all(assistant.id).map((p: any) => p.permission);

  // Retrieve scopes (for Phase 5 row-level authorization)
  const scopes = db.prepare(`
    SELECT resource_type, resource_id FROM assistant_scopes WHERE assistant_id = ?
  `).all(assistant.id) as any[];

  const scopeMap: Record<string, string[]> = {};
  for (const s of scopes) {
    if (!scopeMap[s.resource_type]) {
      scopeMap[s.resource_type] = [];
    }
    scopeMap[s.resource_type].push(s.resource_id);
  }

  // Attach to request
  req.assistant = {
    id: assistant.id,
    name: assistant.name,
    api_key_prefix: assistant.api_key_prefix,
    rate_limit_per_minute: assistant.rate_limit_per_minute,
    is_admin: assistant.is_admin === 1,
    status: assistant.status,
  };
  req.permissions = permissions;
  req.scopes = scopeMap;

  next();
}
