import {
  payPeriodLastDay,
  PayPeriodSchema,
  type CommissionStatement,
  type Me,
  type PayPeriod,
  type PayPeriodBlock,
  type PayrollPeriod,
} from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { CloseDialog } from './CloseDialog';
import { PayNav } from './PayNav';
import { StatementDialog } from './StatementDialog';
import {
  useCurrentPeriod,
  usePayNames,
  usePeriodBlock,
  usePeriodToOpen,
  type PayMember,
  type PayNames,
  type PeriodBlock,
} from './data';
import {
  Chip,
  Delta,
  Empty,
  Gauge,
  Loading,
  LockIcon,
  PeriodArrows,
  PeriodHeading,
  Swatch,
  Unreachable,
} from './parts';

import {
  useLatestPayPeriod,
  usePayPeriod,
  useRefreshPayroll,
  validateStatement,
  type PayRefusal,
} from '@/payroll/api';
import {
  amountWhat,
  blockedText,
  carryLine,
  carryWhat,
  changeBps,
  computedText,
  dayMonthText,
  daysLeft,
  forecastNet,
  gaugePercent,
  goalReachedBps,
  goalSpanBps,
  lateNetOf,
  rateOverdue,
  memberFacts,
  momentAt,
  opensOn,
  payRefusalText,
  phaseChip,
  phaseOf,
  rateText,
  reachedBpsOf,
  roundAmountText,
  rowChips,
  salesSplit,
  sameStageOf,
  statementsCsv,
  stopsThePeriod,
  summaryOf,
  teamNetOf,
  tierAt,
  validatable,
  whoName,
  type RefusalNames,
  type Share,
} from '@/payroll/model';
import { useAppHold, type HoldResult } from '@/reports/Hold';
import '@/payroll/pay.css';
import '@/reports/reports.css';
import {
  amountText,
  followingPeriod,
  percentText,
  periodLine,
  periodTitle,
  previousPeriod,
  signedAmountText,
} from '@/reports/model';
import { accountLine, platformName } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { dayOf, longDay } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Paie › Quinzaine (EQ-05, ADR 0024): one period, the money first — what to pay once it has ended, the team's net and
 * its forecast while it runs — then a row per member. The drafts are checked by default and validated one by one in
 * the members' order; the first validation closes the period for the team (ADR 0032) and says so before. What blocks
 * a period is said above its rows, with what lifts it, and nothing can be validated meanwhile.
 */
export function PeriodPage({
  user,
  chosen,
  member = null,
  onPeriod,
}: {
  user: Me;
  chosen: PayPeriod | null;
  /** The member whose statement opens once the period is read: « Son relevé » on his record in Équipe (EQ-11). */
  member?: string | null;
  onPeriod: (period: PayPeriod | null) => void;
}): JSX.Element {
  const toOpen = usePeriodToOpen(user.role === 'owner');
  // The period opened stays the one shown: validating or paying its last statement changes which one would open, and
  // the screen never jumps to it under an open dialog or before the result is said.
  const [first, setFirst] = useState<PayPeriod | null>(null);
  if (first === null && toOpen !== null) setFirst(toOpen);
  const period = chosen ?? first ?? toOpen;
  return (
    <PeriodView key={period ?? 'none'} user={user} period={period} member={member} onPeriod={onPeriod} />
  );
}

/** A validation that stopped on a refusal of the whole period, while the period reads the same. */
interface Stopped {
  readonly refusal: PayRefusal;
  readonly seen: string;
}

/** What a period's statements are: a refusal said about them holds until one of them changes. */
const stateOf = (period: PayrollPeriod): string =>
  `${period.closing?.closedAt ?? ''}|${period.statements.map((one) => `${one.id}:${String(one.revision)}:${one.status}`).join(',')}`;

