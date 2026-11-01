import type { LeaveRequest, LeaveRequestList, ShiftSwapList, ShiftSwapRequest } from '@nirvana/contracts';
import { useId, useState, type JSX, type ReactNode } from 'react';

import {
  decideLeave,
  endLeave,
  endSwap,
  usePlanning,
  useRefreshPlanning,
  type Outcome,
} from '@/scheduling/api';
import {
  ERROR_MESSAGES,
  inTheWayLine,
  leaveAhead,
  leaveDaysLine,
  leaveLength,
  READ_AGAIN,
  swapViewOf,
} from '@/scheduling/model';
import { dayOf } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { namesOf, SwapBody } from '@/screens/planning/Exchanges';

/**
 * Équipe › Planning, the leaves and the swaps (ADR 0031): the requests to decide first, who is on leave this week,
 * and the chatters' swaps folded below, each one undone from here while it can be.
 */

/** A write that reads everything again when it lands, or when the server says the list changed. */
function useWrite(): {
  busy: boolean;
  problem: string | null;
  run: <T>(write: () => Promise<Outcome<T>>) => Promise<Outcome<T>>;
} {
  const refresh = useRefreshPlanning();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async <T,>(write: () => Promise<Outcome<T>>): Promise<Outcome<T>> => {
    setBusy(true);
    setProblem(null);
    const outcome = await write();
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      return outcome;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setProblem(
      outcome.kind === 'failed'
        ? 'Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.'
        : ERROR_MESSAGES[outcome.code],
    );
    return outcome;
  };
  return { busy, problem, run };
}

function Swatch({ color }: { color: string | null }): JSX.Element {
  return (
    <span
      className="sc-swatch"
      style={color === null ? undefined : { '--sc-color': color }}
      aria-hidden="true"
    />
  );
}

/**
 * The shifts a leave's approval found in its way, for the grid to light them: `at` is when the first of them starts
 * (the leave's start until the planning of the leave is read).
 */
export interface InTheWay {
  readonly leaveId: string;
  readonly shiftIds: readonly string[];
  readonly at: string;
}

/**
 * « Congés à valider », one line folded above the grid (EQ-02): each pending request with Valider and Refuser. A
 * manager never decides their own (the owner does). The shifts of the member still in the leave are said before
 * Valider (EQ-16); the server refuses the approval while they are there, and the page shows them.
 */
export function PendingLeaves({
  list,
  ownMemberId,
  zone,
  onShowShifts,
}: {
  list: LeaveRequestList;
  /** The reader's own member id: their own request waits for someone else. */
  ownMemberId: string | null;
  /** The zone the page shows its days in. */
  zone: string;
  onShowShifts: (inTheWay: InTheWay) => void;
}): JSX.Element | null {
  const pending = list.leaveRequests.filter((leave) => leave.status === 'pending');
  if (pending.length === 0) return null;
  const members = new Map(list.members.map((member) => [member.id, member]));
  return (
    <details className="nv-disclosure nv-plate sc-fold sc-decide nv-swap">
      <summary>
        <span className="nv-disclosure__title">
          {pending.length === 1 ? '1 congé à valider' : `${String(pending.length)} congés à valider`}
        </span>
        <span className="nv-disclosure__sum">
          {[...new Set(pending.map((leave) => members.get(leave.memberId)?.displayName ?? 'Un membre'))].join(
            ', ',
          )}
        </span>
      </summary>
      <ul className="sc-rows nv-disclosure__body">
        {pending.map((leave, index) => (
          <PendingLeave
            key={leave.id}
            leave={leave}
            index={index}
            name={members.get(leave.memberId)?.displayName ?? 'Un membre'}
            color={members.get(leave.memberId)?.color ?? null}
            own={leave.memberId === ownMemberId}
            zone={zone}
            onShowShifts={onShowShifts}
          />
        ))}
      </ul>
    </details>
  );
}

