import { describe, expect, it } from 'vitest';

import { agencyLogoVerdict, logoSidesFit, type PngReading } from '../agency-logo';

const read =
  (width: number, height: number, transparent: boolean | null = true): (() => PngReading) =>
  () => ({ kind: 'read', size: { width, height }, transparent });

describe('Réglages › Facturation : le logo de l’agence', () => {
  it('keeps a PNG of at most 512 KB, sides in bounds, with a transparent pixel', () => {
    expect(agencyLogoVerdict(443_725, read(1_843, 522))).toEqual({
      kind: 'kept',
      size: { width: 1_843, height: 522 },
    });
    expect(agencyLogoVerdict(512 * 1024, read(64, 64))).toMatchObject({ kind: 'kept' });
    expect(agencyLogoVerdict(1_000, read(4_000, 1_000))).toMatchObject({ kind: 'kept' });
  });

  it('refuses, in this order, too heavy, not a PNG, damaged, out of bounds, opaque', () => {
    const never = (): PngReading => {
      throw new Error('a file too heavy is never read');
    };
    expect(agencyLogoVerdict(512 * 1024 + 1, never)).toEqual({ kind: 'refused', reason: 'too_heavy' });
    expect(agencyLogoVerdict(10, () => ({ kind: 'not_png' }))).toEqual({
      kind: 'refused',
      reason: 'not_png',
    });
    expect(agencyLogoVerdict(10, () => ({ kind: 'damaged' }))).toEqual({
      kind: 'refused',
      reason: 'damaged',
    });
    expect(agencyLogoVerdict(10, read(63, 200))).toEqual({ kind: 'refused', reason: 'dimensions' });
    expect(agencyLogoVerdict(10, read(5_000, 64, null))).toEqual({ kind: 'refused', reason: 'dimensions' });
    expect(agencyLogoVerdict(10, read(600, 200, false))).toEqual({ kind: 'refused', reason: 'opaque' });
  });

  it('bounds each side and the pixels in all', () => {
    expect(logoSidesFit({ width: 64, height: 64 })).toBe(true);
    expect(logoSidesFit({ width: 4_000, height: 1_000 })).toBe(true);
    expect(logoSidesFit({ width: 4_001, height: 100 })).toBe(false);
    expect(logoSidesFit({ width: 100, height: 63 })).toBe(false);
    expect(logoSidesFit({ width: 2_001, height: 2_000 })).toBe(false);
  });
});
