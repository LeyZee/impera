import type { FanCardRead } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { screenNotes } from '../domain/injection';

/** A message of the conversation the read gets, numbered: `conversations`' `CardReader` input, matched by shape. */
interface CardReadInput {
  readonly creatorId: string;
  readonly conversationId: string;
  readonly card: readonly string[];
  readonly messages: readonly {
    readonly number: number;
    readonly from: 'fan' | 'creator';
    readonly text: string;
    readonly isNew: boolean;
  }[];
}

type CardReadResult =
  | { readonly ok: true; readonly read: FanCardRead }
  | { readonly ok: false; readonly reason: 'budget' | 'failed' };

/** His card read in his new messages (ADR 0085 § 7): `conversations`' `CardReader` port, matched by shape. */
export interface AgentCardReader {
  read(input: CardReadInput): Promise<CardReadResult>;
}

/**
 * The read on the gateway's `brain` (prompt `brain/fan-card`): a line of his card shaped like an order is kept out
 * of the prompt, as his notes are for a draft; his messages go as data. Budget at its alert or no model: not read.
 */
export function createCardReader(deps: {
  readonly gateway: Pick<LlmGateway, 'readCard'>;
  readonly onDroppedNotes?: (event: { readonly conversationId: string; readonly dropped: number }) => void;
}): AgentCardReader {
  return {
    async read(input) {
      const screened = screenNotes(input.card.join('\n'));
      if (screened.dropped.length > 0)
        deps.onDroppedNotes?.({ conversationId: input.conversationId, dropped: screened.dropped.length });
      const result = await deps.gateway.readCard({
        card: screened.kept === '' ? [] : screened.kept.split('\n'),
        messages: input.messages,
        trace: { creatorId: input.creatorId, conversationId: input.conversationId },
      });
      if (result.ok) return { ok: true, read: result.value.output };
      return { ok: false, reason: result.error.code === 'all_models_failed' ? 'failed' : 'budget' };
    },
  };
}
