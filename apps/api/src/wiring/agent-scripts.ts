import {
  CreatorIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  type SentScriptStep,
} from '@impera/contracts';

import type { AgentScriptView, ScriptHistoryView, ScriptSource } from '../modules/agent';
import type { ConnectorsModule } from '../modules/connectors';
import type { FansModule } from '../modules/fans';
import type { ScriptsModule } from '../modules/scripts';

/** A native script of hers as the `scripts` module reads it for a job. */
type HerScript = Awaited<ReturnType<ScriptsModule['forJobs']['accountScripts']>>[number];

/**
 * The copy on Reveal still says what we prepared (ADR 0161 § 5): the same steps, one branch each, at our price and
 * currency. Changed on Reveal after it was recognised, it is no longer offered: nothing goes at a price not ours.
 */
function stillOurs(script: HerScript, ours: NonNullable<HerScript['ours']>): boolean {
  return (
    ours.steps.length === script.steps.length &&
    script.steps.every((step, index) => {
      const branches = ours.steps[index]?.branches ?? [];
      const [branch] = branches;
      return (
        branches.length === step.branches &&
        branch?.priceMinor === step.priceMinor &&
        branch.currency === step.currency
      );
    })
  );
}

/**
 * A native script as the agent decides on it (ADR 0098), or `null` when it may not be offered (ADR 0161 § 4): only
 * the recognised copy of a script we prepared, still the same on Reveal, with our description and moment. A native
 * script of no script of ours is never offered, whatever identity it carries (those rows are ignored, § 5). Neither is
 * one with a gap of P6-01, or with a step of several branches: the branch engine (ADR 0112, lot 2) reads those.
 * A step is paid when the platform prices it, offered when it sends a media for free, and a bridge when it is text.
 */
export function agentScriptViewOf(script: HerScript): AgentScriptView | null {
  const { ours } = script;
  if (ours === null || !script.proposable) return null;
  if (script.steps.some((step) => step.branches > 1)) return null;
  if (!stillOurs(script, ours)) return null;
  const media = script.steps.flatMap((step) => [...step.media, ...step.previewMedia]);
  return {
    scriptRef: script.ref,
    moment: ours.moment,
    description: ours.description,
    steps: script.steps.map((step) => ({
      stepRef: step.ref,
      kind: step.priceMinor > 0 ? 'paid' : step.media.length > 0 ? 'free' : 'bridge',
      priceMinor: step.priceMinor > 0 ? step.priceMinor : null,
      mediaRefs: step.media.map((each) => each.ref),
    })),
    mediaValidated: media.every((each) => each.described),
    // Written by a human in the editor and checked against her active persona (ADR 0112 § 14).
    descriptionValidated: true,
    // Her persona's limits are checked on our script in the editor, and by the guards on each bubble.
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
