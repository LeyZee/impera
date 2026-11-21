import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NavIcon, type NavIconName } from './NavIcon';

const shellCss = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

/** The icons of the rail and of « Plus »: the ones a click plays (Charles, 21/11). */
const RAIL: readonly NavIconName[] = [
  'dashboard',
  'today',
  'planning',
  'tracking',
  'train',
  'pay',
  'content',
  'team',
  'traffic',
  'creators',
  'me',
  'settings',
  'more',
];

describe('the gesture of each icon of the rail', () => {
  it.each(RAIL)('%s has a part that moves when it is played', (name) => {
    const parts = [...renderToStaticMarkup(<NavIcon name={name} />).matchAll(/class="([^"]+)"/g)]
      .flatMap((match) => (match[1] ?? '').split(' '))
      .filter((part) => part.startsWith('nav-') && !part.startsWith('nav-icon'));
    const moving = parts.filter((part) => new RegExp(`\\.is-playing[^{]*\\.${part}\\b`).test(shellCss));
    expect(moving.length).toBeGreaterThan(0);
  });
});
