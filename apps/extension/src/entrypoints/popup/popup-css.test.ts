import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* The popup's stylesheet, checked on what the DOM tests cannot see: the Reveal eyes at rest (Charles 21/11). */
const css = readFileSync(new URL('./popup.css', import.meta.url), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`, from its first occurrence. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('the Reveal eyes in the popup', () => {
  it('glance aside now and then at rest, in steps, never while reading', () => {
    const glance = rule('.pp-reveal:not(.is-reading) .pp-reveal__pupils');
    expect(glance).toContain('pp-reveal-glance');
    expect(glance).toContain('steps(1, end)');
    expect(css).toContain('@keyframes pp-reveal-glance');
  });

  it('stay still under reduced motion, at rest as while reading', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rule('.pp-reveal .pp-reveal__pupils')).toContain('animation: none');
    expect(reduced).toContain('.pp-reveal .pp-reveal__pupils {');
  });
});