function PendingLeave({
  leave,
  index,
  name,
  color,
  own,
  zone,
  onShowShifts,
}: {
  leave: LeaveRequest;
  index: number;
  name: string;
  color: string | null;
  own: boolean;
  zone: string;
  onShowShifts: (inTheWay: InTheWay) => void;
}): JSX.Element {
  const id = useId();
  const { busy, problem, run } = useWrite();
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState('');
  const [inTheWay, setInTheWay] = useState<readonly string[]>([]);
  // The planning of the leave's days (a leave lasts up to 31 days): the member's shifts still in it are said before
  // Valider, and when they start once the server named them.
  const located = usePlanning({ from: leave.startsAt, to: leave.endsAt, creatorId: null });
  const now = useNow();
  const found = (located.data?.shifts ?? [])
    .filter((shift) => inTheWay.includes(shift.id))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  // Counted as the server refuses them: the member's shifts in the leave that are not over yet (EQ-16).
  const toGive = (located.data?.shifts ?? [])
    .filter(
      (shift) =>
        shift.memberId === leave.memberId &&
        shift.startsAt < leave.endsAt &&
        shift.endsAt > leave.startsAt &&
        new Date(shift.endsAt).getTime() > now.getTime(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const approve = async (): Promise<void> => {
    setInTheWay([]);
    const outcome = await run(() => decideLeave(leave.id, { decision: 'approve' }));
    if (outcome.kind === 'refused' && outcome.code === 'leave_shifts_conflict') setInTheWay(outcome.shiftIds);
  };

  return (
    <li className="sc-row sc-row--leave nv-enter" style={{ '--nv-i': index }}>
      <div className="sc-row__main">
        <p className="sc-row__title">
          <Swatch color={color} />
          {name}
        </p>
        {/* The dates on their own line: never a line that starts with a separator on a phone (EQ-27). */}
        <p className="sc-row__sub nv-num">
          {leaveDaysLine(leave)}, {leaveLength(leave)}
        </p>
        {leave.note === null ? null : <p className="sc-row__sub">« {leave.note} »</p>}
        {inTheWay.length === 0 && toGive.length > 0 && !own ? (
          <div className="sc-inline-warn">
            <p className="tm-warn">
              {toGive.length === 1
                ? '1 shift à donner avant de valider'
                : `${String(toGive.length)} shifts à donner avant de valider`}
            </p>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                onShowShifts({
                  leaveId: leave.id,
                  shiftIds: toGive.map((shift) => shift.id),
                  at: toGive[0]?.startsAt ?? leave.startsAt,
                });
              }}
            >
              Voir
            </button>
          </div>
        ) : null}
        {inTheWay.length > 0 ? (
          <div className="sc-inline-warn nv-swap" role="alert">
            <p className="tm-warn">
              {inTheWayLine(
                name,
                inTheWay.length,
                found.map((shift) => dayOf(shift.startsAt, zone)),
              )}
            </p>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                onShowShifts({
                  leaveId: leave.id,
                  shiftIds: inTheWay,
                  at: found[0]?.startsAt ?? leave.startsAt,
                });
              }}
            >
              {inTheWay.length === 1 ? 'Voir le shift' : 'Voir ces shifts'}
            </button>
          </div>
        ) : problem === null ? null : (
          <p className="tm-warn nv-swap" role="alert">
            {problem}
          </p>
        )}
        {refusing ? (
          <form
            className="sc-refuse nv-swap"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => decideLeave(leave.id, { decision: 'refuse', note }));
            }}
          >
            <label className="nv-field__label" htmlFor={`${id}-note`}>
              Un mot pour {name} <span className="sc-optional">facultatif</span>
            </label>
            <textarea
              id={`${id}-note`}
              className="nv-field__control nv-glass sc-note"
              rows={2}
              maxLength={500}
              value={note}
              autoFocus
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <div className="sc-row__actions">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={busy}
                onClick={() => {
                  setRefusing(false);
                }}
              >
                Garder
              </button>
              <button
                type="submit"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Envoi…' : 'Refuser la demande'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
      {refusing ? null : own ? (
        <p className="sc-row__note">Le propriétaire décide de ton congé.</p>
      ) : (
        <div className="sc-row__actions">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={busy}
            onClick={() => {
              setRefusing(true);
            }}
          >
            Refuser
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void approve();
            }}
          >
            {busy ? 'Validation…' : 'Valider'}
          </button>
        </div>
      )}
    </li>
  );
}

