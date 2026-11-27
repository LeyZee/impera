import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../platform-connector';
import { readCameBack, readDownReason, readServiceOf } from '../read-health';

const now = new Date('2026-11-27T20:00:00Z');

describe('the read of a platform, as the owners are told of it (27/11/2026)', () => {
  it('watches the read of Reveal only', () => {
    expect(readServiceOf('reveal')).toBe('reveal_read');
  });

  it('names the cause: a shape changed, a session dead, or no answer', () => {
    expect(readDownReason(new ConnectorError('fatal', 'shape_changed: conversations (items.0.id)'))).toBe(
      'format_changed',
    );
    expect(readDownReason(new ConnectorError('session_expired', 'refused'))).toBe('session_expired');
    expect(readDownReason(new ConnectorError('transient', 'timeout'))).toBe('unreachable');
    expect(readDownReason(new ConnectorError('rate_limited', '429'))).toBe('unreachable');
    expect(readDownReason(new ConnectorError('fatal', 'something else'))).toBe('unreachable');
  });

  it('tells a read back after a stop only', () => {
    const minuteAgo = new Date(now.getTime() - 60_000);
    expect(readCameBack({ lastPollAt: minuteAgo, pausedUntil: null, consecutiveErrors: 0 }, now)).toBe(false);
    expect(readCameBack({ lastPollAt: minuteAgo, pausedUntil: minuteAgo, consecutiveErrors: 0 }, now)).toBe(
      true,
    );
    expect(readCameBack({ lastPollAt: null, pausedUntil: null, consecutiveErrors: 0 }, now)).toBe(true);
    const longAgo = new Date(now.getTime() - 6 * 60_000);
    expect(readCameBack({ lastPollAt: longAgo, pausedUntil: null, consecutiveErrors: 0 }, now)).toBe(true);
  });
});
