import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFfmpegMediaTools, missingMediaBinaries } from '../ffmpeg-media-tools';

const dir = mkdtempSync(join(tmpdir(), 'impera-ffmpeg-test-'));
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

  // Audit de sécurité du 02/11 (M4): a fan's file never makes ffmpeg open anything but itself.
  it('refuses a playlist naming other files, whatever its content claims', async () => {
    const playlist = new TextEncoder().encode(
      '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nfile:///etc/hostname\n#EXT-X-ENDLIST\n',
    );
    await expect(tools.probe(playlist)).rejects.toThrow();
    await expect(tools.audioTrack(playlist)).rejects.toThrow();
    await expect(tools.toJpeg(playlist)).rejects.toThrow();
  });

  it('refuses a container outside the formats a phone sends', async () => {
    const bmp = make('pixel.bmp', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64', '-frames:v', '1');
    await expect(tools.toJpeg(bmp)).rejects.toThrow(/whitelist/);
  });

  it('fails without quoting the file’s own metadata, only the binary, its exit and its last line', async () => {
    // A file with sound and no picture: keyframes fails after ffmpeg printed the input's metadata on stderr.
    const sound = make(
      'sound.mp4',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=1',
      '-metadata',
      'title=TitreDeLaCreatrice',
      '-c:a',
      'aac',
    );
    const failure = await tools.keyframes(sound, 4).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : '';
    expect(message).toMatch(/^ffmpeg failed \(exit \d+\)/u);
    expect(message).not.toContain('TitreDeLaCreatrice');
  });

  it('kills a call that runs past its time', async () => {
    // A 1 ms budget is spent before ffmpeg has even started: a tiny clip is enough, and keeps the test fast on a busy
    // machine (encoding a long one here outgrew Vitest's 5 s during a loaded pre-push).
    const hurried = createFfmpegMediaTools(undefined, { probe: 1, keyframes: 1, audioTrack: 1, toJpeg: 1 });
    const video = make(
      'short.mp4',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=64x64:rate=10',
      '-pix_fmt',
      'yuv420p',
    );
    await expect(hurried.keyframes(video, 4)).rejects.toMatchObject({ killed: true, signal: 'SIGKILL' });
  });
});

describe('the start-up check of the media binaries', () => {
  it('counts a binary too slow to answer as present, not missing', async () => {
    // 1 ms: ffmpeg is killed before it prints its version, as on a machine under the whole suite's load.
    expect(await missingMediaBinaries({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, 1)).toEqual([]);
  });

  it('names a binary that cannot start', async () => {
    expect(await missingMediaBinaries({ ffmpeg: 'impera-no-such-ffmpeg', ffprobe: 'ffprobe' })).toEqual([
      'ffmpeg',
    ]);
  });
});