function PeriodView({
  user,
  period,
  member,
  onPeriod,
}: {
  user: Me;
  period: PayPeriod | null;
  member: string | null;
  onPeriod: (period: PayPeriod | null) => void;
}): JSX.Element {
  const owner = user.role === 'owner';
  const me = { id: user.id, name: user.name };
  const now = useNow();
  const current = useCurrentPeriod();
  const read = usePayPeriod(period);
  const before = usePayPeriod(period === null ? null : previousPeriod(period));
  const names = usePayNames(period, true);
  const data = read.data?.period === period ? read.data : undefined;
  const previous =
    before.data?.period === (period === null ? null : previousPeriod(period)) ? before.data : undefined;
  const block = usePeriodBlock(data);
  const appHold = useAppHold();
  const refresh = useRefreshPayroll();
  const latest = useLatestPayPeriod();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [refusals, setRefusals] = useState<ReadonlyMap<string, PayRefusal>>(new Map());
  const [stopped, setStopped] = useState<Stopped | null>(null);
  const [closing, setClosing] = useState<readonly CommissionStatement[] | null>(null);
  const [opened, setOpened] = useState<{ readonly id: string; readonly paying: boolean } | null>(null);
  // The statement asked from a member's record: opened once the period is read, or said missing (EQ-11).
  const [asked, setAsked] = useState(member);
  const [absent, setAbsent] = useState<string | null>(null);
  if (asked !== null && data !== undefined) {
    const theirs = data.statements.find((one) => one.memberId === asked);
    setAsked(null);
    if (theirs === undefined) setAbsent(asked);
    else setOpened({ id: theirs.id, paying: false });
  }

  const rows =
    data?.statements.toSorted((a, b) =>
      names.member(a.memberId).name.localeCompare(names.member(b.memberId).name, 'fr'),
    ) ?? [];
  const stop =
    stopped !== null && data !== undefined && stopped.seen === stateOf(data) ? stopped.refusal : null;
  // Pay could not compute the period at its last try: its figures are out of date, nothing validates on them.
  const computing = data?.blocked ?? null;
  const blocked = computing !== null || block !== null || stop !== null;
  const pickable = data === undefined || blocked ? [] : validatable({ ended: data.ended, statements: rows });
  const chosen = pickable.filter((one) => !unchecked.has(one.id) && !sending.has(one.id));
  const reread = rows.find((one) => {
    const refusal = refusals.get(one.id);
    return refusal?.kind === 'refused' && refusal.code === 'commission_statement_changed_conflict';
  });
  const refusalNames = (statement?: CommissionStatement): RefusalNames => ({
    memberName: (memberId) => names.member(memberId).name,
    ...(statement === undefined ? {} : { statement }),
  });

  /** Validates `batch` one by one, in order: each refusal stays on its row, one of the period's stops the rest. */
  const run = async (batch: readonly CommissionStatement[]) => {
    const ids: ReadonlySet<string> = new Set(batch.map((one) => one.id));
    setRefusals((was) => new Map([...was].filter(([id]) => !ids.has(id))));
    let done = 0;
    const refused: [CommissionStatement, PayRefusal][] = [];
    let halted: PayRefusal | null = null;
    for (const one of batch) {
      const outcome = await validateStatement(one.id, one.revision);
      if (outcome.kind === 'ok') {
        done += 1;
        continue;
      }
      // Already validated by someone else: validating twice does nothing more, the period reads again.
      if (outcome.kind === 'refused' && outcome.code === 'commission_statement_status_conflict') continue;
      if (stopsThePeriod(outcome)) {
        halted = outcome;
        break;
      }
      refused.push([one, outcome]);
    }
    await refresh();
    setRefusals(
      (was) => new Map([...was, ...refused.map(([one, refusal]): [string, PayRefusal] => [one.id, refusal])]),
    );
    if (halted !== null && data !== undefined) {
      // The stop holds until the period changes from what it is now, after the validations that passed: never from
      // what it was before they were sent, which would hide it at once.
      const now = await latest(data.period);
      setStopped({ refusal: halted, seen: stateOf(now ?? data) });
    }
    setSending(new Set());
    return { done, refused, halted };
  };

  const validate = (batch: readonly CommissionStatement[]): void => {
    if (batch.length === 0 || data === undefined) return;
    if (data.closing === null) {
      setClosing(batch);
      return;
    }
    hold(batch);
  };

  /** Validates `batch` after the app's hold, then says what passed and what did not, the first closing included. */
  const hold = (batch: readonly CommissionStatement[]): void => {
    const count = batch.length;
    const sum = amountText(
      batch.reduce((total, one) => total + one.payableMinor, 0),
      'EUR',
    );
    const [only] = batch;
    setSending(new Set(batch.map((one) => one.id)));
    appHold.hold(
      {
        title:
          count === 1 && only !== undefined
            ? `Validation du relevé de ${names.member(only.memberId).name}`
            : `Validation de ${String(count)} relevés`,
        text: `${sum} à verser`,
        onCancel: () => {
          setSending(new Set());
        },
      },
      async (): Promise<HoldResult> => {
        const { done, refused, halted } = await run(batch);
        const [first] = refused;
        if (first === undefined && halted === null)
          return {
            ok: true,
            title: done === 1 ? 'Relevé validé' : `${String(done)} relevés validés`,
            text: sum,
          };
        const left = count - done;
        return {
          ok: false,
          title:
            done === 0
              ? 'Rien n’a été validé'
              : `${String(done)} validé${done > 1 ? 's' : ''}, ${String(left)} non validé${left > 1 ? 's' : ''}`,
          text:
            halted !== null
              ? payRefusalText(halted, refusalNames())
              : first === undefined
                ? ''
                : `${names.member(first[0].memberId).name} : ${payRefusalText(first[1], refusalNames(first[0]))}`,
        };
      },
    );
  };

  const openedStatement = opened === null ? undefined : rows.find((one) => one.id === opened.id);
  const previousNet = (memberId: string): number | null =>
    previous?.statements.find((one) => one.memberId === memberId)?.netMinor ?? null;

  const head = (
    <PageHeader
      eyebrow="Paie"
      title={period === null ? 'Quinzaine' : <PeriodHeading period={period} />}
      lead={leadOf(data, blocked, owner)}
      actions={
        <>
          {period === null ? null : <PeriodArrows period={period} current={current} onPeriod={onPeriod} />}
          <PayNav />
          {reread !== undefined ? (
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              onClick={() => {
                setOpened({ id: reread.id, paying: false });
              }}
            >
              Relire le relevé de {names.member(reread.memberId).name}
            </button>
          ) : pickable.length > 0 ? (
            <button
              type="button"
              className="nv-btn nv-btn--neon py-validate--head"
              disabled={chosen.length === 0}
              onClick={() => {
                validate(chosen);
              }}
            >
              {chosen.length === 0 ? 'Valider' : `Valider (${String(chosen.length)})`}
            </button>
          ) : null}
        </>
      }
    />
  );

  if (period === null || (data === undefined && !read.isError)) {
    return (
      <Page>
        {head}
        <div className="py-board">
          <Panel className="py-sum">
            <Loading rows={1} />
          </Panel>
          <Panel>
            <Loading />
          </Panel>
        </div>
      </Page>
    );
  }
  if (data === undefined) {
    return (
      <Page>
        {head}
        <div className="py-board">
          <Panel>
            <Unreachable
              what="la quinzaine"
              onRetry={() => {
                void read.refetch();
              }}
            />
          </Panel>
        </div>
      </Page>
    );
  }

  const ended = data.ended;
  const sameStage = sameStageOf(rows, ended);
  const allChecked =
    pickable.length > 0 && chosen.length === pickable.filter((one) => !sending.has(one.id)).length;

  return (
    <Page>
      {head}
      <div className="py-board">
        <Summary
          data={data}
          stale={computing !== null}
          previous={previous}
          names={names}
          me={me}
          now={now}
          rate={block?.kind === 'rate_missing'}
        />
        <Panel
          className="nv-enter"
          eyebrow={
            ended || data.beforeFirstClosing ? 'Relevés de commissions' : 'À ce jour, membre par membre'
          }
          actions={
            rows.length === 0 ? undefined : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  downloadCsv(data, names);
                }}
              >
                Exporter (CSV)
              </button>
            )
          }
        >
          <div className="rp-sec">
            {computing !== null ? (
              <ComputingNotice
                block={computing}
                owner={owner}
                names={names}
                zone={data.window?.timeZone ?? null}
              />
            ) : block !== null ? (
              <BlockNotice block={block} zone={data.window?.timeZone ?? null} now={now} owner={owner} />
            ) : stop !== null ? (
              <StopNotice
                refusal={stop}
                text={payRefusalText(stop, refusalNames())}
                onPeriod={onPeriod}
                onRetry={() => {
                  setStopped(null);
                }}
              />
            ) : ended && data.closing === null && pickable.length > 0 ? (
              <div className="rp-notice">
                <p className="rp-notice__text">
                  Le premier relevé validé clôt la quinzaine pour toute l’équipe. Un rapport validé ensuite
                  ira sur la quinzaine {periodLine(followingPeriod(data.period))}.
                </p>
              </div>
            ) : null}
            {absent === null ? null : (
              <p className="py-quiet">Pas de relevé de {names.member(absent).name} sur cette quinzaine.</p>
            )}
            {pickable.length === 0 ? null : (
              <SelectAll
                all={allChecked}
                chosen={chosen.length}
                of={pickable.length}
                onAll={() => {
                  setUnchecked(allChecked ? new Set(pickable.map((one) => one.id)) : new Set());
                }}
                onValidate={() => {
                  validate(chosen);
                }}
              />
            )}
            {rows.length === 0 ? (
              data.beforeFirstClosing ? (
                <Empty
                  whisper="Aucun relevé avant la première clôture."
                  text="Un rapport de cette quinzaine compte en retard sur la première quinzaine ouverte de l’équipe."
                />
              ) : (
                <Empty
                  whisper="Pas encore de relevé sur cette quinzaine."
                  text="Un relevé se calcule dès qu’un rapport de fin de shift d’un membre est validé."
                />
              )
            ) : (
              <ul className="py-rows" data-stale={computing === null ? undefined : 'true'}>
                {rows.map((statement, index) => {
                  const member = names.member(statement.memberId);
                  const pick = pickable.some((one) => one.id === statement.id);
                  const refusal = refusals.get(statement.id) ?? null;
                  return (
                    <MemberRow
                      key={statement.id}
                      index={index}
                      statement={statement}
                      member={member}
                      ended={ended}
                      sameStage={sameStage}
                      own={member.userId === me.id}
                      column={pickable.length > 0}
                      pick={pick}
                      checked={pick && !unchecked.has(statement.id)}
                      sending={sending.has(statement.id)}
                      who={(userId) => whoName(userId, me, names.members)}
                      refusal={
                        refusal === null
                          ? null
                          : { refusal, text: payRefusalText(refusal, refusalNames(statement)) }
                      }
                      canPay={owner && statement.status === 'validated' && statement.payableMinor > 0}
                      onCheck={(on) => {
                        setUnchecked((was) => {
                          const next = new Set(was);
                          if (on) next.delete(statement.id);
                          else next.add(statement.id);
                          return next;
                        });
                      }}
                      onOpen={(paying) => {
                        setOpened({ id: statement.id, paying });
                      }}
                    />
                  );
                })}
              </ul>
            )}
            {rows.length === 0 ? null : <p className="py-quiet">{quietOf(data, now)}</p>}
          </div>
        </Panel>
      </div>
      {openedStatement === undefined || opened === null ? null : (
        <StatementDialog
          key={`${openedStatement.id}:${String(openedStatement.revision)}`}
          statement={openedStatement}
          period={data}
          names={names}
          previousNet={previous === undefined ? null : previousNet(openedStatement.memberId)}
          me={me}
          owner={owner}
          canValidateNow={ended && !blocked}
          paying={opened.paying}
          onValidate={(statement) => {
            setOpened(null);
            validate([statement]);
          }}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
      {closing === null ? null : (
        <CloseDialog
          period={data}
          batch={closing}
          onConfirm={() => {
            setClosing(null);
            hold(closing);
          }}
          onClose={() => {
            setClosing(null);
          }}
        />
      )}
    </Page>
  );
}

