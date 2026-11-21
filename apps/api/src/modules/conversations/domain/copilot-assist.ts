import {
  COPILOT_DRAFT_REASON_LABELS,
  OBJECTION_KIND_LABELS,
  copilotNextMove,
  copilotStepName,
  type BankedObjectionKind,
  type CopilotAssist,
  type CopilotCut,
  type CopilotDraftReason,
  type CopilotTrace,
  type FanFlags,
} from '@impera/contracts';

/**
 * ADR 0141 lot a: what the copilot panel shows beside the draft, with no new AI call. The decision is the one the code
 * kept with the draft (`CopilotTrace`); the cuts and what the journal says now are read live at each read (§ 9).
 */
export interface CopilotLive {
  /** The trace of the draft waiting, or, without one, of his latest draft: where the sale stood then. */
  readonly trace: CopilotTrace | null;
  /** His limits; `null` when they do not read (fail closed: `limits_unread`). */
  readonly flags: FanFlags | null;
  readonly careSince: Date | null;
  readonly careClosedAt: Date | null;
  /** A human holds the conversation: the gesture is to hand over. */
  readonly held: boolean;
  /** The objections her bank already answered for him, in order. */
  readonly usedObjections: readonly BankedObjectionKind[];
  readonly customOrderOpen: boolean;
  /** A follow-up of hers is due now. */
  readonly followUpDue: boolean;
}

/** After the care mode, sales stay frozen and nothing explicit for 30 days (ADR 0088 § 7). */
const CARE_EXIT_DAYS = 30;
const DAY_MS = 86_400_000;

/** § 9: what the server cuts, in the panel's order (age first, then care, then the limits). */
export function copilotCuts(live: CopilotLive, now: Date): CopilotCut[] {
  const cuts: CopilotCut[] = [];
  const { flags } = live;
  if (flags?.ageDisputed !== undefined) cuts.push('age_doubt');
  if (live.careSince !== null) cuts.push('care');
  else if (
    live.careClosedAt !== null &&
    now.getTime() - live.careClosedAt.getTime() < CARE_EXIT_DAYS * DAY_MS
  )
    cuts.push('care_exit');
  if (flags?.doNotContact === true) cuts.push('do_not_contact');
  if (flags?.salesFrozen !== undefined) cuts.push('sales_frozen');
  if (flags === null) cuts.push('limits_unread');
  return cuts;
}

const nextStepOf = (step: { readonly stepIndex: number; readonly priceMinor: number } | null) =>
  step === null ? null : { name: copilotStepName(step.stepIndex), priceMinor: step.priceMinor };

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

/**
 * The panel's lines (§ 1 to § 5). With a draft waiting, its gesture, its reasons and the moment to sell; without one,
 * only where the sale stands and the signals, since an older draft's gesture is no longer what to do. A cut removes
 * the gesture, the sale, the moment and the buttons: the panel says the cut, once.
 */
export function copilotAssist(live: CopilotLive, now: Date, withDraft: boolean): CopilotAssist {
  const cuts = copilotCuts(live, now);
  const base = { cuts, buttons: [], clicksLeftToday: 0 };
  if (cuts.length > 0)
    return {
      ...base,
      nextMove: null,
      reasons: [],
      sale: null,
      signals: { desireTrend: null, followUpDue: false },
      saleMoment: null,
    };
  const { trace } = live;
  const sale = trace?.sale ?? null;
  const nextMove = live.held
    ? copilotNextMove({ kind: 'hand_over', priceMinor: null, block: null }, null)
    : withDraft && trace !== null
      ? copilotNextMove(trace.move, sale?.nextStep?.stepIndex ?? null)
      : null;
  const codes: readonly CopilotDraftReason[] = live.held
    ? ['handoff']
    : withDraft
      ? (trace?.reasons ?? [])
      : [];
  return {
    ...base,
    nextMove,
    reasons: unique(codes).map((code) => ({ code, label: COPILOT_DRAFT_REASON_LABELS[code] })),
    sale: {
      script:
        sale === null
          ? null
          : { name: sale.scriptName, stepIndex: sale.stepIndex, stepCount: sale.stepCount },
      nextStep: nextStepOf(sale?.nextStep ?? null),
      refusedSteps: unique(sale?.refusedStepIndexes ?? []).map(copilotStepName),
      usedObjections: unique(live.usedObjections).map((kind) => OBJECTION_KIND_LABELS[kind]),
      customOrderOpen: live.customOrderOpen,
      offerPending: sale?.offerPending ?? false,
    },
    signals: { desireTrend: trace?.desireTrend ?? null, followUpDue: live.followUpDue },
    ...(withDraft && trace !== null && { saleMoment: trace.saleMoment }),
  };
}
