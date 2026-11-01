import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, type JSX, type ReactNode } from 'react';

import { AgentHero } from './AgentHero';
import { BackupBanner } from './BackupBanner';
import { CreatorPicker } from './CreatorPicker';
import { FunnelPanel } from './Funnel';
import { ModeControl } from './ModeControl';
import { PeriodControl, SalesPanel, salesSub } from './Sales';
import { TopFans } from './TopFans';
import { agentRuns, litParts } from './logic';
import type { Fan, Period, Todo, Tone } from './model';
import { Section, TONE_COLOR, useFloatingTip } from './parts';
import { useDashboard, type DashboardView } from './useDashboard';
import './dashboard.css';

import { pillOf } from '@/agent/mode';
import { useAgentModeWriter } from '@/agent/write';
import { useCreators } from '@/creators/api';
import { initialOf } from '@/lib/utils';
import { NightBanner } from '@/settings/telegram/NightBanner';
import { ServerSilent } from '@/shell/ServerSilent';

/** Why the control cannot change the mode under an operator's global switch: the hero says it too (DASH-08). */
const GLOBAL_NOTE =
  'Un arrêt général retient l’agent pour toutes les créatrices : seul un opérateur peut le lever.';

const FUNNEL_SUB: Record<Period, string> = {
  day: 'les fans arrivés aujourd’hui, et combien passent chaque étape',
  week: 'les fans arrivés ces 7 jours, et combien passent chaque étape',
  month: 'les fans arrivés ces 30 jours, et combien passent chaque étape',
};

/** A sentence alone where the page would be: there is no creator yet. */
function Alone({
  tone,
  headline,
  lead,
  children,
}: {
  tone: Tone;
  headline: string;
  lead: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="db">
      <section
        className="db-hero nv-enter"
        style={{ '--_c': TONE_COLOR[tone], '--nv-i': 1 }}
        role="status"
        aria-live="polite"
      >
        <div className="db-hero__top">
          <span className={`nv-orb nv-tone--${tone}`} aria-hidden="true" />
          <div>
            <h1>
              {litParts(headline).map((part) =>
                part.lit ? <em key={part.text}>{part.text}</em> : part.text,
              )}
            </h1>
            <p className="db-hero__lead">{lead}</p>
          </div>
          {children}
        </div>
      </section>
    </div>
  );
}

/**
 * The server does not answer: one sentence, no figure, only « Réessayer », until it answers again. Amber, not red: a
 * warning, the red stays the urgencies'.
 */
function Offline({ creatorName }: { creatorName: string | null }): JSX.Element {
  const client = useQueryClient();
  return (
    <div className="db">
      {creatorName === null ? null : (
        <header className="db-top nv-enter">
          {/* Another creator's Dashboard may still answer: the choice stays at hand. */}
          <CreatorPicker />
          <div className="db-top__who">
            <span className="db-top__av" aria-hidden="true">
              {initialOf(creatorName)}
            </span>
            <span className="db-top__name">{creatorName}</span>
          </div>
        </header>
      )}
      {/* The same face as on Aujourd'hui (DASH-22): the sentence, what it holds back, « Réessayer ». */}
      <ServerSilent
        headline
        text="Les chiffres reviennent dès qu’il répond. Rien ici n’est à jour en attendant."
        onRetry={() => {
          // The list of creators may be what failed: both are read again.
          void client.refetchQueries({ queryKey: ['creators'] });
          void client.refetchQueries({ queryKey: ['dashboard'] });
        }}
      />
    </div>
  );
}

/**
 * No creator yet (first launch): what to do, never a page of made-up figures (DASH-13). Whoever can add one is led to
 * Créatrices; anyone else reads who does.
 */
function NoCreator({ canAddCreator }: { canAddCreator: boolean }): JSX.Element {
  return canAddCreator ? (
    <Alone
      tone="idle"
      headline="Ajoute ta **première créatrice**"
      lead="Son agent, ce qui attend un humain et ses meilleurs fans arriveront ici dès que sa session Reveal sera reliée."
    >
      <Link to="/creatrices" className="nv-btn nv-btn--soft">
        Aller à Créatrices
      </Link>
    </Alone>
  ) : (
    <Alone
      tone="idle"
      headline="Aucune créatrice **pour l’instant**"
      lead="Le propriétaire de l’agence les ajoute. Leur agent et ce qui attend un humain arriveront ici."
    />
  );
}

/**
 * The Dashboard, read top to bottom (maquette v6, validée le 17/10) : the agent's state and what waits for a
 * human, then the sales, the fans' path, the best fans. Every detail lives in a tip, every line opens in Suivi.
 *
 * A creator's keeps her aggregates only (ADR 0023: never a conversation nor a fan): the agent's state and mode,
 * read only, its health, the sales; no « À traiter », no best fans, no way into Suivi. The server sends her neither.
 */
export function DashboardPage({
  period,
  onPeriod,
  forCreator = false,
  forOwner = false,
  opensTracking = false,
  canAddCreator = false,
}: {
  /** The period of the sales, the fans' path, the best fans and the reply delay: from the address (`?periode=`). */
  period: Period;
  onPeriod: (period: Period) => void;
  forCreator?: boolean;
  /** The owner also reads the state of the daily export (OPS-02), the one figure that is the owner's alone. */
  forOwner?: boolean;
  /** The account's rail holds Suivi: a best fan opens his conversation there (DASH-14). */
  opensTracking?: boolean;
  /** The account's rail holds Créatrices: before any creator, the screen leads there (DASH-13). */
  canAddCreator?: boolean;
}): JSX.Element {
  const view = useDashboard(period, forCreator ? 'creator' : forOwner ? 'owner' : 'team');
  if (view.status === 'loading') {
    return (
      <div className="db" aria-busy="true">
        <div className="db-loading nv-plate" aria-label="Chargement du Dashboard" role="status" />
      </div>
    );
  }
  if (view.status === 'offline') return <Offline creatorName={view.creatorName} />;
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  return (
    <Loaded
      view={view}
      period={period}
      onPeriod={onPeriod}
      forCreator={forCreator}
      forOwner={forOwner}
      opensTracking={opensTracking}
    />
  );
}