/** The header's one sentence: what the period asks of the reader now. */
function leadOf(data: PayrollPeriod | undefined, blocked: boolean, owner: boolean): string | undefined {
  if (data === undefined) return undefined;
  if (data.beforeFirstClosing)
    return 'Avant la première clôture de l’équipe : la quinzaine est close sans relevé.';
  if (data.blocked !== null)
    return 'Rien ne se valide pour l’instant : les relevés se recalculeront seuls une fois le blocage levé.';
  if (!data.ended)
    return data.window === null
      ? 'Les relevés se calculent dès qu’un rapport est validé.'
      : `Les relevés se calculent à chaque rapport validé. La quinzaine se valide à partir du ${longDay(opensOn(data.window))}.`;
  if (blocked) return 'Lève d’abord ce qui bloque : la quinzaine se valide ensuite.';
  const phase = phaseOf(summaryOf(data));
  if (phase === 'to_validate')
    return data.closing === null
      ? 'La quinzaine est finie : relis chaque relevé, puis valide-les.'
      : 'Close : il reste des relevés à valider, puis les paiements.';
  if (phase === 'to_pay')
    return owner
      ? 'Validée : marque chaque relevé payé une fois le transfert fait.'
      : 'Validée : le propriétaire verse les relevés.';
  return data.statements.length === 0 ? 'Aucun relevé sur cette quinzaine.' : 'Payée : tout est versé.';
}

