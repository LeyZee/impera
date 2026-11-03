import { err, ok, type MediaDescription } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { MediaDescriber } from '../../../media';
import { createMediaSight, MEDIA_MAX_BYTES } from '../media-sight';

const MEDIA = {
  creatorId: 'c',
  conversationId: 'v',
  platformAccountId: 'a',
  platformConversationId: 't',
  platformMessageId: 'msg',
  platformMediaId: 'm-1',
  kind: 'image',
} as const;
const DESCRIPTION: MediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  factualDescription: 'Un chat roux sur un canapé.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'solo',
  mood: [],
  setting: null,
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

function describer(result: Awaited<ReturnType<MediaDescriber['describe']>>) {
  const files: unknown[] = [];
  const value: MediaDescriber = {
    describe: (file) => {
      files.push(file);
      return Promise.resolve(result);
    },
  };
  return { value, files };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const file =
  (data: Uint8Array, mediaType = 'image/jpeg') =>
  () =>
    Promise.resolve(ok({ mediaType, data }));

describe('createMediaSight', () => {
  it('fetches his file and describes it as a fan media, with the type read from its bytes', async () => {
    const { value, files } = describer(ok(DESCRIPTION));
    // The platform calls it a png: its bytes say jpeg, and the bytes are what the vision gets told.
    const sight = createMediaSight({ fetchMedia: file(JPEG, 'image/png'), describer: value });
    expect(await sight.see(MEDIA)).toEqual(ok(DESCRIPTION));
    expect(files).toEqual([{ origin: 'fan', mediaType: 'image/jpeg', data: JPEG }]);
  });

  it('passes on why the platform gave no file', async () => {
    const { value, files } = describer(ok(DESCRIPTION));
    for (const refusal of ['gone', 'locked', 'too_large', 'unsupported'] as const) {
      const sight = createMediaSight({ fetchMedia: () => Promise.resolve(err(refusal)), describer: value });
      expect(await sight.see(MEDIA)).toEqual(err(refusal));
    }
    expect(files).toEqual([]);
  });

  it('refuses a file too big, of unknown type, or not of the kind announced, before any call', async () => {
    const { value, files } = describer(ok(DESCRIPTION));
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    big.set(JPEG);
    const mp4 = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypisom')]);
    const cases = [
      [big, 'too_large'],
      [new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]), 'unsupported'],
      [mp4, 'unsupported'],
    ] as const;
    for (const [data, reason] of cases) {
      const sight = createMediaSight({ fetchMedia: file(data), describer: value });
      expect(await sight.see(MEDIA), reason).toEqual(err(reason));
    }
    expect(files).toEqual([]);
  });

  it('says why it saw nothing when the fetch or the description fails', async () => {
    const { value } = describer(err({ code: 'sense_failed' }));
    const broken = createMediaSight({ fetchMedia: () => Promise.reject(new Error('503')), describer: value });
    const blind = createMediaSight({ fetchMedia: file(JPEG), describer: value });
    const crashing = createMediaSight({
      fetchMedia: file(JPEG),
      describer: { describe: () => Promise.reject(new Error('store down')) },
    });
    expect(await broken.see(MEDIA)).toEqual(err('fetch_failed'));
    expect(await blind.see(MEDIA)).toEqual(err('sense_failed'));
    expect(await crashing.see(MEDIA)).toEqual(err('describe_failed'));
  });
});
