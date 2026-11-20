import { z } from 'zod';

import { AuditCursorInvalid } from '../domain/errors';
import type { AuditPosition } from '../domain/ports';

/** A position as Postgres writes `created_at` in UTC, to the microsecond, and the line's id. */
const PositionSchema = z.strictObject({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u),
  id: z.uuid(),
});

/** The cursor of `GET /v1/audit`: base64url of the position (docs/conventions/api.md § Pagination). */
export function encodeAuditCursor(position: AuditPosition): string {
  return Buffer.from(JSON.stringify({ at: position.at, id: position.id })).toString('base64url');
}

/** The position a cursor names; `AuditCursorInvalid` for anything this server did not give. */
export function decodeAuditCursor(cursor: string): AuditPosition {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new AuditCursorInvalid();
  }
  const parsed = PositionSchema.safeParse(json);
  if (!parsed.success) throw new AuditCursorInvalid();
  return parsed.data;
}