/** The quiet line under the rows: when the statements were computed, and what a click does. */
function quietOf(data: PayrollPeriod, now: Date): string {
  const zone = data.window?.timeZone ?? null;
  const computed = data.statements.reduce<string | null>(
    (latest, one) => (latest === null || one.computedAt > latest ? one.computedAt : latest),
    null,
  );
  const at = computed === null || zone === null ? '' : `Calculé ${computedText(computed, zone, now)}. `;
  if (!data.ended) return `${at}Rien ne se valide avant la fin de la quinzaine.`;
  if (data.closing !== null)
    return `${at}Close : un rapport validé maintenant va sur la quinzaine ${periodLine(followingPeriod(data.period))}.`;
  return `${at}Un relevé s’ouvre d’un clic : le parcours de l’argent, ligne par ligne.`;
}

/** The period's head: its state, the one figure that leads, at most three beside it, and the split of its sales. */
function Summary({
  data,
  stale,
  previous,
  names,
  me,
  now,
  rate,
}: {
  data: PayrollPeriod;
  /** The figures are those of the last computation that passed: said so, never shown as the truth. */
  stale: boolean;
  previous: PayrollPeriod | undefined;
  names: PayNames;
  me: { readonly id: string; readonly name: string };
  now: Date;
  /** The dollar's rate is missing to close it: what the dollar sales bring is provisional. */
  rate: boolean;
}): JSX.Element {
  const { window, statements } = data;
  const summary = summaryOf(data);
  const phase = phaseOf(summary);
  const net = teamNetOf(statements);
  const lastDay = payPeriodLastDay(data.period);
  const forecast =
    window === null || statements.length === 0 ? null : forecastNet(net, lateNetOf(statements), window, now);
  const previousNet =
    previous === undefined || previous.statements.length === 0 ? null : teamNetOf(previous.statements);
  const versus = periodTitle(previousPeriod(data.period), false);
  const goal = data.collectiveGoal;
  const reached = goal === null ? 0 : goalReachedBps(data, goal);
  const zone = window?.timeZone ?? null;

  const state: ReactNode = data.beforeFirstClosing ? (
    <span className="py-lock">
      <LockIcon />
      <span>Close avant la première clôture</span>
    </span>
  ) : data.closing !== null ? (
    <>
      <span className="py-lock">
        <LockIcon />
        <span>
          Close le {zone === null ? '' : momentAt(data.closing.closedAt, zone)}
          {data.closing.closedBy === null ? '' : ` par ${whoName(data.closing.closedBy, me, names.members)}`}
        </span>
      </span>
      {phase === 'paid' || phase === 'to_pay' ? <Chip chip={phaseChip(summary)} /> : null}
    </>
  ) : !data.ended ? (
    <>
      <Chip chip={phaseChip(summary)} />
      {window === null ? null : <span>{daysLeftText(daysLeft(window, now))}</span>}
    </>
  ) : (
    <>
      <Chip chip={phaseChip(summary)} />
      <span>depuis le {longDay(lastDay)} à minuit</span>
    </>
  );

  /** « +12 % vs 16 – 30 septembre »: a change, and what it is against, written beside it. */
  const against = (now: number): ReactNode =>
    previous === undefined ? null : previousNet === null ? (
      'pas de quinzaine avant pour comparer'
    ) : (
      <>
        <Delta bps={changeBps(now, previousNet)} title={`${amountText(previousNet, 'EUR')} de net`} /> vs{' '}
        {versus}
      </>
    );

  const figures: JSX.Element[] = [];
  if (data.ended)
    figures.push(
      <Figure key="net" label="Net de l’équipe" value={amountText(net, 'EUR')} note={against(net)} />,
    );
  else if (forecast !== null && net > 0)
    figures.push(
      <Figure
        key="forecast"
        label="Prévision de fin"
        value={roundAmountText(Math.round(forecast / 100) * 100, 'EUR')}
        note={previousNet === null ? `à ce rythme, le ${longDay(lastDay)}` : against(forecast)}
      />,
    );
  if (goal !== null) {
    const span = goalSpanBps(goal);
    const forecastBps = !data.ended && forecast !== null ? reachedBpsOf(forecast, goal.targetMinor) : null;
    const tier = tierAt(goal.tiers, forecastBps ?? reached);
    const bonus = tier === null ? '' : `${signedAmountText(tier.bonusMinor, 'EUR')} par chatteur`;
    figures.push(
      <Figure
        key="goal"
        label="Objectif collectif"
        value={percentText(Math.floor(reached / 100) * 100)}
        extra={
          <Gauge
            value={gaugePercent(reached, span)}
            mark={forecastBps === null ? null : gaugePercent(forecastBps, span)}
          />
        }
        note={
          forecastBps === null
            ? tier === null
              ? `aucun palier atteint, sur ${amountText(goal.targetMinor, 'EUR')}`
              : `palier ${percentText(tier.reachedBps)} atteint : ${bonus}`
            : `prévu ${percentText(Math.floor(forecastBps / 100) * 100)} : ${
                tier === null ? 'aucun palier' : `palier ${percentText(tier.reachedBps)}, ${bonus}`
              }`
        }
      />,
    );
  }

  const creators = salesSplit(
    statements,
    (line) => names.account(line.platformAccountId)?.creatorName ?? 'Autre',
  );
  const platforms = salesSplit(statements, (line) => {
    const account = names.account(line.platformAccountId);
    return account === null ? 'Autre' : platformName(account.platform);
  });

  return (
    <section className="nv-plate nv-panel py-sum nv-enter" data-stale={stale ? 'true' : undefined}>
      <div className="py-sum__head">
        <p className="py-sum__state">{state}</p>
      </div>
      {/* Before the team's first closing there is nothing to sum: no statement, ever. */}
      {data.beforeFirstClosing ? null : (
        <div className="py-sum__body">
          {data.ended ? (
            <EndedHero statements={statements} paid={phase === 'paid'} rate={rate} stale={stale} />
          ) : (
            <div className="py-hero">
              <p className="py-hero__label">
                {stale ? 'Net de l’équipe au dernier calcul réussi' : 'Net de l’équipe à ce jour'}
              </p>
              <HeroValue minor={net} />
              {stale ? (
                <p className="py-hero__note">Plus à jour : le calcul est bloqué.</p>
              ) : /* No forecast without a first full day, and none of a net of nothing. */
              forecast === null && statements.length > 0 ? (
                <p className="py-hero__note">La prévision vient après un premier jour entier.</p>
              ) : null}
            </div>
          )}
          {figures.length === 0 ? null : <div className="py-figs">{figures}</div>}
        </div>
      )}
      {creators.length === 0 ? null : (
        <details className="nv-disclosure py-fold">
          <summary>
            <span className="nv-disclosure__title">Ventes par créatrice et par plateforme</span>
            <span className="nv-disclosure__sum">
              {[...creators, ...platforms]
                .map((share) => `${share.name} ${percentText(roundedPercent(share))}`)
                .join(' · ')}
            </span>
          </summary>
          <div className="nv-disclosure__body py-salesfold">
            <Split label="Par créatrice" shares={creators} />
            <Split label="Par plateforme" shares={platforms} />
          </div>
        </details>
      )}
    </section>
  );
}

