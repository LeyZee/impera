import { describe, expect, it } from 'vitest';

import html from './index.html?raw';

describe('popup', () => {
  it('keeps its text off the edge with the design system popup frame', () => {
    expect(html).toContain('class="nv-aura nv-popup"');
  });

  it('shows the mark beside the name', () => {
    expect(html).toContain('src="/icon/mark.svg"');
    expect(html).toContain('<span class="nv-popup__brand">Impera</span>');
  });
});
