import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_SETTINGS } from '../../domain/guards';
import {
  pickVoiceExamples,
  replayableTests,
  voiceExamples,
  type CalibrationRecord,
} from '../calibration-record';
import { createJsonlCalibrationStore } from '../jsonl-calibration-store';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const HERS = { creatorId: 'creator-1', personaVersionId: 'version-1', guardSettings: DEFAULT_GUARD_SETTINGS };

function record(id: string, verdict: CalibrationRecord['verdict'], hers = true): CalibrationRecord {
  return {
    id,
    sessionId: 's1',
    at: '2026-10-17T19:00:00Z',
    version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
    verdict,
    ...(verdict.kind === 'corrected' && { destination: 'voice_example' as const }),
    ...(hers && { creatorId: HERS.creatorId, personaVersionId: HERS.personaVersionId }),
    fanMessage: 'Salut toi',
    bubbles: ['Coucou toi, ça va ?'],
    moment: {
      history: [{ from: 'fan', text: 'Salut toi' }],
      fanNotes: '',
      situation: {
        now: new Date('2026-10-17T21:30:00Z'),
        timeZone: 'Europe/Paris',
        relationshipStartedAt: new Date('2026-10-14T21:30:00Z'),
        spentCents: 0,
      },
    },
  };
}

describe('JSONL calibration store', () => {
  it('keeps every rating and reads them back, skipping a damaged line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'impera-training-'));
    dirs.push(dir);
    const path = join(dir, 'sub', 'ratings.jsonl');
    const store = createJsonlCalibrationStore(path);

    expect(await store.list()).toEqual([]);
    await store.append(record('a', { kind: 'validated' }));
    await appendFile(path, '{"cut by a cra\n');
    await store.append(record('b', { kind: 'corrected', text: 'Coucou toi ✨' }));
    await store.append(record('c', { kind: 'rejected', reason: 'too_long' }));

    const records = await store.list();
    expect(records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(records[0]?.moment.situation.now).toEqual(new Date('2026-10-17T21:30:00Z'));
    expect(voiceExamples(records, HERS).map((e) => e.text)).toEqual(['Coucou toi ✨']);
    expect(replayableTests(records).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('gives back only her corrections, of the version that answered, that her guards let through (AGE-07)', () => {
    const corrected = (id: string, text: string, over: Partial<CalibrationRecord> = {}) => ({
      ...record(id, { kind: 'corrected', text }),
      ...over,
    });
    const records = [
      corrected('a', 'Coucou toi ✨'),
      corrected('b', 'Pareil ailleurs', { creatorId: 'creator-2' }),
      corrected('c', 'Ancienne version', { personaVersionId: 'version-0' }),
      corrected('d', 'Je suis une IA'),
      corrected('e', 'Et toi alors 😏'),
    ];
    expect(voiceExamples(records, HERS).map((e) => e.text)).toEqual(['Et toi alors 😏', 'Coucou toi ✨']);
    const invented = [record('f', { kind: 'corrected', text: 'Sur la persona inventée' }, false)];
    expect(voiceExamples(invented, HERS)).toEqual([]);
  });
});

describe('pickVoiceExamples (ADR 0102 § 2, § 4)', () => {
  it('keeps her bank’s order, leaves out what her hard guards stop, and gives twelve at most', () => {
    const bank = [
      { id: 'n', text: 'Hey toi, le plus récent' },
      { id: 'ia', text: 'Je suis une IA' },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `e${String(i)}`, text: `Coucou ${String(i)}` })),
    ];
    const picked = pickVoiceExamples(bank, DEFAULT_GUARD_SETTINGS);
    expect(picked).toHaveLength(12);
    expect(picked[0]?.id).toBe('n');
    expect(picked.map((e) => e.id)).not.toContain('ia');
    expect(pickVoiceExamples(bank, DEFAULT_GUARD_SETTINGS, 2).map((e) => e.id)).toEqual(['n', 'e0']);
  });
});