/** The hero's amount, smaller when it is long, so that it never overflows its block. */
function HeroValue({ minor }: { minor: number }): JSX.Element {
  const text = amountText(minor, 'EUR');
  return (
    <p className="py-hero__value nv-num" data-long={text.length > 11 ? 'true' : undefined}>
      {text}
    </p>
  );
}

const sumOf = (statements: readonly CommissionStatement[]): number =>
  statements.reduce((total, one) => total + one.payableMinor, 0);

const statementsWord = (count: number): string => `${String(count)} relevé${count > 1 ? 's' : ''}`;

/**
 * An ended period's one amount, never what is not validated counted as owed: what is paid once all is paid; what is
 * left to send of the validated statements once one is; before, what the drafts would pay once validated.
 */
function EndedHero({
  statements,
  paid,
  rate,
  stale,
}: {
  statements: readonly CommissionStatement[];
  paid: boolean;
  rate: boolean;
  /** The figures are those of the last computation that passed: said so, never shown as the truth. */
  stale: boolean;
}): JSX.Element {
  const drafts = statements.filter((one) => one.status === 'draft');
  const validated = statements.filter((one) => one.status === 'validated');
  const payments = statements.filter((one) => one.status === 'paid');
  const sent = payments.reduce((total, one) => total + (one.payment?.sentMinor ?? 0), 0);
  const carried = statements.filter((one) => one.carryOverOutMinor !== 0 && one.status !== 'draft').length;
  // Counted with the words of the rows' chips (carryChip): under the minimum, or under zero.
  const carryingDrafts = statements.filter((one) => one.carryOverOutMinor !== 0 && one.status === 'draft');
  const under = carryingDrafts.filter((one) => one.totalMinor >= 0).length;
  const belowZero = carryingDrafts.length - under;
  const [label, minor] = paid
    ? ['Versé pour la quinzaine', sent]
    : validated.length + payments.length === 0
      ? ['À verser une fois validé', sumOf(drafts)]
      : ['Reste à envoyer', sumOf(validated)];
  const notes = stale
    ? ['Plus à jour : le calcul est bloqué.']
    : [
        !paid && sent > 0 ? `déjà versé ${amountText(sent, 'EUR')}` : null,
        drafts.length === 0
          ? null
          : validated.length + payments.length === 0
            ? `${statementsWord(drafts.length)} à valider`
            : `${amountText(sumOf(drafts), 'EUR')} pas encore validé${drafts.length > 1 ? 's' : ''} (${statementsWord(drafts.length)})`,
        paid && statements.length > 0
          ? `${statementsWord(payments.length)} payé${payments.length > 1 ? 's' : ''}`
          : null,
        carried > 0 ? `${String(carried)} reporté${carried > 1 ? 's' : ''}` : null,
        under > 0 ? `${String(under)} sous le minimum` : null,
        belowZero > 0 ? `${String(belowZero)} sous zéro` : null,
      ].filter((note) => note !== null);
  return (
    <div className="py-hero">
      <p className="py-hero__label">{stale ? `${label}, au dernier calcul réussi` : label}</p>
      <HeroValue minor={minor} />
      {notes.length === 0 ? null : (
        <p className="py-hero__note">
          {notes.map((note, index) => (index === 0 ? capital(note) : note)).join(' · ')}
        </p>
      )}
      {rate ? (
        <p className="py-hero__note">
          Provisoire : les ventes en dollars seront converties au taux de la BCE de la fin de la quinzaine.
        </p>
      ) : null}
    </div>
  );
}

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const roundedPercent = (share: Share): number => Math.round(share.bps / 100) * 100;

