import type { AgencyPeriod } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, type JSX, type ReactNode } from 'react';

import { AgencyStrip } from './AgencyStrip';
import { AgentHero } from './AgentHero';
import { AutomaticConfirm } from './AutomaticConfirm';
import { BackupBanner } from './BackupBanner';
import { CreatorPicker } from './CreatorPicker';
import { FunnelPanel } from './Funnel';
import { ModeControl } from './ModeControl';
import { PaperworkBanner } from './PaperworkBanner';
import { ReportsBanner } from './ReportsBanner';
import { RevealSalesPanel } from './RevealSales';
import { PeriodControl, SalesPanel, salesSub } from './Sales';
import { TopFans } from './TopFans';
import { AgencyInsightsPanel } from './agency/AgencyInsights';
import { agentRuns, litParts } from './logic';
import type { Fan, Period, Todo, Tone } from './model';
import { Section, TONE_COLOR, useFloatingTip } from './parts';
import { useDashboard, type DashboardView } from './useDashboard';
import './dashboard.css';

import { useAgentModeWriter } from '@/agent/write';
import { CreatorFace } from '@/creators/CreatorFace';
import { useCreators } from '@/creators/api';
import { initialOf } from '@/lib/utils';
import { NightBanner } from '@/settings/telegram/NightBanner';
import { ServerSilent } from '@/shell/ServerSilent';

/** Why the control cannot change the mode under an operator's global switch: the hero says it too (DASH-08). */
const GLOBAL_NOTE =
  'Un arrêt général retient l’agent pour toutes les créatrices : seul un opérateur peut le lever.';

/** The days of Reveal's register the panel sums, each sale on its own day (CRM-04 lot c). */
const REVEAL_SUB: Record<Period, string> = {
  day: 'depuis minuit, au centime près',
  week: 'les 7 derniers jours, au centime près',
  month: 'les 30 derniers jours, au centime près',
};

