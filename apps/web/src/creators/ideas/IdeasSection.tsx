import {
  DROP_CATEGORIES,
  DROP_CATEGORY_LABELS,
  TREND_FORMATS,
  instagramPostOf,
  type ContentIdeaOfDay,
  type CreatorId,
  type DropCategory,
  type TrendFormat,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { PASTE_ERRORS, ideasKey, pasteLink, refuseIdea, useIdeas, validateIdea } from './api';
import {
  FORMAT_LABELS,
  IDEA_STATE_LABELS,
  IDEA_STATE_TONES,
  SIGNAL_SOURCE_LABELS,
  correctionOf,
  draftOf,
  draftProblems,
  metricsLine,
  shootLength,
  slashDay,
  type IdeaDraft,
} from './model';
import './ideas.css';

import { askedWhen } from '@/creators/agenda/model';
import { addDays, dayOf, longDay } from '@/scheduling/time';
import { CATEGORY_EMOJIS } from '@/screens/content/model';
import { Select } from '@/shell/Select';
import '@/creators/agenda/agency-agenda.css';

/**
 * Créatrices › Idées du jour (VEI-02, ADR 0060 § 5), the owner's and an active manager's: the morning's ideas for her,
 * each with the trend it cites. Validated as it is or corrected on the spot, it becomes a shooting suggestion in her
 * agenda; refused, it is never proposed again. Nothing leaves for her without this page. « Coller un lien » adds a post
 * seen on Instagram to her trends (§ 2, source 4): the server keeps its address and never opens it.
 */
export function IdeasSection({
  creatorId,
  creatorName,
  timezone,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
}): JSX.Element {
  const today = dayOf(new Date(), timezone);
  const [day, setDay] = useState(today);
  const [pasting, setPasting] = useState(false);
  const query = useIdeas(creatorId, day);
  const label = longDay(day);

  const list = (): JSX.Element => {
    if (query.data === undefined) {
      if (query.isError)
        return (
          <div className="nv-plate aa-empty">
            <p className="ps-title">Ses idées ne se chargent pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void query.refetch()}
            >
              Réessayer
            </button>
          </div>
        );
      return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />;
    }
    const items = query.data.items;
    if (items.length === 0)
      return (
        <div className="nv-plate aa-empty">
          <p className="aa-empty__title">Pas d’idée {day === today ? 'aujourd’hui' : 'ce jour-là'}</p>
          <p className="ps-muted">
            Chaque matin à 7 h, dans son fuseau, jusqu’à trois idées naissent de ses tendances vivantes. Une
            idée qui touche une de ses limites, ressemble à une idée récente ou ne cite aucune tendance est
            retirée avant d’arriver ici.
          </p>
        </div>
      );
    const waiting = items.filter((idea) => idea.state === 'proposed').length;
    return (
      <>
        <p className="aa-summary nv-num">
          {items.length === 1 ? '1 idée' : `${String(items.length)} idées`}
          {waiting === 0 ? ' · toutes décidées' : ` · ${String(waiting)} à décider`}
        </p>
        <ul className="iv-list">
          {items.map((idea, index) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              index={index}
              creatorId={creatorId}
              creatorName={creatorName}
              timezone={timezone}
              day={day}
            />
          ))}
        </ul>
      </>
    );
  };

  return (
    <section className="ps-page aa-page iv-page" aria-label={`Idées du jour de ${creatorName}`}>
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <p className="ps-title">Ses idées du jour</p>
            <p className="ps-muted">
              Les idées de contenu pour {creatorName}, tirées de ses tendances. Rien ne part chez elle sans ta
              validation : validée, une idée devient une suggestion de tournage dans son agenda.
            </p>
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            aria-expanded={pasting}
            onClick={() => {
              setPasting(!pasting);
            }}
          >
            Coller un lien
          </button>
        </div>
        <div className="aa-week" role="group" aria-label="Jour">
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-label="Jour précédent"
            onClick={() => {
              setDay(addDays(day, -1));
            }}
          >
            ‹
          </button>
          <span className="aa-week__label iv-day nv-num" aria-live="polite">
            {day === today ? 'Aujourd’hui · ' : ''}
            {label}
          </span>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            aria-label="Jour suivant"
            disabled={day === today}
            onClick={() => {
              setDay(addDays(day, 1));
            }}
          >
            ›
          </button>
          {day === today ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setDay(today);
              }}
            >
              Aujourd’hui
            </button>
          )}
        </div>
      </div>
      {pasting ? (
        <PasteLink
          creatorId={creatorId}
          creatorName={creatorName}
          onClose={() => {
            setPasting(false);
          }}
        />
      ) : null}
      {list()}
    </section>
  );
}

