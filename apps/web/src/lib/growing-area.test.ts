/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module. */
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

/** The text fields of Équipe, Paie and Moi (recette design du 11/11, GES-06). */
const SCREENS = [
  '../screens/team/MemberSheet.tsx',
  '../screens/team/TeamExchanges.tsx',
  '../screens/pay/EntryForm.tsx',
  '../screens/pay/MySalesPanel.tsx',
  '../screens/pay/HeldSalesPanel.tsx',
  '../screens/pay/InvoiceRow.tsx',
  '../screens/me/ProfileDialog.tsx',
  '../screens/me/FileParts.tsx',
];

describe('a text field that grows with its text (GES-06)', () => {
  it('has no native grip and no scroll bar', () => {
    const css = read('./growing-area.css');
    expect(css).toMatch(/field-sizing:\s*content/u);
    expect(css).toMatch(/resize:\s*none/u);
    expect(read('../screens/team/team.css')).not.toMatch(/resize:\s*(vertical|both)/u);
  });

  it.each(SCREENS)('grows every text field of %s', (path) => {
    const source = read(path);
    const fields = source.split('<textarea').slice(1);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const tag = field.slice(0, field.indexOf('/>'));
      expect(tag).toContain('grow-area');
      expect(tag).toMatch(/ref=\{\w+\}/u);
    }
  });
});
