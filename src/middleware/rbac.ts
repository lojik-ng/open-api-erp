import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, NotFoundError } from '../shared/errors';

/**
 * Middleware to enforce Role-Based Access Control and Row-Level Scoping.
 * Admin assistants bypass all checks.
 */
export function rbac(requiredPermission: string, resourceType?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.assistant) {
      return next(new ForbiddenError(requiredPermission));
    }

    // Admins bypass all restrictions
    if (req.assistant.is_admin) {
      return next();
    }

    // Enforce module-level permission check
    const hasPermission = req.permissions?.includes(requiredPermission);
    if (!hasPermission) {
      return next(new ForbiddenError(requiredPermission));
    }

    // Enforce row-level scoping if scopes exist for this resource type
    if (resourceType && req.scopes && req.scopes[resourceType]) {
      const allowedIds = req.scopes[resourceType];
      
      // Determine what resource ID is being targeted
      const targetId = req.params.id || req.body.id || req.body.resource_id || req.query.id;

      if (targetId && typeof targetId === 'string') {
        if (!allowedIds.includes(targetId)) {
          // Throw NotFoundError instead of Forbidden to prevent leaking record existence
          return next(new NotFoundError(resourceType, targetId));
        }
      }
    }

    next();
  };
}
