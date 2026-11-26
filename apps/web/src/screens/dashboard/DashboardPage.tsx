import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, type JSX, type ReactNode } from 'react';

import { AgentHero } from './AgentHero';
import { AutomaticConfirm } from './AutomaticConfirm';
import { CreatorPicker } from './CreatorPicker';
import { AGENT_PATH, FunnelPanel } from './Funnel';
import { ModeControl } from './ModeControl';
import { OwnerDecisions } from './OwnerDecisions';
import { RevealSalesPanel } from './RevealSales';
import { PeriodControl, SalesPanel, salesSub } from './Sales';
import { TodoCard } from './TodoCard';
import { TopFans } from './TopFans';
import { AgencyInsightsPanel } from './agency/AgencyInsights';
import { SteeringPanel } from './agency/Steering';
import type { AgencySelection } from './agency/period';
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
import { PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

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
 * The address names a creator the account does not list, archived or unknown: the screen says so and shows nothing of
 * another one, neither her figures nor her agent's mode control (recette 16/11, PIL-01). One way out, to a page that exists.
 */
function Missing({ label, onLeave }: { label: string; onLeave: (() => void) | undefined }): JSX.Element {
  return (
    <Alone
      tone="idle"
      headline="Créatrice **introuvable**"
      lead="Elle est archivée, ou ce lien n’est plus bon. Rien d’une autre créatrice n’est affiché à sa place."
    >
      {onLeave === undefined ? null : (
        <button type="button" className="nv-btn nv-btn--soft" onClick={onLeave}>
          {label}
        </button>
      )}
    </Alone>
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
      <PageHeader title="Dashboard" />
      {creatorName === null ? null : (
        <header className="db-top nv-enter">
          {/* Another creator's Dashboard may still answer: the choice stays at hand. */}
          {agency === undefined ? <CreatorPicker onChoose={onCreator} /> : null}
          <div className="db-top__who">
            <span className="db-top__av" aria-hidden="true">
              {initialOf(creatorName)}
            </span>
            <span className="db-top__name">{creatorName}</span>
          </div>
        </header>
      )}
      {/* The same face as on Aujourd'hui (DASH-22): the sentence, what it holds back, « Réessayer ». */}
      <Failure
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
 * No creator yet (first launch): what to do, never a page of made-up figures (DASH-13). The owner, who alone adds one,
 * is led to Créatrices; a manager or an operator reads that none is entrusted to him yet.
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
      headline="Aucune créatrice **ne t’est confiée**"
      lead="C’est le propriétaire de l’agence qui te les confie. Elles apparaîtront ici."
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
  asked,
  onLeave,
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
  /** The owner, who alone adds a creator: before any creator, the screen leads him to Créatrices (DASH-13). */
  canAddCreator?: boolean;
  /** The owner's and an active manager's: her figures from the register lead the page (ADR 0078). */
  agency?: AgencyView;
  /** The creator the address names (`?creatrice=`): her Dashboard, or the sentence that she is not found (PIL-01). */
  asked?: string | undefined;
  /** Out of a creator who is not found, to the Dashboard of the one followed. */
  onLeave?: () => void;
}): JSX.Element {
  const view = useDashboard(period, forOwner ? 'owner' : 'team', asked ?? null);
  if (view.status === 'loading') {
    return (
      <div className="db" aria-busy="true">
        <PageHeader title="Dashboard" />
        {/* The chips keep their place while her Dashboard loads: nothing jumps when it comes (ADM-21). */}
        <div className="db-loading nv-plate" aria-label="Chargement du Dashboard" role="status" />
      </div>
    );
  }
  if (view.status === 'offline')
    return <Offline creatorName={view.creatorName} onCreator={onCreator} agency={agency} />;
  if (view.status === 'empty') return <NoCreator canAddCreator={canAddCreator} />;
  if (view.status === 'missing')
    return agency === undefined ? (
      <Missing label="Revenir au Dashboard" onLeave={onLeave} />
    ) : (
      <Missing label="Voir toute l’agence" onLeave={agency.onAgency} />
    );
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
  readonly selection: AgencySelection;
  readonly onSelection: (selection: AgencySelection) => void;
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
  const several = agency === undefined && (creators?.length ?? 0) >= 2;
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
      {/* The screen's title, as on every other one: the agent's state is a block under it, never the page's title
          (recette visuelle 16/11, COH-07). */}
      <PageHeader title="Dashboard" />
      <header className="db-top nv-enter">
        {/* Whose agent this is, when the account sees several: the pill and Suivi follow the same choice. */}
        {/* The owner and an active manager choose her in the menu's selector instead (ADR 0134 § 3). */}
        {agency === undefined ? <CreatorPicker onChoose={onCreator} /> : null}
        <div className="db-top__who">
          {several ? null : (
            <CreatorFace
              creator={{ id: creatorId, displayName: data.creator.name, hasAvatar: hasPhoto }}
              className="db-top__av"
            />
          )}
          <span>
            {several ? null : <span className="db-top__name">{data.creator.name}</span>}
            {/* What the hour is: hers, now (recette 11/11, ADM-27). */}
            <span className="db-top__when">Chez elle : {data.creator.now}</span>
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

      {/* Read top to bottom (recette visuelle 16/11, PIL-01 and PIL-04): her agent's state and what waits for a human,
          then the figures, then what the agency runs. */}
      {agentHero}

      {/* Who is warned of an urgency at night: part of her agent's state, said right under it. The night's alerts and
          where they go are the owner's to set (Réglages › Bots Telegram): anyone else reads it. */}
      <NightBanner night={data.telegram} creatorName={data.creator.name} opensSettings={forOwner} />

      {/* A creator chosen from the agency: her figures from the register, under her agent (recette 06/11). */}
      {agency === undefined ? null : (
        <SteeringPanel creatorId={creatorId} opensTracking={opensTracking} tip={tip} index={2} />
      )}
      {agency === undefined ? null : (
        <AgencyInsightsPanel
          index={5}
          selection={agency.selection}
          onSelection={agency.onSelection}
          creatorId={creatorId}
          creatorName={data.creator.name}
          canOpenSettings={agency.canOpenSettings}
          tip={tip}
        />
      )}

      {sales === null ? null : (
        <>
          <Section title="Ventes" sub={salesSub(period)} index={2} control={periodControl}>
            <SalesPanel period={period} sales={sales} tip={tip} />
          </Section>

          <Section title="Parcours des fans" sub={FUNNEL_SUB[period]} index={3}>
            <FunnelPanel
              key={period}
              labels={AGENT_PATH}
              counts={sales.funnel.counts}
              before={sales.funnel.before}
              tip={tip}
            />
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

      {/* What the agency runs comes after the figures. On a creator chosen from the agency, the export, the invoices and
          the reports are the agency's, said on its own view, not under each creator (PIL-04). The day's AI budget is
          never on this screen: on « Toute l'agence » for the owner and an active manager, in Réglages › Consommation IA,
          never to an operator who can set nothing of it (PIL-27). */}
      {/* The export, the invoices and the documents are the owner's to settle (OPS-02, EQ-06 lot 8d), the reports that
          wait are their reviewer's (ADR 0073): one card, « À faire » (W3). */}
      {agency === undefined ? <TodoCard forOwner={forOwner} reviewsReports={reviewsReports} /> : null}
      {/* What she has not answered yet, the owner answering in her place (INS-05): nothing if nothing waits. */}
      {forOwner ? (
        <OwnerDecisions creators={creators?.filter((one) => one.id === creatorId) ?? []} showWho={false} />
      ) : null}

      {tip.element}
    </div>
  );
}
