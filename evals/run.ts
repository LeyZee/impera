/**
 * `pnpm evals`: the nightly quality gate (docs/playbooks/write-an-eval.md). It is red until it really
 * measures something: an empty suite, a suite below `min_scenarios` or a missing key never passes, so a
 * nightly run cannot look green while testing nothing. Then the scenarios run through the real agent path
 * (`apps/api/src/scripts/evals.ts`), where the agent's code lives.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { countScenarios, readThresholds } from './suite';

const tier = process.argv.includes('--full') ? 'full' : 'smoke';
const dir = fileURLToPath(new URL('.', import.meta.url));
const thresholds = readThresholds(readFileSync(`${dir}thresholds.json`, 'utf8'));
const found = countScenarios((sub) => {
  try {
    return readdirSync(`${dir}${sub}`);
  } catch {
    return [];
  }
});
const needed = thresholds[tier].min_scenarios;

if (found < needed) {
  console.error(
    `evals ${tier}: ${String(found)} scenario(s) in scenarios/, adversarial/ and regression/, ${String(needed)} needed. ` +
      'An empty or shrunk suite fails on purpose (docs/playbooks/write-an-eval.md).',
  );
  process.exit(1);
}
if (process.env['LLM_XAI_API_KEY'] === undefined || process.env['LLM_XAI_API_KEY'] === '') {
  console.error('evals: no LLM_XAI_API_KEY in the environment, nothing can be measured.');
  process.exit(1);
}
const args = [
  '--filter',
  '@nirvana/api',
  'run',
  'evals',
  ...process.argv.slice(2).filter((arg) => arg !== '--'),
];
const run = spawnSync('pnpm', args, { stdio: 'inherit' });
process.exit(run.status ?? 1);
