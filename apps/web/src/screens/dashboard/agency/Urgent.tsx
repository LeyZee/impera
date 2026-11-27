import type { CreatorTodo } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Chevron } from '../parts';

import { lengthOf } from '@/scheduling/time';
import { todosAcrossQuery } from '@/screens/tracking/api';

/** At most this many lines: the rest one tap away, in Suivi. */
const SHOWN = 3;

/**
 * « Ils t'attendent » (grande recette 21/11, point 2, validé par Charles): « À traiter » of every creator followed, at the
 * top of the agency's Dashboard, so it never opens on figures while fans wait. Red for the grave lines (a possible minor,
 * consent, distress), amber for the rest; three at most, the gravest then the longest waiting, as the server orders
 * them. Nothing while nothing waits.
 */
export function UrgentCard({ opensTracking }: { opensTracking: boolean }): JSX.Element | null {
  const query = useQuery({ ...todosAcrossQuery, enabled: opensTracking });
  const navigate = useNavigate();
  const items = query.data?.items ?? [];
  if (!opensTracking || items.length === 0) return null;
  const grave = items.filter((todo) => todo.tone === 'bad').length;
  const open = (todo: CreatorTodo): void =>
    void navigate({ to: '/suivi', search: { conversation: todo.conversationId, creatrice: todo.creatorId } });
  return (
    <section
      className="nv-plate urg nv-enter"
      data-tone={grave > 0 ? 'bad' : 'warn'}
      style={{ '--nv-i': 0 }}
      aria-labelledby="urg-title"
    >
      <header className="urg__head">
        <span className="urg__pulse" aria-hidden="true" />
        <h2 className="nv-h3 urg__title" id="urg-title">
          {items.length === 1 ? 'Un fan t’attend' : `${String(items.length)} fans t’attendent`}
          {grave > 0 ? (
            <span className="urg__grave">
              {grave === 1 ? 'dont 1 grave' : `dont ${String(grave)} graves`}
            </span>
          ) : null}
        </h2>
        <Link to="/suivi" className="urg__all nv-tap">
          Tout voir
          <Chevron className="db-chev" />
        </Link>
      </header>
      <ul className="urg__list">
        {items.slice(0, SHOWN).map((todo, i) => (
          <li key={`${todo.creatorId}:${todo.conversationId}:${todo.kind}`} style={{ '--_i': i }}>
            <button
              type="button"
              className="urg__row"
              data-tone={todo.tone === 'bad' ? 'bad' : 'warn'}
              onClick={() => {
                open(todo);
              }}
            >
              <span className="urg__dot" aria-hidden="true" />
              <span className="urg__who">
                <b>{todo.title}</b>
                <span className="urg__creator">{todo.creatorName}</span>
              </span>
              <span className="urg__why">{todo.why}</span>
              <span className="urg__time">{`depuis ${lengthOf(todo.waitingMinutes * 60_000)}`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
