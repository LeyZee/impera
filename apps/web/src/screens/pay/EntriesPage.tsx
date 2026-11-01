import type { Me, PayPeriod, PayrollPeriod, TeamMember } from '@nirvana/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { EntryForm, type EntryAdded } from './EntryForm';
import { PayNav } from './PayNav';
import { useCurrentPeriod, usePayNames, type PayMember } from './data';
import { Chip, Empty, Loading, PeriodArrows, PeriodHeading, Swatch, Unreachable } from './parts';

import {
  cancelBonus,
  cancelPenalty,
  usePayEntries,
  usePayPeriod,
  useRefreshPayroll,
  type PayRefusal,
} from '@/payroll/api';
import {
  ENTRY_KIND_LABELS,
  entryByText,
  entryRows,
  payRefusalText,
  penaltyTaken,
  spanText,
  whoName,
  type EntryKind,
  type EntryRow,
} from '@/payroll/model';
import '@/payroll/pay.css';
import '@/reports/reports.css';
import { useSchedulingSettings } from '@/reports/api';
import { periodLine, previousPeriod } from '@/reports/model';
import '@/scheduling/scheduling.css';
import { readerZone } from '@/scheduling/time';
import { Dialog } from '@/screens/team/Dialog';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Paie › Primes et malus (EQ-05, ADR 0024): a period's bonuses, penalties and adjustments, member by member, each with
 * its reason, its author and its sign. A cancelled one stays, struck through. « Ajouter » (the screen's one neon) adds
 * one in two steps; « Annuler » cancels a bonus or a penalty after a confirmation, while a period it counts in is open.
 */
export function EntriesPage({
  user,
  chosen,
  onPeriod,
}: {
  user: Me;
  chosen: PayPeriod | null;
  onPeriod: (period: PayPeriod | null) => void;
}): JSX.Element {
  const current = useCurrentPeriod();
  const period = chosen ?? current;
  const me = { id: user.id, name: user.name };
  const entries = usePayEntries(period);
  const read = usePayPeriod(period);
  const before = usePayPeriod(period === null ? null : previousPeriod(period));
  const names = usePayNames(period, true);
  const settings = useSchedulingSettings();
  const refresh = useRefreshPayroll();
  const [adding, setAdding] = useState<EntryKind | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [added, setAdded] = useState<EntryAdded | null>(null);
  const [arming, setArming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<ReadonlyMap<string, PayRefusal>>(new Map());

  const data = entries.data?.period === period ? entries.data : undefined;
  const statements = read.data?.period === period ? read.data : undefined;
  const zone = settings.data?.timeZone ?? readerZone();
  const eligible = names.members
    .filter((member) => member.status !== 'left' && member.userId !== user.id)
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName, 'fr'));
  const rows =
    data === undefined
      ? []
      : entryRows(data).toSorted((a, b) =>
          names.member(a.memberId).name.localeCompare(names.member(b.memberId).name, 'fr'),
        );

  const cancel = async (row: EntryRow): Promise<void> => {
    setCancelling(row.id);
    const outcome = row.kind === 'bonus' ? await cancelBonus(row.id) : await cancelPenalty(row.id);
    // The row stays busy until the list is read again: « Annuler » never comes back on what is already cancelled.
    await refresh();
    setCancelling(null);
    setArming(null);
    setRefusals((was) => {
      const next = new Map(was);
      if (outcome.kind === 'ok') next.delete(row.id);
      else next.set(row.id, outcome);
      return next;
    });
  };

  const head = (
    <PageHeader
      eyebrow="Paie"
      title={period === null ? 'Primes et malus' : <PeriodHeading period={period} />}
      lead="Une prime, un malus ou un ajustement, toujours avec son motif."
      actions={
        <>
          {period === null ? null : <PeriodArrows period={period} current={current} onPeriod={onPeriod} />}
          <PayNav />
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            onClick={() => {
              setAdded(null);
              setAdding('bonus');
            }}
          >
            Ajouter
          </button>
        </>
      }
    />
  );

  return (
    <Page>
      {head}
      <div className="py-board">
        <Panel className="nv-enter" eyebrow="Saisies">
          {period === null || (data === undefined && !entries.isError) ? (
            <Loading />
          ) : data === undefined ? (
            <Unreachable
              what="la liste des saisies"
              onRetry={() => {
                void entries.refetch();
              }}
            />
          ) : (
            <div className="rp-sec">
              {added?.period !== period ? null : (
                <p className="py-quiet nv-swap" role="status">
                  {added.text}
                </p>
              )}
              {rows.length === 0 ? (
                <Empty
                  whisper="Aucune prime ni aucun malus sur cette quinzaine."
                  text="« Ajouter » en pose un, toujours avec son motif : le membre le lit avec son relevé."
                />
              ) : (
                <ul className="py-rows">
                  {rows.map((row, index) => (
                    <EntryItem
                      key={row.id}
                      index={index}
                      row={row}
                      member={names.member(row.memberId)}
                      own={names.member(row.memberId).userId === user.id}
                      frozen={frozen(row, period, statements)}
                      taken={penaltyTaken(
                        row,
                        statements?.statements.find((one) => one.memberId === row.memberId),
                      )}
                      corrects={correctsText(row, [statements, before.data])}
                      by={entryByText(row, period, (userId) => whoName(userId, me, names.members), zone)}
                      armed={arming === row.id}
                      busy={cancelling === row.id}
                      refusal={refusals.get(row.id) ?? null}
                      onArm={(on) => {
                        setArming(on ? row.id : null);
                      }}
                      onCancel={() => {
                        void cancel(row);
                      }}
                    />
                  ))}
                </ul>
              )}
              <p className="py-quiet">
                Un malus est plafonné à la part du membre plus ses primes de la quinzaine : il ne prend jamais
                plus que ce qu’elle lui rapporte. Personne ne saisit pour soi.
              </p>
            </div>
          )}
        </Panel>
      </div>
      {adding === null ? null : (
        <EntryDialog
          kind={adding}
          onKind={setAdding}
          members={eligible}
          pagePeriod={period}
          busy={addBusy}
          onBusy={setAddBusy}
          onDone={(done) => {
            setAdding(null);
            setAdded(done);
            if (done.period !== period) onPeriod(done.period);
          }}
          onClose={() => {
            setAdding(null);
          }}
        />
      )}
    </Page>
  );
}

