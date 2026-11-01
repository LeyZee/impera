import type { JSX } from 'react';

/**
 * Navigation icons. Each one carries its gesture, played once on activation by `is-playing`
 * (docs/design/README.md, Mouvement): the parts that move have their own class.
 */
export type NavIconName =
  | 'dashboard'
  | 'creators'
  | 'train'
  | 'tracking'
  | 'settings'
  | 'today'
  | 'planning'
  | 'team'
  | 'pay'
  | 'me'
  | 'more';

const PATHS: Readonly<Record<NavIconName, JSX.Element>> = {
  dashboard: (
    <>
      <path d="M3 20h18" />
      <path className="nav-b1" d="M6 17v-5" />
      <path className="nav-b2" d="M12 17V7" />
      <path className="nav-b3" d="M18 17v-8" />
    </>
  ),
  creators: (
    <>
      <g className="nav-h2">
        <circle cx="17" cy="8" r="2.6" />
        <path d="M17.5 13.6c2.3.4 4 2.2 4 4.9v1" />
      </g>
      <g className="nav-h1">
        <circle cx="9" cy="8" r="3.4" />
        <path d="M2.5 19.5v-.6c0-3 2.5-5.4 6.5-5.4s6.5 2.4 6.5 5.4v.6" />
      </g>
    </>
  ),
  train: (
    <>
      <path className="nav-big" d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path className="nav-small" d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
      <path className="nav-tiny" d="M5 2.5v3M3.5 4h3" />
    </>
  ),
  tracking: (
    <>
      <path d="M3.3 19a10 10 0 1 1 17.4 0" />
      <path className="nav-needle" d="m12 14 4-4" />
      <circle cx="12" cy="14" r="1" fill="currentColor" />
    </>
  ),
  settings: (
    <g className="nav-gear">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </g>
  ),
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path
        className="nav-rays"
        d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
      />
    </>
  ),
  planning: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <circle className="nav-day" cx="15.5" cy="15" r="1.3" fill="currentColor" />
    </>
  ),
  team: (
    <>
      <g className="nav-t1">
        <circle cx="5" cy="9.5" r="2.2" />
        <path d="M1.5 18.5v-.3c0-2 1.3-3.5 3.3-3.9" />
      </g>
      <g className="nav-t2">
        <circle cx="12" cy="8" r="3" />
        <path d="M6.5 19.5V19c0-2.8 2.4-5 5.5-5s5.5 2.2 5.5 5v.5" />
      </g>
      <g className="nav-t3">
        <circle cx="19" cy="9.5" r="2.2" />
        <path d="M22.5 18.5v-.3c0-2-1.3-3.5-3.3-3.9" />
      </g>
    </>
  ),
  pay: (
    <g className="nav-coin">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.4 8.7a4.2 4.2 0 1 0 0 6.6M7.2 10.9h5.6M7.2 13.1h5.6" />
    </g>
  ),
  me: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <circle className="nav-head" cx="12" cy="10" r="3" />
      <path d="M6.6 18.6c1.2-2 3.1-3.1 5.4-3.1s4.2 1.1 5.4 3.1" />
    </>
  ),
  more: (
    <>
      <circle className="nav-d1" cx="5.5" cy="12" r="1.2" fill="currentColor" />
      <circle className="nav-d2" cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle className="nav-d3" cx="18.5" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }): JSX.Element {
  return (
    <svg
      className={`nav-icon nav-icon--${name}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
