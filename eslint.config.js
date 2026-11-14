// ESLint flat config. Module boundaries (ADR 0002) are enforced here.
// Never disable a `boundaries/*` rule: see CLAUDE.md.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import prettier from 'eslint-config-prettier';

/**
 * Business modules of apps/api and the modules each one may import (through their index.ts only).
 * Single source of truth, mirrored in docs/architecture/modules.md. No cycles allowed. A planned module (sales:
 * phase 6) enters here with its first code.
 */
const MODULE_DEPENDENCIES = {
  connectors: ['conversations'],
  conversations: ['fans', 'persona', 'agent', 'media'],
  fans: [],
  persona: [],
  agent: ['fans', 'persona', 'media'],
  media: [],
  supervision: ['conversations', 'fans'],
  playground: ['agent'],
  providers: [],
  telegram: [],
  team: [],
  backups: [],
  // ADR 0091: reads the gateway's journal and keeps the credits ledger; imports no module.
  'ai-usage': [],
  scheduling: [],
  scripts: [],
  alerts: [],
  // ADR 0047 § 1: pay is four modules; contractors imports none of the others.
  contractors: [],
  payroll: ['contractors'],
  invoicing: ['payroll', 'contractors'],
  accounting: ['payroll', 'invoicing', 'contractors'],
  notifications: [],
  // ADR 0060: the trend watch reads her limits as the agent's guards do (`touchesTerm`), and a validated idea enters her
  // agenda through the agenda's own door (`suggestShoot`, VEI-01 d1), and the shoot she accepts asks its content
  // through the drops' door (`requestFromIdea`, d2), never by writing their tables.
  trends: ['agent', 'content-drops', 'creator-tasks'],
  // CR-05: her agenda reads her days and her wall-clock time with the scheduling helpers (`scheduling/pure.ts`).
  'creator-tasks': ['scheduling'],
  // CR-06: her drops and the agency's requests (ADR 0044, ADR 0055).
  'content-drops': [],
  // ADR 0026, 0105: a second door on the modules' commands. Lot a, first part, is its pure rules only; the modules it
  // reads join this list with the tools' wiring.
  mcp: [],
};

const moduleNames = Object.keys(MODULE_DEPENDENCIES);

/** Element selector helpers for `boundaries/dependencies` policies. */
const el = (type, captured) => ({ element: captured ? { type, captured } : { type } });
const pkg = (name) => el('package', { package: name });
const anyOf = (...selectors) => selectors;

/**
 * Module layers, told apart by the file's path inside the module folder. `pure.ts` is the second entry point of
 * ADR 0051: re-exports of the module's own pure domain rules, which the modules depending on it may import anywhere.
 */
const LAYERS = {
  domain: 'domain/**',
  application: 'application/**',
  infra: 'infra/**',
  index: 'index.ts',
  pure: 'pure.ts',
};
const layer = (name, module) => ({
  element: {
    type: 'module',
    fileInternalPath: LAYERS[name],
    ...(module === undefined ? {} : { captured: { module } }),
  },
});

/**
 * For each module: its own layers, plus the index.ts of the modules it may depend on (outside its domain) and their
 * pure.ts (everywhere, ADR 0051). Any other file of another module stays out of reach.
 */
const moduleRules = moduleNames.flatMap((name) => {
  const own = (layerName) => layer(layerName, name);
  const dependencies = MODULE_DEPENDENCIES[name];
  const allowedIndexes = dependencies.length > 0 ? [layer('index', dependencies)] : [];
  const allowedPures = dependencies.length > 0 ? [layer('pure', dependencies)] : [];
  return [
    { from: own('pure'), allow: { to: anyOf(own('domain'), pkg('contracts')) } },
    { from: own('domain'), allow: { to: anyOf(own('domain'), pkg('contracts'), ...allowedPures) } },
    {
      from: own('application'),
      allow: {
        to: anyOf(own('domain'), own('application'), pkg('contracts'), ...allowedIndexes, ...allowedPures),
      },
    },
    {
      from: own('infra'),
      allow: {
        to: anyOf(
          own('domain'),
          own('application'),
          own('infra'),
          own('pure'),
          el('package'),
          ...allowedIndexes,
          ...allowedPures,
        ),
      },
    },
    {
      from: own('index'),
      allow: {
        to: anyOf(
          own('domain'),
          own('application'),
          own('infra'),
          own('pure'),
          el('package'),
          ...allowedIndexes,
          ...allowedPures,
        ),
      },
    },
  ];
});

/** External (npm) and core (node:) modules a given element may not import. */
const external = (...sources) => ({ module: { origin: ['external', 'core'], source: sources } });

/**
 * The rule `react/jsx-no-comment-textnodes`, without its plugin: a line comment or a block comment written as JSX
 * text is shown on the screen, not read as a comment (seen on #486). `scripts/eslint-config.test.mjs` checks it.
 */