const daysLeftText = (days: number): string => (days <= 1 ? 'dernier jour' : `encore ${String(days)} jours`);

function Figure({
  label,
  value,
  note,
  extra,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  extra?: ReactNode;
}): JSX.Element {
  return (
    <div className="py-fig">
      <p className="py-fig__label">{label}</p>
      <p className="py-fig__value nv-num">{value}</p>
      {extra}
      {note === null ? null : <p className="py-fig__note nv-num">{note}</p>}
    </div>
  );
}

/**
 * The colours of a split's parts, in order (docs/design, « Couleur »): from `data-1`, then `data-2`, then the ink at
 * 60 % and 25 %; `salesSplit` gives as many parts as there are colours.
 */
const SPLIT_COLORS = [
  'var(--nv-data-1)',
  'var(--nv-data-2)',
  'color-mix(in oklab, var(--nv-ink) 60%, transparent)',
  'color-mix(in oklab, var(--nv-ink) 25%, transparent)',
] as const;

/** A split of the sales: the design system's bar (`nv-split`), its parts and its legend in the same colours. */
function Split({ label, shares }: { label: string; shares: readonly Share[] }): JSX.Element {
  const colorOf = (index: number): string => SPLIT_COLORS[index] ?? SPLIT_COLORS[3];
  return (
    <div>
      <p className="py-fig__label">{label}</p>
      <span className="nv-split py-salesplit" aria-hidden="true">
        {shares.map((share, index) => (
          <i
            key={share.name}
            className="nv-split__part"
            style={{ '--nv-w': `${String(share.bps / 100)}%`, '--_c': colorOf(index) }}
            title={share.name}
          />
        ))}
      </span>
      <ul className="nv-legend py-legend">
        {shares.map((share, index) => (
          <li key={share.name} className="nv-legend__item" title={amountText(share.minor, 'EUR')}>
            <i className="nv-legend__key" style={{ '--_c': colorOf(index) }} aria-hidden="true" />
            {share.name} {percentText(roundedPercent(share))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** « Tout sélectionner n sur n », and on a phone « Valider » beside it. */
function SelectAll({
  all,
  chosen,
  of,
  onAll,
  onValidate,
}: {
  all: boolean;
  chosen: number;
  of: number;
  onAll: () => void;
  onValidate: () => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="py-allrow">
      <label className="rp-all" htmlFor={`${id}-all`}>
        <input id={`${id}-all`} type="checkbox" className="rp-check" checked={all} onChange={onAll} />
        Tout sélectionner
        <span className="rp-all__count nv-num">
          {String(chosen)} sur {String(of)}
        </span>
      </label>
      <button
        type="button"
        className="nv-btn nv-btn--neon nv-btn--sm py-validate--row"
        disabled={chosen === 0}
        aria-label={`Valider les ${String(chosen)} relevés`}
        onClick={onValidate}
      >
        Valider
      </button>
    </div>
  );
}

/** One member's statement: who, what they made and earn, its state; checked or not; a refusal under it. */
function MemberRow({
  index,
  statement,
  member,
  ended,
  sameStage,
  own,
  column,
  pick,
  checked,
  sending,
  who,
  refusal,
  canPay,
  onCheck,
  onOpen,
}: {
  index: number;
  statement: CommissionStatement;
  member: PayMember;
  ended: boolean;
  /** Every row of the period is at the same stage: a row does not repeat it. */
  sameStage: boolean;
  own: boolean;
  /** The list has a column of boxes: a row without one keeps its place. */
  column: boolean;
  pick: boolean;
  checked: boolean;
  sending: boolean;
  who: (userId: string) => string;
  refusal: { readonly refusal: PayRefusal; readonly text: string } | null;
  canPay: boolean;
  onCheck: (on: boolean) => void;
  onOpen: (paying: boolean) => void;
}): JSX.Element {
  const id = useId();
  const zone = statement.window.timeZone;
  const carry = carryLine(statement, ended);
  const chips = rowChips(statement, ended, sameStage);
  const carried = carryWhat(statement);
  const hover = (label: string): string | undefined => {
    if (label === 'Validé' && statement.validatedAt !== null)
      return `Validé le ${momentAt(statement.validatedAt, zone)}${statement.validatedBy === null ? '' : ` par ${who(statement.validatedBy)}`}`;
    if (label === 'Payé' && statement.payment !== null)
      return `Payé le ${longDay(statement.payment.paidOn)}${statement.paidBy === null ? '' : `, marqué par ${who(statement.paidBy)}`}`;
    return undefined;
  };
  const locked = own && statement.status === 'draft' && ended;
  const changed =
    refusal?.refusal.kind === 'refused' && refusal.refusal.code === 'commission_statement_changed_conflict';
  const missingRate =
    refusal?.refusal.kind === 'refused' && refusal.refusal.code === 'commission_rate_missing_conflict';

  return (
    <li
      className="rp-review py-member nv-enter"
      style={{ '--nv-i': Math.min(index, 8) }}
      data-nopick={column ? undefined : 'true'}
      data-checked={checked ? 'true' : undefined}
      data-locked={locked ? 'true' : undefined}
      aria-busy={sending}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('input, button, a, label') !== null)
          return;
        onOpen(false);
      }}
    >
      {!column ? null : pick || locked ? (
        <label className="rp-review__pick" htmlFor={`${id}-pick`}>
          <input
            id={`${id}-pick`}
            type="checkbox"
            className="rp-check"
            checked={checked || sending}
            disabled={!pick || sending}
            aria-label={`Sélectionner le relevé de ${member.name}`}
            onChange={(event) => {
              onCheck(event.target.checked);
            }}
          />
        </label>
      ) : (
        <span className="rp-review__pick" aria-hidden="true" />
      )}
      <div className="rp-review__main">
        <p className="rp-review__who">
          <Swatch color={member.color} />
          <button
            type="button"
            className="py-member__open"
            onClick={() => {
              onOpen(false);
            }}
          >
            {member.name}
          </button>
          {member.manager ? <span className="py-member__role">Manager</span> : null}
        </p>
        <p className="py-member__line nv-num">
          net <b>{amountText(statement.netMinor, 'EUR')}</b>
          {memberFacts(statement).map((fact) => ` · ${fact}`)}
        </p>
        {carry === null ? null : <p className="py-member__line">{carry}</p>}
        {locked ? (
          <p className="rp-review__locked">Ton relevé : un autre membre de l’agence le valide.</p>
        ) : null}
      </div>
      <div className="rp-review__side">
        <span className="py-member__amount">
          <span className="rp-review__amount nv-num">{amountText(statement.payableMinor, 'EUR')}</span>
          <small className="nv-num">{amountWhat(statement, ended, sameStage)}</small>
          {carried === null ? null : <small className="nv-num">{carried}</small>}
        </span>
        {!sending && chips.length === 0 ? null : (
          <div className="py-chips">
            {sending ? (
              <span className="rp-review__held">En validation</span>
            ) : (
              chips.map((chip) => <Chip key={chip.label} chip={chip} title={hover(chip.label)} />)
            )}
          </div>
        )}
        {canPay ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              onOpen(true);
            }}
          >
            Marquer payé
          </button>
        ) : null}
      </div>
      {refusal === null ? null : (
        <div className="py-member__refused rp-notice" data-tone="warn" role="alert">
          <div className="py-notice-row">
            <p className="rp-notice__text">{refusal.text}</p>
            {changed ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  onOpen(false);
                }}
              >
                Relire
              </button>
            ) : missingRate ? (
              <Link
                to="/equipe/membres"
                search={{ membre: statement.memberId }}
                className="nv-btn nv-btn--soft nv-btn--sm"
              >
                Ouvrir sa fiche
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * What stops pay from computing the period (recette du 28/10, Équipe G1), in amber above the rows: who or what, what
 * lifts it, and that the figures below are out of date. No button: no gesture of the screen lifts it (`blockedText`).
 */
function ComputingNotice({
  block,
  owner,
  names,
  zone,
}: {
  block: PayPeriodBlock;
  owner: boolean;
  names: PayNames;
  zone: string | null;
}): JSX.Element {
  const { title, text } = blockedText(block, { owner, memberName: (id) => names.member(id).name }, zone);
  return (
    <div className="rp-notice" data-tone="warn" role="status">
      <p className="rp-notice__title">{title}</p>
      <p className="rp-notice__text">{text}</p>
    </div>
  );
}

/** What blocks the period before anyone tries, in amber above the rows, with the gesture that lifts it. */
function BlockNotice({
  block,
  zone,
  now,
  owner,
}: {
  block: PeriodBlock;
  zone: string | null;
  now: Date;
  owner: boolean;
}): JSX.Element {
  if (block.kind === 'rate_missing') {
    const { latest } = block;
    const read =
      latest === null
        ? 'Aucun taux lu pour l’instant.'
        : `Dernier lu : ${rateText(latest.rateMicros, latest.currency)} le ${dayMonthText(latest.day).replace(/\.$/u, '')}.`;
    const stale = latest !== null && zone !== null && rateOverdue(latest.day, dayOf(now, zone));
    return (
      <div className="rp-notice" data-tone="warn">
        <p className="rp-notice__title">Le taux du dollar de la BCE manque pour la fin de la quinzaine</p>
        <p className="rp-notice__text nv-num">
          {read}{' '}
          {stale
            ? `Le taux n’arrive plus depuis plus de deux jours ouvrés : la lecture des taux de la BCE est en panne.${owner ? '' : ' Préviens le propriétaire.'}`
            : 'Il arrive chaque jour ouvré vers 16 h : la quinzaine se valide dès qu’il est là. Rien à faire de ton côté.'}
        </p>
      </div>
    );
  }
  const count = block.reports.length;
  const named = block.reports.slice(0, 3).map((report) => {
    const { name, startsAt } = block.whose(report);
    return startsAt === null || zone === null ? name : `${name}, ${dayMonthText(dayOf(startsAt, zone))}`;
  });
  const more = count - named.length;
  const list =
    more > 0
      ? `${named.join(' ; ')} et ${String(more)} autre${more > 1 ? 's' : ''}.`
      : `${named.slice(0, -1).join(' ; ')}${named.length > 1 ? ' et ' : ''}${named.at(-1) ?? ''}.`;
  return (
    <div className="rp-notice" data-tone="warn">
      <div className="py-notice-row">
        <div>
          <p className="rp-notice__title">
            {count === 1
              ? 'Un rapport de la quinzaine attend sa relecture'
              : `${String(count)} rapports de la quinzaine attendent leur relecture`}
          </p>
          <p className="rp-notice__text">
            {list} Tant {count === 1 ? 'qu’il attend' : 'qu’ils attendent'}, la quinzaine ne se clôt pas :{' '}
            {count === 1 ? 'il compterait' : 'ils compteraient'} sans avoir été relu{count === 1 ? '' : 's'}.
          </p>
        </div>
        <Link to="/equipe/rapports" className="nv-btn nv-btn--neon nv-btn--sm">
          {count === 1 ? 'Relire le rapport' : `Relire les ${String(count)} rapports`}
        </Link>
      </div>
    </div>
  );
}

/** A validation the server stopped for the whole period: what it said, and what to do about it. */
function StopNotice({
  refusal,
  text,
  onPeriod,
  onRetry,
}: {
  refusal: PayRefusal;
  text: string;
  onPeriod: (period: PayPeriod | null) => void;
  onRetry: () => void;
}): JSX.Element {
  const earlier =
    refusal.kind === 'refused' && refusal.code === 'pay_period_order_conflict'
      ? PayPeriodSchema.safeParse(refusal.details.period)
      : null;
  return (
    <div className="rp-notice" data-tone="warn" role="alert">
      <div className="py-notice-row">
        <p className="rp-notice__text">{text}</p>
        {refusal.kind === 'failed' ? (
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={onRetry}>
            Réessayer
          </button>
        ) : refusal.code === 'pay_period_reports_pending_conflict' ? (
          <Link to="/equipe/rapports" className="nv-btn nv-btn--neon nv-btn--sm">
            Relire les rapports
          </Link>
        ) : earlier?.success === true ? (
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            onClick={() => {
              onPeriod(earlier.data);
            }}
          >
            Ouvrir cette quinzaine
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** How long the export's file stays readable after its download starts. */
const CSV_KEPT_MS = 60_000;

/** The period's statements as a spreadsheet, made in the browser from what is read: no route, no right of its own. */
function downloadCsv(data: PayrollPeriod, names: PayNames): void {
  const csv = statementsCsv(
    data,
    (memberId) => names.member(memberId).name,
    (accountId) => {
      const account = names.account(accountId);
      return account === null ? 'Compte' : `${account.creatorName} (${accountLine(account)})`;
    },
  );
  // The mark tells a spreadsheet the file is UTF-8: « Théo » stays « Théo ».
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `releves-${data.period}.csv`;
  link.click();
  // Freed once the browser has read it: revoked at once, Safari and Firefox may save nothing.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, CSV_KEPT_MS);
}
