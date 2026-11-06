import { InstagramPostCodeSchema, TREND_CAPTURE_MAX_BYTES } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { captureMarked, captureOf, decodedBytes } from './captures';

const CODE = InstagramPostCodeSchema.parse('Cx0abc12DEf');
const SMALL = `data:image/jpeg;base64,${btoa('une capture inventée')}`;
const HUGE = `data:image/jpeg;base64,${'A'.repeat(Math.ceil(((TREND_CAPTURE_MAX_BYTES + 10) * 4) / 3))}`;

describe('captureOf', () => {
  it('takes a JPEG that fits, as the API wants it', () => {
    expect(captureOf(SMALL)).toEqual({ mediaType: 'image/jpeg', data: btoa('une capture inventée') });
    expect(decodedBytes(btoa('abcd'))).toBe(4);
  });

  it('refuses anything else', () => {
    expect(captureOf(HUGE)).toBeNull();
    expect(captureOf('data:image/png;base64,AAAA')).toBeNull();
    expect(captureOf(null)).toBeNull();
  });
});

describe('captureMarked', () => {
  const wait = (): Promise<void> => Promise.resolve();

  it('takes four shots while the post stays on screen', async () => {
    const shoot = vi.fn(() => Promise.resolve<string | null>(SMALL));
    const captures = await captureMarked(CODE, { shoot, onScreen: () => Promise.resolve(CODE), wait });
    expect(captures).toHaveLength(4);
    expect(shoot).toHaveBeenCalledTimes(4);
  });

  it('stops as soon as the post leaves the screen', async () => {
    const onScreen = vi
      .fn<() => Promise<typeof CODE | null>>()
      .mockResolvedValueOnce(CODE)
      .mockResolvedValueOnce(CODE)
      .mockResolvedValue(null);
    const captures = await captureMarked(CODE, { shoot: () => Promise.resolve(SMALL), onScreen, wait });
    expect(captures).toHaveLength(2);
  });

  it('lowers the quality when a shot is too heavy, and gives up past the lowest', async () => {
    const shoot = vi.fn((quality: number) => Promise.resolve(quality > 40 ? HUGE : SMALL));
    const captures = await captureMarked(CODE, { shoot, onScreen: () => Promise.resolve(CODE), wait });
    expect(captures).toHaveLength(4);
    expect(shoot.mock.calls.slice(0, 3).map(([quality]) => quality)).toEqual([70, 50, 35]);
    const heavy = await captureMarked(CODE, {
      shoot: () => Promise.resolve(HUGE),
      onScreen: () => Promise.resolve(CODE),
      wait,
    });
    expect(heavy).toEqual([]);
  });

  it('takes nothing when the tab cannot be shot (another tab shown)', async () => {
    const captures = await captureMarked(CODE, {
      shoot: () => Promise.resolve(null),
      onScreen: () => Promise.resolve(CODE),
      wait,
    });
    expect(captures).toEqual([]);
  });
});
