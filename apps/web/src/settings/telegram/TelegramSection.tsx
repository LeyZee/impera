import type {
  TelegramBot,
  TelegramChat,
  TelegramChatId,
  TelegramDelivery,
  TelegramOverview,
  TelegramRoute,
  TelegramTopic,
} from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';

import { distinctNames } from '../names';
import { ReauthRequired } from '../services/api';

import { BotSheet, type SheetMode } from './BotSheet';
import { GroupPreview, PreviewMessage } from './Preview';
import { Reauth } from './Reauth';
import {
  TelegramForbidden,
  TelegramOff,
  fetchDeliveries,
  fetchOverview,
  removeBot,
  removeChat,
  saveRoutes,
  sendTest,
} from './api';
import {
  ALERT_TOPICS,
  botLine,
  chatChoices,
  chatLine,
  goneChats,
  goneLine,
  clockLabel,
  coverOf,
  deliveryLabel,
  healthOf,
  hourLabel,
  initials,
  plural,
  routeState,
  toggleRoute,
  topicsOfChat,
  TOPICS,
  type ChatChoice,
  type Scope,
} from './model';
import type { TelegramTab } from './search';
import './telegram.css';

import { creatorsSearch } from '@/creators/search';

/** The topics of the Alertes tab, her own alerts with them: what « Dernières alertes » lists. */
const ALERT_TOPIC_SET: ReadonlySet<TelegramTopic> = new Set(ALERT_TOPICS);

/** The page refreshes on its own: a bot removed from a group turns orange without a reload. */
const REFRESH_MS = 30_000;
const OFFLINE = 'Le serveur ne répond pas. Réessaie dans un instant.';

type Load =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'off' }
  | { kind: 'forbidden' }
  | { kind: 'ready'; overview: TelegramOverview };
type Tab = TelegramTab;

const TABS: readonly { key: Tab; label: string }[] = [
  // Not « Alertes »: Réglages › Alertes is where an alert is written; this tab says who gets which level.
  { key: 'alerts', label: 'Qui est prévenu' },
  { key: 'sales', label: 'Ventes' },
  { key: 'validations', label: 'Validations' },
  { key: 'bots', label: 'Bots et groupes' },
];

/**
 * Réglages › Telegram (fiche P3-07, ADR 0020): who gets which alert, in which group, through which bot. One tab per
 * kind of message, plus the bots. Nothing on this page ever shows a token or a fan's words.
 */
