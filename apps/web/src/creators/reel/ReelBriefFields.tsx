import { REEL_HOOK_WORDS_MAX, REEL_LINE_MAX, REEL_ON_SCREEN_WORDS_MAX } from '@impera/contracts';
import { useId, useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';

import { SecondsSlider } from './SecondsSlider';
import {
  addShot,
  HOOK_COUNTER,
  mayAddShot,
  mayRemoveShot,
  moveShot,
  ON_SCREEN_COUNTER,
  previewOf,
  REEL_PROBLEM_WORDS,
  reelProblems,
  removeShot,
  setShot,
  typedWords,
  type ReelDraft,
} from './model';
import './reel-fields.css';

import { ReelBrief } from '@/screens/agenda/ReelBrief';
import '@/screens/agenda/agenda.css';
import '@/screens/team/team.css';

/** Whether the browser grows a text field with its text by itself (Chromium, Edge, Safari 18+). */
const SIZED_BY_CONTENT = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * A shot: one line said in a sentence, that wraps on a phone rather than being cut. Enter adds no line; a pasted line
 * break becomes a space.
 */
function ShotArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (text: string) => void;
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
      className="nv-field__control nv-glass rb-shot__input"
      aria-label={label}
      rows={1}
      value={value}
      maxLength={REEL_LINE_MAX}
      autoComplete="off"
      placeholder={placeholder}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.preventDefault();
      }}
      onChange={(event) => {
        onChange(event.target.value.replace(/\s*[\r\n]+\s*/gu, ' '));
      }}
    />
  );
}

/** A field of words with its counter: amber once full, and the field takes no word more. */
function WordsField({
  id,
  label,
  optional,
  value,
  max,
  counter,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  max: number;
  counter: (text: string) => { readonly label: string; readonly full: boolean };
  placeholder: string;
  onChange: (text: string) => void;
}): JSX.Element {
  const count = counter(value);
  return (
    <div className="nv-field rb-field">
      <div className="rb-field__head">
        <label className="nv-field__label" htmlFor={id}>
          {label} {optional === true ? <span className="ag-optional">facultatif</span> : null}
        </label>
        <span id={`${id}-count`} className="rb-count nv-num" data-full={count.full ? 'true' : undefined}>
          {count.label}
        </span>
      </div>
      <input
        id={id}
        className="nv-field__control nv-glass"
        value={value}
        maxLength={REEL_LINE_MAX}
        autoComplete="off"
        placeholder={placeholder}
        aria-describedby={`${id}-count`}
        onChange={(event) => {
          onChange(typedWords(event.target.value, max));
        }}
      />
    </div>
  );
}

