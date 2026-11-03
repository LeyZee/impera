import { err, ok, type MediaDescription } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { createInMemoryDescriptionStore } from '../../infra/gateway-senser';
import {
  createMediaDescriber,
  type MediaTools,
  type SenseRequest,
  type Transcriber,
} from '../describe-media';

const DESCRIPTION: MediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'video',
  factualDescription: 'Mire de couleurs avec un compteur.',
  durationS: 12,
  segments: [],
  intensity: 'not_visible',
  anatomyVisible: [],
  castMode: 'not_visible',
  mood: [],
  setting: null,
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

const TOOLS: MediaTools = {
  probe: () => Promise.resolve({ durationS: 12, hasAudio: true }),
  keyframes: () =>
    Promise.resolve([0, 4, 8].map((atS) => ({ atS, mediaType: 'image/jpeg', data: new Uint8Array([atS]) }))),
  audioTrack: () => Promise.resolve(new Uint8Array([7])),
  toJpeg: () => Promise.resolve(new Uint8Array([0xff, 0xd8])),
};

function setup(tools: MediaTools = TOOLS, transcribe?: Transcriber, isFallback = false) {
  const requests: SenseRequest[] = [];
  const describer = createMediaDescriber({
    sense: (request) => {
      requests.push(request);
      return Promise.resolve(ok({ description: DESCRIPTION, isFallback }));
    },
    ...(transcribe && { transcribe }),
    store: createInMemoryDescriptionStore(),
    tools,
    senseVersion: 'gemini-3.8-flash:abc',
  });
  return { describer, requests };
}

describe('describe media', () => {
  it('describes a video once, from its keyframes and what is said in it', async () => {
    const { describer, requests } = setup(TOOLS, () => Promise.resolve(ok('viens voir')));
    const file = { origin: 'creator', mediaType: 'video/mp4', data: new Uint8Array([9, 9, 9]) } as const;

    expect((await describer.describe(file)).ok).toBe(true);
    expect((await describer.describe(file)).ok).toBe(true);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request).toMatchObject({ kind: 'video', durationS: 12, mediaType: 'video/mp4' });
    const cut = request?.kind === 'video' ? await request.keyframes() : undefined;
    expect(cut?.frames.map((f) => f.atS)).toEqual([0, 4, 8]);
    expect(cut?.transcript).toBe('viens voir');
  });

  it('keeps no description made by the fallback model: the next one asks the main model again', async () => {
    const { describer, requests } = setup(TOOLS, undefined, true);
    const file = { origin: 'fan', mediaType: 'image/png', data: new Uint8Array([5]) } as const;
    await describer.describe(file);
    await describer.describe(file);
    expect(requests).toHaveLength(2);
  });

  it('samples a long video sparser instead of decoding every second', async () => {
    const rates: number[] = [];
    const { describer, requests } = setup({
      ...TOOLS,
      probe: () => Promise.resolve({ durationS: 600, hasAudio: false }),
      keyframes: (_, perSecond) => Promise.resolve((rates.push(perSecond), [])),
    });
    await describer.describe({ origin: 'creator', mediaType: 'video/mp4', data: new Uint8Array([6]) });
    const request = requests[0];
    if (request?.kind === 'video') await request.keyframes();
    expect(rates).toEqual([0.04]);
  });

  it('cuts nothing while the vision model reads the video itself', async () => {
    let cuts = 0;
    const { describer } = setup({ ...TOOLS, keyframes: () => Promise.resolve(((cuts += 1), [])) });
    await describer.describe({ origin: 'fan', mediaType: 'video/mp4', data: new Uint8Array([4]) });
    expect(cuts).toBe(0);
  });

  it('keeps the images when the transcription fails', async () => {
    const { describer, requests } = setup(TOOLS, () => Promise.resolve(err('xai: timeout')));
    const result = await describer.describe({
      origin: 'fan',
      mediaType: 'video/mp4',
      data: new Uint8Array([1]),
    });
    expect(result.ok).toBe(true);
    const request = requests[0];
    expect(request?.kind === 'video' && (await request.keyframes())).not.toHaveProperty('transcript');
  });

  it('converts a WebP photo to JPEG before describing it', async () => {
    const { describer, requests } = setup();
    await describer.describe({ origin: 'fan', mediaType: 'image/webp', data: new Uint8Array([1, 2]) });
    expect(requests[0]).toMatchObject({ kind: 'image', mediaType: 'image/jpeg' });
  });

  it('refuses a file that is neither a photo nor a video', async () => {
    const { describer } = setup();
    const result = await describer.describe({
      origin: 'fan',
      mediaType: 'text/html',
      data: new Uint8Array(),
    });
    expect(!result.ok && result.error.code).toBe('unsupported_media');
  });

  it('says so when the video cannot be read', async () => {
    const { describer } = setup({ ...TOOLS, probe: () => Promise.reject(new Error('moov atom not found')) });
    const result = await describer.describe({
      origin: 'fan',
      mediaType: 'video/mp4',
      data: new Uint8Array([1]),
    });
    expect(!result.ok && result.error).toEqual({ code: 'unreadable_media', detail: 'moov atom not found' });
  });
});