/** « En congé cette semaine »: one quiet line of people, each one's leave cancelled from it while it lasts. */
export function OnLeave({
  list,
  from,
  to,
  now,
}: {
  list: LeaveRequestList;
  /** The week shown, its first and last day. */
  from: string;
  to: string;
  now: Date;
}): JSX.Element | null {
  const [open, setOpen] = useState<string | null>(null);
  const away = list.leaveRequests.filter(
    (leave) => leave.status === 'approved' && leave.firstDay <= to && leave.lastDay >= from,
  );
  if (away.length === 0) return null;
  const members = new Map(list.members.map((member) => [member.id, member]));
  const opened = away.find((leave) => leave.id === open) ?? null;
  return (
    <section className="sc-duty sc-onleave" aria-labelledby="sc-onleave-title">
      <h2 id="sc-onleave-title" className="sc-duty__title">
        <svg className="sc-onleave__icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3.5h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM2.5 6.5h11M5.5 2v3M10.5 2v3M6 10h4" />
        </svg>
        En congé cette semaine
      </h2>
      <ul className="sc-duty__list">
        {away.map((leave) => {
          const member = members.get(leave.memberId);
          return (
            <li key={leave.id}>
              <button
                type="button"
                className="sc-duty__one"
                aria-expanded={open === leave.id}
                onClick={() => {
                  setOpen(open === leave.id ? null : leave.id);
                }}
              >
                <Swatch color={member?.color ?? null} />
                <span className="sc-duty__who">{member?.displayName ?? 'Un membre'}</span>
                <span className="sc-duty__where">{leaveDaysLine(leave)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {opened === null ? null : (
        <CancelLeave
          key={opened.id}
          leave={opened}
          name={members.get(opened.memberId)?.displayName ?? 'ce membre'}
          now={now}
          onDone={() => {
            setOpen(null);
          }}
        />
      )}
    </section>
  );
}

function CancelLeave({
  leave,
  name,
  now,
  onDone,
}: {
  leave: LeaveRequest;
  name: string;
  now: Date;
  onDone: () => void;
}): JSX.Element {
  const { busy, problem, run } = useWrite();
  const ahead = leaveAhead(leave, now);
  return (
    <div className="nv-confirm sc-onleave__confirm" role="alertdialog" aria-label={`Congé de ${name}`}>
      <p className="sc-confirm__text">
        {leaveDaysLine(leave)}, {leaveLength(leave)}.{' '}
        {ahead
          ? `L’annuler rend ${name} planifiable dès maintenant ; les jours déjà passés restent comptés comme congé.`
          : 'Ce congé est fini.'}
      </p>
      {problem === null ? null : (
        <p className="tm-warn nv-swap" role="alert">
          {problem}
        </p>
      )}
      <div className="nv-confirm__actions">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={busy} onClick={onDone}>
          {ahead ? 'Garder' : 'Fermer'}
        </button>
        {ahead ? (
          <button
            type="button"
            className="nv-btn nv-btn--destructive nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void run(() => endLeave(leave.id)).then((outcome) => {
                if (outcome.kind === 'ok') onDone();
              });
            }}
          >
            {busy ? 'Annulation…' : 'Annuler le congé'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The chatters' swaps, folded with a one-line summary: a proposal is withdrawn here, an accepted swap undone while
 * neither shift has started (the server checks the rest).
 */
export function TeamSwaps({
  list,
  now,
  zone,
}: {
  list: ShiftSwapList;
  now: Date;
  zone: string;
}): JSX.Element | null {
  if (list.swapRequests.length === 0) return null;
  const names = namesOf(list);
  const swaps = [...list.swapRequests].sort(
    (a, b) =>
      Number(b.status === 'proposed') - Number(a.status === 'proposed') ||
      b.createdAt.localeCompare(a.createdAt),
  );
  const open = swaps.filter((swap) => swap.status === 'proposed').length;
  const accepted = swaps.filter((swap) => swap.status === 'accepted').length;
  const sum = [
    open === 0 ? null : `${String(open)} en attente`,
    accepted === 0 ? null : accepted === 1 ? '1 accepté' : `${String(accepted)} acceptés`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  return (
    <details className="nv-disclosure nv-plate sc-fold">
      <summary>
        <span className="nv-disclosure__title">Échanges entre chatteurs</span>
        <span className="nv-disclosure__sum">{sum === '' ? 'Ces deux dernières semaines' : sum}</span>
      </summary>
      <div className="nv-disclosure__body">
        <ul className="sc-cards">
          {swaps.map((swap) => (
            <TeamSwap key={swap.id} swap={swap} now={now}>
              <SwapBody view={swapViewOf(swap, 'agency', names, zone)} message={swap.message} />
            </TeamSwap>
          ))}
        </ul>
      </div>
    </details>
  );
}

function TeamSwap({
  swap,
  now,
  children,
}: {
  swap: ShiftSwapRequest;
  now: Date;
  children: ReactNode;
}): JSX.Element {
  const { busy, problem, run } = useWrite();
  const [arming, setArming] = useState(false);
  const started = (at: string | null): boolean => at !== null && new Date(at).getTime() <= now.getTime();
  const undoable =
    swap.status === 'accepted' && !started(swap.shiftStartsAt) && !started(swap.targetShiftStartsAt);
  return (
    <li className="nv-plate sc-card" data-over={swap.status === 'proposed' || undoable ? undefined : 'true'}>
      {children}
      {problem === null ? null : (
        <p className="tm-warn sc-refusal nv-swap" role="alert">
          {problem}
        </p>
      )}
      {swap.status === 'proposed' ? (
        <div className="sc-card__actions">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void run(() => endSwap(swap.id));
            }}
          >
            {busy ? 'Retrait…' : 'Retirer la proposition'}
          </button>
        </div>
      ) : undoable && !arming ? (
        <div className="sc-card__actions">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setArming(true);
            }}
          >
            Annuler l’échange
          </button>
        </div>
      ) : null}
      {undoable && arming ? (
        <div className="nv-confirm" role="alertdialog" aria-label="Confirmer">
          <p className="sc-confirm__text">
            Chaque shift revient à qui l’avait avant l’échange. Les deux chatteurs le voient dans leur
            planning.
          </p>
          <div className="nv-confirm__actions">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setArming(false);
              }}
            >
              Garder
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--destructive nv-btn--sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                void run(() => endSwap(swap.id)).then(() => {
                  setArming(false);
                });
              }}
            >
              {busy ? 'Annulation…' : 'Annuler l’échange'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
