import type { LeaveRequest, ShiftSwapList, ShiftSwapRequest } from '@nirvana/contracts';
import { useState, type JSX } from 'react';

import { answerSwap, endLeave, endSwap, useRefreshPlanning } from '@/scheduling/api';
import {
  ERROR_MESSAGES,
  LEAVE_STATUS,
  leaveAhead,
  leaveDaysLine,
  leaveLength,
  READ_AGAIN,
  swapRefusalText,
  swapViewOf,
  type SwapSide,
  type SwapView,
} from '@/scheduling/model';

/**
 * The chatter's side of the leaves and the swaps (ADR 0031): the proposals waiting for their answer, their own leaves
 * and swaps. Every write reads the planning again; a refusal that says the list is read again does so too.
 */

/** A line the reader is told after an answer: the swap lapsed, or the server said no. */
interface Said {
  readonly text: string;
  readonly tone: 'info' | 'warn';
}

/** The names a swap list carries: members by display name, creators by name. */
export function namesOf(list: ShiftSwapList): {
  member: (id: string) => string;
  creator: (id: string) => string | undefined;
} {
  const members = new Map<string, string>(list.members.map((member) => [member.id, member.displayName]));
  const creators = new Map<string, string>(
    list.accounts.map((account) => [account.creatorId, account.creatorName]),
  );
  return {
    member: (id) => members.get(id) ?? 'Quelqu’un',
    creator: (id) => creators.get(id),
  };
}

/** « À toi de répondre »: the proposals a colleague made to the reader, each with Accepter and Refuser. */
export function Answers({
  swaps,
  list,
  zone,
}: {
  swaps: readonly ShiftSwapRequest[];
  list: ShiftSwapList;
  zone: string;
}): JSX.Element | null {
  const [said, setSaid] = useState<Said | null>(null);
  if (swaps.length === 0 && said === null) return null;
  const names = namesOf(list);
  return (
    <section className="sc-answers nv-swap" aria-labelledby="sc-answers-title">
      <h2 id="sc-answers-title" className="sc-section__title">
        {swaps.length === 0
          ? 'Échanges'
          : swaps.length === 1
            ? 'Un échange attend ta réponse'
            : `${String(swaps.length)} échanges attendent ta réponse`}
      </h2>
      {said === null ? null : (
        <p className={`sc-said sc-said--${said.tone} nv-swap`} role="status">
          {said.text}
        </p>
      )}
      <ul className="sc-cards">
        {swaps.map((swap, index) => (
          <AnswerCard
            key={swap.id}
            swap={swap}
            view={swapViewOf(swap, 'target', names, zone)}
            index={index}
            requester={names.member(swap.requesterId)}
            onSaid={setSaid}
          />
        ))}
      </ul>
    </section>
  );
}

function AnswerCard({
  swap,
  view,
  index,
  requester,
  onSaid,
}: {
  swap: ShiftSwapRequest;
  view: SwapView;
  index: number;
  requester: string;
  onSaid: (said: Said | null) => void;
}): JSX.Element {
  const refresh = useRefreshPlanning();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const answer = async (choice: 'accept' | 'decline'): Promise<void> => {
    setBusy(choice);
    setProblem(null);
    onSaid(null);
    const outcome = await answerSwap(swap.id, choice);
    setBusy(null);
    if (outcome.kind === 'ok') {
      onSaid({
        text:
          choice === 'decline'
            ? 'Tu as refusé : la proposition est close.'
            : swap.targetShiftId === null
              ? `C’est fait : le shift de ${requester} est sur ton planning.`
              : 'C’est fait : vous avez échangé vos shifts.',
        tone: 'info',
      });
      await refresh();
      return;
    }
    if (outcome.kind === 'failed') {
      setProblem('Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.');
      return;
    }
    // A swap that no longer holds is an ordinary end: it leaves the list, and the page says why (ADR 0031).
    if (READ_AGAIN.has(outcome.code)) {
      onSaid({ text: ERROR_MESSAGES[outcome.code], tone: 'info' });
      await refresh();
      return;
    }
    setProblem(
      swapRefusalText(
        outcome.code,
        swap.targetShiftId === null ? 'take' : 'exchange',
        requester,
        outcome.shiftId,
      ),
    );
  };

  return (
    <li className="nv-plate sc-card nv-enter" style={{ '--nv-i': index }}>
      <SwapBody view={view} message={swap.message} />
      {problem === null ? null : (
        <p className="tm-warn sc-refusal nv-swap" role="alert">
          {problem}
        </p>
      )}
      <div className="sc-card__actions">
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={busy !== null}
          aria-busy={busy === 'decline'}
          onClick={() => {
            void answer('decline');
          }}
        >
          {busy === 'decline' ? 'Refus…' : 'Refuser'}
        </button>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          disabled={busy !== null}
          aria-busy={busy === 'accept'}
          onClick={() => {
            void answer('accept');
          }}
        >
          {busy === 'accept' ? 'Échange…' : 'Accepter'}
        </button>
      </div>
    </li>
  );
}

/** The title, the shift or two, the requester's word: the same body for every reader. */
export function SwapBody({ view, message }: { view: SwapView; message: string | null }): JSX.Element {
  return (
    <div className="sc-card__body">
      <div className="sc-card__head">
        <p className="sc-card__title">{view.title}</p>
        <span className={`nv-status tm-status tm-status--${view.status.tone}`}>
          <span className="nv-status__dot" />
          {view.status.label}
        </span>
      </div>
      <dl className="sc-card__lines">
        {view.lines.map((line) => (
          <div key={line.label} className="sc-card__line">
            <dt>{line.label}</dt>
            <dd className="nv-num">{line.text}</dd>
          </div>
        ))}
      </dl>
      {message === null ? null : <blockquote className="sc-card__quote">{message}</blockquote>}
    </div>
  );
}

