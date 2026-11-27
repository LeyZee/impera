import type { CustomPriceGrid, Language, OpenCustomOrder } from '@impera/contracts';
import type { BrainScript, Brief, LlmGateway } from '@impera/llm';
import { BRAIN_SCRIPTS_MAX, brainScriptId } from '@impera/llm';

import type { DesireMap } from '../domain/fantasy-match';
import { screenNotes } from '../domain/injection';
import { askableOnly } from '../domain/kyc';
import { maskOwnHandles } from '../domain/own-accounts';
import { paidWaiting } from '../domain/script-run';
import { withDiscountAsked } from '../domain/turn-briefs';
import {
  hisDesireMap,
  sameEveningAsLastOffer,
  scriptChoices,
  scriptLanguageOf,
  type ScriptChoice,
} from '../domain/turn-scripts';

import type { PreparedTurn } from './compose-inputs';
import type { ComposeTurnInput, ComposerPersona } from './compose-types';

/** The brain's reading of his message, and what was read for it that the rest of the turn uses. */
export interface BrainTurn {
  readonly brain: Awaited<ReturnType<LlmGateway['brain']>>;
  /** Its reading as code keeps it; absent when the brain failed. */
  readonly brief: Brief | undefined;
  /** Lines of her notes shaped like an order: kept out of both prompts. */
  readonly droppedNotes: readonly string[];
  readonly desireMap: DesireMap;
  readonly scriptLanguage: Language | null;
  /** The scripts the brain was offered, by the ids it answers with; none the same evening as her last one. */
  readonly choices: readonly ScriptChoice[];
  /** His fantasies none of her permitted scripts meets. */
  readonly uncovered: readonly string[];
  /** His order as the custom-orders module keeps it, with her grid; absent when none is kept. */
  readonly kept:
    { readonly order: OpenCustomOrder | null; readonly grid: CustomPriceGrid | null } | undefined;
}

/**
 * The brain's call on his message: her notes for it alone added to the shared ones, the scripts it may pick, his order
 * kept, and its reading as code keeps it. Its reading proposes; everything after it is decided by code.
 */
export async function askBrain(
  gateway: LlmGateway,
  persona: ComposerPersona,
  input: ComposeTurnInput,
  prepared: PreparedTurn,
): Promise<BrainTurn> {
  const { notes, base, language } = prepared;
  const brainOnly = screenNotes(input.brainNotes ?? '');
  const droppedNotes = [...notes.dropped, ...brainOnly.dropped];
  const desireMap = hisDesireMap(notes.kept, persona.guardSettings);
  const evening = sameEveningAsLastOffer(input.offer, input.situation);
  const scriptLanguage = scriptLanguageOf(language, input.keptLanguage?.value);
  // The care mode may depend on what the brain reads: only a care already open is known before it.
  const ranked = scriptChoices(
    input.scripts,
    input.situation,
    desireMap,
    input.offer,
    input.care === true,
    scriptLanguage,
    { max: BRAIN_SCRIPTS_MAX, idOf: brainScriptId },
  );
  const choices = evening ? [] : ranked.choices;
  const { uncovered } = ranked;
  const brainScripts: BrainScript[] = choices.map(({ id, script, matches }) => ({
    id,
    description: script.description,
    ...(matches.length > 0 && { matches }),
  }));
  const latestRun = input.scripts?.latest ?? null;
  const stepWaiting = latestRun?.status === 'open' && paidWaiting(latestRun) !== undefined;
  // His order kept by the custom-orders module (ADR 0159): the brain reads his request into its boxes.
  const kept =
    input.customOrder?.order === undefined
      ? undefined
      : { order: input.customOrder.order, grid: input.customOrder.grid ?? null };
  const brain = await gateway.brain({
    ...base,
    // Her handles never enter a prompt (Sécurité, 27/11).
    fanNotes: maskOwnHandles(
      [notes.kept, brainOnly.kept].filter((block) => block !== '').join('\n'),
      persona.guardSettings.ownAccounts,
    ),
    ...(input.alerts !== undefined && input.alerts.length > 0 && { alerts: input.alerts }),
    ...(brainScripts.length > 0 && { scripts: brainScripts }),
    ...(stepWaiting && { scriptStepWaiting: true }),
    ...(kept !== undefined && {
      customOrder: {
        open: kept.order !== null,
        supplements: (kept.grid?.supplements ?? []).map((line) => ({ id: line.id, name: line.label })),
      },
    }),
  });
  // She asks only what the card lets her ask (ADR 0085 § 2): whatever the brain names, `desires` is never asked.
  const asked = brain.ok ? askableOnly(brain.value.output) : undefined;
  const brief: Brief | undefined = asked === undefined ? undefined : withDiscountAsked(asked, input.fanText);
  return { brain, brief, droppedNotes, desireMap, scriptLanguage, choices, uncovered, kept };
}
