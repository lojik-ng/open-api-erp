/**
 * Encode a cursor from a record's created_at and id.
 * Format: base64url("created_at|id")
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url');
}

/**
 * Decode a cursor back to its components.
 */
export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const [createdAt, id] = decoded.split('|');
    if (!createdAt || !id) {
      throw new Error('Invalid cursor format');
    }
    return { createdAt, id };
  } catch (err) {
    throw new Error('Invalid cursor');
  }
}

/**
 * Build the WHERE clause and params for cursor-based pagination.
 * Uses a composite comparison: (created_at, id) > (cursor_created_at, cursor_id)
 */
export function cursorWhereClause(cursor?: string): { clause: string; params: string[] } {
  if (!cursor) return { clause: '', params: [] };

  const { createdAt, id } = decodeCursor(cursor);
  return {
    clause: 'AND (created_at > ? OR (created_at = ? AND id > ?))',
    params: [createdAt, createdAt, id],
  };
}
