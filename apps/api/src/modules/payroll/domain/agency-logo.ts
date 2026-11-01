import {
  AGENCY_LOGO_MAX_BYTES,
  AGENCY_LOGO_MAX_PIXELS,
  AGENCY_LOGO_MAX_SIDE,
  AGENCY_LOGO_MIN_SIDE,
  type AgencyLogoRefusal,
} from '@nirvana/contracts';

/** A PNG's size, from its header (IHDR). */
export interface PngSize {
  readonly width: number;
  readonly height: number;
}

/**
 * What reading a file as a PNG found: not a PNG (its signature), a PNG broken somewhere (a chunk cut short or altered,
 * a header PNG does not allow, pixel data that does not inflate or unfilter to the size its header gives), or its size
 * and whether at least one pixel is transparent. `transparent` is `null` when the pixels were not decoded, the sides
 * being out of bounds (`decodable`).
 */
export type PngReading =
  | { readonly kind: 'not_png' }
  | { readonly kind: 'damaged' }
  | { readonly kind: 'read'; readonly size: PngSize; readonly transparent: boolean | null };

/**
 * Whether a PNG of this size is within bounds, and so may be decoded: the bound on pixels caps what checking each
 * pixel of a 512 KB file costs the server.
 */
export const logoSidesFit = ({ width, height }: PngSize): boolean =>
  width >= AGENCY_LOGO_MIN_SIDE &&
  height >= AGENCY_LOGO_MIN_SIDE &&
  width <= AGENCY_LOGO_MAX_SIDE &&
  height <= AGENCY_LOGO_MAX_SIDE &&
  width * height <= AGENCY_LOGO_MAX_PIXELS;

export type LogoVerdict =
  | { readonly kind: 'kept'; readonly size: PngSize }
  | { readonly kind: 'refused'; readonly reason: AgencyLogoRefusal };

/**
 * Whether the agency's logo is kept (EQ-06, Réglages › Facturation): a PNG of at most 512 KB (PDFKit draws no SVG and a
 * JPEG has no transparency, ADR 0037 § 2), whole, of sides in bounds, with at least one transparent pixel so that it
 * sits on the white page instead of printing its background as a box. The first reason that applies is given, in that
 * order: what the owner can see before opening the file first.
 */
export function agencyLogoVerdict(byteLength: number, read: () => PngReading): LogoVerdict {
  const refused = (reason: AgencyLogoRefusal): LogoVerdict => ({ kind: 'refused', reason });
  // Too heavy, the file is never read.
  if (byteLength > AGENCY_LOGO_MAX_BYTES) return refused('too_heavy');
  const reading = read();
  if (reading.kind === 'not_png') return refused('not_png');
  if (reading.kind === 'damaged') return refused('damaged');
  if (!logoSidesFit(reading.size) || reading.transparent === null) return refused('dimensions');
  if (!reading.transparent) return refused('opaque');
  return { kind: 'kept', size: reading.size };
}