export function TelegramSection({
  tab: shownTab,
  onTab,
}: {
  /** The tab of the address (`?onglet=`); left out, the page keeps its own. */
  tab?: Tab;
  onTab?: (tab: Tab) => void;
} = {}): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [deliveries, setDeliveries] = useState<readonly TelegramDelivery[]>([]);
  const [ownTab, setOwnTab] = useState<Tab>('alerts');
  const tab = shownTab ?? ownTab;
  const setTab = onTab ?? setOwnTab;
  const [scope, setScope] = useState<Scope>('all');
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  /** Only the latest refresh may land: an older answer arriving late would show a stale state. */
  const latest = useRef(0);
  /** Route saves run one after the other, each with the version the previous one returned. */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const version = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const overview = await fetchOverview();
      if (ticket !== latest.current) return;
      version.current = overview.version;
      // Two creators of the same name stay apart on the chips.
      const coverage = distinctNames(overview.coverage, (creator) => creator.creatorId);
      setLoad({ kind: 'ready', overview: { ...overview, coverage } });
      setNow(new Date());
    } catch (error) {
      if (ticket !== latest.current) return;
      if (error instanceof TelegramOff) {
        setLoad({ kind: 'off' });
        return;
      }
      if (error instanceof TelegramForbidden) {
        setLoad({ kind: 'forbidden' });
        return;
      }
      setLoad((current) => (current.kind === 'ready' ? current : { kind: 'failed' }));
    }
    fetchDeliveries().then(setDeliveries, () => undefined);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // Neither a sheet open nor a page the server refuses (not the owner) is read again on a timer.
    if (sheet !== null || load.kind === 'forbidden') return undefined;
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh, sheet, load.kind]);

  /** Shows the new routing at once, then saves it; a refusal puts back what the server holds. */
  const applyRoutes = useCallback(
    (next: TelegramRoute[]): void => {
      setNotice(null);
      setLoad((current) =>
        current.kind === 'ready'
          ? { kind: 'ready', overview: { ...current.overview, routes: next } }
          : current,
      );
      saving.current = saving.current.then(async () => {
        try {
          const result = await saveRoutes(version.current, next);
          if (result.ok) {
            version.current = result.value.version;
            return;
          }
          setNotice(
            result.refusal.kind === 'routes_version_conflict'
              ? 'Quelqu’un a changé ces réglages en même temps que toi. Voici les siens : refais ton choix si besoin.'
              : result.refusal.message,
          );
        } catch {
          setNotice(`Le choix n’a pas été enregistré. ${OFFLINE}`);
        }
        await refresh();
      });
    },
    [refresh],
  );

  const closeSheet = useCallback(() => {
    setSheet(null);
    void refresh();
  }, [refresh]);

  if (load.kind !== 'ready') {
    return (
      <section className="tg-page" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? (
          <div className="nv-plate tg-cover" data-state="warn">
            <div>
              <p className="tg-cover__title">Le serveur ne répond pas</p>
              <p className="tg-cover__sub">
                Les bots et les groupes n’ont pas pu être lus. Réessaie dans un instant.
              </p>
              <button type="button" className="nv-btn nv-btn--soft tg-top" onClick={() => void refresh()}>
                Réessayer
              </button>
            </div>
          </div>
        ) : null}
        {load.kind === 'forbidden' ? (
          <div className="nv-plate tg-cover">
            <div>
              <p className="tg-cover__title">Seul le propriétaire règle Telegram</p>
              <p className="tg-cover__sub">
                Les bots, les groupes et qui reçoit quelles alertes se règlent depuis son compte.
              </p>
            </div>
          </div>
        ) : null}
        {load.kind === 'off' ? (
          <div className="nv-plate tg-cover" data-state="warn">
            <div>
              <p className="tg-cover__title">Telegram n’est pas activé sur ce serveur</p>
              <p className="tg-cover__sub">
                C’est un réglage d’installation, fait une seule fois par la personne qui héberge Nirvana.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  const { overview } = load;
  const choices = chatChoices(overview.bots);
  const toggle = (topic: TelegramTopic, chatId: TelegramChatId, at: Scope = scope): void => {
    applyRoutes(toggleRoute(overview.routes, at, topic, chatId));
  };
  const openAdd = (): void => {
    setSheet({ kind: 'add' });
  };
  const openBots = (): void => {
    setTab('bots');
  };
  const lede = (
    <p className="tg-lede">
      Ce qui mérite ton attention arrive dans tes groupes Telegram. Les messages des fans ne quittent jamais
      Nirvana.
    </p>
  );
  const sheetView =
    sheet === null ? null : <BotSheet mode={sheet} onChanged={() => void refresh()} onClose={closeSheet} />;
  // Until a group has received something, each tab opens its example of what the group will read.
  const isExampleOpen = choices.every((c) => c.chat.lastSentAt === null);

  // No bot yet: one empty state and its one action, no strip, no tabs, no table of empty rows (recette du 29/10).
  if (overview.bots.length === 0) {
    return (
      <section className="tg-page">
        {lede}
        <section className="nv-plate tg-empty">
          <div className="tg-bot__icon" aria-hidden="true">
            <TelegramGlyph />
          </div>
          <p className="tg-cover__title">{coverOf(overview).title}</p>
          <p className="tg-cover__sub">
            Un bot Telegram se crée en une minute avec @BotFather, puis tu le mets dans un groupe : les
            urgences y arriveront, même à 3 h du matin. Nirvana te guide pas à pas.
          </p>
          <button type="button" className="nv-btn nv-btn--neon" onClick={openAdd}>
            Ajouter un bot
          </button>
        </section>
        {sheetView}
      </section>
    );
  }

  return (
    <section className="tg-page">
      {lede}

      <HealthStrip overview={overview} onFix={setTab} />

      <TabBar tab={tab} onTab={setTab} />

      <div
        className="tg-panel"
        role="tabpanel"
        id={`tg-panel-${tab}`}
        aria-labelledby={`tg-tab-${tab}`}
        key={tab}
      >
        {tab === 'alerts' ? (
          <AlertsTab
            overview={overview}
            choices={choices}
            deliveries={deliveries}
            scope={scope}
            onScope={setScope}
            onToggle={toggle}
            onAdd={openAdd}
            onRepair={openBots}
            isExampleOpen={isExampleOpen}
          />
        ) : tab === 'sales' ? (
          <SalesTab
            overview={overview}
            choices={choices}
            scope={scope}
            onScope={setScope}
            onToggle={toggle}
            onAdd={openAdd}
            onRepair={openBots}
            isExampleOpen={isExampleOpen}
          />
        ) : tab === 'validations' ? (
          <ValidationsTab
            overview={overview}
            choices={choices}
            scope={scope}
            onScope={setScope}
            onToggle={toggle}
            onAdd={openAdd}
            onRepair={openBots}
            isExampleOpen={isExampleOpen}
          />
        ) : (
          <BotsTab
            overview={overview}
            now={now}
            onSheet={setSheet}
            onChanged={() => void refresh()}
            onAdd={openAdd}
          />
        )}
      </div>

      {notice === null ? null : (
        <p className="tg-notice" role="alert">
          {notice}
        </p>
      )}

      {sheetView}
    </section>
  );
}

/** The tab named on the strip when something is to fix there. */
const FIX_TAB_LABEL: Record<'bots' | 'alerts', string> = {
  bots: 'Bots et groupes',
  alerts: 'Qui est prévenu',
};

/** The state of Telegram in one line; when something is broken, the whole strip leads to where it is fixed. */
function HealthStrip({
  overview,
  onFix,
}: {
  overview: TelegramOverview;
  onFix: (tab: Tab) => void;
}): JSX.Element {
  const health = healthOf(overview);
  const fix = health.fix;
  const content = (
    <>
      <span className="tg-health__item">
        <span className="tg-state-dot" data-tone={health.tone} />
        <b>{health.label}</b>
      </span>
      {/* The counts stay on a wide screen; a phone keeps the state and the last send (telegram.css). */}
      <span className="tg-health__sep tg-health__count" />
      <span className="tg-health__item tg-health__count">
        <b>{health.botCount}</b> {health.botCount > 1 ? 'bots' : 'bot'}
      </span>
      <span className="tg-health__item tg-health__count">
        <b>{health.groupCount}</b> {health.groupCount > 1 ? 'groupes' : 'groupe'}
      </span>
      {health.lastSentAt === null ? null : (
        <>
          <span className="tg-health__sep" />
          <span className="tg-health__item">
            Dernier envoi <b>{hourLabel(health.lastSentAt)}</b>
          </span>
        </>
      )}
      {fix === null ? null : <span className="tg-health__go">{FIX_TAB_LABEL[fix]} →</span>}
    </>
  );
  if (fix === null) {
    return (
      <div className="nv-plate tg-health" aria-label="État de Telegram">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="nv-plate tg-health tg-health--link"
      data-tone={health.tone}
      onClick={() => {
        onFix(fix);
      }}
    >
      {content}
    </button>
  );
}

/** Tabs with the arrow keys, Home and End (WAI-ARIA tabs pattern, automatic activation). */
function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }): JSX.Element {
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = TABS.findIndex((t) => t.key === tab);
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : null;
    const next = to === null ? undefined : TABS[to];
    if (next === undefined) return;
    event.preventDefault();
    onTab(next.key);
    document.getElementById(`tg-tab-${next.key}`)?.focus();
  };
  return (
    <div className="nv-glass tg-tabs" role="tablist" aria-label="Sections Telegram" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button
          key={t.key}
          id={`tg-tab-${t.key}`}
          type="button"
          role="tab"
          className="tg-tab"
          aria-selected={t.key === tab}
          aria-controls={`tg-panel-${t.key}`}
          tabIndex={t.key === tab ? 0 : -1}
          onClick={(event) => {
            onTab(t.key);
            // On a phone the bar scrolls sideways: the chosen tab comes fully into view.
            event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }}
        >
          <TabIcon tab={t.key} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }): JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (tab) {
    case 'alerts':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
        </svg>
      );
    case 'sales':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.7.8-2.7 2 0 2.9 5.7 1.6 5.7 4.4 0 1.2-1.2 2-2.9 2-1.3 0-2.4-.5-2.9-1.5M12 6v1.8M12 16.2V18" />
        </svg>
      );
    case 'validations':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="5" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5" />
        </svg>
      );
    case 'bots':
      return <TelegramGlyph />;
  }
}

function TelegramGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 4.3 2.9 11.4c-1.2.5-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.7 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.4-1.3z" />
    </svg>
  );
}

function InfoGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

interface RoutingProps {
  readonly overview: TelegramOverview;
  readonly choices: readonly ChatChoice[];
  readonly onToggle: (topic: TelegramTopic, chatId: TelegramChatId, at?: Scope) => void;
  readonly onAdd: () => void;
  /** Opens Bots et groupes, where a refused bot is repaired. */
  readonly onRepair: () => void;
  /** The example of a message starts open while no group has received anything yet. */
  readonly isExampleOpen: boolean;
}

interface ScopedProps extends RoutingProps {
  readonly scope: Scope;
  readonly onScope: (scope: Scope) => void;
}

/** « Toutes les créatrices », then one chip per creator. */
function ScopePicker({
  overview,
  scope,
  onScope,
}: {
  overview: TelegramOverview;
  scope: Scope;
  onScope: (scope: Scope) => void;
}): JSX.Element {
  return (
    <div className="tg-scope" role="radiogroup" aria-label="Créatrice">
      <button
        type="button"
        role="radio"
        className="nv-chip"
        aria-checked={scope === 'all'}
        onClick={() => {
          onScope('all');
        }}
      >
        Toutes les créatrices
      </button>
      {overview.coverage.map((creator) => (
        <button
          key={creator.creatorId}
          type="button"
          role="radio"
          className="nv-chip"
          aria-checked={scope === creator.creatorId}
          onClick={() => {
            onScope(creator.creatorId);
          }}
        >
          {creator.displayName}
        </button>
      ))}
    </div>
  );
}

