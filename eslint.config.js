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
 * Single source of truth, mirrored in docs/architecture/modules.md. No cycles allowed. A planned module (sales,
 * scripts: phase 6) enters here with its first code.
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
  scheduling: [],
  alerts: [],
  payroll: [],
};

const moduleNames = Object.keys(MODULE_DEPENDENCIES);

/** Element selector helpers for `boundaries/dependencies` policies. */
const el = (type, captured) => ({ element: captured ? { type, captured } : { type } });
const pkg = (name) => el('package', { package: name });
const anyOf = (...selectors) => selectors;

/** Module layers, told apart by the file's path inside the module folder. */
const LAYERS = { domain: 'domain/**', application: 'application/**', infra: 'infra/**', index: 'index.ts' };
const layer = (name, module) => ({
  element: {
    type: 'module',
    fileInternalPath: LAYERS[name],
    ...(module === undefined ? {} : { captured: { module } }),
  },
});

/** For each module: its own layers plus the index.ts of the modules it may depend on. */
const moduleRules = moduleNames.flatMap((name) => {
  const own = (layerName) => layer(layerName, name);
  const allowedIndexes =
    MODULE_DEPENDENCIES[name].length > 0 ? [layer('index', MODULE_DEPENDENCIES[name])] : [];
  return [
    { from: own('domain'), allow: { to: anyOf(own('domain'), pkg('contracts')) } },
    {
      from: own('application'),
      allow: { to: anyOf(own('domain'), own('application'), pkg('contracts'), ...allowedIndexes) },
    },
    {
      from: own('infra'),
      allow: { to: anyOf(own('domain'), own('application'), own('infra'), el('package'), ...allowedIndexes) },
    },
    {
      from: own('index'),
      allow: { to: anyOf(own('domain'), own('application'), own('infra'), el('package'), ...allowedIndexes) },
    },
  ];
});

/** External (npm) and core (node:) modules a given element may not import. */
const external = (...sources) => ({ module: { origin: ['external', 'core'], source: sources } });

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
            { from: el('api-root'), allow: { to: anyOf(layer('index'), el('package'), el('api-root')) } },
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
              allow: { to: anyOf(layer('index'), el('package'), el('api-root'), el('api-test')) },
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
                el('web'),
                el('extension'),
                el('api-root'),
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
      ],
    },
  },
  {
    // Tests and ops scripts may log to the console.
    files: ['**/*.test.ts', '**/scripts/**', 'evals/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);

export { MODULE_DEPENDENCIES, moduleNames };
