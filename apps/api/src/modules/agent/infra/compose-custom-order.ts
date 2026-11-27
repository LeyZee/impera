import { supplementsIn } from '@impera/contracts';
import type { Brief } from '@impera/llm';

import { customOrderTurn, type CustomOrderTurn } from '../../custom-orders';
import {
  customOrderDecision,
  customOrderStop,
  saysWhatHeWants,
  type CustomOrderDecision,
} from '../domain/custom-order';
import { touchesTerm } from '../domain/guards';

import type { BrainTurn } from './compose-brain';
import type { ComposeTurnInput, ComposerPersona } from './compose-types';

/**
 * The custom-orders turn as the rest of the turn reads it: a chatter takes it, or she answers from its brief and her
 * card going out opens the order in « À traiter » (`custom_order_opened`, until its own line comes).
 */
function decisionOf(turn: ReturnType<typeof customOrderTurn> | undefined): CustomOrderDecision {
  if (turn === undefined || turn.kind === 'none') return { kind: 'none' };
  if (turn.kind === 'handoff') return { kind: 'handoff' };
  return { kind: 'reply', brief: turn.brief, opens: turn.event?.type === 'custom_order_card_ready' };
}

/**
 * A custom order is never sold by her (ADR 0090 § A): a chatter takes it, or she commits to nothing. A trap's answer
 * comes first, and in the care mode nothing is sold at all (ADR 0088 § 2). Kept, his order goes box by box until her
 * card (ADR 0159 § A.2); otherwise she commits to nothing (ADR 0090 § A).
 */
export function customOrderOf(facts: {
  readonly persona: ComposerPersona;
  readonly input: ComposeTurnInput;
  readonly brief: Brief | undefined;
  readonly kept: BrainTurn['kept'];
  readonly ageConfirmed: boolean;
  readonly trapped: boolean;
  readonly care: boolean;
  readonly proofRelayed: boolean;
}): {
  readonly customOrder: Exclude<CustomOrderDecision, { kind: 'none' }> | undefined;
  readonly customOrderKept: Exclude<CustomOrderTurn, { kind: 'none' }> | undefined;
} {
  const { brief, input, kept } = facts;
  const orderContext =
    brief === undefined
      ? undefined
      : {
          risks: brief.risks,
          flags: input.customOrder?.flags,
          ageConfirmed: facts.ageConfirmed || input.customOrder?.flags?.ageConfirmedAt !== undefined,
          neverDoes: (facts.persona.guardSettings.neverDo ?? []).some((term) =>
            touchesTerm(input.fanText, term),
          ),
        };
  const held = brief === undefined || orderContext === undefined || facts.trapped || facts.care;
  const turn =
    held || kept === undefined
      ? undefined
      : customOrderTurn({
          asksForService: brief.intent === 'asks_for_service' || facts.proofRelayed,
          reading:
            brief.customOrder === undefined
              ? null
              : supplementsIn(
                  brief.customOrder,
                  (kept.grid?.supplements ?? []).map((line) => line.id),
                ),
          order: kept.order,
          stop: customOrderStop(orderContext),
          chatterOnShift: input.customOrder?.chatterOnShift === true,
          grid: kept.grid,
        });
  const order: CustomOrderDecision | undefined = held
    ? undefined
    : kept !== undefined
      ? decisionOf(turn)
      : customOrderDecision({
          ...orderContext,
          asksForService: brief.intent === 'asks_for_service' || facts.proofRelayed,
          chatterOnShift: input.customOrder?.chatterOnShift === true,
          orderOpen: input.customOrder?.orderOpen === true,
          // A proof relayed says what he wants by itself; otherwise the brain's reading of his request.
          saysWhatHeWants: facts.proofRelayed || saysWhatHeWants(brief.customOrder),
        });
  const customOrder = order?.kind === 'none' ? undefined : order;
  const customOrderKept = turn === undefined || turn.kind === 'none' ? undefined : turn;
  return { customOrder, customOrderKept };
}
