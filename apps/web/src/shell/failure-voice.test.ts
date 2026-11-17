/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/*
 * Recette visuelle 16/11, lot 3 (T6: ETA-04, ETA-05): « Le serveur ne répond pas » has one face, `Failure`
 * (shell/states.tsx), on every screen. Read from the sources: a screen that writes the sentence itself, as a title, a
 * line of text or a prop, brings back an eighth way to say it.
 */
const SRC = new URL('../', import.meta.url);

/**
 * The screens that still say it by hand, and why. Each one must still do so: a screen moved to `Failure` leaves this
 * list in the same change.
 */
const BY_HAND: Readonly<Record<string, string>> = {
  'auth/ForgottenPasswordPage.tsx':
    'before sign-in, outside the shell: the sign-in card says it with its own `Refused` (the link is read again)',
  'auth/LinkPage.tsx':
    'before sign-in, outside the shell: the sign-in card says it with its own `Refused` (the link is read again)',
  'auth/Unreachable.tsx':
    'the whole app before its shell: the page shown when /v1/session itself does not answer',
  'settings/ai-usage/CreditDialog.tsx':
    'a write that failed, in a dialog: it says what became of the input, not that a screen could not be read',
  'screens/tracking/FanLimits.tsx':
    'the one-word state of a folded panel’s summary line, where a card cannot sit; the reader’s `Failure` speaks above',
  'screens/train/PlaygroundPage.tsx':
    'the Playground thread is merging its own error card (server or Grok), to swap for `Failure` in one line',
};

/** The sentence written as a JSX text, a prop's string or a string that is the whole title. */
const BY_HAND_PATTERN =
  />\s*Le serveur (?:<em[^>]*>)?ne répond pas|=\s*"Le serveur ne répond pas|['"`]Le serveur ne répond pas['"`]/u;

const sources: readonly (readonly [string, string])[] = readdirSync(SRC, {
  recursive: true,
  encoding: 'utf8',
})
  .filter((path) => path.endsWith('.tsx') && !path.includes('.test.') && path !== 'shell/states.tsx')
  .map((path) => [path, readFileSync(new URL(path, SRC), 'utf8')] as const);

describe('« Le serveur ne répond pas » (T6: ETA-04, ETA-05)', () => {
  const byHand = sources.filter(([, source]) => BY_HAND_PATTERN.test(source)).map(([path]) => path);

  it('is said by `Failure` alone, outside the screens named with their reason', () => {
    expect(byHand.filter((path) => !(path in BY_HAND))).toEqual([]);
  });

  it('names only screens that still say it by hand', () => {
    expect(Object.keys(BY_HAND).filter((path) => !byHand.includes(path))).toEqual([]);
  });

  it('finds the screens that go through `Failure`', () => {
    const through = sources.filter(([, source]) => /<Failure\b/u.test(source));
    expect(through.length).toBeGreaterThan(30);
  });
});
