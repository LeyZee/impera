// @vitest-environment jsdom
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { BeninGuide } from './BeninGuide';

const GUIDE = join('docs', 'reference', 'residence-certificate-benin.md');

/** The document, found from wherever the tests run (the package, or the repository's root). */
function readGuide(from: string): string {
  const path = join(from, GUIDE);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const up = dirname(from);
  if (up === from) throw new Error(`${GUIDE} not found`);
  return readGuide(up);
}

const doc = readGuide(process.cwd());

/**
 * The guide's words in order, as the document writes them: from its title to the states of the document, without the
 * Markdown's marks (bold, italics, list markers) nor any space; « AAAA » is the year shown.
 */
function guideWords(year: string): string {
  const lines = doc.split('\n');
  const from = lines.findIndex((line) => line.startsWith('**Ton attestation de domiciliation fiscale**'));
  const to = lines.findIndex((line) => line.startsWith('Après l'));
  return lines
    .slice(from, to + 1)
    .map((line) => line.replace(/^\s*(?:-|\d+\.)\s+/u, ''))
    .join('')
    .replace(/\*\*|_/gu, '')
    .replaceAll('AAAA', year)
    .replaceAll("'", '’')
    .replace(/\s/gu, '');
}

afterEach(cleanup);

describe('the guide of the tax residence certificate (Benin)', () => {
  it('shows the validated document word for word', () => {
    const { container } = render(<BeninGuide year="2026" />);
    expect(container.textContent.replace(/\s/gu, '')).toBe(guideWords('2026'));
  });
});