/** « Ajouter un malus » and its period: the dialog of the add, its title following the kind chosen. */
function EntryDialog({
  kind,
  onKind,
  members,
  pagePeriod,
  busy,
  onBusy,
  onDone,
  onClose,
}: {
  kind: EntryKind;
  onKind: (kind: EntryKind) => void;
  members: readonly TeamMember[];
  pagePeriod: PayPeriod | null;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onDone: (added: EntryAdded) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <Dialog
      className="py-dialog"
      title={`Ajouter ${kind === 'bonus' ? 'une prime' : kind === 'adjustment' ? 'un ajustement' : 'un malus'}`}
      lead={
        kind === 'adjustment'
          ? 'Sur la prochaine quinzaine du membre à valider'
          : pagePeriod === null
            ? undefined
            : `Quinzaine ${periodLine(pagePeriod)}, ou une autre encore ouverte`
      }
      busy={busy}
      onClose={onClose}
    >
      <EntryForm
        kind={kind}
        onKind={onKind}
        members={members}
        pagePeriod={pagePeriod}
        busy={busy}
        onBusy={onBusy}
        onDone={onDone}
        onCancel={onClose}
      />
    </Dialog>
  );
}

/**
 * A bonus, or a penalty ending in this period, once the member's statement of it is validated: frozen, the server
 * refuses to cancel it (`pay_period_closed_conflict`, `penalty_cancel_conflict`). Unknown while the period is read.
 */
function frozen(row: EntryRow, period: PayPeriod, statements: PayrollPeriod | undefined): boolean {
  if (statements === undefined) return false;
  const statement = statements.statements.find((one) => one.memberId === row.memberId);
  if (statement === undefined || statement.status === 'draft') return false;
  return row.span === null || row.span.to <= period;
}

