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
  | 'content'
  | 'team'
  | 'people'
  | 'pay'
  | 'me'
  | 'bell'
  | 'shield'
  | 'more'
  | 'eye'
  | 'eye-off'
  | 'phone'
  | 'puzzle'
  | 'sign-out'
  | 'compass'
  | 'clapper'
  | 'traffic'
  | 'heart';

const PEOPLE = (
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
);

const PATHS: Readonly<Record<NavIconName, JSX.Element>> = {
  // Trafic: a chain link, its two halves closing on each other (ADR 0134 § 9).
  traffic: (
    <>
      <path className="nav-link-a" d="M10.2 13.8a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1.2 1.2" />
      <path className="nav-link-b" d="M13.8 10.2a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1.2-1.2" />
    </>
  ),
  dashboard: (
    <>
      <path d="M3 20h18" />
      <path className="nav-b1" d="M6 17v-5" />
      <path className="nav-b2" d="M12 17V7" />
      <path className="nav-b3" d="M18 17v-8" />
    </>
  ),
  // Créatrices: one silhouette marked with a star (ADR 0134 § 9).
  creators: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.5 19.5v-.6c0-3 2.5-5.4 6.5-5.4 1.3 0 2.5.3 3.5.7" />
      <path className="nav-star" d="m18 11.6 1.3 3.1 3.1 1.3-3.1 1.3-1.3 3.1-1.3-3.1-3.1-1.3 3.1-1.3z" />
    </>
  ),
  // Entraîner: a dumbbell, lifted (the target read as « objectifs »; Charles, 21/11).
  train: (
    <g className="nav-lift">
      <path d="M8.5 12h7" />
      <g className="nav-w1">
        <rect x="5" y="7" width="3.5" height="10" rx="1.6" />
        <path d="M2.5 9.8v4.4" />
      </g>
      <g className="nav-w2">
        <rect x="15.5" y="7" width="3.5" height="10" rx="1.6" />
        <path d="M21.5 9.8v4.4" />
      </g>
    </g>
  ),
  // Suivi: two conversation bubbles, hers behind his.
  tracking: (
    <>
      <path
        className="nav-c2"
        d="M17 8.5h2a2.5 2.5 0 0 1 2.5 2.5v4.5A2.5 2.5 0 0 1 19 18h-.5v2.6L15.6 18h-3.1a2.5 2.5 0 0 1-2.3-1.5"
      />
      <path
        className="nav-c1"
        d="M5 3.5h7A2.5 2.5 0 0 1 14.5 6v4.5A2.5 2.5 0 0 1 12 13H8.5l-3 2.8V13H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5z"
      />
    </>
  ),
  settings: (
    <g className="nav-gear">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </g>
  ),
  // Aujourd'hui: the house one comes home to, its door opening (the sun was already « Jour »; Charles, 21/11).
  today: (
    <>
      <path className="nav-roof" d="M3.5 11 12 3.5l8.5 7.5" />
      <path className="nav-walls" d="M5.5 9.6V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9.6" />
      <path className="nav-door" d="M10 20.5v-5.2a2 2 0 0 1 4 0v5.2" />
    </>
  ),
  planning: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17" />
      <path className="nav-pins" d="M8 3v4M16 3v4" />
      <circle className="nav-day" cx="15.5" cy="15" r="1.3" fill="currentColor" />
    </>
  ),
  // Contenu: a photo with its sun, and the arrow of a drop going up.
  content: (
    <>
      <rect x="3.5" y="5.5" width="13" height="13" rx="3" />
      <path d="m3.5 15.5 3.6-3.6a1.5 1.5 0 0 1 2.1 0l4.3 4.3" />
      <circle className="nav-sun" cx="12.6" cy="9.4" r="1.2" fill="currentColor" />
      <path className="nav-up" d="M19.5 21v-7M17 16.4l2.5-2.5 2.5 2.5" />
    </>
  ),
  // Équipe, and who is on a task or a shift: several people (the headset read as « support »; Charles, 21/11).
  team: PEOPLE,
  people: PEOPLE,
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
      <path className="nav-body" d="M6.6 18.6c1.2-2 3.1-3.1 5.4-3.1s4.2 1.1 5.4 3.1" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 21h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  // Her media shown as they are, or blurred (SC-04 lot c4): the lid closes over the eye, the bar crosses it.
  eye: (
    <>
      <path className="nav-lid" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle className="nav-pupil" cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4" />
      <path d="M6.6 7.1C3.9 8.8 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.2" />
      <path d="M9.9 10a2.8 2.8 0 0 0 4 4" />
      <path className="nav-strike" d="M3.5 3.5l17 17" />
    </>
  ),
  // Installer Impera on a phone (recette 11/11, CRE-29).
  phone: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  // The extension, in the account's menu: the piece the browser shows it by (Lucide's puzzle; recette 11/11, GES-23).
  puzzle: (
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
  ),
  // Se déconnecter: the door left, the arrow going out.
  'sign-out': (
    <>
      <path d="M9.5 20.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5h3.5" />
      <path className="nav-out" d="M10 12h10.5M16.5 8l4 4-4 4" />
    </>
  ),
  // A page that leads nowhere (recette 11/11, CRE-35).
  compass: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9z" />
    </>
  ),
  // A shoot (« Fiche de tournage »), drawn after Lucide's clapperboard, in place of the 🎬 that was its icon (CRE-11).
  clapper: (
    <>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </>
  ),
  // A fan in care mode, what he likes: the same heart as the extension's.
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
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
