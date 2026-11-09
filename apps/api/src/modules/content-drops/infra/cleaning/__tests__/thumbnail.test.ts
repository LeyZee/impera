import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createThumbnailer } from '../thumbnail';

const run = promisify(execFile);

/** Invented pictures made by ffmpeg (a prerequisite of the repository), never a real drop. */
const DEVICE = 'Camera Inventee 7';

describe('content-drops › the reduced picture of a medium (SC-04 lot c4)', () => {
  const thumbnailer = createThumbnailer();
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'impera-thumbnail-test-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function made(name: string, args: readonly string[]): Promise<string> {
    const path = join(dir, name);
    await run('ffmpeg', ['-v', 'error', '-y', ...args, '-metadata', `comment=${DEVICE}`, path]);
    return path;
  }

  const sizeOf = async (path: string): Promise<{ width: number; height: number }> => {
    const { stdout } = await run('ffprobe', [
      ...['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0'],
      path,
    ]);
    const [width = 0, height = 0] = stdout.trim().split(',').map(Number);
    return { width, height };
  };

  it('makes a JPEG of a photo, 640 wide at most, without its tags', async () => {
    const photo = await made('photo.png', ['-f', 'lavfi', '-i', 'testsrc=size=1600x1200', '-frames:v', '1']);
    const out = join(dir, 'photo.jpg');
    expect(await thumbnailer.make(photo, 'image', out)).toBe(true);
    const bytes = await readFile(out);
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(await sizeOf(out)).toEqual({ width: 640, height: 480 });
    expect(bytes.toString('latin1').includes(DEVICE)).toBe(false);
  });

  it('makes one of a video, and keeps a small one at its size', async () => {
    const video = await made('video.mp4', [
      ...[
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=10',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
      ],
    ]);
    const out = join(dir, 'video.jpg');
    expect(await thumbnailer.make(video, 'video', out)).toBe(true);
    expect(await sizeOf(out)).toEqual({ width: 320, height: 240 });
    expect((await readFile(out)).toString('latin1').includes(DEVICE)).toBe(false);
  });

  it('gives none for a file it cannot read', async () => {
    const junk = join(dir, 'junk.mp4');
    await writeFile(junk, 'not a video at all');
    expect(await thumbnailer.make(junk, 'video', join(dir, 'junk.jpg'))).toBe(false);
  });
});
