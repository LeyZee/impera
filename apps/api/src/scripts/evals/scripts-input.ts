import type { ScriptsInput } from '../../modules/agent/index';

import type { ScenarioScripts } from './scenario';

const MINUTE_MS = 60_000;

/**
 * Her scripts as the agent reads them, from a scenario's made-up catalogue, run and Reveal history (ADR 0098): the
 * same input a real fan's message gets from the platform. Prices are given in euros, read in cents.
 */
export function scriptsInputOf(scripts: ScenarioScripts, now: Date): ScriptsInput {
  const catalogue = scripts.catalogue.map((script) => ({
    scriptRef: script.ref,
    moment: script.moment,
    description: script.description,
    steps: script.steps.map((step) => ({
      kind: step.kind,
      priceMinor: step.price_euros === undefined ? null : Math.round(step.price_euros * 100),
      ...(step.instruction !== undefined && { instruction: step.instruction }),
      ...(step.media !== undefined && { mediaSheet: step.media }),
      // A scenario names no vault media: what he received is told by the scripts played.
      mediaRefs: [],
    })),
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  }));
  const { run } = scripts;
  const startedAt = new Date(now.getTime() - (run?.started_minutes_ago ?? 0) * MINUTE_MS);
  const script = catalogue.find((entry) => entry.scriptRef === run?.script);
  const latest =
    run === undefined
      ? null
      : {
          scriptRef: run.script,
          status: run.status,
          steps: run.steps.map((step) => {
            const platform = script?.steps[step.index];
            return {
              stepIndex: step.index,
              kind: platform?.kind ?? 'free',
              outcome: step.outcome,
              priceMinor: platform?.priceMinor ?? null,
              sentAt: startedAt,
              at: startedAt,
            };
          }),
          ignoredMessages: run.ignored_messages,
          startedAt,
          endedAt: run.status === 'open' ? null : startedAt,
        };
  return {
    conversationRef: 'conversation-eval',
    catalogue,
    history: {
      scripts: scripts.history.map((entry) => ({
        scriptRef: entry.script,
        sentStepIndexes: entry.sent,
        boughtStepIndexes: entry.bought,
      })),
    },
    latest,
    countsHisMessage: true,
  };
}
