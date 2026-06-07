import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { db, withTransaction } from '../../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { logger } from '../../config/logger';

export interface RegisterWebhookInput {
  url: string;
  eventType: string;
}

function isSafeUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') {
      return false;
    }
    if (hostname === '169.254.169.254') {
      return false;
    }
    if (hostname.startsWith('10.')) {
      return false;
    }
    if (hostname.startsWith('192.168.')) {
      return false;
    }
    if (hostname.startsWith('172.')) {
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        const second = parseInt(parts[1], 10);
        if (second >= 16 && second <= 31) {
          return false;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

export class WebhooksService {
  static register(input: RegisterWebhookInput, assistantId: string) {
    if (!isSafeUrl(input.url)) {
      throw new ValidationError({ url: 'Webhook URL must not point to local or private networks.' });
    }

    return withTransaction(() => {
      const id = uuid();
      const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
      
      try {
        db.prepare(`
          INSERT INTO webhook_subscriptions (id, assistant_id, url, event_type, secret, status)
          VALUES (?, ?, ?, ?, ?, 'active')
        `).run(id, assistantId, input.url, input.eventType, secret);
      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          throw new ConflictError(`A subscription for this URL and event type already exists.`);
        }
        throw err;
      }

      return {
        id,
        assistant_id: assistantId,
        url: input.url,
        event_type: input.eventType,
        secret,
        status: 'active',
      };
    });
  }

  static list(assistantId: string) {
    return db.prepare('SELECT id, url, event_type, status, created_at FROM webhook_subscriptions WHERE assistant_id = ?').all(assistantId);
  }

  static delete(id: string, assistantId: string) {
    const result = db.prepare('DELETE FROM webhook_subscriptions WHERE id = ? AND assistant_id = ?').run(id, assistantId);
    if (result.changes === 0) {
      throw new NotFoundError('Webhook subscription', id);
    }
    return { success: true };
  }

  /**
   * Dispatch webhooks matching the eventType or wildcard '*' asynchronously.
   */
  static async dispatch(eventType: string, payload: any) {
    try {
      // Fetch matching subscriptions
      const subscriptions = db.prepare(`
        SELECT url, secret 
        FROM webhook_subscriptions 
        WHERE status = 'active' AND (event_type = ? OR event_type = '*')
      `).all(eventType) as { url: string; secret: string }[];

      if (subscriptions.length === 0) {
        return;
      }

      const bodyStr = JSON.stringify({
        event: eventType,
        timestamp: new Date().toISOString(),
        data: payload
      });

      for (const sub of subscriptions) {
        // Compute signature: HMAC-SHA256 using subscription secret
        const signature = crypto.createHmac('sha256', sub.secret).update(bodyStr).digest('hex');

        // Fire request asynchronously (fire-and-forget, handle error gracefully)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-webhook-signature': signature
        };

        logger.debug({ url: sub.url, eventType }, 'Dispatching webhook notification');

        // Execute POST request using standard fetch API or dynamic import of a fetch library.
        // Node 18+ has native fetch. Let's use native global fetch.
        if (typeof fetch !== 'undefined') {
          fetch(sub.url, {
            method: 'POST',
            headers,
            body: bodyStr,
            signal: AbortSignal.timeout(3000) // 3 seconds timeout
          }).then(res => {
            logger.debug({ url: sub.url, status: res.status }, 'Webhook dispatched response');
          }).catch(err => {
            logger.debug({ url: sub.url, err: err.message }, 'Webhook request failed');
          });
        }
      }
    } catch (err) {
      logger.error(err, 'Failed to dispatch webhooks');
    }
  }
}