const JSX_COMMENT_TEXT = {
  selector: 'JSXText[value=/(^|\\n)\\s*\\/[\\/*]/]',
  message: 'A comment written as JSX text is displayed: wrap it in braces, {/* … */}.',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/node_modules/**',
      '.scratch/**',
      '**/coverage/**',
      '**/*.config.*',
      'scripts/**',
      // Boundary fixtures break the rules on purpose; apps/api/src/__tests__/boundaries.test.ts lints them.
      'apps/api/src/__tests__/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { boundaries, 'import-x': importX },
    settings: {
      // Paths in `boundaries/elements` are relative to the repository root, whatever directory ESLint runs from
      // (turbo runs `eslint` inside each package).
      'boundaries/root-path': import.meta.dirname,
      // boundaries resolves imports through the eslint-plugin-import setting, import-x through its own.
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'] },
      },
      // import-x parses the imported files itself (needed by no-cycle): TypeScript sources need the TS parser.
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import-x/extensions': ['.ts', '.tsx', '.js', '.mjs'],
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: ['apps/*/tsconfig.json', 'packages/*/tsconfig.json'],
        }),
      ],
      // Elements are folders. A business module is one element; its layers (domain, application, infra) and its
      // public entry point (index.ts) are told apart by the file's path inside the module (`fileInternalPath`).
      'boundaries/elements': [
        { type: 'module', pattern: 'apps/api/src/modules/*', capture: ['module'], partialMatch: false },
        { type: 'api-tests', pattern: 'apps/api/src/__tests__', partialMatch: false },
        { type: 'api-scripts', pattern: 'apps/api/src/scripts', partialMatch: false },
        // ADR 0047 § 3: each module's wiring, imported by `composition-root.ts` alone.
        { type: 'api-wiring', pattern: 'apps/api/src/wiring', partialMatch: false },
        { type: 'api-root', pattern: 'apps/api/src', partialMatch: false },
        { type: 'api-test', pattern: 'apps/api/test', partialMatch: false },
        { type: 'package', pattern: 'packages/*/src', capture: ['package'], partialMatch: false },
        { type: 'web', pattern: 'apps/web/src', partialMatch: false },
        { type: 'extension', pattern: 'apps/extension/src', partialMatch: false },
        { type: 'evals', pattern: 'evals', partialMatch: false },
      ],
      // Test files next to the code may import anything inside their own package.
      'boundaries/ignore': ['**/*.test.ts', '**/*.spec.ts'],
    },
    rules: {
      // Layer purity inside a module, the dependency graph between modules (ADR 0002) and the external
      // packages each layer may use. Another module is reachable through its index.ts only: importing
      // `modules/fans/infra/...` from another module is an error. Policies are evaluated in order; the last match wins.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          checkAllOrigins: true,
          policies: [
            // npm packages and node: builtins are allowed by default; the policies at the end restrict them.
            { allow: { to: { module: { origin: ['external', 'core'] } } } },
            ...moduleRules,
            {
              from: el('api-root'),
              allow: { to: anyOf(layer('index'), el('package'), el('api-root')) },
            },
            // The one place where the wiring files are imported, and the order they are built in.
            {
              from: { element: { type: 'api-root', fileInternalPath: 'composition-root.ts' } },
              allow: { to: anyOf(layer('index'), el('package'), el('api-root'), el('api-wiring')) },
            },
            // A wiring file builds its module from the shared dependencies: modules by their index.ts only.
            {
              from: el('api-wiring'),
              allow: { to: anyOf(layer('index'), el('package'), el('api-root'), el('api-wiring')) },
            },
            {
              from: el('api-scripts'),
              allow: { to: anyOf(layer('index'), el('package'), el('api-root')) },
            },
            {
              from: el('api-tests'),
              allow: {
                to: anyOf(layer('index'), el('package'), el('api-root'), el('api-test'), el('api-tests')),
              },
            },
            {
              from: el('api-test'),
              allow: {
                to: anyOf(layer('index'), el('package'), el('api-root'), el('api-test')),
              },
            },
            { from: el('package'), allow: { to: el('package') } },
            // design-system: ADR 0015. Apps may import it next to contracts.
            { from: el('web'), allow: { to: anyOf(pkg('contracts'), pkg('design-system'), el('web')) } },
            {
              from: el('extension'),
              allow: { to: anyOf(pkg('contracts'), pkg('design-system'), el('extension')) },
            },
            { from: el('evals'), allow: { to: anyOf(pkg('contracts'), pkg('llm'), el('evals')) } },
            // The domain does no I/O.
            {
              from: layer('domain'),
              disallow: {
                to: [
                  external('drizzle-orm', 'fastify', 'graphile-worker', 'pg', 'undici', 'ai', '@ai-sdk/*'),
                  { module: { origin: 'core', source: '!node:crypto' } },
                ],
              },
            },
            // pure.ts has the domain's bans, and no npm package at all (ADR 0051).
            {
              from: layer('pure'),
              disallow: {
                to: [
                  { module: { origin: 'external' } },
                  { module: { origin: 'core', source: '!node:crypto' } },
                ],
              },
            },
            // LLM SDKs never leave packages/llm (ADR 0009).
            {
              from: anyOf(
                pkg('contracts'),
                pkg('db'),
                pkg('design-system'),
                layer('domain'),
                layer('application'),
                layer('infra'),
                layer('index'),
                layer('pure'),
                el('web'),
                el('extension'),
                el('api-root'),
                el('api-wiring'),
                el('api-scripts'),
                el('evals'),
              ),
              disallow: {
                to: external('ai', '@ai-sdk/*', 'openai', '@anthropic-ai/sdk', '@mistralai/mistralai'),
              },
            },
          ],
        },
      ],
      'import-x/order': ['error', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'import-x/no-cycle': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use literal unions and Zod schemas instead of enums (coding.md).',
        },
        JSX_COMMENT_TEXT,
      ],
    },
  },
  {
    // Tests and ops scripts may log to the console.
    files: ['**/*.test.ts', '**/scripts/**', 'evals/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // ADR 0051: a module's pure.ts only re-exports from its own domain; it writes nothing itself.
    files: ['apps/api/src/modules/*/pure.ts', 'apps/api/src/__tests__/fixtures/boundaries/modules/*/pure.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Program > :not(ExportNamedDeclaration[source.value=/^\\.\\/domain\\//], ExportAllDeclaration[source.value=/^\\.\\/domain\\//])',
          message: 'pure.ts only re-exports from its own domain/ (ADR 0051).',
        },
      ],
    },
  },
  prettier,
);

export { JSX_COMMENT_TEXT, MODULE_DEPENDENCIES, moduleNames };
