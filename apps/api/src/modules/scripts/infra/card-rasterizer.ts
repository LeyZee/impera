import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RasterizeCard } from '../domain/ports';

/**
 * A card's SVG turned into a PNG by ffmpeg's librsvg decoder (SC-01 lot b): ffmpeg is on every machine already
 * (module `media`), so no new dependency. Its own fontconfig names only the fonts of `fonts/` (Geist and Instrument
 * Serif, SIL OFL 1.1), never the machine's: the same SVG gives the same PNG wherever ffmpeg runs.
 */

const TIMEOUT_MS = 15_000;
/** A 1080 × 1080 card is a few hundred kilobytes. */
const MAX_PNG_BYTES = 8 * 1024 * 1024;

const missingMessage =
  'ffmpeg absent : introuvable sur le PATH. Installe ffmpeg (avec librsvg), puis relance.';

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const fontsConf = (fontsDir: string, cacheDir: string): string =>
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>` +
  `<dir>${fontsDir}</dir><cachedir>${cacheDir}</cachedir></fontconfig>`;

/** `fontsDir`: the folder of the card fonts, `infra/fonts` (copied next to `dist` in the image). */
export function createCardRasterizer(fontsDir: string): RasterizeCard {
  let config: Promise<string> | null = null;
  /** One fontconfig file for the process, written once in a private temporary folder. */
  const configFile = (): Promise<string> => {
    config ??= (async () => {
      const dir = await mkdtemp(join(tmpdir(), 'nirvana-cards-'));
      const file = join(dir, 'fonts.conf');
      await writeFile(file, fontsConf(fontsDir, join(dir, 'cache')));
      return file;
    })().catch((error: unknown) => {
      config = null;
      throw error;
    });
    return config;
  };

  return async (svg) => {
    const file = await configFile();
    const dir = await mkdtemp(join(tmpdir(), 'nirvana-card-'));
    const input = join(dir, 'card.svg');
    await writeFile(input, svg);
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        execFile(
          'ffmpeg',
          [
            '-hide_banner',
            '-loglevel',
            'error',
            // Only our SVG, from a file (the decoder cannot probe a pipe). It names no file, image nor link (`cardSvg`),
            // so librsvg opens nothing else.
            '-protocol_whitelist',
            'file',
            '-f',
            'svg_pipe',
            '-i',
            input,
            '-frames:v',
            '1',
            '-f',
            'image2pipe',
            '-vcodec',
            'png',
            'pipe:1',
          ],
          {
            encoding: 'buffer',
            maxBuffer: MAX_PNG_BYTES,
            timeout: TIMEOUT_MS,
            killSignal: 'SIGKILL',
            env: { ...process.env, FONTCONFIG_FILE: file },
          },
          (error, stdout) => {
            if (error !== null) {
              reject(isNotFound(error) ? new Error(missingMessage, { cause: error }) : error);
              return;
            }
            resolve(stdout);
          },
        );
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
