/**
 * The popup's icons, drawn after Lucide (ISC licence, the design system's icon set): 24 px grid, 2 px stroke,
 * `currentColor`. Built as SVG nodes, never parsed from text.
 */

const SHAPES = {
  arrowUpRight: [
    ['path', { d: 'M7 7h10v10' }],
    ['path', { d: 'M7 17 17 7' }],
  ],
  arrowRight: [
    ['path', { d: 'M5 12h14' }],
    ['path', { d: 'm12 5 7 7-7 7' }],
  ],
  chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  arrowUp: [
    ['path', { d: 'm5 12 7-7 7 7' }],
    ['path', { d: 'M12 19V5' }],
  ],
  arrowDown: [
    ['path', { d: 'M12 5v14' }],
    ['path', { d: 'm19 12-7 7-7-7' }],
  ],
  /** A limit that forbids: a struck circle (the panel's status band, Design 16/11). */
  ban: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'm4.9 4.9 14.2 14.2' }],
  ],
  /** His desire, in the status band: a flame, its direction said by an arrow. */
  flame: [
    [
      'path',
      {
        d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
      },
    ],
  ],
  clock: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M12 6v6l4 2' }],
  ],
  hourglass: [
    ['path', { d: 'M5 22h14' }],
    ['path', { d: 'M5 2h14' }],
    ['path', { d: 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22' }],
    ['path', { d: 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2' }],
  ],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
  /** The fan card's lines and folds (Design 16/11): what he likes, what he does not want, what is intimate, to find. */
  heart: [
    [
      'path',
      {
        d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
      },
    ],
  ],
  circleMinus: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['path', { d: 'M8 12h8' }],
  ],
  lock: [
    ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
    ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  rotate: [
    ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
  ],
  alert: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  shield: [
    [
      'path',
      {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      },
    ],
    ['path', { d: 'm9 12 2 2 4-4' }],
  ],
  key: [
    ['path', { d: 'm15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4' }],
    ['path', { d: 'm21 2-9.6 9.6' }],
    ['circle', { cx: '7.5', cy: '15.5', r: '5.5' }],
  ],
  message: [['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }]],
  eyeOff: [
    [
      'path',
      { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' },
    ],
    ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
    [
      'path',
      { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' },
    ],
    ['path', { d: 'm2 2 20 20' }],
  ],
  eye: [
    [
      'path',
      { d: 'M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0' },
    ],
    ['circle', { cx: '12', cy: '12', r: '3' }],
  ],
  // The CRM menu's own drawings (apps/web/src/shell/NavIcon.tsx, #991): the same shape for the same place.
  dashboard: [
    ['path', { d: 'M3 20h18' }],
    ['path', { d: 'M6 17v-5' }],
    ['path', { d: 'M12 17V7' }],
    ['path', { d: 'M18 17v-8' }],
  ],
  today: [
    ['path', { d: 'M3.5 11 12 3.5l8.5 7.5' }],
    ['path', { d: 'M5.5 9.6V19A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9.6' }],
    ['path', { d: 'M10 20.5v-5.2a2 2 0 0 1 4 0v5.2' }],
  ],
  tracking: [
    [
      'path',
      {
        d: 'M17 8.5h2a2.5 2.5 0 0 1 2.5 2.5v4.5A2.5 2.5 0 0 1 19 18h-.5v2.6L15.6 18h-3.1a2.5 2.5 0 0 1-2.3-1.5',
      },
    ],
    [
      'path',
      {
        d: 'M5 3.5h7A2.5 2.5 0 0 1 14.5 6v4.5A2.5 2.5 0 0 1 12 13H8.5l-3 2.8V13H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5z',
      },
    ],
  ],
  train: [
    ['path', { d: 'M8.5 12h7' }],
    ['rect', { x: '5', y: '7', width: '3.5', height: '10', rx: '1.6' }],
    ['path', { d: 'M2.5 9.8v4.4' }],
    ['rect', { x: '15.5', y: '7', width: '3.5', height: '10', rx: '1.6' }],
    ['path', { d: 'M21.5 9.8v4.4' }],
  ],
  // Réglages: the CRM menu's gear.
  settings: [
    ['circle', { cx: '12', cy: '12', r: '3' }],
    [
      'path',
      {
        d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
      },
    ],
  ],
  // Équipe: several people (the headset read as « support »; Charles, 21/11).
  team: [
    ['circle', { cx: '5', cy: '9.5', r: '2.2' }],
    ['path', { d: 'M1.5 18.5v-.3c0-2 1.3-3.5 3.3-3.9' }],
    ['circle', { cx: '12', cy: '8', r: '3' }],
    ['path', { d: 'M6.5 19.5V19c0-2.8 2.4-5 5.5-5s5.5 2.2 5.5 5v.5' }],
    ['circle', { cx: '19', cy: '9.5', r: '2.2' }],
    ['path', { d: 'M22.5 18.5v-.3c0-2-1.3-3.5-3.3-3.9' }],
  ],
  creators: [
    ['circle', { cx: '9', cy: '8', r: '3.4' }],
    ['path', { d: 'M2.5 19.5v-.6c0-3 2.5-5.4 6.5-5.4 1.3 0 2.5.3 3.5.7' }],
    ['path', { d: 'm18 11.6 1.3 3.1 3.1 1.3-3.1 1.3-1.3 3.1-1.3-3.1-3.1-1.3 3.1-1.3z' }],
  ],
  planning: [
    ['rect', { x: '3.5', y: '5', width: '17', height: '15.5', rx: '3' }],
    ['path', { d: 'M3.5 10h17' }],
    ['path', { d: 'M8 3v4M16 3v4' }],
    ['circle', { cx: '15.5', cy: '15', r: '1.3', fill: 'currentColor' }],
  ],
  pay: [
    ['circle', { cx: '12', cy: '12', r: '9' }],
    ['path', { d: 'M15.4 8.7a4.2 4.2 0 1 0 0 6.6M7.2 10.9h5.6M7.2 13.1h5.6' }],
  ],
  me: [
    ['circle', { cx: '12', cy: '12', r: '9.5' }],
    ['circle', { cx: '12', cy: '10', r: '3' }],
    ['path', { d: 'M6.6 18.6c1.2-2 3.1-3.1 5.4-3.1s4.2 1.1 5.4 3.1' }],
  ],
  // The copilot's « L’essentiel » tab (Charles 21/11, piste C).
  star: [['path', { d: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z' }]],
  pencil: [
    [
      'path',
      {
        d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
      },
    ],
  ],
} as const satisfies Record<string, readonly (readonly [string, Readonly<Record<string, string>>])[]>;

export type IconName = keyof typeof SHAPES;

const SVG = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [key, value] of Object.entries({
    width: String(size),
    height: String(size),
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    class: `popup-icon popup-icon--${name}`,
  })) {
    svg.setAttribute(key, value);
  }
  for (const [tag, attrs] of SHAPES[name]) {
    const shape = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}
