import type { CreatorTodo } from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { dismissFragile, setFanFlag, todosAcrossQuery } from './api';

import { frenchSpaces } from '@/lib/utils';

/** His line « Le marquer fragile ? » in « À traiter », where the server put it, or `undefined`. */
export function useFragileTodo(creatorId: string, fanId: string): CreatorTodo | undefined {
  const queue = useQuery(todosAcrossQuery);
  return queue.data?.items.find(
    (item) => item.kind === 'fragile_proposed' && item.fanId === fanId && item.creatorId === creatorId,
  );
}

/**
 * The AI's proposal to mark him « fragile » (ADR 0085 § 9, lot b2), at the top of his sheet with what to know before
 * writing to him, in amber: why, in one sentence, and the two answers. « Marquer fragile » sets the limit as a person
 * does by hand; « Écarter » sets the proposal aside. Someone who cannot change his limits reads it without the buttons.
 */
export function FragileProposal({
  creatorId,
  fanId,
  todo,
  canDecide,
}: {
  creatorId: string;
  fanId: string;
  todo: CreatorTodo;
  canDecide: boolean;
}): JSX.Element {
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (call: () => Promise<string | null>): Promise<void> => {
    setPending(true);
    setError(null);
    const refused = await call();
    setPending(false);
    if (refused !== null) {
      setError(refused);
      return;
    }
    await Promise.all([
      client.invalidateQueries({ queryKey: todosAcrossQuery.queryKey }),
      client.invalidateQueries({ queryKey: ['fan-flags', creatorId, fanId] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };

  return (
    <li className="tr-alert tr-alert--care tr-fragile">
      <strong>Le marquer fragile ?</strong>
      <span>{frenchSpaces(todo.why)}</span>
      {canDecide ? (
        <span className="tr-fragile__actions">
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--soft"
            disabled={pending}
            onClick={() =>
              void answer(async () => {
                const result = await setFanFlag(creatorId, fanId, { flag: 'fragile', set: true });
                return result.ok ? null : result.message;
              })
            }
          >
            Marquer fragile
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--plain"
            disabled={pending}
            onClick={() => void answer(() => dismissFragile(creatorId, fanId))}
          >
            Écarter
          </button>
        </span>
      ) : (
        <span className="tr-limit__hint">Le propriétaire ou un manager décide.</span>
      )}
      {error === null ? null : (
        <span className="tr-warn" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
