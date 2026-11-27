import { useMemo, type JSX } from 'react';
import { encode } from 'uqr';

/**
 * A QR code drawn in the page (recette 27/11, G7): the authenticator app scans it from a computer's screen instead of
 * a key of 32 letters typed by hand. Encoded here (`uqr`, no request), one path of dark modules on a light plate, so
 * that a phone reads it in Night as in Day: the two colours are the scanner's, not the theme's.
 */
export function QrCode({ text, label }: { text: string; label: string }): JSX.Element {
  const { size, path } = useMemo(() => {
    const qr = encode(text, { ecc: 'M', border: 2 });
    const cells: string[] = [];
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) cells.push(`M${String(x)} ${String(y)}h1v1h-1z`);
      });
    });
    return { size: qr.size, path: cells.join('') };
  }, [text]);
  return (
    <svg
      className="size-44 rounded-[var(--nv-radius-md)]"
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