/** The agent's period, said on its blocks under the agency's figures: three months read as 30 days (ADR 0078 § 3). */
const AGENT_SPAN: Record<Period, string> = {
  day: 'aujourd’hui',
  week: 'ces 7 jours',
  month: 'ces 30 jours',
};

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
function Offline({
  creatorName,
  onCreator,
  agency,
}: {
  creatorName: string | null;
  onCreator: ((creatorId: string) => void) | undefined;
  agency: AgencyView | undefined;
}): JSX.Element {
  const client = useQueryClient();
  return (
    <div className="db">
      {creatorName === null ? null : (
        <header className="db-top nv-enter">
          {/* Another creator's Dashboard may still answer: the choice stays at hand. */}
          <CreatorPicker
            onChoose={onCreator}
            agency={agency === undefined ? undefined : { selected: false, onChoose: agency.onAgency }}
          />
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
export function NoCreator({ canAddCreator }: { canAddCreator: boolean }): JSX.Element {
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
 * The agency's screen: the creator reads her own Aujourd'hui (ADR 0042 § 8), and the server refuses her this one.
 */
export function DashboardPage({
  period,
  onPeriod,
  onCreator,
  forOwner = false,
  reviewsReports = false,
  opensTracking = false,
  canAddCreator = false,
  agency,
}: {
  /** The period of the sales, the fans' path, the best fans and the reply delay: from the address (`?periode=`). */
  period: Period;
  onPeriod: (period: Period) => void;
  /** Another creator chosen on the chips: the address names her (`?creatrice=`, PRO-28). */
  onCreator?: (creatorId: string) => void;
  /** The owner also reads the state of the daily export (OPS-02), the one figure that is the owner's alone. */
  forOwner?: boolean;
  /** The account reviews the team's reports (its rail holds Équipe): what waits on it is said here (ADR 0073). */
  reviewsReports?: boolean;
  /** The account's rail holds Suivi: a best fan opens his conversation there (DASH-14). */
  opensTracking?: boolean;
  /** The account's rail holds Créatrices: before any creator, the screen leads there (DASH-13). */
  canAddCreator?: boolean;
  /** The owner's and an active manager's: her figures from the register lead the page (ADR 0078). */
  agency?: AgencyView;
}): JSX.Element {
  const view = useDashboard(period, forOwner ? 'owner' : 'team');
  if (view.status === 'loading') {
    return (
      <div className="db" aria-busy="true">
        <div className="db-loading nv-plate" aria-label="Chargement du Dashboard" role="status" />
      </div>
    );
  }
  if (view.status === 'offline')
    return <Offline creatorName={view.creatorName} onCreator={onCreator} agency={agency} />;
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  return (
    <Loaded
      view={view}
      period={period}
      onPeriod={onPeriod}
      onCreator={onCreator}
      forOwner={forOwner}
      reviewsReports={reviewsReports}
      opensTracking={opensTracking}
      agency={agency}
    />
  );
}

/** The agency's figures on a creator's Dashboard (ADR 0078): their period, and the way back to the whole agency. */
export interface AgencyView {
  readonly period: AgencyPeriod;
  readonly onPeriod: (period: AgencyPeriod) => void;
  readonly onAgency: () => void;
  readonly canOpenSettings: boolean;
}

function Loaded({
  view: { creatorId, globalStop, readAt, data, mode, automatic },
  period,
  onPeriod,
  onCreator,
  forOwner,
  reviewsReports,
  opensTracking,
  agency,
}: {
  view: Extract<DashboardView, { status: 'live' }>;
  period: Period;
  onPeriod: (period: Period) => void;
  onCreator: ((creatorId: string) => void) | undefined;
  forOwner: boolean;
  reviewsReports: boolean;
  opensTracking: boolean;
  agency: AgencyView | undefined;
}): JSX.Element {
  const tip = useFloatingTip();
  const sales = data.sales?.[period] ?? null;
  // With several creators the chips above name her: the header does not say her name a second time (DASH-03).
  const creators = useCreators().data;
  const several = (creators?.length ?? 0) >= 2;
  // Her photo copied at her import (CRM-07 b2), read in the list: the Dashboard's answer does not carry it.
  const hasPhoto = creators?.find((one) => one.id === creatorId)?.hasAvatar === true;

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

  // With the agency's figures above, their control sets the period of the whole page: none down here.
  const periodControl =
    agency === undefined ? <PeriodControl period={period} onChange={onPeriod} /> : undefined;
  // Three months read as 30 days in the agent's blocks: their lines say so (ADR 0078 § 3).
  const agentHero = (
    <AgentHero
      agent={data.agent}
      mode={mode}
      todos={data.todos}
      onOpen={openTodo}
      onResume={globalStop ? undefined : resume}
      tip={tip}
      globalStop={globalStop}
      opensSettings={forOwner}
    />
  );
  return (
    <div className="db">
      <header className="db-top nv-enter">
        {/* Whose agent this is, when the account sees several: the pill and Suivi follow the same choice. */}
        <CreatorPicker
          onChoose={onCreator}
          agency={agency === undefined ? undefined : { selected: false, onChoose: agency.onAgency }}
        />
        <div className="db-top__who">
          {several ? null : (
            <CreatorFace
              creator={{ id: creatorId, displayName: data.creator.name, hasAvatar: hasPhoto }}
              className="db-top__av"
            />
          )}
          <span>
            {several ? null : <span className="db-top__name">{data.creator.name}</span>}
            <span className="db-top__when">
              {data.creator.platform} · {data.creator.now}
            </span>
          </span>
        </div>
        {/* The mode changes once the server has made the change (PUT /v1/agent/mode). */}
        <ModeControl
          mode={mode}
          automatic={automatic}
          creatorName={data.creator.name}
          tip={tip}
          readOnly={globalStop ? GLOBAL_NOTE : null}
          running={running}
          onChange={setMode}
        />
        {writer.asking ? (
          <AutomaticConfirm
            creatorName={data.creator.name}
            onConfirmed={writer.confirmed}
            onCancel={writer.cancelled}
          />
        ) : null}
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

      {/* A creator chosen from the agency: her figures first, the agency's cards after (recette 06/11). */}
      {agency === undefined ? (
        agentHero
      ) : (
        <AgencyInsightsPanel
          period={agency.period}
          onPeriod={agency.onPeriod}
          creatorId={creatorId}
          creatorName={data.creator.name}
          canOpenSettings={agency.canOpenSettings}
          tip={tip}
        />
      )}

      <BackupBanner enabled={forOwner} />

      {/* The invoices' due dates, contests and documents to check: the owner's to settle (EQ-06 lot 8d). */}
      <PaperworkBanner enabled={forOwner} />

      {/* The reports that wait on the agency, never left unseen in the queue: the owner's and an active manager's to
          decide (ADR 0073). */}
      <ReportsBanner enabled={reviewsReports} />

      {/* The night's alerts and where they go are the owner's to set (Réglages › Telegram): anyone else reads it. */}
      <NightBanner night={data.telegram} creatorName={data.creator.name} opensSettings={forOwner} />

      {/* The AI budget and the stuck jobs of no creator are the agency's, not her agent's health (reco 18, PRO-10). */}
      <AgencyStrip agency={data.agency} />

      {agency === undefined ? null : agentHero}

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

      {/* The platform's register, read by its API (CRM-04 lot c): the period's figures as it gives them, who sold for the
        owner and an active manager. Never on her Dashboard: the server sends her none. */}
      {/* With the agency's figures above, who sold is said there, richer: not a second time here. */}
      {data.revealSales === null || agency !== undefined ? null : (
        <Section
          title={`Ventes lues chez ${data.revealSales.where}`}
          sub={REVEAL_SUB[period]}
          index={sales === null ? 2 : 4}
          control={sales === null ? periodControl : undefined}
        >
          <RevealSalesPanel sales={data.revealSales} creatorName={data.creator.name} tip={tip} />
        </Section>
      )}

      <Section
        title="Meilleurs fans"
        sub={
          agency === undefined
            ? 'ce qu’ils ont dépensé : d’abord la part de l’agent, puis celle des chatteurs'
            : `les achats vus dans ses conversations ${AGENT_SPAN[period]} : d’abord la part de l’agent, puis celle des chatteurs`
        }
        index={(sales === null ? 2 : 4) + (data.revealSales === null || agency !== undefined ? 0 : 1)}
        control={sales === null && data.revealSales === null ? periodControl : undefined}
      >
        <TopFans
          fans={data.fans}
          tip={tip}
          onOpen={opensTracking ? openFan : undefined}
          usdNote={data.usdNote}
          {...(agency === undefined
            ? {}
            : {
                empty:
                  'Aucun achat vu dans ses conversations : elles se lisent une fois la session Reveal capturée. Les ventes du registre sont plus haut.',
              })}
        />
      </Section>

      {/* Until Reveal's purchases are observed, nothing stands for the sales: no « bientôt » line (recette 05/11, PRO-24). */}

      {tip.element}
    </div>
  );
}
