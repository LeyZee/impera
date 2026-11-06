/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./calendar.css', import.meta.url), 'utf8');

describe('the team’s calendar (recette 05/11)', () => {
  it('draws no violet edge on the side of a créneau: the agent is said once per creator (CHAT-27)', () => {
    expect(css).not.toMatch(/\.cal-slot\[data-ai[^\]]*\]::after/u);
    expect(css).not.toMatch(/inset\s+3px\s+0\s+0\s+var\(--nv-agent\)/u);
  });
});
