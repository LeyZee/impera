import { FanIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { DONE_KEPT_MS, drawnKey, keepsDone } from './redraw';
import type { GestureDone, PanelScreen } from './view';

const screen = (now: string, text = ''): PanelScreen => ({
  kind: 'conversation',
  fanName: 'marc_lyon',
  money: null,
  standing: null,
  cardOn: true,
  opensCreators: false,
  card: { fanId: FanIdSchema.parse('0199f2a0-0000-7000-8000-000000000003'), fields: [], others: [] },
  openGroups: new Set(['him']),
  newSince: null,
  draft: {
    kind: 'ready',
    bubbles: ['coucou'],
    placed: false,
    mode: 'editing',
    text,
    reason: null,
    done: null,
  },
  now: new Date(now),
});

describe('what makes the panel draw again', () => {
  // Recette du 16/11, EXT-15: « à l'instant » stayed for ever; EXT-01: the text he types never redraws.
  it('follows the clock by the minute, never his typing', () => {
    const base = drawnKey(screen('2026-11-08T18:00:05Z'));
    expect(drawnKey(screen('2026-11-08T18:00:55Z'))).toBe(base);
    expect(drawnKey(screen('2026-11-08T18:01:00Z'))).not.toBe(base);
    expect(drawnKey(screen('2026-11-08T18:00:05Z', 'coucou toi'))).toBe(base);
    expect(base).toContain('"openGroups":["him"]');
  });

  // EXT-23: « Refusé… » vanished in less than 5 s with the draft.
  it('keeps what a gesture left a while, and while bubbles are left to copy', () => {
    const done = (patch: Partial<GestureDone>): GestureDone => ({
      outcome: 'rejected',
      bubbles: ['a', 'b'],
      copied: 0,
      copyFailed: false,
      sent: 'sent',
      ...patch,
    });
    expect(keepsDone(done({}), 0, DONE_KEPT_MS - 1)).toBe(true);
    expect(keepsDone(done({}), 0, DONE_KEPT_MS)).toBe(false);
    expect(keepsDone(done({ outcome: 'placed', copied: 1 }), 0, DONE_KEPT_MS * 10)).toBe(true);
    expect(keepsDone(done({ outcome: 'placed', copied: 2 }), 0, DONE_KEPT_MS)).toBe(false);
  });
});
