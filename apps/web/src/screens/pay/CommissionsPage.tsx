import {
  payPeriodLastDay,
  type BonusTier,
  type CollectiveGoal,
  type CommissionStatement,
  type Me,
  type PayPeriod,
  type PayPeriodBlock,
  type PayPeriodSummary,
  type PayrollPeriod,
  type PlanningAccount,
} from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type JSX } from 'react';

import { useCfaFrancs, useCurrentPeriod, usePayNames } from './data';
import { Chip, Empty, Gauge, GoalTicks, Loading, MoneyPath, Unreachable } from './parts';

import {
  PAYROLL_KEY,
  PeriodCursorInvalid,
  usePayPeriod,
  usePayPeriods,
  usePayrollSettings,
} from '@/payroll/api';
import {
  fcfaText,
  forecastNet,
  gaugePercent,
  goalSpanBps,
  heroPeriodOf,
  mainLine,
  memberPeriodAmount,
  memberPhaseChip,
  momentAt,
  myBlockedText,
  myStatementWords,
  roundAmountText,
  salesFor,
  summaryOf,
  tierProgress,
} from '@/payroll/model';
import '@/payroll/pay.css';
import '@/reports/reports.css';
import {
  amountText,
  followingPeriod,
  percentText,
  periodLine,
  periodTitle,
  signedAmountText,
} from '@/reports/model';
import { platformName } from '@/scheduling/model';
import '@/scheduling/scheduling.css';
import { longDay } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { Dialog } from '@/screens/team/Dialog';
import '@/screens/team/team.css';
import { Page, PageHeader, Panel } from '@/shell/layout';

/**
 * Commissions (EQ-05, the chatter's): what they touch for the period whose money is on its way — computed, being
 * validated, validated or paid —, the path of that money from the sales, what is left to reach their next tier and
 * the team's goal in the period under way, then their past statements. Only their own: never a ranking nor another
 * member's amount. The hero is the screen's one neon.
 */