/** « corrige son relevé du 16 au 31 octobre », found in the periods read; said without its period otherwise. */
function correctsText(row: EntryRow, periods: readonly (PayrollPeriod | undefined)[]): string | null {
  if (row.corrects === null) return null;
  const statement = periods.flatMap((one) => one?.statements ?? []).find((one) => one.id === row.corrects);
  return statement === undefined
    ? 'corrige un relevé déjà validé'
    : `corrige son relevé ${periodLine(statement.window.period)}`;
}

function EntryItem({
  index,
  row,
  member,
  own,
  frozen: isFrozen,
  taken,
  corrects,
  by,
  armed,
  busy,
  refusal,
  onArm,
  onCancel,
}: {
  index: number;
  row: EntryRow;
  member: PayMember;
  own: boolean;
  frozen: boolean;
  /** What a penalty really takes in the period, read in the member's statement. */
  taken: string | null;
  corrects: string | null;
  by: string;
  armed: boolean;
  busy: boolean;
  refusal: PayRefusal | null;
  onArm: (on: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const bonus = row.kind === 'bonus';
  const what = `${bonus ? 'la prime' : 'le malus'} de ${row.amount}`;
  const keep = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const kept = useRef(false);
  // Armed, the focus goes to « Garder », the answer that changes nothing; kept, it comes back to « Annuler ».
  useEffect(() => {
    if (armed) keep.current?.focus();
    else if (kept.current) trigger.current?.focus();
    kept.current = false;
  }, [armed]);
  const notes = [
    row.span === null ? null : spanText(row.span),
    corrects,
    row.struck && row.cancellation === null ? 'ne compte plus sur cette quinzaine' : null,
  ].filter((note) => note !== null);
  return (
    <li
      className="py-entry nv-enter"
      style={{ '--nv-i': index }}
      data-cancelled={row.struck ? 'true' : undefined}
    >
      <div className="py-entry__main">
        <p className="py-entry__who">
          <Swatch color={member.color} />
          {member.name}
          <span className="py-member__role">{ENTRY_KIND_LABELS[row.kind]}</span>
          {row.struck ? <Chip chip={{ label: 'Annulé', tone: 'neutral' }} /> : null}
        </p>
        <p className="py-entry__why">
          « {row.reason} »{notes.length === 0 ? '' : ` · ${notes.join(' · ')}`}
        </p>
        <p className="py-entry__by">{by}</p>
      </div>
      <div className="py-entry__side">
        <span className="py-entry__amount nv-num">{row.amount}</span>
        {taken === null ? null : <small className="py-entry__taken nv-num">{taken}</small>}
        {row.cancellable && !own && !isFrozen && !armed ? (
          <button
            ref={trigger}
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-label={`Annuler ${what} de ${member.name}`}
            onClick={() => {
              onArm(true);
            }}
          >
            Annuler
          </button>
        ) : null}
      </div>
      {armed ? (
        <div className="nv-confirm" role="alertdialog" aria-label="Confirmer l’annulation">
          <p className="py-entry__ask">
            Annuler {what} de {member.name} ?{' '}
            {row.span === null
              ? 'Son relevé de la quinzaine est recalculé ; la saisie reste, barrée.'
              : 'Il ne compte plus à partir de sa première quinzaine encore ouverte ; les quinzaines validées le gardent.'}
          </p>
          <div className="nv-confirm__actions">
            <button
              ref={keep}
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                kept.current = true;
                onArm(false);
              }}
            >
              Garder
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--destructive nv-btn--sm"
              disabled={busy}
              aria-busy={busy}
              onClick={onCancel}
            >
              {busy ? 'Annulation…' : `Annuler ${bonus ? 'la prime' : 'le malus'}`}
            </button>
          </div>
        </div>
      ) : null}
      {refusal === null ? null : (
        <p className="tm-warn sc-refusal py-entry__refusal nv-swap" role="alert">
          {payRefusalText(refusal, { memberName: () => member.name })}
        </p>
      )}
    </li>
  );
}