function scopeName(overview: TelegramOverview, scope: Scope): string | null {
  return scope === 'all' ? null : (overview.coverage.find((c) => c.creatorId === scope)?.displayName ?? null);
}

/** The groups a topic goes to, as chips; a creator's line shows the « toutes » groups as already on. */
function ChatChips({
  overview,
  choices,
  scope,
  topic,
  onToggle,
  onAdd,
  onRepair,
}: RoutingProps & { scope: Scope; topic: TelegramTopic }): JSX.Element {
  const reachable = choices.filter((c) => c.isReachable);
  // Groups that exist but cannot be written to: a new bot would not help, the one in place needs fixing.
  if (reachable.length === 0 && choices.length > 0) {
    return (
      <button type="button" className="nv-btn nv-btn--plain nv-btn--sm tg-self-start" onClick={onRepair}>
        {choices.some((c) => c.bot.state !== 'active') ? 'Réparer le bot' : 'Voir les groupes'}
      </button>
    );
  }
  if (reachable.length === 0) {
    return (
      <button type="button" className="nv-btn nv-btn--plain nv-btn--sm tg-self-start" onClick={onAdd}>
        Mettre un bot dans un groupe
      </button>
    );
  }
  return (
    <div className="tg-chips" role="group" aria-label={`Groupes pour ${TOPICS[topic].label}`}>
      {reachable.map(({ chat }) => {
        const state = routeState(overview.routes, scope, topic, chat.id);
        return (
          <button
            key={chat.id}
            type="button"
            role="checkbox"
            className="tg-gchip"
            aria-checked={state !== 'off'}
            data-inherited={state === 'inherited'}
            disabled={state === 'inherited'}
            title={state === 'inherited' ? 'Déjà reçu pour toutes les créatrices' : undefined}
            onClick={() => {
              onToggle(topic, chat.id, scope);
            }}
          >
            <span className="tg-av">{initials(chat.title)}</span>
            <span>{chat.title}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The topic goes to at least one group someone can read, for this scope. */
function reachesAGroup(routing: RoutingProps, scope: Scope, topic: TelegramTopic): boolean {
  return routing.choices.some(
    (c) => c.isReachable && routeState(routing.overview.routes, scope, topic, c.chat.id) !== 'off',
  );
}

function RoutingList({
  topics,
  scope,
  ...routing
}: RoutingProps & { topics: readonly TelegramTopic[]; scope: Scope }): JSX.Element {
  return (
    <div className="nv-plate">
      <div className="nv-list">
        {topics.map((topic) => (
          <div className="tg-route" key={topic}>
            <div className="tg-lvl">
              <b>
                <span className="tg-dot" data-topic={topic} />
                {TOPICS[topic].label}
              </b>
              <small>{TOPICS[topic].sub}</small>
              {topic === 'keyword' ? (
                <>
                  <small>
                    Un mot de sa Persona arrête l’agent pour ce fan ; le groupe reçoit le mot trouvé et un
                    lien, jamais le message.{' '}
                    <Link
                      className="tg-route__link"
                      to="/creatrices"
                      search={creatorsSearch('persona', scope === 'all' ? null : scope)}
                    >
                      Modifier les mots dans la Persona
                    </Link>
                  </small>
                  {!reachesAGroup(routing, scope, topic) ? (
                    <small className="tg-route__warn">
                      Sans groupe choisi ici, un mot-clé ne prévient personne sur Telegram.
                    </small>
                  ) : null}
                </>
              ) : null}
            </div>
            <ChatChips {...routing} scope={scope} topic={topic} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertsTab({
  deliveries,
  scope,
  onScope,
  ...routing
}: ScopedProps & { deliveries: readonly TelegramDelivery[] }): JSX.Element {
  const { overview } = routing;
  const cover = coverOf(overview);
  const name = scopeName(overview, scope);
  const alerts = deliveries.filter((d) => ALERT_TOPIC_SET.has(d.topic));
  const shown = alerts.slice(0, 8);
  const failed = shown.filter((d) => !deliveryLabel(d).isOk).length;
  return (
    <>
      <section className="nv-plate tg-cover" data-state={cover.isOk ? 'ok' : 'warn'} aria-live="polite">
        <div className="tg-cover__orb">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
            {cover.isOk ? <path d="M8.5 12l2.5 2.5 4.5-5" /> : <path d="M12 8v5M12 16h.01" />}
          </svg>
        </div>
        <div>
          <p className="tg-cover__title">{cover.title}</p>
          <p className="tg-cover__sub">{cover.sub}</p>
        </div>
      </section>

      {shown.length === 0 ? null : (
        <section>
          <details className="nv-disclosure nv-plate" open={failed > 0}>
            <summary>
              <span className="nv-disclosure__title">Dernières alertes</span>
              <span className="nv-disclosure__sum">
                {failed === 0
                  ? `${plural(shown.length, 'alerte')}, toutes livrées`
                  : `${plural(shown.length, 'alerte')}, ${String(failed)} à regarder`}
              </span>
            </summary>
            <div className="nv-disclosure__body">
              <div className="nv-list">
                {shown.map((delivery) => {
                  const label = deliveryLabel(delivery);
                  return (
                    <div className="tg-log" key={delivery.id}>
                      <time dateTime={delivery.createdAt}>{clockLabel(delivery.createdAt)}</time>
                      <span className="tg-dot" data-topic={delivery.topic} />
                      <p>
                        {delivery.summary}
                        <small> · {delivery.chatTitle}</small>
                      </p>
                      <em data-ok={label.isOk}>{label.text}</em>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>
        </section>
      )}

      <section>
        <p className="tg-eyebrow">
          Qui reçoit quoi{' '}
          <span>{name === null ? 'Pour toutes les créatrices' : `Pour ${name}, en plus de « toutes »`}</span>
        </p>
        <ScopePicker overview={overview} scope={scope} onScope={onScope} />
        <RoutingList {...routing} topics={ALERT_TOPICS} scope={scope} />
      </section>

      <GroupPreview
        isOpen={routing.isExampleOpen}
        group="Astreinte"
        heading="Pensé pour être lu à 3 h du matin"
        points={[
          'Le niveau, la créatrice, la raison, et un seul lien.',
          'Quand quelqu’un prend la main, le message se met à jour pour tout le groupe.',
          'Le retour à la normale arrive en réponse, sans sonner.',
          'Plusieurs alertes d’un coup sont regroupées en un message.',
        ]}
      >
        <PreviewMessage from="Nirvana Alertes" time="02:38" edit="✓ Pris en main par Théo">
          🔴 <b>URGENT · Créatrice</b>
          <br />
          Possible mineur sur une photo envoyée par un fan. L’agent n’écrit plus à ce fan et attend un humain.
          <br />
          <span className="tg-msg__link">Ouvrir la conversation</span>
        </PreviewMessage>
        <PreviewMessage from="Nirvana Alertes" time="07:52" isSilent quote="La session Reveal a expiré">
          ✓ Résolu : la session est revenue.
        </PreviewMessage>
      </GroupPreview>
    </>
  );
}

/** What a tab whose events do not exist yet says, plainly: the routing is ready, the messages come later. */
function Coming({ children }: { children: string }): JSX.Element {
  return (
    <div className="tg-callout">
      <InfoGlyph />
      <span>{children}</span>
    </div>
  );
}

function SalesTab({ scope, onScope, ...routing }: ScopedProps): JSX.Element {
  return (
    <>
      <Coming>
        Les ventes arrivent avec la connexion à Reveal : Nirvana annoncera chaque vente dès que Reveal
        confirme le paiement. Tu peux déjà choisir le groupe.
      </Coming>
      <section>
        <p className="tg-eyebrow">Annoncer les ventes</p>
        <ScopePicker overview={routing.overview} scope={scope} onScope={onScope} />
        <RoutingList {...routing} topics={['sale']} scope={scope} />
      </section>
      <GroupPreview
        isOpen={routing.isExampleOpen}
        group="Ventes"
        heading="Sans son, sans le fan"
        points={[
          'Le montant, le pack, qui a vendu. Jamais le pseudo du fan.',
          'Une vente n’est annoncée qu’une fois le paiement confirmé par Reveal.',
          'Les ventes arrivent sans son : elles ne réveillent personne la nuit.',
          'Un groupe à part évite de noyer les alertes.',
        ]}
      >
        <PreviewMessage from="Nirvana Ventes" time="22:47" isSilent>
          💰 <b>Vente · Créatrice · 45,00 €</b>
          <br />
          Pack « Soirée » payé, vendu par l’agent.
          <br />
          <span className="tg-msg__link">Voir la conversation</span>
        </PreviewMessage>
      </GroupPreview>
    </>
  );
}

function ValidationsTab({ scope, onScope, ...routing }: ScopedProps): JSX.Element {
  return (
    <>
      <Coming>
        Les validations arrivent avec le copilote et les vocaux : un vocal ou un brouillon qui attend
        t’enverra un lien vers l’écran où valider. Tu peux déjà choisir le groupe.
      </Coming>
      <section>
        <p className="tg-eyebrow">Ce qui demande un humain</p>
        <ScopePicker overview={routing.overview} scope={scope} onScope={onScope} />
        <RoutingList {...routing} topics={['validation']} scope={scope} />
      </section>
      <GroupPreview
        isOpen={routing.isExampleOpen}
        group="Astreinte"
        heading="On valide là où on écoute"
        points={[
          'Le lien ouvre le CRM à l’écran de validation : tu écoutes, tu valides ou tu refuses.',
          'La voix de la créatrice ne part jamais chez Telegram.',
          'Une fois traité, le message se met à jour pour que personne ne le fasse deux fois.',
        ]}
      >
        <PreviewMessage from="Nirvana Alertes" time="21:16" edit="✓ Validé par Hugo">
          🎙️ <b>Vocal à valider · Créatrice</b>
          <br />
          Vocal de 14 s prêt pour un fan. Il ne part pas sans toi.
          <br />
          <span className="tg-msg__link">Écouter et valider</span>
        </PreviewMessage>
      </GroupPreview>
    </>
  );
}

type Pending =
  | { kind: 'confirm'; botId: string }
  | { kind: 'reauth'; botId: string }
  | { kind: 'forget'; chatId: string }
  | null;
type TestState = Record<string, { kind: 'busy' } | { kind: 'ok' } | { kind: 'error'; message: string }>;

function BotsTab({
  overview,
  now,
  onSheet,
  onChanged,
  onAdd,
}: {
  overview: TelegramOverview;
  now: Date;
  onSheet: (mode: SheetMode) => void;
  onChanged: () => void;
  onAdd: () => void;
}): JSX.Element {
  const [pending, setPending] = useState<Pending>(null);
  const [tests, setTests] = useState<TestState>({});
  const [error, setError] = useState<string | null>(null);
  /** The groups whose removal is under way: their button waits, and is never pressed twice. */
  const [forgetting, setForgetting] = useState<ReadonlySet<string>>(new Set());
  const choices = chatChoices(overview.bots);
  const active = choices.filter((c) => c.isReachable).length;

  const remove = (bot: TelegramBot): void => {
    setError(null);
    removeBot(bot.id).then(onChanged, (reason: unknown) => {
      if (reason instanceof ReauthRequired) {
        setPending({ kind: 'reauth', botId: bot.id });
        return;
      }
      setError(`${bot.displayName} n’a pas été supprimé. ${OFFLINE}`);
    });
  };

  const forget = (chat: TelegramChat): void => {
    setError(null);
    const done = (): void => {
      setForgetting((all) => new Set([...all].filter((id) => id !== chat.id)));
    };
    setForgetting((all) => new Set([...all, chat.id]));
    removeChat(chat.id).then(
      (result) => {
        done();
        if (result === 'still_member') setError(`Le bot est revenu dans ${chat.title} : le groupe reste.`);
        onChanged();
      },
      () => {
        done();
        setError(`${chat.title} n’a pas été retiré. ${OFFLINE}`);
      },
    );
  };

  const test = (chatId: TelegramChatId): void => {
    setTests((all) => ({ ...all, [chatId]: { kind: 'busy' } }));
    sendTest(chatId).then(
      (result) => {
        setTests((all) => ({
          ...all,
          [chatId]: result.ok ? { kind: 'ok' } : { kind: 'error', message: result.refusal.message },
        }));
        onChanged();
      },
      () => {
        setTests((all) => ({ ...all, [chatId]: { kind: 'error', message: OFFLINE } }));
      },
    );
  };

  // The page's one neon goes to the first bot to repair; with none, nothing here is lit (the page has no neon).
  const firstBroken = overview.bots.find((bot) => bot.state !== 'active')?.id ?? null;

  return (
    <>
      <section>
        <p className="tg-eyebrow">
          Bots{' '}
          <span>{`${plural(overview.bots.length, 'bot')} · ${plural(active, 'groupe')} actif${active > 1 ? 's' : ''}`}</span>
        </p>
        <div className="nv-plate">
          <div className="nv-list">
            {overview.bots.map((bot) => {
              const line = botLine(bot);
              const botChoices = choices.filter((c) => c.bot.id === bot.id);
              const gone = goneChats(bot);
              return (
                <div className="tg-bot" key={bot.id}>
                  <div className="tg-bot__head">
                    <div className="tg-bot__icon" aria-hidden="true">
                      <TelegramGlyph />
                    </div>
                    <div className="tg-min0">
                      <div className="tg-bot__name">{bot.displayName}</div>
                      <div className="tg-bot__handle" data-warning={line.isWarning}>
                        {line.text}
                      </div>
                    </div>
                    <div className="tg-actions">
                      {bot.state === 'active' ? (
                        <span className="nv-status nv-status--sent">
                          <span className="nv-status__dot" />
                          Actif
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`nv-btn nv-btn--sm ${bot.id === firstBroken ? 'nv-btn--neon' : 'nv-btn--soft'}`}
                          onClick={() => {
                            onSheet({ kind: 'replace', bot });
                          }}
                        >
                          Réparer
                        </button>
                      )}
                    </div>
                  </div>
                  {botChoices.length === 0 && gone.length === 0 ? (
                    <p className="tg-hint tg-bot__empty">Ce bot n’est dans aucun groupe.</p>
                  ) : (
                    <div className="nv-list">
                      {botChoices.map((choice) => {
                        const chatLabel = chatLine(choice, now);
                        const topics = topicsOfChat(overview.routes, choice.chat.id);
                        const state = tests[choice.chat.id];
                        return (
                          <div className="tg-chat" key={choice.chat.id}>
                            <span className="tg-av">{initials(choice.chat.title)}</span>
                            <div className="tg-chat__t">
                              <b>{choice.chat.title}</b>
                              <small data-warning={chatLabel.isWarning}>{chatLabel.text}</small>
                              {topics.length === 0 ? null : (
                                <span className="tg-topics">
                                  {topics.map((topic) => (
                                    <span key={topic}>
                                      <span className="tg-dot" data-topic={topic} />
                                      {TOPICS[topic].label}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {state?.kind === 'error' ? (
                                <small data-warning="true" role="alert">
                                  {state.message}
                                </small>
                              ) : null}
                            </div>
                            <div className="tg-actions">
                              {state?.kind === 'ok' ? (
                                <span className="tg-sent">✓ Reçu dans le groupe</span>
                              ) : (
                                <button
                                  type="button"
                                  className="nv-btn nv-btn--soft nv-btn--sm"
                                  disabled={state?.kind === 'busy' || !choice.isReachable}
                                  onClick={() => {
                                    test(choice.chat.id);
                                  }}
                                >
                                  {state?.kind === 'busy' ? 'Envoi…' : 'Envoyer un test'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {gone.map((chat) => (
                        <div className="tg-chat" key={chat.id}>
                          <span className="tg-av">{initials(chat.title)}</span>
                          <div className="tg-chat__t">
                            <b>{chat.title}</b>
                            <small data-warning="true">{goneLine(chat)}</small>
                          </div>
                          <div className="tg-actions">
                            <button
                              type="button"
                              className="nv-btn nv-btn--plain nv-btn--sm nv-btn--destructive"
                              disabled={forgetting.has(chat.id)}
                              onClick={() => {
                                setPending({ kind: 'forget', chatId: chat.id });
                              }}
                            >
                              {forgetting.has(chat.id) ? 'Retrait…' : 'Retirer de la liste'}
                            </button>
                          </div>
                          {pending?.kind === 'forget' && pending.chatId === chat.id ? (
                            <div className="nv-confirm tg-full">
                              <p>
                                <b>Retirer {chat.title} de la liste ?</b>{' '}
                                <span className="tg-hint">
                                  Ses routes partent avec lui. Si tu rajoutes le bot à ce groupe, il revient
                                  tout seul.
                                </span>
                              </p>
                              <div className="nv-confirm__actions">
                                <button
                                  type="button"
                                  className="nv-btn nv-btn--soft nv-btn--sm"
                                  onClick={() => {
                                    setPending(null);
                                  }}
                                >
                                  Garder
                                </button>
                                <button
                                  type="button"
                                  className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                                  onClick={() => {
                                    setPending(null);
                                    forget(chat);
                                  }}
                                >
                                  Retirer
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="tg-bot__foot">
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm"
                      disabled={bot.state !== 'active'}
                      onClick={() => {
                        onSheet({ kind: 'listen', bot });
                      }}
                    >
                      Ajouter à un groupe
                    </button>
                    {/* « Réparer » above already replaces the token of a broken bot. */}
                    {bot.state === 'active' ? (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm"
                        onClick={() => {
                          onSheet({ kind: 'replace', bot });
                        }}
                      >
                        Remplacer le jeton
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="nv-btn nv-btn--plain nv-btn--sm nv-btn--destructive"
                      onClick={() => {
                        setPending({ kind: 'confirm', botId: bot.id });
                      }}
                    >
                      Supprimer
                    </button>
                    {pending?.kind === 'confirm' && pending.botId === bot.id ? (
                      <div className="nv-confirm tg-full">
                        <p>
                          <b>Supprimer {bot.displayName} ?</b>{' '}
                          <span className="tg-hint">
                            {botChoices.length === 1
                              ? 'Son groupe ne recevra plus rien. '
                              : botChoices.length > 1
                                ? `Ses ${plural(botChoices.length, 'groupe')} ne recevront plus rien. `
                                : ''}
                            Le bot reste dans Telegram : pour l’effacer, envoie /deletebot à @BotFather.
                          </span>
                        </p>
                        <div className="nv-confirm__actions">
                          <button
                            type="button"
                            className="nv-btn nv-btn--soft nv-btn--sm"
                            onClick={() => {
                              setPending(null);
                            }}
                          >
                            Garder
                          </button>
                          <button
                            type="button"
                            className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                            onClick={() => {
                              setPending(null);
                              remove(bot);
                            }}
                          >
                            Supprimer le bot
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {pending?.kind === 'reauth' && pending.botId === bot.id ? (
                      <div className="nv-confirm tg-full">
                        <Reauth
                          onConfirmed={() => {
                            setPending(null);
                            remove(bot);
                          }}
                          onCancel={() => {
                            setPending(null);
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {error === null ? null : (
        <p className="tg-notice" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="nv-btn nv-btn--soft nv-btn--sm tg-self-start" onClick={onAdd}>
        Ajouter un bot
      </button>
      <div className="tg-callout">
        <InfoGlyph />
        <span>
          Un bot peut servir plusieurs groupes, et rien n’oblige à en avoir plusieurs. Un second bot sert
          surtout à séparer les ventes des urgences, avec un autre nom dans Telegram.
        </span>
      </div>
    </>
  );
}
