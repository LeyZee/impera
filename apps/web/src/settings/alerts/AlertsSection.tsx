import {
  ALERT_KEYWORD_MAX,
  ALERT_TEST_MESSAGE_MAX,
  alertKeywordKey,
  CUSTOM_ALERT_NAME_MAX,
  CUSTOM_ALERT_PHRASE_MAX,
  CUSTOM_ALERT_TOPIC,
  CustomAlertGroupIdSchema,
  SYSTEM_ALERT_CODES,
  SYSTEM_ALERT_TOPICS,
  type AlertTestBody,
  type AlertTestResult,
  type CreatorId,
  type CreatorSummary,
  type CustomAlertGroup,
  type CustomAlertGroupId,
  type SystemAlertSetting,
  type TelegramTopic,
} from '@nirvana/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import {
  ALERTS_ERRORS,
  ALERTS_QUERY_KEY,
  alertsErrorKind,
  archiveAlert,
  createAlert,
  replaceAlert,
  setSystemAlert,
  testAlert,
  useAlerts,
} from './api';
import {
  bodyOf,
  canSave,
  creatorsLine,
  draftIssues,
  draftOf,
  hasChanges,
  isActive,
  isLocked,
  issueList,
  newDraft,
  pauseLine,
  sameTest,
  switchedBody,
  SYSTEM_ALERTS,
  systemEnabled,
  systemLine,
  telegramHeadLine,
  telegramLine,
  testBodyOf,
  testCreatorOf,
  testCostLine,
  testHint,
  testVerdict,
  type AlertDraft,
  type TelegramLine,
  type TelegramRouting,
} from './model';
import './alerts.css';

import { useCreators } from '@/creators/api';
import { Entries, Field, FormContext, SwitchRow, TextArea, TextInput } from '@/creators/persona/fields';
import '@/creators/persona/persona.css';
import { creatorsSearch } from '@/creators/search';
import { distinctNames } from '@/settings/names';
import { fetchOverview, TelegramOff } from '@/settings/telegram/api';
import { TOPICS } from '@/settings/telegram/model';
import { searchOfTab, TAB_OF_TOPIC } from '@/settings/telegram/search';

/**
 * Réglages › Alertes (P4-01), the owner's alone: the alerts she writes herself (a phrase the brain reads, words the
 * code finds, or both) and the system's, on each creator. Where each one goes on Telegram is read from Réglages ›
 * Telegram, never set here. Nothing on this page ever shows what a fan wrote.
 */
