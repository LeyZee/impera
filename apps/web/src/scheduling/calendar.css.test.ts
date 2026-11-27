/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./calendar.css', import.meta.url), 'utf8');
const grid = readFileSync(new URL('./scheduling.css', import.meta.url), 'utf8');

describe('the team’s calendar (recette 05/11)', () => {
  it('draws no violet edge on the side of a créneau: the agent is said once per creator (CHAT-27)', () => {
    expect(css).not.toMatch(/\.cal-slot\[data-ai[^\]]*\]::after/u);
    expect(css).not.toMatch(/inset\s+3px\s+0\s+0\s+var\(--nv-agent\)/u);
  });

  it('quiets a finished shift by its background, never by fading its text (GES-11)', () => {
    const past = /\.sc-chip\[data-phase='past'\]\s*\{([^}]*)\}/u.exec(grid)?.[1] ?? '';
    expect(past).toContain('background');
    expect(past).not.toMatch(/opacity/u);
  });
});

describe('Équipe › Planning (recette visuelle 16/11)', () => {
  const rule = (selector: string): string =>
    new RegExp(`^${selector.replace(/[.[\]()]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'mu').exec(grid)?.[1] ?? '';

  it('says a place to fill quietly, in amber only within the next day (GES-05)', () => {
    expect(rule('.sc-slot__fill')).not.toContain('--nv-warning');
    expect(rule(".sc-slot__fill[data-soon='true']")).toContain('color: var(--nv-warning)');
  });

  it('draws a shift that goes on as « suite », without a second breathing edge (GES-05)', () => {
    expect(css).toMatch(/\.cal-chip--cont::after\s*\{\s*display: none;/u);
    expect(grid).not.toMatch(/\[data-carried='true'\]::after/u);
  });

  it('lists a phone’s day without the empty box of a créneau gone by, nor a « suite » (GES-05)', () => {
    const phone =
      /@media \(max-width: 820px\) \{\s*\/\*[^]*?\*\/\s*([^{]*)\{\s*display: none;/u.exec(grid)?.[1] ?? '';
    expect(phone).toContain('.sc-slot:has(> .sc-slot__gone)');
    expect(phone).toContain(".sc-slot > .sc-chip[data-carried='true']");
  });

  it('breaks a member’s name on two lines rather than cut it, and gives the handles 160 px (GES-22)', () => {
    const name = rule('.sc-chip__name');
    expect(name).toContain('-webkit-line-clamp: 2');
    expect(name).not.toMatch(/ellipsis|nowrap/u);
    expect(rule('.sc-chip__who')).not.toMatch(/ellipsis|nowrap/u);
    expect(grid).toMatch(
      /@media \(min-width: 1280px\) \{\s*\.sc-grid \{\s*grid-template-columns: calc\(160px \+/u,
    );
  });

  it('never cuts a « suite » name mid-word, and drops « Libre » before the hours of a narrow créneau (CHAT-04)', () => {
    const cont = /\.cal-chip--cont \.sc-chip__name \{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(cont).toContain('white-space: nowrap');
    expect(cont).toContain('text-overflow: ellipsis');
    expect(css).toMatch(/@container \(max-width: [^)]+\) \{\s*\.cal-free__word \{\s*display: none;/u);
  });
});
