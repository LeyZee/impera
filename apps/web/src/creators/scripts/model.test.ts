import { SCRIPT_EXPORT_MAX_BYTES, type ScriptStructure } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { structureOf } from './fixtures';
import { mediaLine, scriptCode, sentScripts } from './model';

import { dropOf, fileOf, requestOf } from '@/screens/content/fixtures';

const NIGHT = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');
const BOTH = structureOf('0192f3a0-0000-7000-8000-000000000a02', 'Week-end inventé', 'both');

function scriptOf(
  number: number,
  structureId: ScriptStructure['id'],
  moment: 'day' | 'night' | null,
  fields: Parameters<typeof dropOf>[0] = {},
) {
  const request = requestOf({ category: 'script', structureId, moment });
  const drop = dropOf({
    category: 'script',
    scriptNumber: number,
    requestId: request.id,
    files: [
      fileOf({ slotKey: 'salon::0', bytes: 3_000_000 }),
      fileOf({ slotKey: 'salon::1', kind: 'video', mime: 'video/mp4', bytes: 1_200_000_000 }),
    ],
    ...fields,
  });
  return { request, drop };
}

describe('Créatrices › Scripts, her sent scripts (SC-03 c2b)', () => {
  it('lists her sent scripts the latest first, never another drop nor one withdrawn', () => {
    const a = scriptOf(3, NIGHT.id, 'night');
    const b = scriptOf(12, BOTH.id, 'day');
    const gone = scriptOf(4, NIGHT.id, 'night', { state: 'withdrawn' });
    const rows = sentScripts(
      {
        requests: [a.request, b.request, gone.request],
        drops: [a.drop, b.drop, gone.drop, dropOf()],
      },
      [NIGHT, BOTH],
    );
    expect(rows.map((row) => [row.code, row.name, row.moment, row.blocker])).toEqual([
      ['S012', 'Week-end inventé', 'day', null],
      ['S003', 'Soirée inventée', 'night', null],
    ]);
  });

  it('falls back on its structure’s moment, and never guesses one for « Jour et nuit »', () => {
    const old = scriptOf(1, NIGHT.id, null);
    const unknown = scriptOf(2, BOTH.id, null);
    const rows = sentScripts({ requests: [old.request, unknown.request], drops: [old.drop, unknown.drop] }, [
      NIGHT,
      BOTH,
    ]);
    expect(rows.map((row) => [row.code, row.moment, row.blocker])).toEqual([
      ['S002', null, 'moment_unknown'],
      ['S001', 'night', null],
    ]);
  });

  it('offers no archive while her media are checked, nor past what one archive holds', () => {
    const checking = scriptOf(1, NIGHT.id, 'night', { state: 'received' });
    const heavy = scriptOf(2, NIGHT.id, 'night', {
      files: [
        fileOf({ slotKey: 'salon::1', kind: 'video', mime: 'video/mp4', bytes: SCRIPT_EXPORT_MAX_BYTES + 1 }),
      ],
    });
    const rows = sentScripts(
      { requests: [checking.request, heavy.request], drops: [checking.drop, heavy.drop] },
      [NIGHT],
    );
    expect(rows.map((row) => row.blocker)).toEqual(['too_large', 'not_ready']);
  });

  it('says when her originals go once the copy is confirmed: 30 days later', () => {
    const done = scriptOf(5, NIGHT.id, 'night', { exportedAt: '2026-11-06T15:00:00.000Z' });
    const [row] = sentScripts({ requests: [done.request], drops: [done.drop] }, []);
    expect(row?.name).toBeNull();
    expect(row?.originalsUntil).toBe('2026-12-06T15:00:00.000Z');
  });

  it('reads her media as the team does', () => {
    expect(mediaLine({ photos: 3, videos: 1, bytes: 1_250_000_000 })).toBe('3 photos · 1 vidéo · 1,3 Go');
    expect(mediaLine({ photos: 1, videos: 0, bytes: 4_000_000 })).toBe('1 photo · 4 Mo');
    expect(scriptCode(7)).toBe('S007');
  });
});