export function AlertsSection(): JSX.Element {
  const alerts = useAlerts();
  const creators = useCreators();
  const routing = useTelegramRouting();
  const [editing, setEditing] = useState<'new' | CustomAlertGroupId | null>(null);

  if (alerts.data === undefined || creators.data === undefined) {
    if (alerts.isError || creators.isError) {
      const kind = alertsErrorKind(alerts.error);
      return (
        <section className="ps-page al-page">
          <div className="nv-plate ps-head nv-enter">
            {/* One wording for a silent server across Réglages: what it is, then what could not be read (REG-21). */}
            <p className="ps-title">
              {kind === 'unavailable' ? 'Le serveur ne répond pas' : 'Les alertes ne se chargent pas'}
            </p>
            <p className="ps-muted">
              {kind === 'unavailable' ? 'Les alertes n’ont pas pu être lues.' : ALERTS_ERRORS[kind]}
            </p>
            {kind === 'unavailable' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => {
                  void alerts.refetch();
                  void creators.refetch();
                }}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="ps-page al-page" aria-busy="true" aria-label="Alertes">
        <div className="nv-plate ps-head ps-skeleton" />
        <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
      </section>
    );
  }

  const known = routing.data ?? null;
  const telegramHead = telegramHeadLine(known);
  const all = distinctNames(creators.data, (creator) => creator.id);
  const custom = alerts.data.custom;
  return (
    <section className="ps-page al-page">
      <header className="nv-plate ps-head nv-enter">
        <div className="al-head">
          <div className="al-head__text">
            <h2 className="ps-title">Alertes</h2>
            <p className="ps-lead">
              Une alerte surveille ce que les fans écrivent. Quand elle sonne, l’équipe est prévenue ; si tu
              le choisis, l’agent se met en pause sur ce fan et passe la main.
            </p>
          </div>
          {/* One editor at a time: opening another would drop the changes of the open one (recette du 28/10). */}
          {editing !== null ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--neon al-head__action"
              disabled={all.length === 0}
              onClick={() => {
                setEditing('new');
              }}
            >
              Nouvelle alerte
            </button>
          )}
        </div>
        {all.length === 0 ? (
          <p className="ps-muted">Ajoute d’abord une créatrice : une alerte surveille ses fans.</p>
        ) : null}
        {telegramHead === null ? null : (
          <p className="al-telegram">
            <span className="al-telegram__dot" aria-hidden="true" />
            <span>
              {telegramHead}{' '}
              <Link to="/reglages/telegram" search={searchOfTab('bots')} className="al-link">
                Brancher un groupe
              </Link>
            </span>
          </p>
        )}
      </header>

      {editing === 'new' ? (
        <AlertEditor
          saved={null}
          creators={all}
          routing={known}
          onDone={() => {
            setEditing(null);
          }}
        />
      ) : null}

      <section className="al-group" aria-labelledby="al-own-title">
        <h3 id="al-own-title" className="al-eyebrow">
          Tes alertes
        </h3>
        {custom.length === 0 && editing !== 'new' ? (
          <div className="nv-plate al-empty nv-enter" style={{ '--nv-i': 1 }}>
            <p className="al-empty__title">Aucune alerte à toi pour l’instant</p>
            <p className="ps-muted">
              Écris ce que tu veux repérer comme tu le dirais à un chatteur (« le fan demande une vidéo faite
              pour lui »), ou donne des mots-clés : le code les cherche sans IA.
            </p>
          </div>
        ) : (
          <ul className="al-list">
            {custom.map((alert, index) =>
              editing === alert.groupId ? (
                <li key={alert.groupId}>
                  <AlertEditor
                    saved={alert}
                    creators={all}
                    routing={known}
                    onDone={() => {
                      setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <AlertLine
                  key={alert.groupId}
                  alert={alert}
                  index={index}
                  creators={all}
                  routing={known}
                  onEdit={
                    editing === null
                      ? () => {
                          setEditing(alert.groupId);
                        }
                      : null
                  }
                />
              ),
            )}
          </ul>
        )}
      </section>

      <section className="al-group" aria-labelledby="al-system-title">
        <h3 id="al-system-title" className="al-eyebrow">
          Alertes du système
        </h3>
        <p className="ps-muted al-group__lede">
          Le code les lève lui-même. Sauf les mots-clés, chacune se coupe créatrice par créatrice.
        </p>
        <ul className="al-list">
          {SYSTEM_ALERT_CODES.map((code, index) => {
            const setting = alerts.data.system.find((line) => line.code === code) ?? {
              code,
              locked: isLocked(code),
              creators: [],
            };
            return <SystemLine key={code} setting={setting} index={index} creators={all} routing={known} />;
          })}
        </ul>
      </section>
    </section>
  );
}

/** The routing of Réglages › Telegram, as far as this page needs it: who has no group for which topic. */
function useTelegramRouting(): { data: TelegramRouting | undefined } {
  return useQuery({
    queryKey: ['telegram', 'routing'],
    queryFn: async (): Promise<TelegramRouting> => {
      try {
        const overview = await fetchOverview();
        return overview.routes.length === 0 ? 'none' : overview.coverage;
      } catch (error) {
        if (error instanceof TelegramOff) return 'off';
        throw error;
      }
    },
    retry: false,
  });
}

/** Said only when something is off (no group, Telegram silent for it): an alert that goes where it should says nothing. */
function TelegramNote({ line }: { line: TelegramLine | null }): JSX.Element | null {
  if (line === null || line.kind === 'sent') return null;
  return (
    <p className="al-telegram" data-kind={line.kind}>
      <span className="al-telegram__dot" aria-hidden="true" />
      <span>
        {line.text}
        {line.kind === 'missing' ? (
          <>
            {' '}
            <ChooseGroup topic={line.topic} />
          </>
        ) : null}
      </span>
    </p>
  );
}

/** Opens Réglages › Telegram on the tab that routes this topic. */
function ChooseGroup({ topic }: { topic: TelegramTopic }): JSX.Element {
  return (
    <Link to="/reglages/telegram" search={searchOfTab(TAB_OF_TOPIC[topic])} className="al-link">
      Choisir le groupe
    </Link>
  );
}

const enabledIds = (alert: CustomAlertGroup): CreatorId[] =>
  alert.creators.filter((creator) => creator.enabled).map((creator) => creator.creatorId);

function AlertLine({
  alert,
  index,
  creators,
  routing,
  onEdit,
}: {
  alert: CustomAlertGroup;
  index: number;
  creators: readonly CreatorSummary[];
  routing: TelegramRouting | null;
  /** `null` while another alert is being written: no « Modifier » until it is saved or abandoned. */
  onEdit: (() => void) | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const switchId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = isActive(alert);

  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      setError(ALERTS_ERRORS[alertsErrorKind(reason)]);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY });
    }
  };

  const telegram = active
    ? telegramLine({
        notify: alert.notify,
        topic: CUSTOM_ALERT_TOPIC,
        topicLabel: TOPICS[CUSTOM_ALERT_TOPIC].label,
        creatorIds: enabledIds(alert),
        routing,
      })
    : null;

  return (
    <li
      className="nv-plate al-line nv-enter"
      style={{ '--nv-i': index + 1 }}
      data-off={active ? undefined : 'true'}
      aria-labelledby={`${switchId}-name`}
    >
      {/* One line by alert, the rest opened on a tap: twelve alerts no longer make a wall (REG-16). */}
      <div className="al-line__top">
        <button
          type="button"
          className="al-line__open"
          aria-expanded={open}
          aria-controls={`${switchId}-more`}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          <span className="al-line__title">
            <span id={`${switchId}-name`} className="al-line__name">
              {alert.name}
            </span>
            {active && alert.pausesAgent ? <span className="nv-tag">Pause</span> : null}
          </span>
          <span className="al-line__meta">
            {creatorsLine(
              alert.creators.map((creator) => creator.creatorId),
              creators,
            )}
          </span>
        </button>
        <label className="al-line__switch" htmlFor={switchId}>
          <span className="ps-muted">{active ? 'Active' : 'Coupée'}</span>
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="nv-switch"
            checked={active}
            disabled={busy}
            aria-label={`${alert.name} : ${active ? 'active' : 'coupée'}`}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run(() => replaceAlert(alert.groupId, switchedBody(alert, enabled)));
            }}
          />
        </label>
      </div>
      <TelegramNote line={telegram} />
      {error === null ? null : (
        <p className="ps-error" role="alert">
          {error}
        </p>
      )}
      <div id={`${switchId}-more`} className="al-line__more" hidden={!open}>
        {alert.phrase === null ? null : <p className="al-line__phrase">« {alert.phrase} »</p>}
        {alert.keywords.length === 0 ? null : (
          <ul className="al-words" aria-label="Mots-clés">
            {alert.keywords.map((word) => (
              <li key={alertKeywordKey(word)} className="al-word">
                {word}
              </li>
            ))}
          </ul>
        )}
        <p className="al-line__does" data-pauses={alert.pausesAgent ? 'true' : undefined}>
          {active
            ? pauseLine(alert.pausesAgent)
            : 'Coupée : elle ne surveille rien tant que tu ne la rallumes pas'}
        </p>
        {confirming ? (
          <div className="nv-confirm al-confirm">
            <p className="al-confirm__text">
              Archiver « {alert.name} » ? Elle ne surveille plus rien ; ce qu’elle a déjà repéré reste dans
              l’historique du Suivi.
            </p>
            <div className="nv-confirm__actions">
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Garder
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--destructive nv-btn--sm"
                disabled={busy}
                onClick={() => void run(() => archiveAlert(alert.groupId))}
              >
                Archiver
              </button>
            </div>
          </div>
        ) : (
          <div className="al-line__actions">
            {onEdit === null ? null : (
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={busy}
                onClick={onEdit}
              >
                Modifier
              </button>
            )}
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Archiver
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Writes one alert, new or saved. The new one's id is made once, so that a retry after a lost answer writes it once. */
function AlertEditor({
  saved,
  creators,
  routing,
  onDone,
}: {
  saved: CustomAlertGroup | null;
  creators: readonly CreatorSummary[];
  routing: TelegramRouting | null;
  onDone: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const id = useId();
  const [groupId] = useState(() => CustomAlertGroupIdSchema.parse(crypto.randomUUID()));
  const [draft, setDraft] = useState<AlertDraft>(() =>
    saved === null ? newDraft(creators) : draftOf(saved),
  );
  /** How many times « save » was asked with something to fix: each one takes her to the first field to fix. */
  const [tries, setTries] = useState(0);
  const tried = tries > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The name the server refused as another active alert's: refused on the field while it is still the one typed. */
  const [takenName, setTakenName] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  // Opened: the name first. Refused: the first field to fix, in view.
  useEffect(() => {
    const target =
      tries === 0
        ? form.current?.querySelector<HTMLElement>('input')
        : form.current?.querySelector<HTMLElement>(
            '[data-invalid="true"] input, [data-invalid="true"] textarea, [data-invalid="true"] button',
          );
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.focus({ preventScroll: true });
  }, [tries]);

  const nameTaken = takenName !== null && draft.name === takenName;
  const formState = {
    issues: [
      ...(nameTaken ? [{ field: 'name', message: ALERTS_ERRORS.name_taken }] : []),
      ...(tried ? issueList(draftIssues(draft)) : []),
    ],
    changed: [],
  };
  const edit = (patch: Partial<AlertDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const save = async (): Promise<void> => {
    if (!canSave(draft)) {
      setTries((count) => count + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = bodyOf(draft, saved);
      await (saved === null ? createAlert({ ...body, groupId }) : replaceAlert(saved.groupId, body));
      await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY });
      onDone();
    } catch (reason) {
      const kind = alertsErrorKind(reason);
      if (kind === 'name_taken') {
        // On the field itself, in view and focused, like any other field to fix.
        setTakenName(draft.name);
        setTries((count) => count + 1);
      } else {
        setError(ALERTS_ERRORS[kind]);
      }
      setBusy(false);
    }
  };

  const toggleCreator = (creatorId: CreatorId): void => {
    edit({
      creatorIds: draft.creatorIds.includes(creatorId)
        ? draft.creatorIds.filter((chosen) => chosen !== creatorId)
        : [...draft.creatorIds, creatorId],
    });
  };

  const telegram = telegramLine({
    notify: true,
    topic: CUSTOM_ALERT_TOPIC,
    topicLabel: TOPICS[CUSTOM_ALERT_TOPIC].label,
    creatorIds: draft.creatorIds,
    routing,
  });

  return (
    <form
      ref={form}
      className="nv-plate al-editor nv-enter"
      aria-label={saved === null ? 'Nouvelle alerte' : `Modifier « ${saved.name} »`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormContext.Provider value={formState}>
        <p className="al-eyebrow">{saved === null ? 'Nouvelle alerte' : 'Modifier l’alerte'}</p>
        <Field label="Nom" id={`${id}-name`} path="name" hint="Ce que l’équipe lira quand elle sonne.">
          <TextInput
            id={`${id}-name`}
            value={draft.name}
            maxLength={CUSTOM_ALERT_NAME_MAX}
            example="Vidéo perso"
            invalid={formState.issues.some((issue) => issue.field === 'name')}
            onChange={(name) => {
              edit({ name });
            }}
          />
        </Field>
        <Field
          label="Ce qu’elle repère"
          id={`${id}-phrase`}
          path="phrase"
          hint="Une phrase, comme tu le dirais à un chatteur. L’IA la lit à chaque message du fan."
        >
          <TextArea
            id={`${id}-phrase`}
            value={draft.phrase}
            maxLength={CUSTOM_ALERT_PHRASE_MAX}
            rows={2}
            example="Le fan demande une vidéo faite pour lui"
            // « Une phrase, des mots-clés, ou les deux » is said under the words, and marks both fields (REG-18).
            invalid={formState.issues.some((issue) => issue.field === 'watch')}
            onChange={(phrase) => {
              edit({ phrase });
            }}
          />
        </Field>
        <Field
          label="Mots-clés"
          id={`${id}-words`}
          path="watch"
          hint="Le code les cherche lui-même, sans IA : majuscules, accents et ponctuation n’y changent rien."
        >
          <Entries
            id={`${id}-words`}
            values={draft.keywords}
            maxLength={ALERT_KEYWORD_MAX}
            placeholder="Un mot, puis Entrée"
            keyOf={alertKeywordKey}
            onChange={(keywords) => {
              edit({ keywords });
            }}
          />
        </Field>
        {creators.length > 1 ? (
          <Field label="Créatrices" path="creators">
            <div className="ps-chips" role="group" aria-label="Créatrices">
              {creators.map((creator) => (
                <button
                  key={creator.id}
                  type="button"
                  role="checkbox"
                  className="nv-chip"
                  aria-checked={draft.creatorIds.includes(creator.id)}
                  onClick={() => {
                    toggleCreator(creator.id);
                  }}
                >
                  {creator.displayName}
                </button>
              ))}
            </div>
          </Field>
        ) : null}
        <div className="ps-switches">
          <SwitchRow
            label="Mettre l’agent en pause"
            detail={pauseLine(draft.pausesAgent)}
            checked={draft.pausesAgent}
            onChange={(pausesAgent) => {
              edit({ pausesAgent });
            }}
          />
          <SwitchRow
            label="Prévenir sur Telegram"
            detail={
              draft.notify
                ? (telegram?.text ?? `Dans « ${TOPICS[CUSTOM_ALERT_TOPIC].label} »`)
                : 'Gardée dans l’historique du Suivi, sans Telegram'
            }
            checked={draft.notify}
            onChange={(notify) => {
              edit({ notify });
            }}
          />
        </div>
        {draft.notify && telegram?.kind === 'missing' ? (
          <p className="al-telegram" data-kind="missing">
            <span className="al-telegram__dot" aria-hidden="true" />
            <span>
              <ChooseGroup topic={CUSTOM_ALERT_TOPIC} />
            </span>
          </p>
        ) : null}
        <AlertTry draft={draft} creators={creators} />
        {error === null ? null : (
          <p className="ps-error" role="alert">
            {error}
          </p>
        )}
        <div className="al-editor__actions">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onDone}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy || !hasChanges(draft, saved)}>
            {saved === null ? 'Créer l’alerte' : 'Enregistrer'}
          </button>
        </div>
      </FormContext.Provider>
    </form>
  );
}

/**
 * « Tester » (P4-01): the alert as written now, tried on a message she types, before it is saved. Words are read by
 * the code, the phrase by one call to the brain (said before she asks), with the active persona of one of the alert's
 * creators, chosen here when it has several (recette M13). An answer for another creator, phrase, other words or
 * another message is not shown: it would say what the alert no longer is.
 */
function AlertTry({
  draft,
  creators,
}: {
  draft: AlertDraft;
  creators: readonly CreatorSummary[];
}): JSX.Element {
  const id = useId();
  const [picked, setPicked] = useState<CreatorId | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{
    readonly sent: AlertTestBody;
    readonly result: AlertTestResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = testBodyOf(draft, message, picked);
  const reader = testCreatorOf(draft, picked);
  const chosen = creators.filter((creator) => draft.creatorIds.includes(creator.id));
  const hint = testHint(draft, message);
  const current = answer !== null && body !== null && sameTest(answer.sent, body) ? answer : null;
  const verdict = current === null ? null : testVerdict(current.sent, current.result, draft.pausesAgent);

  const run = async (): Promise<void> => {
    if (body === null) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer({ sent: body, result: await testAlert(body) });
    } catch (reason) {
      setError(ALERTS_ERRORS[alertsErrorKind(reason)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="al-try" aria-labelledby={`${id}-title`}>
      <p className="al-try__title" id={`${id}-title`}>
        Tester sur un message
      </p>
      {chosen.length > 1 ? (
        <Field label="Avec la persona active de">
          <div className="ps-chips" role="radiogroup" aria-label="Avec la persona active de">
            {chosen.map((creator) => (
              <button
                key={creator.id}
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={creator.id === reader}
                onClick={() => {
                  setPicked(creator.id);
                }}
              >
                {creator.displayName}
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label="Message d’un fan" id={`${id}-message`} hint={testCostLine(draft)}>
        <TextArea
          id={`${id}-message`}
          value={message}
          maxLength={ALERT_TEST_MESSAGE_MAX}
          rows={2}
          example="Tu me ferais une vidéo rien que pour moi ?"
          onChange={(next) => {
            setMessage(next);
            setError(null);
          }}
        />
      </Field>
      <div className="al-try__run">
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          disabled={busy || body === null}
          aria-busy={busy}
          onClick={() => {
            void run();
          }}
        >
          {busy ? 'Test…' : 'Tester'}
        </button>
        {hint === null ? null : <span className="al-try__why">{hint}</span>}
      </div>
      <div role="status" aria-live="polite">
        {verdict === null ? null : (
          <div className="al-try__verdict" data-rings={verdict.rings ? 'true' : undefined}>
            <p className="al-try__headline">{verdict.headline}</p>
            {verdict.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {verdict.warning === null ? null : <p className="al-try__warning">{verdict.warning}</p>}
          </div>
        )}
      </div>
      {error === null ? null : (
        <p className="ps-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function SystemLine({
  setting,
  index,
  creators,
  routing,
}: {
  setting: SystemAlertSetting;
  index: number;
  creators: readonly CreatorSummary[];
  routing: TelegramRouting | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [busy, setBusy] = useState<CreatorId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = SYSTEM_ALERTS[setting.code];
  const locked = isLocked(setting.code);
  const topic = SYSTEM_ALERT_TOPICS[setting.code];
  const on = creators.filter((creator) => systemEnabled(setting, creator.id)).map((creator) => creator.id);

  const toggle = async (creatorId: CreatorId, enabled: boolean): Promise<void> => {
    setBusy(creatorId);
    setError(null);
    try {
      await setSystemAlert(setting.code, { creators: [{ creatorId, enabled }] });
    } catch (reason) {
      setError(ALERTS_ERRORS[alertsErrorKind(reason)]);
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY });
    }
  };

  const single = creators.length === 1 ? creators[0] : undefined;
  return (
    <li
      className="nv-plate al-line al-system nv-enter"
      style={{ '--nv-i': index + 1 }}
      aria-labelledby={titleId}
    >
      <div className="al-line__top">
        <div className="al-line__text">
          <p id={titleId} className="al-line__name">
            {meta.title}
          </p>
          <p className="al-line__meta">{systemLine(setting, creators)}</p>
        </div>
        {locked ? (
          <span className="nv-tag nv-tag--declared al-lock">Toujours active</span>
        ) : single === undefined ? null : (
          <input
            type="checkbox"
            role="switch"
            className="nv-switch"
            checked={systemEnabled(setting, single.id)}
            disabled={busy !== null}
            aria-label={`${meta.title} : ${systemEnabled(setting, single.id) ? 'active' : 'coupée'}`}
            onChange={(event) => void toggle(single.id, event.target.checked)}
          />
        )}
      </div>
      <p className="al-line__does">{meta.what}</p>
      {/* The words are taken out in the creator's persona: one link each, to the right one (REG-13). */}
      {setting.code === 'keyword' ? (
        <p className="al-line__links">
          {creators.map((creator, at) => (
            <span key={creator.id}>
              {at === 0 ? null : ' · '}
              <Link to="/creatrices" search={creatorsSearch('persona', creator.id)} className="al-link">
                {creators.length === 1
                  ? 'Modifier les mots dans sa persona'
                  : `Persona de ${creator.displayName}`}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <TelegramNote
        line={
          on.length === 0
            ? null
            : telegramLine({
                notify: true,
                topic,
                topicLabel: TOPICS[topic].label,
                creatorIds: on,
                routing,
              })
        }
      />
      {locked || single !== undefined ? null : (
        <div className="ps-switches al-creators">
          {creators.map((creator) => (
            <SwitchRow
              key={creator.id}
              label={creator.displayName}
              checked={systemEnabled(setting, creator.id)}
              onChange={(enabled) => void toggle(creator.id, enabled)}
            />
          ))}
        </div>
      )}
      {error === null ? null : (
        <p className="ps-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