type Mode = 'read' | 'correct' | 'refuse';

function IdeaCard({
  idea,
  index,
  creatorId,
  creatorName,
  timezone,
  day,
}: {
  idea: ContentIdeaOfDay;
  index: number;
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
  day: string;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const [mode, setMode] = useState<Mode>('read');
  const [draft, setDraft] = useState<IdeaDraft>(() => draftOf(idea));
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const problems = draftProblems(draft);
  const shown = (field: keyof IdeaDraft): string | undefined => (tried ? problems[field] : undefined);
  const metrics = metricsLine(idea.signal.metrics);
  const decided = idea.state !== 'proposed';

  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: ideasKey(creatorId, day) });

  const validate = async (corrected: boolean): Promise<void> => {
    if (corrected) {
      setTried(true);
      if (Object.keys(problems).length > 0) return;
    }
    setBusy(true);
    setError(null);
    const outcome = await validateIdea(creatorId, idea.id, corrected ? correctionOf(idea, draft) : null);
    setBusy(false);
    if (outcome.kind === 'ok') {
      const when = askedWhen(outcome.value.suggestion, timezone);
      setMode('read');
      setNotice(
        outcome.value.suggestion.when === null
          ? `Validée : aucune de ses dispos n’a de place, elle la placera elle-même dans sa semaine.`
          : `Validée : ${creatorName} la voit dans son agenda, ${when.charAt(0).toLowerCase()}${when.slice(1)}.`,
      );
      await refresh();
      return;
    }
    setError(outcome.message);
    if (outcome.kind === 'decided') await refresh();
  };

  const refuse = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const typed = reason.trim();
    const outcome = await refuseIdea(creatorId, idea.id, typed === '' ? null : typed);
    setBusy(false);
    if (outcome.kind === 'ok') {
      setMode('read');
      setNotice('Refusée : elle ne sera jamais reproposée.');
      await refresh();
      return;
    }
    setError(outcome.message);
    if (outcome.kind === 'decided') await refresh();
  };

  const set = (patch: Partial<IdeaDraft>): void => {
    setDraft((before) => ({ ...before, ...patch }));
  };

  return (
    <li
      className="nv-plate iv-card nv-enter"
      style={{ '--nv-i': index + 1 }}
      data-state={idea.state}
      aria-labelledby={`${id}-title`}
    >
      <div className="iv-card__top">
        <span className="iv-cat">
          <span aria-hidden="true">{CATEGORY_EMOJIS[idea.category]}</span>
          {DROP_CATEGORY_LABELS[idea.category]}
        </span>
        <span className="iv-length nv-num">≈ {shootLength(idea.shootMinutes)}</span>
        <span className="aa-pill iv-state" data-tone={IDEA_STATE_TONES[idea.state]}>
          {IDEA_STATE_LABELS[idea.state]}
        </span>
      </div>
      {mode === 'correct' ? (
        <form
          className="iv-form"
          noValidate
          onSubmit={(event: SyntheticEvent) => {
            event.preventDefault();
            void validate(true);
          }}
        >
          <Field id={`${id}-t`} label="Titre" problem={shown('title')}>
            <input
              id={`${id}-t`}
              className="nv-field__control"
              value={draft.title}
              maxLength={120}
              aria-invalid={shown('title') !== undefined}
              onChange={(event) => {
                set({ title: event.target.value });
              }}
            />
          </Field>
          <div className="iv-form__row">
            <Field id={`${id}-c`} label="Catégorie">
              <Select<DropCategory>
                id={`${id}-c`}
                value={draft.category}
                options={DROP_CATEGORIES.map((category) => ({
                  value: category,
                  label: `${CATEGORY_EMOJIS[category]} ${DROP_CATEGORY_LABELS[category]}`,
                }))}
                onChange={(category) => {
                  set({ category });
                }}
              />
            </Field>
            <Field id={`${id}-m`} label="Temps de tournage" problem={shown('shootMinutes')}>
              <span className="iv-suffix">
                <input
                  id={`${id}-m`}
                  className="nv-field__control nv-num"
                  inputMode="numeric"
                  value={draft.shootMinutes}
                  aria-invalid={shown('shootMinutes') !== undefined}
                  onChange={(event) => {
                    set({ shootMinutes: event.target.value });
                  }}
                />
                <span className="iv-suffix__unit" aria-hidden="true">
                  min
                </span>
              </span>
            </Field>
          </div>
          <Field id={`${id}-s`} label="À tourner" problem={shown('toShoot')}>
            <textarea
              id={`${id}-s`}
              className="nv-field__control iv-area"
              rows={4}
              value={draft.toShoot}
              aria-invalid={shown('toShoot') !== undefined}
              onChange={(event) => {
                set({ toShoot: event.target.value });
              }}
            />
          </Field>
          <Field id={`${id}-r`} label="Pourquoi" problem={shown('reason')}>
            <textarea
              id={`${id}-r`}
              className="nv-field__control iv-area iv-area--short"
              rows={2}
              value={draft.reason}
              aria-invalid={shown('reason') !== undefined}
              onChange={(event) => {
                set({ reason: event.target.value });
              }}
            />
          </Field>
          {error === null ? null : (
            <p className="iv-error" role="alert">
              {error}
            </p>
          )}
          <div className="iv-actions">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setMode('read');
                setDraft(draftOf(idea));
                setTried(false);
                setError(null);
              }}
            >
              Annuler
            </button>
            <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} aria-busy={busy}>
              Valider avec ces corrections
            </button>
          </div>
        </form>
      ) : (
        <>
          <h3 className="iv-title" id={`${id}-title`}>
            {idea.title}
          </h3>
          <section className="iv-shoot" aria-label="À tourner">
            <b className="iv-label">À tourner</b>
            <p className="iv-text">{idea.toShoot}</p>
          </section>
          <p className="iv-why">{idea.reason}</p>
        </>
      )}
      <section className="iv-signal" aria-label="Tendance citée">
        <p className="iv-signal__head">
          <b>{SIGNAL_SOURCE_LABELS[idea.signal.source]}</b>
          {idea.signal.format === null ? null : <span> · {FORMAT_LABELS[idea.signal.format]}</span>}
          <span className="nv-num"> · jusqu’au {slashDay(idea.signal.expiresAt)}</span>
        </p>
        <p className="iv-signal__text">{idea.signal.text}</p>
        {metrics === null && idea.signal.url === null ? null : (
          <p className="iv-signal__foot">
            {metrics === null ? null : <span className="nv-num">{metrics}</span>}
            {idea.signal.url === null ? null : (
              <a className="iv-signal__link" href={idea.signal.url} target="_blank" rel="noopener noreferrer">
                Voir sur Instagram
              </a>
            )}
          </p>
        )}
      </section>
      {idea.state === 'refused' && idea.refusalReason !== null ? (
        <p className="iv-why">Motif : {idea.refusalReason}</p>
      ) : null}
      {notice === null ? null : (
        <p className="iv-notice" role="status">
          {notice}
        </p>
      )}
      {mode === 'refuse' ? (
        <div className="iv-form" role="group" aria-label="Refuser l’idée">
          <Field id={`${id}-why`} label="Motif (facultatif)">
            <input
              id={`${id}-why`}
              className="nv-field__control"
              value={reason}
              maxLength={280}
              placeholder="Pas son style, déjà tourné…"
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </Field>
          {error === null ? null : (
            <p className="iv-error" role="alert">
              {error}
            </p>
          )}
          <div className="iv-actions">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setMode('read');
                setError(null);
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void refuse()}
            >
              Refuser l’idée
            </button>
          </div>
        </div>
      ) : null}
      {mode === 'read' && !decided ? (
        <>
          {error === null ? null : (
            <p className="iv-error" role="alert">
              {error}
            </p>
          )}
          <div className="iv-actions">
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setNotice(null);
                setError(null);
                setMode('refuse');
              }}
            >
              Refuser
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={busy}
              onClick={() => {
                setNotice(null);
                setError(null);
                setMode('correct');
              }}
            >
              Corriger
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void validate(false)}
            >
              Valider
            </button>
          </div>
        </>
      ) : null}
    </li>
  );
}