function Loaded({
  view: { creatorId, globalStop, readAt, data, mode, automatic },
  period,
  onPeriod,
  forCreator,
  forOwner,
  opensTracking,
}: {
  view: Extract<DashboardView, { status: 'live' }>;
  period: Period;
  onPeriod: (period: Period) => void;
  forCreator: boolean;
  forOwner: boolean;
  opensTracking: boolean;
}): JSX.Element {
  const tip = useFloatingTip();
  const sales = data.sales?.[period] ?? null;
  // With several creators the chips above name her: the header does not say her name a second time (DASH-03).
  const several = (useCreators().data?.length ?? 0) >= 2;

  const navigate = useNavigate();
  // Every line opens in Suivi, where a draft is decided and a handoff given back; a best fan too, on his conversation.
  const openTodo = useCallback(
    (todo: Todo) => void navigate({ to: '/suivi', search: { conversation: todo.conversationId } }),
    [navigate],
  );
  // His conversation may be older than her latest ones: Suivi is told whose it is.
  const openFan = useCallback(
    (fan: Fan) =>
      void navigate({ to: '/suivi', search: { conversation: fan.conversationId, creatrice: creatorId } }),
    [navigate, creatorId],
  );
  const writer = useAgentModeWriter(creatorId, readAt);
  const { setMode } = writer;
  const resume = useCallback(() => {
    setMode('copilot');
  }, [setMode]);
  const running = agentRuns(data.agent);
  // The global stop is said in the hero, next to the sentence it explains, not in this corner (DASH-08).
  const notice = writer.notice;
  const pill = pillOf(mode, running);

  const periodControl = <PeriodControl period={period} onChange={onPeriod} />;
  return (
    <div className="db">
      <header className="db-top nv-enter">
        {/* Whose agent this is, when the account sees several: the pill and Suivi follow the same choice. */}
        <CreatorPicker />
        <div className="db-top__who">
          {several ? null : (
            <span className="db-top__av" aria-hidden="true">
              {initialOf(data.creator.name)}
            </span>
          )}
          <span>
            {several ? null : <span className="db-top__name">{data.creator.name}</span>}
            <span className="db-top__when">
              {data.creator.platform} · {data.creator.now}
            </span>
          </span>
        </div>
        {forCreator ? (
          // Hers to read, not to change: the mode alone, never a control that looks like one (DASH-21).
          <p className="db-modepill nv-glass nv-glass--thin">
            <span
              className={`nv-dot${pill.tone === 'unknown' ? '' : ` nv-tone--${pill.tone}`}${pill.live ? ' nv-dot--live' : ''}`}
              aria-hidden="true"
            />
            {pill.label}
            <span className="db-modepill__who">réglé par l’agence</span>
          </p>
        ) : (
          // The mode changes once the server has made the change (PUT /v1/agent/mode).
          <ModeControl
            mode={mode}
            automatic={automatic}
            creatorName={data.creator.name}
            tip={tip}
            readOnly={globalStop ? GLOBAL_NOTE : null}
            running={running}
            onChange={setMode}
          />
        )}
        {writer.pending ? (
          <p className="db-notice db-notice--quiet" role="status">
            Envoi au serveur…
          </p>
        ) : notice === null ? null : (
          <p className="db-notice" role="alert">
            {notice}
          </p>
        )}
      </header>

      <AgentHero
        agent={data.agent}
        mode={mode}
        todos={data.todos}
        onOpen={openTodo}
        onResume={!globalStop && !forCreator ? resume : undefined}
        tip={tip}
        forCreator={forCreator}
        globalStop={globalStop}
        opensSettings={forOwner}
      />

      <BackupBanner enabled={forOwner} />

      {/* The night's alerts and where they go are the team's (Réglages › Telegram). */}
      {forCreator ? null : <NightBanner night={data.telegram} creatorName={data.creator.name} />}

      {sales === null ? null : (
        <>
          <Section title="Ventes" sub={salesSub(period)} index={2} control={periodControl}>
            <SalesPanel period={period} sales={sales} tip={tip} />
          </Section>

          <Section title="Parcours des fans" sub={FUNNEL_SUB[period]} index={3}>
            <FunnelPanel key={period} counts={sales.funnel.counts} before={sales.funnel.before} tip={tip} />
          </Section>
        </>
      )}

      {forCreator ? null : (
        <Section
          title="Meilleurs fans"
          sub="ce qu’ils ont dépensé : d’abord la part de l’agent, puis celle des chatteurs"
          index={2}
          control={sales === null ? periodControl : undefined}
        >
          <TopFans
            fans={data.fans}
            tip={tip}
            onOpen={opensTracking ? openFan : undefined}
            usdNote={data.usdNote}
          />
        </Section>
      )}

      {/* Until Reveal's purchases are observed, one quiet line says where the sales are read, no block (DASH-02). */}
      {sales === null ? (
        <p className="db-salesnote nv-enter" style={{ '--nv-i': 3 }}>
          Ventes : bientôt lues depuis Reveal.
        </p>
      ) : null}

      {tip.element}
    </div>
  );
}
