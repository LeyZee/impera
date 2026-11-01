import { crc32, deflateSync } from 'node:zlib';

import type { InvoiceLogo } from '../../domain/ports';

/** A PNG of `width` × `height` pixels in navy, half transparent on its right: an invented logo. */
export function inventedLogo(width = 120, height = 34): InvoiceLogo {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // 8 bits per channel
  header.writeUInt8(6, 9); // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      rows.set([0x0e, 0x1e, 0x3d, x < width / 2 ? 255 : 96], row + 1 + x * 4);
    }
  }
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { mediaType: 'image/png', bytes: new Uint8Array(bytes) };
}