/** « Mes congés »: folded, with what is in it on one line; a pending request is withdrawn from here. */
export function MyLeaves({ leaves, now }: { leaves: readonly LeaveRequest[]; now: Date }): JSX.Element {
  const ahead = leaves.filter((leave) => leaveAhead(leave, now));
  const pending = ahead.filter((leave) => leave.status === 'pending').length;
  const approved = ahead.filter((leave) => leave.status === 'approved').length;
  const sum =
    ahead.length === 0
      ? 'Aucun à venir'
      : [
          pending === 0 ? null : `${String(pending)} en attente`,
          approved === 0 ? null : approved === 1 ? '1 validé' : `${String(approved)} validés`,
        ]
          .filter((part) => part !== null)
          .join(' · ') || 'Rien en cours';
  const shown = [...leaves].sort(
    (a, b) => Number(leaveAhead(b, now)) - Number(leaveAhead(a, now)) || a.firstDay.localeCompare(b.firstDay),
  );
  return (
    <details className="nv-disclosure nv-plate sc-fold">
      <summary>
        <span className="nv-disclosure__title">Mes congés</span>
        <span className="nv-disclosure__sum">{sum}</span>
      </summary>
      <div className="nv-disclosure__body">
        {shown.length === 0 ? (
          <p className="tm-hint">Aucun congé demandé ces derniers temps.</p>
        ) : (
          <ul className="sc-rows">
            {shown.map((leave) => (
              <LeaveRow key={leave.id} leave={leave} now={now} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function LeaveRow({ leave, now }: { leave: LeaveRequest; now: Date }): JSX.Element {
  const refresh = useRefreshPlanning();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const status = LEAVE_STATUS[leave.status];
  const withdraw = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const outcome = await endLeave(leave.id);
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setProblem(
      outcome.kind === 'failed'
        ? 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.'
        : ERROR_MESSAGES[outcome.code],
    );
  };
  return (
    <li className="sc-row" data-over={leaveAhead(leave, now) ? undefined : 'true'}>
      <div className="sc-row__main">
        <p className="sc-row__title">
          {leaveDaysLine(leave)} <span className="sc-row__aside">· {leaveLength(leave)}</span>
        </p>
        {leave.note === null ? null : <p className="sc-row__sub">« {leave.note} »</p>}
        {leave.decisionNote === null ? null : (
          <p className="sc-row__sub">L’agence : « {leave.decisionNote} »</p>
        )}
        {problem === null ? null : (
          <p className="tm-warn nv-swap" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="sc-row__side">
        <span className={`nv-status tm-status tm-status--${status.tone}`}>
          <span className="nv-status__dot" />
          {status.label}
        </span>
        {leave.status === 'pending' ? (
          <button
            type="button"
            className="sc-link"
            disabled={busy}
            onClick={() => {
              void withdraw();
            }}
          >
            {busy ? 'Retrait…' : 'Retirer'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** « Mes échanges »: the reader's proposals and the answers they gave, folded; an open proposal is withdrawn here. */
export function MySwaps({
  list,
  memberId,
  zone,
}: {
  list: ShiftSwapList;
  memberId: string;
  zone: string;
}): JSX.Element {
  const mine = list.swapRequests
    .filter(
      (swap) =>
        swap.requesterId === memberId || (swap.targetMemberId === memberId && swap.status !== 'proposed'),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open = mine.filter((swap) => swap.status === 'proposed').length;
  const names = namesOf(list);
  return (
    <details className="nv-disclosure nv-plate sc-fold">
      <summary>
        <span className="nv-disclosure__title">Mes échanges</span>
        <span className="nv-disclosure__sum">
          {mine.length === 0
            ? 'Aucun ces deux dernières semaines'
            : open === 0
              ? `${String(mine.length)} ces deux dernières semaines`
              : `${String(open)} en attente de réponse`}
        </span>
      </summary>
      <div className="nv-disclosure__body">
        {mine.length === 0 ? (
          <p className="tm-hint">
            Pour proposer un de tes shifts à un collègue, touche « Échanger » à côté du shift.
          </p>
        ) : (
          <ul className="sc-cards">
            {mine.map((swap) => (
              <MySwapCard
                key={swap.id}
                swap={swap}
                side={swap.requesterId === memberId ? 'requester' : 'target'}
                view={swapViewOf(swap, swap.requesterId === memberId ? 'requester' : 'target', names, zone)}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function MySwapCard({
  swap,
  side,
  view,
}: {
  swap: ShiftSwapRequest;
  side: SwapSide;
  view: SwapView;
}): JSX.Element {
  const refresh = useRefreshPlanning();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const withdraw = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const outcome = await endSwap(swap.id);
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setProblem(
      outcome.kind === 'failed'
        ? 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.'
        : ERROR_MESSAGES[outcome.code],
    );
  };
  return (
    <li className="nv-plate sc-card" data-over={swap.status === 'proposed' ? undefined : 'true'}>
      <SwapBody view={view} message={swap.message} />
      {problem === null ? null : (
        <p className="tm-warn sc-refusal nv-swap" role="alert">
          {problem}
        </p>
      )}
      {side === 'requester' && swap.status === 'proposed' ? (
        <div className="sc-card__actions">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void withdraw();
            }}
          >
            {busy ? 'Retrait…' : 'Retirer la proposition'}
          </button>
        </div>
      ) : null}
    </li>
  );
}