function Arrow({ up }: { up: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M5 5l6 6M11 5l-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

const Hint = ({ children }: { children: ReactNode }): JSX.Element => (
  <p className="tm-hint tm-hint--error">{children}</p>
);

/**
 * « Fiche reel » (VEI-08, ADR 0082 § 3), the agency's: her first sentence and her text on screen with their counters,
 * the shots in the order she films them, how it ends, how long; beside it (under it on a phone), exactly what she will
 * see, the same component as on her phone, at each keystroke. Shown when the shoot is for a Reel Insta, in « Proposer
 * une tâche » and in the correction of an idea. Left blank, the shoot leaves without a sheet.
 */
export function ReelBriefFields({
  draft,
  tried,
  onChange,
}: {
  draft: ReelDraft;
  /** Once « Proposer » or « Valider » was pressed: what is missing says so, in amber. */
  tried: boolean;
  onChange: (draft: ReelDraft) => void;
}): JSX.Element {
  const id = useId();
  const problems = tried ? reelProblems(draft) : [];
  const set = (patch: Partial<ReelDraft>): void => {
    onChange({ ...draft, ...patch });
  };
  return (
    <section className="rb nv-plate" aria-labelledby={`${id}-title`}>
      <header className="rb__head">
        <h3 className="rb__title" id={`${id}-title`}>
          Fiche reel
        </h3>
        <p className="rb__help">
          Ce qu’elle dit d’abord, où va le texte, quoi filmer : elle la lit d’un coup d’œil.
        </p>
      </header>
      <div className="rb__split">
        <div className="rb__fields">
          <WordsField
            id={`${id}-hook`}
            label="Première phrase"
            value={draft.hook}
            max={REEL_HOOK_WORDS_MAX}
            counter={HOOK_COUNTER}
            placeholder="Ce qu’elle dit dans les trois premières secondes"
            onChange={(hook) => {
              set({ hook });
            }}
          />
          {problems.includes('hook') ? <Hint>{REEL_PROBLEM_WORDS.hook}</Hint> : null}
          <WordsField
            id={`${id}-screen`}
            label="Texte à l’écran"
            optional
            value={draft.onScreen}
            max={REEL_ON_SCREEN_WORDS_MAX}
            counter={ON_SCREEN_COUNTER}
            placeholder="Quelques mots posés sur l’image"
            onChange={(onScreen) => {
              set({ onScreen });
            }}
          />
          <fieldset className="rb-shots">
            <legend className="nv-field__label">Plans</legend>
            <ol className="rb-shots__list">
              {draft.shots.map((shot, index) => (
                <li key={shot.key} className="rb-shot">
                  <span className="rb-shot__n nv-num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <ShotArea
                    label={`Plan ${String(index + 1)}`}
                    value={shot.text}
                    placeholder={index === 0 ? 'Le premier plan, une ligne' : 'Puis…'}
                    onChange={(text) => {
                      onChange(setShot(draft, shot.key, text));
                    }}
                  />
                  <span className="rb-shot__tools">
                    <button
                      type="button"
                      className="nv-iconbtn rb-shot__btn"
                      aria-label={`Monter le plan ${String(index + 1)}`}
                      disabled={index === 0}
                      onClick={() => {
                        onChange(moveShot(draft, shot.key, -1));
                      }}
                    >
                      <Arrow up />
                    </button>
                    <button
                      type="button"
                      className="nv-iconbtn rb-shot__btn"
                      aria-label={`Descendre le plan ${String(index + 1)}`}
                      disabled={index === draft.shots.length - 1}
                      onClick={() => {
                        onChange(moveShot(draft, shot.key, 1));
                      }}
                    >
                      <Arrow up={false} />
                    </button>
                    <button
                      type="button"
                      className="nv-iconbtn rb-shot__btn"
                      aria-label={`Retirer le plan ${String(index + 1)}`}
                      disabled={!mayRemoveShot(draft)}
                      onClick={() => {
                        onChange(removeShot(draft, shot.key));
                      }}
                    >
                      <Cross />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm rb-shots__add"
              disabled={!mayAddShot(draft)}
              onClick={() => {
                onChange(addShot(draft));
              }}
            >
              {mayAddShot(draft) ? 'Ajouter un plan' : 'Six plans au plus'}
            </button>
          </fieldset>
          {problems.includes('shots') ? <Hint>{REEL_PROBLEM_WORDS.shots}</Hint> : null}
          <div className="nv-field rb-field">
            <label className="nv-field__label" htmlFor={`${id}-end`}>
              Pour finir <span className="ag-optional">facultatif</span>
            </label>
            <input
              id={`${id}-end`}
              className="nv-field__control nv-glass"
              value={draft.ending}
              maxLength={REEL_LINE_MAX}
              autoComplete="off"
              placeholder="Ce qui ramène au début : un mot repris, un geste"
              onChange={(event) => {
                set({ ending: event.target.value });
              }}
            />
          </div>
          <div className="nv-field rb-field">
            <span className="nv-field__label" id={`${id}-seconds-label`}>
              Durée
            </span>
            <SecondsSlider
              id={`${id}-seconds`}
              labelledBy={`${id}-seconds-label`}
              value={draft.seconds}
              onChange={(seconds) => {
                set({ seconds });
              }}
            />
          </div>
        </div>
        <div className="rb__preview" aria-label="Ce qu’elle verra" role="group">
          <span className="rb__preview-label">Ce qu’elle verra</span>
          <div className="ag-brief rb__sheet">
            <b className="ag-brief__title">🎬 Fiche de tournage</b>
            <ReelBrief brief={previewOf(draft)} />
          </div>
        </div>
      </div>
    </section>
  );
}
