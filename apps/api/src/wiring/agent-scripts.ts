import {
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  type ScriptEnergy,
  type SentScriptStep,
} from '@impera/contracts';

import type { AgentScriptView, ScriptHistoryView, ScriptSource } from '../modules/agent';
import type { ConnectorsModule } from '../modules/connectors';
import type { FansModule } from '../modules/fans';
import type { ScriptsModule } from '../modules/scripts';

/** A native script of hers as the `scripts` module reads it for a job. */
type HerScript = Awaited<ReturnType<ScriptsModule['forJobs']['accountScripts']>>[number];

const ENERGY: Record<ScriptEnergy, string> = {
  soft: 'douce tout du long',
  rising: 'qui monte',
  intense: 'intense dès le début',
};

/** What the brain picks a script on (ADR 0098 § 6): its validated identity, in the agency's words. */
function descriptionOf(identity: NonNullable<HerScript['identity']>): string {
  const { ambiance, energy, setting, useWhen, avoidWhen } = identity.content;
  return [
    `Ambiance : ${ambiance}, ${ENERGY[energy]}.`,
    `Décor : ${setting}.`,
    `À utiliser quand : ${useWhen.join(' ; ')}.`,
    ...(avoidWhen.length === 0 ? [] : [`À éviter quand : ${avoidWhen.join(' ; ')}.`]),
  ].join('\n');
}

/**
 * A native script as the agent decides on it (ADR 0098), or `null` when it may not be offered: not proposable (the
 * gaps of P6-01, its identity not validated, a branch unset), or with a step of several branches. The branch engine
 * (ADR 0112, lot 2) reads those; until then a script with branches is never offered, whatever its settings.
 * A step is paid when the platform prices it, offered when it sends a media for free, and a bridge when it is text.
 */
export function agentScriptViewOf(script: HerScript): AgentScriptView | null {
  if (!script.proposable || script.identity?.validatedAt == null) return null;
  if (script.steps.some((step) => step.branches > 1)) return null;
  const media = script.steps.flatMap((step) => [...step.media, ...step.previewMedia]);
  return {
    scriptRef: script.ref,
    moment: script.moment,
    description: descriptionOf(script.identity),
    steps: script.steps.map((step) => ({
      stepRef: step.ref,
      kind: step.priceMinor > 0 ? 'paid' : step.media.length > 0 ? 'free' : 'bridge',
      priceMinor: step.priceMinor > 0 ? step.priceMinor : null,
      mediaRefs: step.media.map((each) => each.ref),
    })),
    mediaValidated: media.every((each) => each.described),
    descriptionValidated: true,
    // Her persona's limits are checked by the agency when it validates the identity, and by the guards on each bubble.
    touchesLimits: false,
  };
}

/**
 * What Reveal says was sent to him and what he bought, per script and step index (ADR 0018 § 5): each step it lists,
 * found among her scripts on the account by its own ref. A step of none of them is of a script gone: it rules nothing.
 */
export function scriptHistoryOf(
  scripts: readonly HerScript[],
  sent: readonly SentScriptStep[],
): ScriptHistoryView {
  const sentRefs = new Set(sent.map((step) => step.stepRef.id));
  const boughtRefs = new Set(sent.filter((step) => step.purchased).map((step) => step.stepRef.id));
  const indexesIn = (script: HerScript, refs: ReadonlySet<string>) =>
    script.steps.flatMap((step, index) => (refs.has(step.ref) ? [index] : []));
  return {
    scripts: scripts
      .map((script) => ({
        scriptRef: script.ref,
        sentStepIndexes: indexesIn(script, sentRefs),
        boughtStepIndexes: indexesIn(script, boughtRefs),
      }))
      .filter((entry) => entry.sentStepIndexes.length > 0),
  };
}

interface AgentScriptsDeps {
  readonly scripts: Pick<ScriptsModule['forJobs'], 'accountScripts'>;
  readonly reads: Pick<ConnectorsModule['platformReads'], 'scriptHistory' | 'lastOfferAt'>;
  readonly fans: Pick<FansModule, 'getFan'>;
}

/** The fan on the platform: his account and his platform id. A fan of another account is refused (fail closed). */
async function platformFanOf(
  deps: AgentScriptsDeps,
  creatorId: string,
  fanId: string,
): Promise<{ readonly platformAccountId: string; readonly platformFanId: string }> {
  const fan = await deps.fans.getFan(CreatorIdSchema.parse(creatorId), FanIdSchema.parse(fanId));
  if (fan === null) throw new Error('fan not found');
  return { platformAccountId: fan.platformAccountId, platformFanId: fan.platformFanId };
}

/**
 * Her scripts for the agent's composer (ADR 0098): her catalogue from the scripts the agency mirrored and validated,
 * his history from the platform, read again at each message. Any read that fails throws: the composer sells nothing.
 */
export function createAgentScriptSource(deps: AgentScriptsDeps): ScriptSource {
  return {
    async catalogue(creatorId, platformAccountId) {
      const scripts = await deps.scripts.accountScripts(
        CreatorIdSchema.parse(creatorId),
        PlatformAccountIdSchema.parse(platformAccountId),
      );
      return scripts.flatMap((script) => agentScriptViewOf(script) ?? []);
    },
    async history(creatorId, platformAccountId, _platformConversationId, fanId) {
      const fan = await platformFanOf(deps, creatorId, fanId);
      if (fan.platformAccountId !== platformAccountId) throw new Error('fan of another account');
      const accountId = PlatformAccountIdSchema.parse(platformAccountId);
      const [scripts, sent] = await Promise.all([
        deps.scripts.accountScripts(CreatorIdSchema.parse(creatorId), accountId),
        deps.reads.scriptHistory(accountId, fan.platformFanId),
      ]);
      return scriptHistoryOf(scripts, sent);
    },
  };
}

/**
 * When a priced bundle was last offered to him on the platform, bought or not: the policy's cooldown (P6-01). Without a
 * script she may offer on his account, the platform is not asked: she offers only what a script sends (ADR 0098), so
 * nothing can be sold whatever the cooldown says.
 */
export function createLastOfferAt(
  deps: AgentScriptsDeps,
): (creatorId: string, fanId: string) => Promise<Date | null> {
  return async (creatorId, fanId) => {
    const fan = await platformFanOf(deps, creatorId, fanId);
    const accountId = PlatformAccountIdSchema.parse(fan.platformAccountId);
    const scripts = await deps.scripts.accountScripts(CreatorIdSchema.parse(creatorId), accountId);
    if (!scripts.some((script) => agentScriptViewOf(script) !== null)) return null;
    return deps.reads.lastOfferAt(accountId, fan.platformFanId);
  };
}
