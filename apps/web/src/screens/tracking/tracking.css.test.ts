import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tracking.css', import.meta.url), 'utf8');

describe('a conversation in a narrow list (recette 07/11, EXT-02)', () => {
  it('measures the list, not the window: the side column of a computer is as narrow as a phone', () => {
    expect(css).toMatch(/\.tr-list \{\s*container-type: inline-size;/u);
  });

  it('sends the state pill under the pseudo there, so the pseudo is never cut to « f… »', () => {
    const narrow = /@container \(max-width: 480px\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(
      /\.tr-groups \.tr-row\.nv-convo \{\s*grid-template-columns: auto minmax\(0, 1fr\);/u,
    );
    expect(narrow).toMatch(/\.tr-groups \.tr-row\.nv-convo > \.nv-convo__side \{\s*grid-column: 2;/u);
  });
});
