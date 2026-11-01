import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFfmpegMediaTools, missingMediaBinaries } from '../ffmpeg-media-tools';

const dir = mkdtempSync(join(tmpdir(), 'nirvana-ffmpeg-test-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// These tests run the real ffmpeg (a prerequisite, CLAUDE.md): say so plainly when it is not installed.
beforeAll(async () => {
  const missing = await missingMediaBinaries();
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(' et ')} ${missing.length > 1 ? 'absents' : 'absent'} du PATH : installe ffmpeg (il fournit aussi ffprobe), puis relance.`,
    );
  }
});

/** Synthetic media made on the fly: no real data. */
function make(name: string, ...args: string[]): Uint8Array {
  const path = join(dir, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path]);
  return new Uint8Array(readFileSync(path));
}

const JPEG_MAGIC = [0xff, 0xd8];

describe('ffmpeg media tools', () => {
  const tools = createFfmpegMediaTools();

  it('reads duration and sound, and cuts a moving video into dated keyframes', async () => {
    const video = make(
      'pattern.mp4',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=6:size=320x240:rate=10',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=6',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
    );

    expect(await tools.probe(video)).toMatchObject({ hasAudio: true });
    expect((await tools.probe(video)).durationS).toBeCloseTo(6, 0);
    const frames = await tools.keyframes(video, 1);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    expect(frames.map((f) => f.atS)).toEqual([...frames.map((f) => f.atS)].sort((a, b) => a - b));
    expect([...(frames[0]?.data.slice(0, 2) ?? [])]).toEqual(JPEG_MAGIC);
    expect((await tools.audioTrack(video)).byteLength).toBeGreaterThan(1_000);
  });

  it('drops the frames of a still video', async () => {
    const still = make(
      'still.mp4',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=320x240:d=8:r=10',
      '-pix_fmt',
      'yuv420p',
    );
    expect(await tools.probe(still)).toMatchObject({ hasAudio: false });
    expect((await tools.keyframes(still, 1)).length).toBeLessThanOrEqual(2);
  });

  it('turns any image into a JPEG', async () => {
    const webp = make('pixel.webp', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1');
    expect([...(await tools.toJpeg(webp)).slice(0, 2)]).toEqual(JPEG_MAGIC);
  });

  it('fails on a file that is not a video', async () => {
    await expect(tools.probe(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
