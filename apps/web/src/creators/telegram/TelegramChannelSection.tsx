import {
  LINK_DESTINATION_MAX,
  type ChannelSlot,
  type RedirectLink,
  type TelegramChannelConfig,
  type TelegramChannelView,
  type TelegramChatId,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';
import { Segment, SwitchRow } from '../persona/fields';

import {
  CHANNEL_ERRORS,
  ChannelRefused,
  channelErrorKind,
  channelQueryKey,
  saveTelegramChannel,
  useTelegramChannel,
} from './api';
import {
  DAY_NAMES,
  DAY_SHORT,
  LINKS_FULL,
  SLOTS_FULL,
  SLOTS_RULE,
  WARNING_TEXT,
  choiceHint,
  clockWords,
  daysWords,
  issuesOf,
  newLink,
  nextSlot,
  rhythmWords,
  sameConfig,
  trimmed,
} from './model';
import './telegram-channel.css';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { PasswordPrompt, SignInAgain } from '@/settings/services/PasswordPrompt';
import { ReauthRequired } from '@/settings/services/api';
import { Select } from '@/shell/Select';

/**
 * Créatrices › Canal Telegram (ADR 0080 § 6), the owner's alone: the channel the agency's bot posts in for her, the
 * slots when a post goes out on its own, how long before it is shown to the agency, and the redirect links the code
 * adds at the end of each post. Built like her hours: a head with the state and the one action, then the work.
 */
export function TelegramChannelSection({
  creatorId,
  onDirty = ignore,
}: {
  creatorId: string;
  /** Told whether the setting holds changes not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const query = useTelegramChannel(creatorId);
  if (query.data === undefined) {
    if (query.isError) {
      const kind = channelErrorKind(query.error);
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Son canal Telegram ne se charge pas</p>
            <p className="ps-muted">{CHANNEL_ERRORS[kind]}</p>
            {kind === 'session_expired' ? (
              <SignInAgain />
            ) : kind === 'unavailable' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => void query.refetch()}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="ps-page" aria-busy="true" aria-label="Canal Telegram">
        <div className="nv-plate ps-head ps-skeleton" />
        <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
      </section>
    );
  }
  return <ChannelForm key={creatorId} creatorId={creatorId} view={query.data} onDirty={onDirty} />;
}

const ignore = (): void => undefined;

const PREVIEW_OPTIONS = [
  { value: '15', label: '15 min avant' },
  { value: '30', label: '30 min avant' },
  { value: '60', label: '1 h avant' },
  { value: '120', label: '2 h avant' },
  { value: '240', label: '4 h avant' },
] as const;
type PreviewValue = (typeof PREVIEW_OPTIONS)[number]['value'];
/** The option of a stored window, or none when the server holds another value (between 15 min and 4 h). */
const previewValueOf = (minutes: number): PreviewValue | '' =>
  PREVIEW_OPTIONS.find((option) => option.value === String(minutes))?.value ?? '';

interface Problem {
  readonly text: string;
  readonly expired: boolean;
}

function ChannelForm({
  creatorId,
  view,
  onDirty,
}: {
  creatorId: string;
  view: TelegramChannelView;
  onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [stored, setStored] = useState(view);
  const [draft, setDraft] = useState<TelegramChannelConfig>(view.config);
  const headRef = useRef<HTMLDivElement>(null);
  const headOnScreen = useOnScreen(headRef);
  const [saving, setSaving] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const times = useUnreadableTimes();

  const issues = issuesOf(draft);
  const changed = !sameConfig(draft, stored.config);
  const blocked = issues.size > 0 || times.unreadable;
  const dirty = changed || times.unreadable;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const edit = (next: TelegramChannelConfig): void => {
    setDraft(next);
    setNotice(null);
    setProblem(null);
  };
  const editSlots = (slots: ChannelSlot[]): void => {
    edit({ ...draft, slots });
  };
  const editLinks = (links: RedirectLink[], channelLinkId = draft.channelLinkId): void => {
    edit({ ...draft, links, channelLinkId });
  };

  async function save(): Promise<void> {
    setSaving(true);
    setProblem(null);
    try {
      const saved = await saveTelegramChannel(creatorId, trimmed(draft));
      queryClient.setQueryData(channelQueryKey(creatorId), saved);
      setStored(saved);
      setDraft(saved.config);
      setNotice(
        saved.warnings.length === 0
          ? 'Enregistré : les posts partiront à ces créneaux.'
          : 'Enregistré. Il reste à régler ce qui est en ambre.',
      );
    } catch (error) {
      if (error instanceof ReauthRequired) setReauth(true);
      else if (error instanceof ChannelRefused) setProblem({ text: error.message, expired: false });
      else {
        const kind = channelErrorKind(error);
        setProblem({ text: CHANNEL_ERRORS[kind], expired: kind === 'session_expired' });
      }
    } finally {
      setSaving(false);
    }
  }

  const state =
    problem !== null
      ? { dot: 'warn', text: problem.text }
      : blocked
        ? {
            dot: 'warn',
            text: issues.size > 1 ? `${String(issues.size)} lignes à corriger` : 'Une ligne à corriger',
          }
        : changed
          ? { dot: 'ok', text: 'Modifié, prêt à enregistrer' }
          : notice !== null
            ? { dot: 'ok', text: notice }
            : stored.saved
              ? { dot: stored.warnings.length === 0 ? 'ok' : 'warn', text: rhythmWords(stored.config.slots) }
              : { dot: 'idle', text: 'Pas encore réglé : 19 h tous les jours une fois le canal choisi' };

  const undo = (): void => {
    edit(stored.config);
  };
  const choices = stored.channels;
  const chosen = choices.find((choice) => choice.chatId === draft.chatId);
  const added = nextSlot(draft.slots);
  const warnings = stored.warnings;

  return (
    <section className="ps-page tc-page">
      <div className="nv-plate ps-head" ref={headRef}>
        <div className="ps-head__top">
          <div className="ps-head__who">
            <h2 className="ps-title">Son canal Telegram</h2>
          </div>
          <div className="ps-head__actions">
            {changed && !saving ? (
              <button type="button" className="nv-btn nv-btn--plain nv-btn--sm ps-pop" onClick={undo}>
                Tout annuler
              </button>
            ) : null}
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              disabled={!changed || blocked || saving}
              aria-busy={saving}
              onClick={() => void save()}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
        <div className="ps-head__state" aria-live="polite">
          <span className="ps-dot" data-dot={state.dot} />
          <span className="ps-head__text" key={state.text}>
            {state.text}
          </span>
        </div>
        {warnings.length > 0 && !changed ? (
          <ul className="tc-warnings" aria-label="Ce qui empêche les posts de partir">
            {warnings.map((warning) => (
              <li key={warning} className="tc-warning">
                {WARNING_TEXT[warning]}
              </li>
            ))}
          </ul>
        ) : null}
        {problem?.expired === true ? <SignInAgain /> : null}
        {reauth ? (
          <PasswordPrompt
            lead="Pour changer son canal Telegram, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              setReauth(false);
              void save();
            }}
            onCancel={() => {
              setReauth(false);
            }}
          />
        ) : null}
      </div>

      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="tc-channel">
          <h3 className="ps-block__title" id="tc-channel">
            Canal
          </h3>
          {choices.length === 0 ? (
            <p className="ps-lead">
              Ajoute le bot de l’agence comme administrateur de son canal, avec le droit « Publier des
              messages » : le canal apparaît ici dans la minute.
            </p>
          ) : (
            <>
              <div className="tc-row">
                <Select<TelegramChatId>
                  ariaLabel="Son canal"
                  value={draft.chatId ?? ''}
                  placeholder="Choisir son canal…"
                  options={choices.map((choice) => {
                    const hint = choiceHint(choice);
                    return {
                      value: choice.chatId,
                      label: choice.title,
                      ...(hint === undefined ? {} : { hint }),
                      disabled: choice.takenByOther || choice.routedForAlerts,
                    };
                  })}
                  onChange={(chatId) => {
                    edit({ ...draft, chatId });
                  }}
                />
                {draft.chatId === null ? null : (
                  <button
                    type="button"
                    className="nv-btn nv-btn--plain nv-btn--sm"
                    onClick={() => {
                      edit({ ...draft, chatId: null });
                    }}
                  >
                    Retirer
                  </button>
                )}
              </div>
              {chosen !== undefined && choiceHint(chosen) !== undefined ? (
                <p className="tc-warning" role="status">
                  {choiceHint(chosen)}
                </p>
              ) : (
                <p className="ps-hint">
                  Dans Telegram, laisse « Signer les messages » éteint : le post vient d’elle.
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="tc-slots">
          <h3 className="ps-block__title" id="tc-slots">
            Créneaux
          </h3>
          <p className="ps-lead">{SLOTS_RULE}</p>
          <ul className="tc-slots" aria-label="Créneaux">
            {draft.slots.map((slot, rank) => (
              <SlotLine
                // The rank is the line: a slot has no id of its own, and lines are never reordered while edited.
                key={rank}
                slot={slot}
                issue={issues.get(`slot:${String(rank)}`) ?? null}
                onUnreadable={times.onUnreadable}
                onChange={(next) => {
                  editSlots(draft.slots.map((one, i) => (i === rank ? next : one)));
                }}
                onRemove={() => {
                  editSlots(draft.slots.filter((_, i) => i !== rank));
                }}
              />
            ))}
          </ul>
          {issues.get('slots') === undefined ? null : (
            <p className="ps-error" role="alert">
              {issues.get('slots')}
            </p>
          )}
          {added === null ? (
            <p className="ps-hint">{SLOTS_FULL}</p>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm ps-self-start"
              onClick={() => {
                editSlots([...draft.slots, added]);
              }}
            >
              <span aria-hidden="true">+</span> Ajouter un créneau
            </button>
          )}
        </section>
      </div>

      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="tc-check">
          <h3 className="ps-block__title" id="tc-check">
            Validation
          </h3>
          <div className="tc-setting tc-setting--select">
            <span className="tc-setting__text">
              <span className="tc-setting__label" aria-hidden="true">
                Aperçu dans le groupe Info
              </span>
              <span className="ps-hint">Pour valider, réécrire ou changer le média.</span>
            </span>
            <Select<PreviewValue>
              ariaLabel="Aperçu dans le groupe Info"
              value={previewValueOf(draft.previewMinutes)}
              options={PREVIEW_OPTIONS}
              onChange={(value) => {
                edit({ ...draft, previewMinutes: Number(value) });
              }}
            />
          </div>
          <SwitchRow
            label="Publier sans validation"
            detail={
              draft.publishWithoutValidation
                ? 'Le post part à l’heure si personne ne l’arrête.'
                : 'Sans « Valider » avant l’heure, le post ne part pas.'
            }
            checked={draft.publishWithoutValidation}
            onChange={(publishWithoutValidation) => {
              edit({ ...draft, publishWithoutValidation });
            }}
          />
        </section>
      </div>

      <div className="nv-plate ps-panel">
        <section className="ps-block" aria-labelledby="tc-links">
          <h3 className="ps-block__title" id="tc-links">
            Liens
          </h3>
          <p className="ps-lead">
            Le lien du canal finit chaque post, et le texte parle de l’endroit où il mène.
          </p>
          <ul className="tc-links" aria-label="Liens de redirection">
            {draft.links.map((link) => (
              <LinkLine
                key={link.id}
                link={link}
                isChannelLink={draft.channelLinkId === link.id}
                nameIssue={issues.get(`link:${link.id}:name`) ?? null}
                urlIssue={issues.get(`link:${link.id}:url`) ?? null}
                destinationIssue={issues.get(`link:${link.id}:destination`) ?? null}
                onChange={(next) => {
                  editLinks(draft.links.map((one) => (one.id === link.id ? next : one)));
                }}
                onChoose={() => {
                  editLinks(draft.links, link.id);
                }}
                onRemove={() => {
                  editLinks(
                    draft.links.filter((one) => one.id !== link.id),
                    draft.channelLinkId === link.id ? null : draft.channelLinkId,
                  );
                }}
              />
            ))}
          </ul>
          {draft.links.length >= 20 ? (
            <p className="ps-hint">{LINKS_FULL}</p>
          ) : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm ps-self-start"
              onClick={() => {
                const link = newLink();
                // Her first link is the channel's until another is chosen.
                editLinks([...draft.links, link], draft.channelLinkId ?? link.id);
              }}
            >
              <span aria-hidden="true">+</span> Ajouter un lien
            </button>
          )}
          <div className="tc-form">
            <div className="tc-setting">
              <span className="tc-setting__label" aria-hidden="true">
                Dans le post
              </span>
              <Segment
                label="Forme du lien"
                options={[
                  { value: 'label', label: 'Un texte en lien' },
                  { value: 'bare', label: 'L’adresse nue' },
                ]}
                value={draft.linkForm}
                onChange={(linkForm) => {
                  edit({ ...draft, linkForm });
                }}
              />
            </div>
            {draft.linkForm === 'label' ? (
              <LabelField
                value={draft.linkLabel}
                issue={issues.get('label') ?? null}
                onChange={(linkLabel) => {
                  edit({ ...draft, linkLabel });
                }}
              />
            ) : null}
          </div>
        </section>
      </div>
      <SaveBar
        show={dirty && !headOnScreen}
        warn={blocked}
        text={state.text}
        saveLabel="Enregistrer"
        saving={saving}
        blocked={blocked ? 'Corrige d’abord les lignes signalées.' : null}
        onReset={undo}
        onSave={() => void save()}
      />
    </section>
  );
}

function SlotLine({
  slot,
  issue,
  onChange,
  onRemove,
  onUnreadable,
}: {
  slot: ChannelSlot;
  issue: string | null;
  onChange: (slot: ChannelSlot) => void;
  onRemove: () => void;
  onUnreadable: (field: string, unreadable: boolean) => void;
}): JSX.Element {
  const id = useId();
  const name = `créneau de ${clockWords(slot.minute)}${slot.days.length === 0 ? '' : `, ${daysWords(slot.days)}`}`;
  return (
    <li
      className="tc-slot"
      data-off={slot.enabled ? undefined : 'true'}
      data-invalid={issue === null ? undefined : 'true'}
    >
      <div className="tc-slot__fields">
        <TimeField
          className="tc-time"
          value={slot.minute}
          label={`Heure du ${name}`}
          onChange={(minute) => {
            onChange({ ...slot, minute });
          }}
          onUnreadable={onUnreadable}
        />
        <span className="tc-days" role="group" aria-label={`Jours du ${name}`}>
          {DAY_SHORT.map((short, index) => {
            const day = index + 1;
            const on = slot.days.includes(day);
            return (
              <button
                key={short}
                type="button"
                className="nv-chip tc-day"
                aria-pressed={on}
                aria-label={DAY_NAMES[index]}
                onClick={() => {
                  onChange({
                    ...slot,
                    days: on
                      ? slot.days.filter((one) => one !== day)
                      : [...slot.days, day].sort((a, b) => a - b),
                  });
                }}
              >
                {short}
              </button>
            );
          })}
        </span>
        <span className="tc-slot__end">
          <label className="tc-slot__switch" htmlFor={id}>
            <span className="tc-slot__state" aria-hidden="true">
              {slot.enabled ? 'Actif' : 'Coupé'}
            </span>
            <input
              id={id}
              type="checkbox"
              role="switch"
              className="nv-switch"
              checked={slot.enabled}
              aria-label={`Activer le ${name}`}
              onChange={(event) => {
                onChange({ ...slot, enabled: event.target.checked });
              }}
            />
          </label>
          <button
            type="button"
            className="ps-entry__remove"
            aria-label={`Retirer le ${name}`}
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </div>
      {issue === null ? null : <p className="ps-error">{issue}</p>}
    </li>
  );
}

function LinkLine({
  link,
  isChannelLink,
  nameIssue,
  urlIssue,
  destinationIssue,
  onChange,
  onChoose,
  onRemove,
}: {
  link: RedirectLink;
  isChannelLink: boolean;
  nameIssue: string | null;
  urlIssue: string | null;
  destinationIssue: string | null;
  onChange: (link: RedirectLink) => void;
  onChoose: () => void;
  onRemove: () => void;
}): JSX.Element {
  const nameId = useId();
  const urlId = useId();
  const destinationId = useId();
  const name = link.name.trim();
  const named = name === '' ? 'ce lien' : `le lien « ${name} »`;
  const of = name === '' ? 'de ce lien' : `du lien « ${name} »`;
  return (
    <li className="tc-link" data-chosen={isChannelLink ? 'true' : undefined}>
      <div className="tc-link__fields">
        <span className="tc-link__field">
          <label className="sr-only" htmlFor={nameId}>
            Nom {of}
          </label>
          <input
            id={nameId}
            className="nv-field__control nv-glass tc-link__name"
            value={link.name}
            maxLength={60}
            placeholder="Nom (Telegram, Insta bio…)"
            aria-invalid={nameIssue === null ? undefined : true}
            onChange={(event) => {
              onChange({ ...link, name: event.target.value });
            }}
          />
        </span>
        <span className="tc-link__field tc-link__field--url">
          <label className="sr-only" htmlFor={urlId}>
            Adresse {of}
          </label>
          <input
            id={urlId}
            className="nv-field__control nv-glass tc-link__url"
            value={link.url}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…"
            aria-invalid={urlIssue === null ? undefined : true}
            onChange={(event) => {
              onChange({ ...link, url: event.target.value });
            }}
          />
        </span>
        <span className="tc-link__end">
          <button
            type="button"
            className="nv-chip"
            aria-pressed={isChannelLink}
            aria-label={`Lien du canal : ${named}`}
            onClick={onChoose}
          >
            {isChannelLink ? 'Lien du canal' : 'Choisir pour le canal'}
          </button>
          <button
            type="button"
            className="ps-entry__remove"
            aria-label={`Retirer ${named}`}
            onClick={onRemove}
          >
            ×
          </button>
        </span>
        <span className="tc-link__destination">
          <label className="tc-field-label" htmlFor={destinationId}>
            Où il mène<span className="sr-only"> ({named})</span>
          </label>
          <DestinationArea
            id={destinationId}
            value={link.destination}
            maxLength={LINK_DESTINATION_MAX}
            placeholder="mon Reveal, mon live TikTok ce soir 21 h…"
            aria-describedby={
              destinationIssue === null
                ? `${destinationId}-hint`
                : `${destinationId}-hint ${destinationId}-error`
            }
            aria-invalid={destinationIssue === null ? undefined : true}
            onChange={(destination) => {
              onChange({ ...link, destination });
            }}
          />
          <span className="sr-only" id={`${destinationId}-hint`}>
            Le post parle de cet endroit, sans adresse.
          </span>
        </span>
      </div>
      {nameIssue === null ? null : <p className="ps-error">{nameIssue}</p>}
      {urlIssue === null ? null : <p className="ps-error">{urlIssue}</p>}
      {destinationIssue === null ? null : (
        <p className="ps-error" id={`${destinationId}-error`}>
          {destinationIssue}
        </p>
      )}
    </li>
  );
}

function LabelField({
  value,
  issue,
  onChange,
}: {
  value: string;
  issue: string | null;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-field ps-field" data-invalid={issue === null ? undefined : 'true'}>
      <label className="tc-field-label" htmlFor={id}>
        Texte du lien
      </label>
      <input
        id={id}
        className="nv-field__control nv-glass ps-input"
        value={value}
        maxLength={60}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {issue === null ? null : <p className="ps-error">{issue}</p>}
    </div>
  );
}

/** Whether the browser grows a text field with its text by itself (Chromium, Edge, Safari 18+). */
const SIZED_BY_CONTENT = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * Where a link leads: one line of text that wraps instead of being cut on a phone. Enter adds no line; a pasted line
 * break becomes a space, since the sentence is said in one line.
 */
function DestinationArea({
  id,
  value,
  onChange,
  ...rest
}: {
  id: string;
  value: string;
  maxLength: number;
  placeholder: string;
  'aria-describedby': string;
  'aria-invalid': true | undefined;
  onChange: (value: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = ref.current;
    if (area === null || SIZED_BY_CONTENT) return;
    area.style.height = '';
    if (area.scrollHeight > 0) area.style.height = `${String(area.scrollHeight + 2)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      className="nv-field__control nv-glass tc-link__area"
      value={value}
      {...rest}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
      onChange={(event) => {
        onChange(event.target.value.replace(/\s*[\r\n]+\s*/gu, ' '));
      }}
    />
  );
}