export function CommissionsPage({ user }: { user: Me }): JSX.Element {
  const now = useNow();
  const current = useCurrentPeriod();
  const periods = usePayPeriods();
  // PAIE-32: the usual payout delay the owner announced, read by every member; never a figure of the code.
  const delay = usePayrollSettings().data?.payoutDelayBusinessDays ?? null;
  const client = useQueryClient();
  const [opened, setOpened] = useState<PayPeriod | null>(null);

  // A cursor the server no longer knows: the list reads again from its start, nothing to say.
  const lost = periods.error instanceof PeriodCursorInvalid;
  useEffect(() => {
    if (lost) void client.resetQueries({ queryKey: [...PAYROLL_KEY, 'periods'] });
  }, [lost, client]);

  const summaries = periods.data?.pages.flatMap((page) => page.items) ?? [];
  const hero =
    current === null || periods.data === undefined
      ? null
      : heroPeriodOf(periods.data.pages[0]?.items ?? [], current);
  const heroRead = usePayPeriod(hero);
  const nowRead = usePayPeriod(current);
  const heroNames = usePayNames(hero, false);
  const nowNames = usePayNames(current, false);

  const head = (period: PayPeriod | null): JSX.Element => (
    <PageHeader
      eyebrow={period === null ? 'Quinzaine' : `Quinzaine ${periodLine(period)}`}
      title="Commissions"
      lead="Ce que tu as gagné sur la quinzaine, et comment ta commission se construit."
    />
  );

  if (periods.isError && !lost && periods.data === undefined)
    return (
      <Page>
        {head(current)}
        <div className="py-board">
          <Panel className="nv-enter">
            <Unreachable
              what="la liste de tes relevés"
              onRetry={() => {
                void periods.refetch();
              }}
            />
          </Panel>
        </div>
      </Page>
    );
  if (hero === null || current === null)
    return (
      <Page>
        {head(null)}
        <div className="py-me">
          <div className="py-me__col">
            <Panel>
              <Loading rows={1} />
            </Panel>
            <Panel>
              <Loading rows={2} />
            </Panel>
          </div>
          <div className="py-me__col">
            <Panel>
              <Loading rows={2} />
            </Panel>
          </div>
        </div>
      </Page>
    );
  if (summaries.length === 0)
    return (
      <Page>
        {head(current)}
        <div className="py-board">
          <Panel className="nv-enter">
            <div className="py-empty">
              <p className="py-empty__whisper">Ton premier relevé arrive avec ton premier rapport validé.</p>
              <p className="py-empty__text">
                Chaque rapport de fin de shift que l’agence valide compte ici, compte par compte, de tes
                ventes à ce que tu touches.
              </p>
              <Link to="/planning" className="nv-btn nv-btn--soft">
                Voir mon planning
              </Link>
            </div>
          </Panel>
        </div>
      </Page>
    );

  const heroData = heroRead.data?.period === hero ? heroRead.data : undefined;
  const statement = heroData?.statements[0];
  const nowData = nowRead.data?.period === current ? nowRead.data : undefined;
  const past = summaries.filter((summary) => summary.window.period !== hero);

  return (
    <Page>
      {head(hero)}
      <div className="py-me">
        <div className="py-me__col">
          {heroData === undefined ? (
            heroRead.isError ? (
              <Panel className="nv-enter">
                <Unreachable
                  what="ta quinzaine"
                  onRetry={() => {
                    void heroRead.refetch();
                  }}
                />
              </Panel>
            ) : (
              <>
                <Panel>
                  <Loading rows={1} />
                </Panel>
                <Panel>
                  <Loading rows={2} />
                </Panel>
              </>
            )
          ) : statement === undefined ? (
            heroData.blocked ? (
              // Their own report blocks the period before any statement: why, never an empty period.
              <MyBlockNotice block={heroData.blocked} hasStatement={false} />
            ) : (
              <Panel className="nv-enter">
                <Empty
                  whisper="Pas encore de relevé sur cette quinzaine."
                  text="Il se calcule dès que l’agence valide un de tes rapports de fin de shift."
                />
              </Panel>
            )
          ) : (
            <>
              {heroData.blocked ? <MyBlockNotice block={heroData.blocked} /> : null}
              <Hero statement={statement} period={heroData} now={now} />
              <Panel className="nv-enter" eyebrow="Le parcours de ton argent">
                <div className="rp-sec">
                  <MoneyPath
                    statement={statement}
                    names={heroNames}
                    you
                    payLabel={myStatementWords(statement, heroData.ended, now, delay).label}
                  />
                </div>
              </Panel>
            </>
          )}
        </div>
        <div className="py-me__col">
          <Panel
            className="nv-enter"
            eyebrow="Ma performance"
            title={hero === current ? undefined : `Quinzaine ${periodLine(current)}`}
          >
            {nowData === undefined ? (
              nowRead.isError ? (
                <Unreachable
                  what="la quinzaine en cours"
                  onRetry={() => {
                    void nowRead.refetch();
                  }}
                />
              ) : (
                <Loading rows={1} />
              )
            ) : (
              <Performance
                period={nowData}
                account={nowNames.account}
                chatter={user.team?.role !== 'manager'}
                now={now}
              />
            )}
          </Panel>
          <Panel className="nv-enter" eyebrow="Mes relevés">
            <div className="rp-sec">
              {past.length === 0 ? (
                <p className="py-quiet">Tes quinzaines précédentes viendront ici, chacune avec son relevé.</p>
              ) : (
                <ul className="py-periods">
                  {past.map((summary, index) => (
                    <li
                      key={summary.window.period}
                      className="nv-enter"
                      style={{ '--nv-i': Math.min(index, 8) }}
                    >
                      <MyPeriodRow
                        summary={summary}
                        onOpen={() => {
                          setOpened(summary.window.period);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {periods.hasNextPage ? (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain nv-btn--sm"
                  disabled={periods.isFetchingNextPage}
                  aria-busy={periods.isFetchingNextPage}
                  onClick={() => {
                    void periods.fetchNextPage();
                  }}
                >
                  {periods.isFetchingNextPage ? 'Lecture…' : 'Quinzaines plus anciennes'}
                </button>
              ) : null}
              {periods.isError && !lost ? (
                <p className="tm-warn" role="alert">
                  Le serveur ne répond pas : les quinzaines plus anciennes n’ont pas pu être lues.
                </p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
      {opened === null ? null : (
        <MyStatementDialog
          period={opened}
          now={now}
          onClose={() => {
            setOpened(null);
          }}
        />
      )}
    </Page>
  );
}

/** What the member touches for the period: the one lit surface of the screen. */
function Hero({
  statement,
  period,
  now,
}: {
  statement: CommissionStatement;
  period: PayrollPeriod;
  now: Date;
}): JSX.Element {
  const delay = usePayrollSettings().data?.payoutDelayBusinessDays ?? null;
  const words = myStatementWords(statement, period.ended, now, delay);
  const cfa = useCfaFrancs(statement.memberId);
  return (
    <section
      className="nv-plate nv-panel nv-stat--hero py-mehero nv-enter"
      aria-label={words.label}
      data-stale={period.blocked === null ? undefined : 'true'}
    >
      <div className="py-mehero__top">
        <span className="py-mehero__period nv-num">{periodTitle(period.period, false)}</span>
        <Chip chip={memberPhaseChip(summaryOf(period))} />
        <span className="py-quiet nv-num">{words.since}</span>
      </div>
      <p className="py-hero__label">{words.label}</p>
      <p className="py-hero__value nv-num nv-swap" key={statement.revision}>
        {amountText(statement.payableMinor, 'EUR')}
      </p>
      {statement.payableMinor === 0 || !cfa ? null : (
        <p className="py-hero__note nv-num">{fcfaText(statement.payableMinor)}</p>
      )}
      {words.notes.map((note) => (
        <p key={note} className="py-hero__note nv-num">
          {note}
        </p>
      ))}
    </section>
  );
}

/**
 * What is left to do in the period under way: the next individual tier, in net and roughly in sales on the account
 * that brings the most, then for a chatter their share of the team's goal, in percent only.
 */
function Performance({
  period,
  account,
  chatter,
  now,
}: {
  period: PayrollPeriod;
  account: (platformAccountId: string) => PlanningAccount | null;
  chatter: boolean;
  now: Date;
}): JSX.Element {
  const statement = period.statements[0];
  const net = statement?.netMinor ?? 0;
  const tiers = statement?.rules.bonusTiers ?? period.bonusTiers?.tiers ?? [];
  const goal = chatter ? (statement?.rules.collectiveGoal ?? period.collectiveGoal) : null;
  if (tiers.length === 0 && goal === null)
    return (
      <div className="rp-sec">
        <p className="py-quiet">
          Pas de palier ni d’objectif d’équipe sur cette quinzaine : ta commission suit ton net, rapport après
          rapport.
        </p>
      </div>
    );
  return (
    <div className="rp-sec">
      {tiers.length === 0 ? null : (
        <TierLeft
          net={net}
          tiers={tiers}
          statement={statement}
          account={account}
          lastDay={payPeriodLastDay(period.period)}
        />
      )}
      {goal === null ? null : <GoalShare goal={goal} statement={statement} period={period} now={now} />}
    </div>
  );
}

function TierLeft({
  net,
  tiers,
  statement,
  account,
  lastDay,
}: {
  net: number;
  tiers: readonly BonusTier[];
  statement: CommissionStatement | undefined;
  account: (platformAccountId: string) => PlanningAccount | null;
  lastDay: string;
}): JSX.Element | null {
  const { reached, next } = tierProgress(net, tiers);
  if (next === null && reached !== null)
    return (
      <div className="py-left">
        <p className="py-left__title">Palier {reached.label} atteint</p>
        <Gauge value={100} mark={null} />
        <p className="py-left__text">
          Le plus haut : <b className="nv-num">{signedAmountText(reached.bonusMinor, 'EUR')}</b> sur ce
          relevé.
        </p>
      </div>
    );
  if (next === null) return null;
  const from = reached?.thresholdMinor ?? 0;
  const left = next.thresholdMinor - net;
  const line = statement === undefined ? null : mainLine(statement.lines);
  const where = line === null ? null : account(line.platformAccountId);
  return (
    <div className="py-left">
      <p className="py-left__title nv-num">
        Palier {next.label} : encore {amountText(left, 'EUR')} de net
      </p>
      <Gauge value={gaugePercent(net - from, next.thresholdMinor - from)} mark={null} />
      <div className="py-gaugelabels nv-num">
        <span>
          {reached === null ? roundAmountText(0, 'EUR') : `${reached.label} ${roundAmountText(from, 'EUR')}`}
        </span>
        <span>
          {next.label} {roundAmountText(next.thresholdMinor, 'EUR')}
        </span>
      </div>
      <p className="py-left__text">
        {line === null ? (
          'Pour '
        ) : (
          <>
            Soit environ <b className="nv-num">{roundAmountText(salesFor(left, line), line.currency)}</b> de
            ventes
            {where === null ? '' : ` sur ${platformName(where.platform)}`} d’ici le {longDay(lastDay)},
            pour{' '}
          </>
        )}
        <b className="nv-num">{signedAmountText(next.bonusMinor, 'EUR')}</b>
        {reached === null ? '' : ` au lieu de ${signedAmountText(reached.bonusMinor, 'EUR')}`}.
      </p>
    </div>
  );
}

/** The team's goal as a chatter follows it: how far in percent, where the pace leads, and what each tier brings them. */
function GoalShare({
  goal,
  statement,
  period,
  now,
}: {
  goal: Pick<CollectiveGoal, 'targetMinor' | 'tiers'>;
  statement: CommissionStatement | undefined;
  period: PayrollPeriod;
  now: Date;
}): JSX.Element {
  const reached = statement?.team?.collective?.reachedBps ?? null;
  const span = goalSpanBps(goal);
  // A member never reads the team's net (`netMinor` is null for them), only the percent reached, which grows with the
  // net: the pace extrapolates the percent. The team's late reports are not theirs to read either, so none is set apart.
  const forecastBps =
    reached === null || period.ended || period.window === null
      ? null
      : forecastNet(reached, 0, period.window, now);
  const tiers = goal.tiers.toSorted((a, b) => a.reachedBps - b.reachedBps);
  return (
    <div className="py-left">
      <p className="py-left__title nv-num">
        {reached === null
          ? 'Objectif de l’équipe'
          : `Objectif de l’équipe : ${percentText(Math.floor(reached / 100) * 100)}`}
      </p>
      <Gauge
        value={gaugePercent(reached ?? 0, span)}
        mark={forecastBps === null ? null : gaugePercent(forecastBps, span)}
      />
      <GoalTicks
        tiers={goal.tiers}
        span={span}
        reached={reached}
        title={(one) =>
          `À ${percentText(one.reachedBps)} : ${signedAmountText(one.bonusMinor, 'EUR')} pour toi`
        }
      />
      <p className="py-left__text">
        {tiers.map((one, index) => (
          <span key={one.reachedBps}>
            {index === 0 ? 'À ' : ' ; à '}
            {percentText(one.reachedBps)}, <b className="nv-num">{signedAmountText(one.bonusMinor, 'EUR')}</b>
            {index === 0 ? ' pour toi' : ''}
          </span>
        ))}
        .
        {forecastBps === null
          ? reached === null
            ? ' Ta part se lit dès ton premier rapport validé de la quinzaine.'
            : ''
          : ' La marque est là où l’équipe finit à ce rythme.'}
      </p>
    </div>
  );
}

/** A period pay could not compute, said to the member in amber: their statement is out of date, never whose rate lacks. */
function MyBlockNotice({
  block,
  hasStatement = true,
}: {
  block: PayPeriodBlock;
  hasStatement?: boolean;
}): JSX.Element {
  const { title, text } = myBlockedText(block, hasStatement);
  return (
    <div className="rp-notice nv-enter" data-tone="warn" role="status">
      <p className="rp-notice__title">{title}</p>
      <p className="rp-notice__text">{text}</p>
    </div>
  );
}

/** One of the member's past periods: its state, its net and closing beneath, and one amount. */
function MyPeriodRow({ summary, onOpen }: { summary: PayPeriodSummary; onOpen: () => void }): JSX.Element {
  const { window } = summary;
  const chip = memberPhaseChip(summary);
  // A period carried over pays nothing: its row says what went on the next one, the member's `carriedMinor` (#295).
  const amount =
    chip.label === 'Reporté'
      ? {
          minor: summary.carriedMinor,
          what: `reporté sur le ${periodTitle(followingPeriod(window.period), false)}`,
        }
      : memberPeriodAmount(summary);
  const sub = `${amountText(summary.netMinor, 'EUR')} de net${summary.ended ? '' : ' à ce jour'}`;
  return (
    <button type="button" className="py-period nv-tap" onClick={onOpen}>
      <span>
        <span className="py-period__name nv-num">{periodTitle(window.period, false)}</span>
        <span className="py-period__sub nv-num">{sub}</span>
      </span>
      <Chip chip={chip} />
      <span className="py-period__amount nv-num">
        {amountText(amount.minor, 'EUR')}
        <small>{amount.what}</small>
      </span>
      <span className="py-period__go" aria-hidden="true" />
    </button>
  );
}

/** A past statement of the member's, opened from « Mes relevés »: the same lines as the agency's, in the second person. */
function MyStatementDialog({
  period,
  now,
  onClose,
}: {
  period: PayPeriod;
  now: Date;
  onClose: () => void;
}): JSX.Element {
  const read = usePayPeriod(period);
  const names = usePayNames(period, false);
  const data = read.data?.period === period ? read.data : undefined;
  const statement = data?.statements[0];
  const cfa = useCfaFrancs(statement?.memberId);
  const delay = usePayrollSettings().data?.payoutDelayBusinessDays ?? null;
  const words =
    data === undefined || statement === undefined
      ? null
      : myStatementWords(statement, data.ended, now, delay);
  return (
    <Dialog
      className="py-dialog"
      title={periodTitle(period)}
      lead={
        <>
          Relevé de commissions
          {data === undefined ? null : <Chip chip={memberPhaseChip(summaryOf(data))} />}
        </>
      }
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        {data === undefined ? (
          read.isError ? (
            <Unreachable
              what="ce relevé"
              onRetry={() => {
                void read.refetch();
              }}
            />
          ) : (
            <Loading rows={2} />
          )
        ) : statement === undefined || words === null ? (
          data.blocked ? (
            <MyBlockNotice block={data.blocked} hasStatement={false} />
          ) : (
            <p className="py-quiet">Pas de relevé à ton nom sur cette quinzaine.</p>
          )
        ) : (
          <>
            {data.blocked ? <MyBlockNotice block={data.blocked} /> : null}
            <div className="py-dialog__hero" data-stale={data.blocked ? 'true' : undefined}>
              <div className="py-hero">
                <p className="py-hero__label">{words.label}</p>
                <p className="py-hero__value nv-num">{amountText(statement.payableMinor, 'EUR')}</p>
                {statement.payableMinor === 0 || !cfa ? null : (
                  <p className="py-hero__note nv-num">{fcfaText(statement.payableMinor)}</p>
                )}
              </div>
              {words.notes.map((note) => (
                <p key={note} className="py-hero__note nv-num">
                  {note}
                </p>
              ))}
            </div>
            <MoneyPath statement={statement} names={names} you payLabel={words.label} />
          </>
        )}
        <div className="py-dialog__foot">
          {statement === undefined || statement.validatedAt === null ? null : (
            <p className="py-quiet">
              Validé le {momentAt(statement.validatedAt, statement.window.timeZone)}.
            </p>
          )}
          <button type="button" className="nv-btn nv-btn--plain" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </Dialog>
  );
}
