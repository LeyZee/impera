import { describe, expect, it } from 'vitest';

import { NOT_WHAT_IT_SAYS, SNIFF_BYTES, headRefusal, holds, sniff } from './file-sniff';

const bytes = (...parts: (string | readonly number[])[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((part) => (typeof part === 'string' ? [...new TextEncoder().encode(part)] : part)),
  );

describe('What a file is by its first bytes, on her sheet as on the server (recette CRE-12)', () => {
  it('finds each accepted family', () => {
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(bytes([0x89], 'PNG\r\n', [0x1a], '\n'))).toBe('png');
    expect(sniff(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('webp');
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBe('heif');
    expect(sniff(bytes([0, 0, 0, 0x18], 'ftypqt  '))).toBe('isobmff');
    expect(sniff(bytes([0, 0, 0, 8], 'wide'))).toBe('isobmff');
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('ebml');
    expect(sniff(bytes('RIFF', [0, 0, 0, 0], 'AVI '))).toBe('avi');
    expect(sniff(bytes('ID3', [4, 0]))).toBe('mp3');
    expect(sniff(bytes([0xff, 0xfb]))).toBe('mp3');
    expect(sniff(bytes([0xff, 0xf1]))).toBe('adts');
  });

  it('finds none in a text, an empty file or a PDF', () => {
    expect(sniff(bytes('juste du texte'))).toBeNull();
    expect(sniff(new Uint8Array())).toBeNull();
    expect(sniff(bytes('%PDF-1.7'))).toBeNull();
  });

  it('reads no more than its first bytes', () => {
    expect(SNIFF_BYTES).toBeGreaterThanOrEqual(12);
  });

  it('lets a `.mov` hold an MP4 and a vocal `.m4a` too, never a photo hold a video', () => {
    expect(holds('video/quicktime', 'isobmff')).toBe(true);
    expect(holds('audio/x-m4a', 'isobmff')).toBe(true);
    expect(holds('image/jpeg', 'isobmff')).toBe(false);
    expect(holds('image/heic', 'jpeg')).toBe(false);
  });

  it('refuses a renamed file with the server’s own sentence, and lets a true one go', () => {
    expect(headRefusal('image/jpeg', bytes('juste du texte'))).toBe(NOT_WHAT_IT_SAYS);
    expect(headRefusal('image/jpeg', bytes([0x89], 'PNG\r\n', [0x1a], '\n'))).toBe(NOT_WHAT_IT_SAYS);
    expect(headRefusal('image/jpeg', bytes([0xff, 0xd8, 0xff]))).toBeNull();
    expect(headRefusal('image/heic', bytes([0, 0, 0, 0x18], 'ftypheic'))).toBeNull();
    expect(headRefusal('video/mp4', bytes([0, 0, 0, 0x18], 'ftypisom'))).toBeNull();
  });
});
