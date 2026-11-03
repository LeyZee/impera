import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RasterizeCard } from '../domain/ports';

/**
 * A card's SVG turned into a PNG by librsvg (SC-01 lot b): through `rsvg-convert` where it is installed (the Docker
 * image: Alpine's ffmpeg is built without librsvg), otherwise through ffmpeg's librsvg decoder (a dev machine and the
 * CI, whose ffmpeg has it; ffmpeg is there already for the module `media`). The same library draws in both. The tool
 * is chosen once per process, so one image always draws with the same one. Its own fontconfig names only the fonts of `fonts/` (Geist and Instrument
 * Serif, SIL OFL 1.1), never the machine's: the same SVG gives the same PNG within one Docker image (another librsvg,
 * pango or freetype may anti-alias differently, so a PNG is never compared across machines). Two renders at most run at
 * once, the others wait their turn: a screen of previews never starts a crowd of ffmpeg beside the API.
 */

const TIMEOUT_MS = 15_000;
const CONCURRENT_RENDERS = 2;
/** A 1080 × 1080 card is a few hundred kilobytes. */
const MAX_PNG_BYTES = 8 * 1024 * 1024;

const missingMessage =
  'Ni rsvg-convert ni ffmpeg sur le PATH : installe rsvg-convert (ou ffmpeg avec librsvg), puis relance.';

type Tool = 'rsvg-convert' | 'ffmpeg';

/** The command line of each tool, for one SVG file, the PNG on its standard output. */
const commandOf = (tool: Tool, input: string): readonly string[] =>
  tool === 'rsvg-convert'
    ? ['--format', 'png', input]
    : [
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
      ];

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

  let running = 0;
  const waiting: (() => void)[] = [];
  /** A slot among the two renders, released by the returned function. */
  const acquire = async (): Promise<() => void> => {
    if (running >= CONCURRENT_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve));
    else running += 1;
    return () => {
      const next = waiting.shift();
      if (next === undefined) running -= 1;
      else next();
    };
  };

  /** `rsvg-convert` until it is found missing, then ffmpeg for the rest of the process. */
  let tool: Tool = 'rsvg-convert';
  return async (svg) => {
    const release = await acquire();
    try {
      const file = await configFile();
      try {
        return await render(tool, file, svg);
      } catch (error) {
        if (tool === 'ffmpeg' || !isNotFound(error)) throw error;
        tool = 'ffmpeg';
        return await render(tool, file, svg);
      }
    } finally {
      release();
    }
  };
}

async function render(tool: Tool, file: string, svg: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nirvana-card-'));
  const input = join(dir, 'card.svg');
  try {
    await writeFile(input, svg);
    return await new Promise<Buffer>((resolve, reject) => {
      execFile(
        tool,
        commandOf(tool, input),
        {
          encoding: 'buffer',
          maxBuffer: MAX_PNG_BYTES,
          timeout: TIMEOUT_MS,
          killSignal: 'SIGKILL',
          env: { ...process.env, FONTCONFIG_FILE: file },
        },
        (error, stdout) => {
          if (error !== null) {
            // Not found: the caller tries ffmpeg; ffmpeg not found either says what to install.
            reject(
              isNotFound(error) && tool === 'ffmpeg' ? new Error(missingMessage, { cause: error }) : error,
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
