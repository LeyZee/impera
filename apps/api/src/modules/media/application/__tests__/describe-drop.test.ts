import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { err, ok, type DropMediaDescription } from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDropDescriber,
  DROP_VIDEO_INLINE_MAX_BYTES,
  type DropContext,
  type DropSensed,
  type DropSenseError,
  type DropSenseRequest,
  type FileMediaTools,
} from '../describe-drop';

/** Invented (ADR 0010). */
const DESCRIPTION: DropMediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'video',
  detailed:
    'Chambre éclairée par une lampe de chevet. Elle s’assoit au bord du lit en nuisette noire et dit « coucou ».',
  factualDescription: 'Elle s’assoit au bord du lit en nuisette noire.',
  durationS: 12,
  segments: [{ startS: 0, endS: 12, description: 'Elle s’assoit et salue la caméra.' }],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'solo',
  mood: [],
  setting: 'chambre, lampe de chevet, nuisette noire',
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

const SENSED: DropSensed = { description: DESCRIPTION, model: 'gemini-3.8-flash', promptHash: 'abc' };

const CONTEXT: DropContext = {
  category: 'Script',
  step: { number: 2, name: 'La nuisette', instruction: 'Assise au bord du lit.', position: 1, count: 3 },
};

const TOOLS: FileMediaTools = {
  probe: () => Promise.resolve({ durationS: 12, hasAudio: true }),
  keyframes: () =>
    Promise.resolve([0, 4, 8].map((atS) => ({ atS, mediaType: 'image/jpeg', data: new Uint8Array([atS]) }))),
  audioTrack: () => Promise.resolve(new Uint8Array([7])),
  toJpeg: () => Promise.resolve(new Uint8Array([0xff, 0xd8])),
};

let dir = '';
let path = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'describe-drop-'));
  path = join(dir, 'media');
  await writeFile(path, new Uint8Array([1, 2, 3]));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(answers: readonly (DropSensed | DropSenseError)[]) {
  const requests: DropSenseRequest[] = [];
  let call = 0;
  const describer = createDropDescriber({
    tools: TOOLS,
    transcribe: () => Promise.resolve(ok('coucou')),
    sense: (request) => {
      requests.push(request);
      const answer = answers[Math.min(call, answers.length - 1)] ?? 'failed';
      call += 1;
      return Promise.resolve(typeof answer === 'string' ? err(answer) : ok(answer));
    },
  });
  return { describer, requests };
}

const video = (bytes: number) =>
  ({ creatorId: 'creator-1', path, mime: 'video/mp4', kind: 'video', bytes, context: CONTEXT }) as const;

describe('describe a drop (ADR 0083)', () => {
  it('sends a light video whole, with its context, and holds nothing back', async () => {
    const { describer, requests } = setup([SENSED]);
    const result = await describer.describe(video(3));

    expect(result).toEqual(ok({ ...SENSED, reviewReasons: [] }));
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.context).toEqual(CONTEXT);
    expect(request?.creatorId).toBe('creator-1');
    expect(request?.kind === 'video' && request.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reads a heavy video by its keyframes and what is said, never whole', async () => {
    const { describer, requests } = setup([SENSED]);
    await describer.describe(video(DROP_VIDEO_INLINE_MAX_BYTES + 1));

    const [request] = requests;
    if (request?.kind !== 'video') throw new Error('a video was expected');
    expect(request.data).toBeNull();
    const read = await request.keyframes();
    expect(read.frames.map((f) => f.atS)).toEqual([0, 4, 8]);
    expect(read.transcript).toBe('coucou');
  });

  it('converts a photo the model does not take, and sends a JPEG as it is', async () => {
    const { describer, requests } = setup([SENSED]);
    const photo = { creatorId: 'creator-1', path, kind: 'image', bytes: 3, context: CONTEXT } as const;
    await describer.describe({ ...photo, mime: 'image/heic' });
    await describer.describe({ ...photo, mime: 'image/jpeg' });

    expect(requests.map((r) => (r.kind === 'image' ? [r.mediaType, [...r.data]] : null))).toEqual([
      ['image/jpeg', [0xff, 0xd8]],
      ['image/jpeg', [1, 2, 3]],
    ]);
  });

  it('asks once more when the description points to another media (§ 3)', async () => {
    const elsewhere = {
      ...SENSED,
      description: { ...DESCRIPTION, detailed: 'Elle porte à nouveau la nuisette.' },
    };
    const { describer, requests } = setup([elsewhere, SENSED]);

    expect(await describer.describe(video(3))).toEqual(ok({ ...SENSED, reviewReasons: [] }));
    expect(requests).toHaveLength(2);
  });

  it('keeps it for a human, with its reason, when the second one points elsewhere too', async () => {
    const elsewhere = { ...SENSED, description: { ...DESCRIPTION, detailed: 'Toujours la même nuisette.' } };
    const { describer, requests } = setup([elsewhere]);

    expect(await describer.describe(video(3))).toEqual(
      ok({ ...elsewhere, reviewReasons: ['back_reference'] }),
    );
    expect(requests).toHaveLength(2);
  });

  it('keeps the first one when the second call fails', async () => {
    const elsewhere = { ...SENSED, description: { ...DESCRIPTION, detailed: 'Encore assise.' } };
    const { describer } = setup([elsewhere, 'failed']);

    expect(await describer.describe(video(3))).toEqual(
      ok({ ...elsewhere, reviewReasons: ['back_reference'] }),
    );
  });

  it('never asks again for another person: the model is not trusted, a human clears it (§ 4)', async () => {
    const duo = { ...SENSED, description: { ...DESCRIPTION, castMode: 'duo' as const } };
    const { describer, requests } = setup([duo]);

    expect(await describer.describe(video(3))).toEqual(ok({ ...duo, reviewReasons: ['not_alone'] }));
    expect(requests).toHaveLength(1);
  });

  it('says the budget is spent, so the job asks again tomorrow (§ 8)', async () => {
    const { describer } = setup(['budget']);
    expect(await describer.describe(video(3))).toEqual(err({ code: 'budget' }));
  });

  it('says a file it cannot read, without calling the model', async () => {
    const { describer, requests } = setup([SENSED]);
    const result = await describer.describe({ ...video(3), path: join(dir, 'missing') });

    expect(result.ok ? null : result.error.code).toBe('unreadable');
    expect(requests).toHaveLength(0);
  });
});
