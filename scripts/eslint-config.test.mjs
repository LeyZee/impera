// The repository's ESLint rules that need no type information, run on small texts (node --test, `pnpm test:scripts`).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Linter } from 'eslint';

import config, { JSX_COMMENT_TEXT } from '../eslint.config.js';

const linter = new Linter();
const jsx = (code) =>
  linter.verify(code, [
    {
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { 'no-restricted-syntax': ['error', JSX_COMMENT_TEXT] },
    },
  ]);

test('a comment written as JSX text is refused, a real one and plain text are not', () => {
  assert.equal(jsx('const a = <div>\n  // pas un commentaire\n</div>;').length, 1);
  assert.equal(jsx('const a = <p>/* non plus */</p>;').length, 1);
  assert.deepEqual(jsx('const a = <div>{/* un vrai */}Texte https://exemple.test/a</div>;'), []);
});

test('the rule is in the configuration every source file reads', () => {
  const holds = config.some((entry) =>
    (entry.rules?.['no-restricted-syntax'] ?? []).slice(1).includes(JSX_COMMENT_TEXT),
  );
  assert.equal(holds, true);
});
