import {
  ageOn,
  LANGUAGES,
  PERSONA_OPTIONS,
  PERSONA_SHEET,
  PERSONA_SHEET_BOUNDS,
  SHEET_LONG_MAX,
  SHEET_SHORT_MAX,
  type SheetQuestion,
  type SheetSection,
} from '@impera/contracts';
import { useContext, useId, useState, type JSX, type ReactNode } from 'react';

import { Field, FormContext, NumberInput, Picker } from './fields';
import {
  answerText,
  hasChange,
  isPlaceholder,
  issueCountByPanel,
  localDay,
  localTime,
  type Answer,
  type PanelKey,
  type SheetDraft,
} from './model';

import { useGrowingArea } from '@/lib/growing-area';
import { DayField } from '@/scheduling/DayField';
import { cityOf } from '@/scheduling/time';

/**
 * Sa fiche (ADR 0079): Desirali's seven panels, in its order, with its labels word for word and its layout (the whole
 * row, half of it or a third; one column on a phone). Every answer is free text the model reads, but six: the date,
 * the two measures, the number of partners, the time zone (hers, shown, never changed here) and the languages.
 */
export function SheetPanels({
  sheet,
  onAnswer,
  open,
  onToggle,
  timezone,
  isOwner,
}: {
  sheet: SheetDraft;
  onAnswer: (panel: PanelKey, key: string, value: Answer) => void;
  /** The panels unfolded; the screen opens one to show a field in it. */
  open: ReadonlySet<PanelKey>;
  onToggle: (panel: PanelKey) => void;
  /** The creator's own zone (`creators.timezone`), the one the code goes by (ADR 0079 § 3). */
  timezone: string | null;
  isOwner: boolean;
}): JSX.Element {
  const form = useContext(FormContext);
  const counts = issueCountByPanel(form.issues);
  return (
    <div className="ps-panels">
      {PERSONA_SHEET.map((section) => {
        const questions = section.questions.map((question) => (
          <Question
            key={question.key}
            panel={section.key}
            question={question}
            value={sheet[section.key][question.key]}
            onAnswer={(value) => {
              onAnswer(section.key, question.key, value);
            }}
            timezone={timezone}
            isOwner={isOwner}
          />
        ));
        return section.title === null ? (
          // Desirali's last panel has no title: its one question, « Zones interdites », names it.
          <section key={section.key} className="nv-plate ps-sheet-panel" data-panel={section.key}>
            <div className="ps-sheet-panel__body ps-sheet-panel__body--bare">{questions}</div>
          </section>
        ) : (
          <Panel
            key={section.key}
            section={section}
            title={section.title}
            answered={answeredIn(section, sheet)}
            toFix={counts[section.key] ?? 0}
            edited={hasChange(form.changed, `sheet.${section.key}`)}
            open={open.has(section.key)}
            onToggle={() => {
              onToggle(section.key);
            }}
          >
            {questions}
          </Panel>
        );
      })}
    </div>
  );
}

