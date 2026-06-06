import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { db } from '../config/database';
import { logger } from '../config/logger';

class EventBus extends EventEmitter {
  /**
   * Emit an event, persist it to the events table, and notify listeners.
   */
  publish(
    eventType: string,
    sourceModule: string,
    resourceType: string,
    resourceId: string,
    payload: object
  ): string {
    const eventId = uuid();

    try {
      db.prepare(`
        INSERT INTO events (id, event_type, source_module, resource_type, resource_id, payload, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(eventId, eventType, sourceModule, resourceType, resourceId, JSON.stringify(payload));

      logger.debug({ eventId, eventType }, 'Event persisted to outbox');

      // Emit to in-process listeners
      this.emit(eventType, { eventId, resourceType, resourceId, payload });
    } catch (err) {
      logger.error({ err, eventType, resourceId }, 'Failed to publish event');
      throw err;
    }

    return eventId;
  }

  /**
   * Mark an event as completed.
   */
  markCompleted(eventId: string) {
    try {
      db.prepare("UPDATE events SET status = 'completed' WHERE id = ?").run(eventId);
      logger.debug({ eventId }, 'Event marked completed');
    } catch (err) {
      logger.error({ err, eventId }, 'Failed to mark event completed');
    }
  }

  /**
   * Mark an event as failed and record the error.
   */
  markFailed(eventId: string, error: Error) {
    try {
      db.prepare("UPDATE events SET status = 'failed', error_message = ? WHERE id = ?").run(error.message, eventId);
      logger.warn({ eventId, error: error.message }, 'Event marked failed');
    } catch (err) {
      logger.error({ err, eventId }, 'Failed to mark event failed');
    }
  }

  /**
   * Recovery: called on application startup.
   * Re-emits any events that were persisted but never completed.
   */
  replayUnprocessed() {
    try {
      const unprocessed = db.prepare(
        "SELECT * FROM events WHERE status = 'pending' ORDER BY created_at ASC"
      ).all() as any[];

      if (unprocessed.length > 0) {
        logger.info(`Replaying ${unprocessed.length} unprocessed events`);
      }

      for (const event of unprocessed) {
        logger.debug({ eventId: event.id, eventType: event.event_type }, 'Replaying event');
        this.emit(event.event_type, {
          eventId: event.id,
          resourceType: event.resource_type,
          resourceId: event.resource_id,
          payload: JSON.parse(event.payload),
        });
      }
    } catch (err) {
      logger.error(err, 'Failed to replay unprocessed events');
    }
  }
}

export const eventBus = new EventBus();
export default eventBus;
