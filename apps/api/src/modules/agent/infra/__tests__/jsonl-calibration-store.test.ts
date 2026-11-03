import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { replayableTests, voiceExamples, type CalibrationRecord } from '../calibration-record';
import { createJsonlCalibrationStore } from '../jsonl-calibration-store';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function record(id: string, verdict: CalibrationRecord['verdict']): CalibrationRecord {
  return {
    id,
    sessionId: 's1',
    at: '2026-10-17T19:00:00Z',
    version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
    verdict,
    ...(verdict.kind === 'corrected' && { destination: 'voice_example' as const }),
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
    expect(voiceExamples(records)).toEqual(['Coucou toi ✨']);
    expect(replayableTests(records).map((r) => r.id)).toEqual(['b', 'c']);
  });
});