/** How many questions of a panel hold an answer: the time zone always does, it is hers. */
function answeredIn(section: SheetSection, sheet: SheetDraft): number {
  const answers = sheet[section.key];
  return section.questions.filter((q) => {
    if (q.key === 'timezone') return true;
    const value = answers[q.key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.trim() !== '' && !isPlaceholder(value);
    return value.length > 0;
  }).length;
}

/** A panel that folds, as at Desirali: its icon left of the title, the chevron right. */
function Panel({
  section,
  title,
  answered,
  toFix,
  edited,
  open,
  onToggle,
  children,
}: {
  section: SheetSection;
  title: string;
  answered: number;
  toFix: number;
  edited: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  const total = section.questions.length;
  return (
    <section
      className="nv-plate ps-sheet-panel"
      data-panel={section.key}
      data-open={open ? 'true' : undefined}
      aria-labelledby={`${id}-title`}
    >
      <h3 className="ps-sheet-panel__heading">
        <button
          type="button"
          className="ps-sheet-panel__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <PanelIcon icon={section.icon} />
          <span className="ps-sheet-panel__title" id={`${id}-title`}>
            {title}
          </span>
          {edited ? <span className="ps-changed ps-changed--on" aria-label="modifié" /> : null}
          <span className="ps-sheet-panel__meta">
            {toFix > 0 ? (
              <span className="nv-subnav__count" aria-label={`${String(toFix)} à corriger`}>
                {toFix}
              </span>
            ) : null}
            <span
              className="ps-sheet-panel__count"
              aria-label={`${String(answered)} réponses sur ${String(total)}`}
            >
              {answered}/{total}
            </span>
            <span className="ps-sheet-panel__chevron" aria-hidden="true" />
          </span>
        </button>
      </h3>
      {/* Folded, the answers stay in the page: « Voir » and a search find them, and nothing typed is lost. */}
      <div className="ps-sheet-panel__body" id={`${id}-body`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** The icons of Desirali's panels, drawn here in the design's stroke. */
function PanelIcon({ icon }: { icon: SheetSection['icon'] }): JSX.Element {
  return (
    <svg
      className="ps-sheet-panel__icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PANEL_ICONS[icon]}
    </svg>
  );
}

const PANEL_ICONS: Readonly<Record<SheetSection['icon'], JSX.Element>> = {
  pin: (
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  house: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9v10h12V9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.8 1.9-1.7 0-1.2-1-1.6-1-2.6 0-1 .8-1.7 1.9-1.7h2.1a3.6 3.6 0 0 0 3.6-3.6C20.5 6.8 16.7 3.5 12 3.5Z" />
      <circle cx="7.8" cy="11" r="1" />
      <circle cx="10.5" cy="7.4" r="1" />
      <circle cx="15" cy="7.6" r="1" />
    </>
  ),
  bubble: (
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />
  ),
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10Z" />,
  flame: (
    <path d="M12 21a6 6 0 0 0 6-6c0-3.6-2.6-5.6-3.6-8.5-.5 2.2-1.6 3.4-2.9 4.1C11.6 8 10.6 5.2 9 3c-.3 4-4 6.6-4 11a7 7 0 0 0 7 7Z" />
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6l-7-2.5Z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </>
  ),
};

/** The small icons Desirali puts in some fields, kept beside their label. */
const FIELD_ICONS: Readonly<Record<string, JSX.Element>> = {
  height_m: <path d="M8 3v18M8 7h3M8 11h4M8 15h3M8 19h4M16 3l2.5 3h-5L16 3Zm0 18 2.5-3h-5L16 21Zm0-15v12" />,
  weight_kg: (
    <>
      <path d="M6.5 8.5h11l1.8 11H4.7l1.8-11Z" />
      <circle cx="12" cy="6" r="2.2" />
    </>
  ),
  job: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
      <path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17" />
    </>
  ),
  timezone: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5S9.6 5.9 12 3.5Z" />
    </>
  ),
  music_genres: (
    <>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  favorite_movies: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  favorite_books: <path d="M5 4.5h11.5a2 2 0 0 1 2 2V19.5H7a2 2 0 0 1-2-2v-13Zm0 13a2 2 0 0 1 2-2h11.5" />,
};

type Language = (typeof LANGUAGES)[number];
const isLanguage = (value: string): value is Language => LANGUAGES.some((language) => language === value);

/** « 26 ans aujourd’hui », on the local calendar of today; nothing for a date not yet whole or still to come. */
export function ageLine(birthDate: string, today: string = localDay()): string | undefined {
  try {
    const age = ageOn(birthDate, today);
    return age >= 0 ? `${String(age)} ans aujourd’hui` : undefined;
  } catch {
    return undefined;
  }
}

/** One question, drawn by its kind, at its width; its path in the persona is `sheet.<panel>.<key>`. */
function Question({
  panel,
  question,
  value,
  onAnswer,
  timezone,
  isOwner,
}: {
  panel: PanelKey;
  question: SheetQuestion;
  value: Answer | undefined;
  onAnswer: (value: Answer) => void;
  timezone: string | null;
  isOwner: boolean;
}): JSX.Element {
  const id = useId();
  const path = `sheet.${panel}.${question.key}`;
  const icon = FIELD_ICONS[question.key];
  const [dateUnreadable, setDateUnreadable] = useState(false);
  const label = question.label;
  const field = (control: ReactNode, hint?: ReactNode, controlId: string | undefined = id): JSX.Element => (
    <div className="ps-q" data-width={question.width}>
      <Field label={label} hint={hint ?? question.help} path={path} id={controlId} icon={icon}>
        {control}
      </Field>
    </div>
  );

  switch (question.kind) {
    case 'short':
    case 'long':
      return field(
        <FreeAnswer
          id={id}
          value={answerText(value)}
          long={question.kind === 'long'}
          onChange={(text) => {
            // An emptied field is no answer, never an empty string (the schema reads null).
            onAnswer(text.trim() === '' ? null : text);
          }}
        />,
      );
    case 'date': {
      const day = answerText(value);
      return field(
        <DayField
          id={id}
          className="ps-input"
          value={isPlaceholder(day) ? '' : day}
          toward="past"
          optional
          onChange={onAnswer}
          invalid={dateUnreadable}
          onUnreadable={setDateUnreadable}
        />,
        dateUnreadable ? 'Un jour comme 12/05/1998, ou 120598.' : ageLine(day),
      );
    }
    case 'decimal':
      return field(
        <Decimal
          id={id}
          value={typeof value === 'number' ? value : null}
          unit={question.key === 'height_m' ? 'm' : 'kg'}
          onChange={onAnswer}
        />,
      );
    case 'integer':
      return field(
        <NumberInput
          id={id}
          nullable
          unit=""
          bounds={PERSONA_SHEET_BOUNDS.bodyCount}
          value={typeof value === 'number' ? value : null}
          onChange={onAnswer}
        />,
      );
    case 'timezone':
      // Not a field: it does not change here (ADR 0079 § 3). Her city and her hour, one line (CREA-27).
      return field(
        timezone === null ? (
          <p className="ps-static-line">Fuseau de la créatrice pas encore réglé</p>
        ) : (
          <p className="ps-static-line" title={timezone}>
            {cityOf(timezone)} · {localTime(timezone)} chez elle
          </p>
        ),
        isOwner ? 'Celui de la créatrice, à changer dans Heures d’activité.' : 'Celui de la créatrice.',
        undefined,
      );
    case 'languages':
      return field(
        <Picker
          id={id}
          label={label}
          placeholder="Choisir une ou plusieurs langues"
          empty="Aucune langue ne correspond"
          options={PERSONA_OPTIONS.languages}
          // Her first language is the one she answers in: a new pick goes last, her order stays.
          keepOrder
          values={Array.isArray(value) ? value.filter(isLanguage) : []}
          onChange={onAnswer}
        />,
      );
  }
}

/**
 * A free answer: never cut, it grows with what is written (Desirali's one-line fields hold paragraphs, recette
 * persona 06/11). A long answer starts on three lines and counts its characters; a short one starts on one line and
 * counts them only near its end.
 */
function FreeAnswer({
  id,
  value,
  long,
  onChange,
}: {
  id: string;
  value: string;
  long: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const shown = isPlaceholder(value) ? '' : value;
  const max = long ? SHEET_LONG_MAX : SHEET_SHORT_MAX;
  // A folded panel has no height to measure: where the browser does not size it, the field keeps its rows until typed in.
  const ref = useGrowingArea(shown);
  const near = shown.length > max * 0.9;
  return (
    <div className="ps-area" data-long={long ? 'true' : undefined}>
      <textarea
        ref={ref}
        id={id}
        className="nv-glass nv-field__control ps-input ps-answer"
        value={shown}
        rows={long ? 3 : 1}
        maxLength={max}
        placeholder="À remplir"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {long || near ? (
        <span className="ps-area__count" data-near={near ? 'true' : undefined}>
          {shown.length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')}
        </span>
      ) : null}
    </div>
  );
}

/** « 1,68 » as she types it: a comma or a point, the unit after. Emptied, it is no answer. */
function Decimal({
  id,
  value,
  unit,
  onChange,
}: {
  id: string;
  value: number | null;
  unit: string;
  onChange: (value: number | null) => void;
}): JSX.Element {
  const [text, setText] = useState(() => shownDecimal(value));
  // Another value than the one typed (an import, « Tout annuler »): the field shows it.
  if (parseDecimal(text) !== value && !(Number.isNaN(value) && Number.isNaN(parseDecimal(text)))) {
    setText(shownDecimal(value));
  }
  return (
    <div className="nv-glass nv-field__control ps-number">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className="ps-number__input ps-number__input--free"
        value={text}
        placeholder="—"
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseDecimal(event.target.value));
        }}
      />
      <span className="ps-number__unit">{unit}</span>
    </div>
  );
}

const shownDecimal = (value: number | null): string =>
  value === null || Number.isNaN(value) ? '' : value.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

/** Empty is no answer; anything else not a number is NaN, which the schema refuses with its message. */
const parseDecimal = (text: string): number | null => {
  const trimmed = text.trim().replace(/\s/gu, '').replace(',', '.');
  return trimmed === '' ? null : Number(trimmed);
};