function Field({
  id,
  label,
  problem,
  children,
}: {
  id: string;
  label: string;
  problem?: string | undefined;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="nv-field iv-field">
      <label className="nv-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {problem === undefined ? null : (
        <p className="iv-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * « Coller un lien » (ADR 0060 § 2, source 4): the address of a post or a reel, one line on what it shows, its
 * format; for the creator of the sheet. Checked by its form here and on the server, never opened by either.
 */
function PasteLink({
  creatorId,
  creatorName,
  onClose,
}: {
  creatorId: CreatorId;
  creatorName: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [format, setFormat] = useState<TrendFormat | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const post = instagramPostOf(url);
  const problems = {
    url:
      url.trim() === ''
        ? 'Colle l’adresse du post.'
        : post === null
          ? 'Ce n’est pas l’adresse d’un post ou d’un reel Instagram.'
          : undefined,
    text: text.trim() === '' ? 'Une ligne sur ce qu’il montre.' : undefined,
    format: format === null ? 'Choisis son format.' : undefined,
  };
  const shown = (field: keyof typeof problems): string | undefined => (tried ? problems[field] : undefined);

  const submit = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    setTried(true);
    if (post === null || format === null || text.trim() === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const outcome = await pasteLink({ url: post.url, text: text.trim(), format, creatorId });
    setBusy(false);
    if (outcome.kind !== 'ok') {
      setError(PASTE_ERRORS[outcome.kind]);
      return;
    }
    const until = outcome.pasted.expiresAt === null ? '' : `, jusqu’au ${slashDay(outcome.pasted.expiresAt)}`;
    setNotice(
      outcome.pasted.created
        ? `Ajouté aux tendances de ${creatorName}${until}. Les idées du matin pourront le citer.`
        : `Ce post était déjà dans ses tendances${until}.`,
    );
    setUrl('');
    setText('');
    setFormat(null);
    setTried(false);
  };

  return (
    <form
      className="nv-plate iv-paste"
      noValidate
      aria-labelledby={`${id}-h`}
      onSubmit={(event) => void submit(event)}
    >
      <div className="iv-paste__head">
        <p className="ps-title" id={`${id}-h`}>
          Coller un lien
        </p>
        <p className="ps-muted">
          Un post ou un reel vu sur Instagram, pour les tendances de {creatorName}. Impera garde son adresse
          et ta ligne, jamais le média, et n’ouvre jamais le lien.
        </p>
      </div>
      <Field id={`${id}-u`} label="Lien du post" problem={shown('url')}>
        <input
          id={`${id}-u`}
          className="nv-field__control"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.instagram.com/reel/…"
          value={url}
          aria-invalid={shown('url') !== undefined}
          onChange={(event) => {
            setUrl(event.target.value);
          }}
        />
      </Field>
      <Field id={`${id}-x`} label="Ce qu’il montre" problem={shown('text')}>
        <input
          id={`${id}-x`}
          className="nv-field__control"
          maxLength={280}
          placeholder="Transition miroir sur un son qui monte"
          value={text}
          aria-invalid={shown('text') !== undefined}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </Field>
      <div className="nv-field iv-field">
        <span className="nv-field__label" id={`${id}-f`}>
          Format
        </span>
        <div className="ps-chips" role="radiogroup" aria-labelledby={`${id}-f`}>
          {TREND_FORMATS.map((one) => (
            <button
              key={one}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={format === one}
              onClick={() => {
                setFormat(one);
              }}
            >
              {FORMAT_LABELS[one]}
            </button>
          ))}
        </div>
        {shown('format') === undefined ? null : (
          <p className="iv-error" role="alert">
            {shown('format')}
          </p>
        )}
      </div>
      {error === null ? null : (
        <p className="iv-error" role="alert">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="iv-notice" role="status">
          {notice}
        </p>
      )}
      <div className="iv-actions">
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={busy} onClick={onClose}>
          Fermer
        </button>
        <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={busy} aria-busy={busy}>
          Ajouter
        </button>
      </div>
    </form>
  );
}
