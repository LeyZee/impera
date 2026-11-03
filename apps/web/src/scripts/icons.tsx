import type { JSX } from 'react';

/** The few strokes of the structures screen, drawn as the navigation's (24 px grid, 1.75 stroke, `currentColor`). */
export type ScIconName = 'image' | 'video' | 'audio' | 'up' | 'down' | 'close' | 'plus' | 'prev' | 'next';

const PATHS: Readonly<Record<ScIconName, JSX.Element>> = {
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 15-4.5-4.5L8 19" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="3" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </>
  ),
  audio: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  up: <path d="m6 14 6-6 6 6" />,
  down: <path d="m6 10 6 6 6-6" />,
  close: <path d="M7 7l10 10M17 7 7 17" />,
  plus: <path d="M12 5v14M5 12h14" />,
  prev: <path d="m14.5 6-6 6 6 6" />,
  next: <path d="m9.5 6 6 6-6 6" />,
};

export function ScIcon({ name, size = 16 }: { name: ScIconName; size?: number }): JSX.Element {
  return (
    <svg
      className="st-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
