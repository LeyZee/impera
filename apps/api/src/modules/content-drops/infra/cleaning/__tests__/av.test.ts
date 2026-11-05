import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanAv, probeAv } from '../av';

const run = promisify(execFile);

/**
 * A video and a vocal made by ffmpeg with the tags a phone writes (an invented device, a position in Paris), and the
 * proof that the cleaning leaves none of it, in the QuickTime atoms or an ID3 tag, while the picture keeps its
 * rotation. ffmpeg is a prerequisite of the repository (CLAUDE.md), in CI as here. Invented data only.
 */
const DEVICE = 'Telephone Invente 9';
const PLACE = '+48.8566+002.3522/';

describe('content-drops › a video’s and a vocal’s metadata removed by ffmpeg (ADR 0055 § 3)', () => {
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'impera-av-test-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a phone’s QuickTime video: no position, no device, its quarter turn kept', async () => {
    const plain = join(dir, 'plain.mov');
    const raw = join(dir, 'raw.mov');
    const out = join(dir, 'out.mov');
    await run('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', plain],
    ]);
    // As an iPhone writes it: the turn in the stream, the position and the device in the QuickTime keys.
    await run('ffmpeg', [
      ...['-v', 'error', '-y', '-display_rotation:v:0', '90', '-i', plain, '-c', 'copy'],
      ...[
        '-metadata',
        `location=${PLACE}`,
        '-metadata',
        `model=${DEVICE}`,
        '-movflags',
        'use_metadata_tags',
        raw,
      ],
    ]);
    const before = (await readFile(raw)).toString('latin1');
    expect(before).toContain(PLACE);
    expect(before).toContain(DEVICE);

    const probed = await probeAv(raw);
    expect(probed).toMatchObject({ videoCodec: 'h264', audio: { index: 1, codec: 'aac' } });
    await cleanAv(raw, out, {
      video: true,
      route: 'copy',
      quicktime: true,
      audio: probed.audio,
      bytes: 1,
      durationMs: probed.durationMs,
    });
    const after = (await readFile(out)).toString('latin1');
    expect(after).not.toContain(PLACE);
    expect(after).not.toContain(DEVICE);
    expect(after).not.toContain('Lavf');
    // 320 × 240 turned a quarter: it shows 240 wide, 320 high, two seconds long, with its sound.
    expect(await probeAv(out)).toEqual({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audio: { index: 1, codec: 'aac' },
      width: 240,
      height: 320,
      durationMs: 2000,
    });
  });

  it('a vocal in MP3: its ID3 tag gone, the sound kept', async () => {
    const raw = join(dir, 'raw.mp3');
    const out = join(dir, 'out.mp3');
    await run('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:a', 'libmp3lame'],
      ...['-metadata', `artist=${DEVICE}`, '-metadata', `comment=${PLACE}`, raw],
    ]);
    expect((await readFile(raw)).toString('latin1')).toContain(DEVICE);
    await cleanAv(raw, out, { video: false, family: 'mp3', bytes: 1 });
    const after = await readFile(out);
    expect(after.toString('latin1')).not.toContain(DEVICE);
    expect(after.toString('latin1').startsWith('ID3')).toBe(false);
    const probed = await probeAv(out);
    expect(probed).toMatchObject({ hasVideo: false, hasAudio: true, width: null, height: null });
    expect(probed.durationMs).toBeGreaterThan(900);
  });

  it('throws on a file it cannot read', async () => {
    const raw = join(dir, 'broken.mp4');
    await run('sh', ['-c', `printf '\\000\\000\\000\\030ftypmp42garbage' > '${raw}'`]);
    await expect(
      cleanAv(raw, join(dir, 'x.mp4'), {
        video: true,
        route: 'copy',
        quicktime: false,
        audio: null,
        bytes: 1,
        durationMs: null,
      }),
    ).rejects.toThrow();
  });
});
