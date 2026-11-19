/**
 * Reveal's mark, drawn by us (demande de Charles du 19/11 : « les smileys des yeux qui tournent vers le côté ») rather
 * than its file: two eyes glancing aside on a raspberry tile, in the popup's grammar. Its colours are the popup's
 * tokens (`--pp-reveal-*`), a brand raspberry kept apart from the urgency red. While a session is on its way, the eyes
 * read the tab: the pupils glance from one side to the other (`is-reading`), still under reduced motion.
 */

const SVG = 'http://www.w3.org/2000/svg';

type Shape = readonly [string, Readonly<Record<string, string>>];

const FACE = 'pp-reveal-face';
const SHINE = 'pp-reveal-shine';

const SHAPES: readonly Shape[] = [
  [
    'rect',
    { class: 'pp-reveal__tile', x: '0', y: '0', width: '40', height: '40', rx: '11', fill: `url(#${FACE})` },
  ],
  [
    'rect',
    {
      class: 'pp-reveal__shine',
      x: '0',
      y: '0',
      width: '40',
      height: '40',
      rx: '11',
      fill: `url(#${SHINE})`,
    },
  ],
  [
    'rect',
    { class: 'pp-reveal__rim', x: '0.5', y: '0.5', width: '39', height: '39', rx: '10.5', fill: 'none' },
  ],
  ['ellipse', { class: 'pp-reveal__white', cx: '14', cy: '21', rx: '6.6', ry: '8.2' }],
  ['ellipse', { class: 'pp-reveal__white', cx: '26.4', cy: '21', rx: '6.6', ry: '8.2' }],
];

const PUPILS: readonly Shape[] = [
  ['circle', { class: 'pp-reveal__pupil', cx: '16.2', cy: '22.4', r: '4.1' }],
  ['circle', { class: 'pp-reveal__glint', cx: '17.6', cy: '20.8', r: '1.2' }],
  ['circle', { class: 'pp-reveal__pupil', cx: '28.6', cy: '22.4', r: '4.1' }],
  ['circle', { class: 'pp-reveal__glint', cx: '30', cy: '20.8', r: '1.2' }],
];

function shape([tag, attrs]: Shape): SVGElement {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function gradient(id: string, stops: readonly string[]): SVGElement {
  const element = shape(['linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' }]);
  stops.forEach((name, index) => {
    element.append(shape(['stop', { class: name, offset: String(index / Math.max(1, stops.length - 1)) }]));
  });
  return element;
}

/** The 40 px tile of the Reveal card, in place of a glyph. `reading` sets the eyes glancing. */
export function revealMark(reading: boolean): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [key, value] of Object.entries({
    width: '40',
    height: '40',
    viewBox: '0 0 40 40',
    'aria-hidden': 'true',
    class: reading ? 'pp-reveal is-reading' : 'pp-reveal',
  })) {
    svg.setAttribute(key, value);
  }
  const defs = shape(['defs', {}]);
  defs.append(
    gradient(FACE, ['pp-reveal__top', 'pp-reveal__bottom']),
    gradient(SHINE, ['pp-reveal__shine-top', 'pp-reveal__shine-mid', 'pp-reveal__shine-end']),
  );
  const pupils = shape(['g', { class: 'pp-reveal__pupils' }]);
  pupils.append(...PUPILS.map(shape));
  svg.append(defs, ...SHAPES.map(shape), pupils);
  return svg;
}
