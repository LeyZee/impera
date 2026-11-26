import type { CreatorDecisionId, CreatorSummary } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { answerInHerPlace, dueOf, ownerDecisionsKey, useOwnerDecisions } from './owner-decisions';

import { creatorAvatarUrl } from '@/creators/CreatorFace';
import { useNow } from '@/scheduling/useNow';
import { DecisionStack } from '@/screens/today/DecisionStack';
import '@/screens/today/creator-today.css';

/**
 * « Elle n'a pas encore répondu » (INS-05, ADR 0164): in the owner's « À faire » zone, the questions that wait on her
 * creators, the one that ends first on top, answered in her place with her own card. The number first, then the pile;
 * nothing when nothing waits. « Plus tard » and « D'autres idées » stay hers: the owner only answers.
 */
export function OwnerDecisions({
  creators,
  showWho,
}: {
  /** One creator on her Dashboard, all of them on « Toutes ». */
  creators: readonly CreatorSummary[];
  /** On « Toutes »: whose question it is, on each. */
  showWho: boolean;
}): JSX.Element | null {
  const { decisions } = useOwnerDecisions(creators);
  const client = useQueryClient();
  const now = useNow();
  if (decisions.length === 0) return null;
  const byId = new Map(decisions.map((one) => [one.decision.id, one.creator]));
  const creatorOf = (id: CreatorDecisionId): CreatorSummary | undefined => byId.get(id);
  return (
    <section className="db-decisions nv-enter" aria-labelledby="db-decisions-title">
      <header className="db-decisions__head">
        <h2 id="db-decisions-title" className="nv-h2">
          {decisions.length === 1
            ? '1 question sans réponse'
            : `${String(decisions.length)} questions sans réponse`}
        </h2>
        <p className="db-decisions__sub">
          {showWho ? 'Tes créatrices n’ont pas encore répondu' : 'Elle n’a pas encore répondu'}
        </p>
      </header>
      <DecisionStack
        decisions={decisions.map((one) => one.decision)}
        onAnswer={async (decision, key) => {
          const creator = creatorOf(decision.id);
          if (creator === undefined) throw new Error('decision without creator');
          try {
            return await answerInHerPlace(creator.id, decision.id, key);
          } finally {
            void client.invalidateQueries({ queryKey: ownerDecisionsKey(creator.id) });
          }
        }}
        {...(showWho
          ? {
              who: (decision) => {
                const creator = creatorOf(decision.id);
                return creator === undefined
                  ? undefined
                  : {
                      name: creator.displayName,
                      ...(creator.hasAvatar === true ? { avatarUrl: creatorAvatarUrl(creator.id) } : {}),
                    };
              },
            }
          : {})}
        due={(decision) => dueOf(decision.expiresAt, now)}
        notice={(decision) => (
          <p className="nv-note">Tu réponds à la place de {creatorOf(decision.id)?.displayName ?? 'elle'}.</p>
        )}
      />
    </section>
  );
}
