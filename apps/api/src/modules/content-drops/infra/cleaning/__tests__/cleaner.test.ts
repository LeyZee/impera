import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DropMime } from '@impera/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sniff } from '../../../domain/sniff';
import { probeAv } from '../av';
import { createFileCleaner } from '../cleaner';

const run = promisify(execFile);

/**
 * Videos in the formats other than an iPhone's (ADR 0070), made by ffmpeg with the tags a camera writes (an invented
 * device), and the proof that each comes out as the platforms read it: H.264 or HEVC copied or moved into an MP4,
 * the rest converted into H.264, never with a tag left. ffmpeg is a prerequisite of the repository (CLAUDE.md), in CI
 * as here. Invented data only, never a real drop.
 */
const DEVICE = 'Camera Inventee 7';

describe('content-drops › a video in any common format (ADR 0070 § 3)', () => {
  const cleaner = createFileCleaner();
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'impera-cleaner-test-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** One second of a test picture and a tone, in the codecs and container given, tagged with the device. */
  async function made(name: string, video: string[], audio: string[], size = '320x240'): Promise<string> {
    const path = join(dir, name);
    await run('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10`],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', ...video, ...audio],
      ...['-metadata', `comment=${DEVICE}`, '-metadata', `title=${DEVICE}`, path],
    ]);
    expect((await readFile(path)).toString('latin1').includes(DEVICE)).toBe(true);
    return path;
  }

  async function cleaned(raw: string, mime: DropMime) {
    const head = new Uint8Array(await readFile(raw)).subarray(0, 32);
    const family = sniff(head);
    if (family === null) throw new Error(`${raw}: no family`);
    const out = `${raw}.out`;
    const convert = await cleaner.needsConversion(raw, family, mime);
    const file = await cleaner.clean(raw, out, family, mime);
    const bytes = await readFile(out);
    const probed = await probeAv(out);
    return { family, convert, file, probed, text: bytes.toString('latin1'), head: bytes.subarray(4, 8) };
  }

  it('a WebM in VP9 and Opus is converted into an H.264 MP4 with AAC, no tag left', async () => {
    const raw = await made('vp9.webm', ['-c:v', 'libvpx-vp9', '-b:v', '200k'], ['-c:a', 'libopus']);
    const result = await cleaned(raw, 'video/webm');
    expect(result.family).toBe('ebml');
    expect(result.convert).toBe(true);
    expect(result.file).toMatchObject({
      mime: 'video/mp4',
      width: 320,
      height: 240,
      hasVideo: true,
      hasAudio: true,
    });
    expect(result.probed).toMatchObject({ videoCodec: 'h264', audio: { codec: 'aac' } });
    expect(result.text.includes(DEVICE)).toBe(false);
    expect(result.text.includes('Lavf')).toBe(false);
    // Nor the encoder's version and settings (its SEI): only the generic name ffmpeg gives every H.264 stream.
    expect(result.text.includes('x264 - core')).toBe(false);
  });

  it('an AVI in MJPEG and PCM is converted, its sound into AAC', async () => {
    const raw = await made('mjpeg.avi', ['-c:v', 'mjpeg'], ['-c:a', 'pcm_s16le']);
    const result = await cleaned(raw, 'video/x-msvideo');
    expect(result.family).toBe('avi');
    expect(result.convert).toBe(true);
    expect(result.probed).toMatchObject({
      videoCodec: 'h264',
      audio: { codec: 'aac' },
      width: 320,
      height: 240,
    });
    expect(result.text.includes(DEVICE)).toBe(false);
  });

  it('a QuickTime in ProRes, turned a quarter, is converted with its turn applied', async () => {
    const plain = await made('prores-plain.mov', ['-c:v', 'prores_ks'], ['-c:a', 'pcm_s16le']);
    const raw = join(dir, 'prores.mov');
    await run('ffmpeg', ['-v', 'error', '-y', '-display_rotation:v:0', '90', '-i', plain, '-c', 'copy', raw]);
    const result = await cleaned(raw, 'video/quicktime');
    expect(result.convert).toBe(true);
    // A converted QuickTime comes out as an MP4, upright: 240 wide, 320 high.
    expect(result.file).toMatchObject({ mime: 'video/mp4', width: 240, height: 320 });
    expect(result.probed.videoCodec).toBe('h264');
    expect(result.text.includes(DEVICE)).toBe(false);
  });

  it('a Matroska in H.264 and AAC is moved into an MP4 without being converted', async () => {
    const raw = await made('h264.mkv', ['-c:v', 'libx264'], ['-c:a', 'aac']);
    const result = await cleaned(raw, 'video/x-matroska');
    expect(result.convert).toBe(false);
    expect(result.file.mime).toBe('video/mp4');
    expect(Buffer.from(result.head).toString('latin1')).toBe('ftyp');
    expect(result.probed).toMatchObject({ videoCodec: 'h264', audio: { codec: 'aac' } });
    expect(result.text.includes(DEVICE)).toBe(false);
  });

  it('an iPhone’s HEVC QuickTime is copied as it came, still QuickTime', async () => {
    const raw = await made(
      'hevc.mov',
      ['-c:v', 'libx265', '-x265-params', 'log-level=none', '-tag:v', 'hvc1'],
      ['-c:a', 'aac'],
    );
    const result = await cleaned(raw, 'video/quicktime');
    expect(result.convert).toBe(false);
    expect(result.file.mime).toBe('video/quicktime');
    expect(result.probed.videoCodec).toBe('hevc');
    expect(result.text.includes(DEVICE)).toBe(false);
  });

  it('a picture wider than 4K is brought down to 3 840, its ratio kept', async () => {
    const raw = await made(
      'wide.mkv',
      ['-c:v', 'libvpx-vp9', '-b:v', '200k'],
      ['-c:a', 'libopus'],
      '4000x200',
    );
    const result = await cleaned(raw, 'video/x-matroska');
    expect(result.file).toMatchObject({ width: 3840, height: 192 });
  });

  it('a photo or a vocal never needs a conversion', async () => {
    expect(await cleaner.needsConversion(join(dir, 'none'), 'jpeg', 'image/jpeg')).toBe(false);
    expect(await cleaner.needsConversion(join(dir, 'none'), 'mp3', 'audio/mpeg')).toBe(false);
  });
});
