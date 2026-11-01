import { placeSegmentThumb } from '@nirvana/design-system';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import {
  appendPick,
  hasChange,
  isPlaceholder,
  issuesOf,
  matchOptions,
  togglePick,
  type FieldIssue,
} from './model';

/** What an empty text field says, and what a placeholder of the example (`<à remplir>`) shows as. */
const TO_FILL = 'À remplir';

/** An example in an empty field reads as one, « Ex. : … », never as a value already typed (REG-17). */
const placeholderOf = (placeholder: string | undefined, example: string | undefined): string =>
  example === undefined ? (placeholder ?? TO_FILL) : `Ex. : ${example}`;

/**
 * The controls of the persona form, all on the design-system classes: a field with its label and its errors,
 * text, numbers with their unit, chips, a segment, a switch row and a list of entries.
 */

/** What every field reads about the draft: its problems and what changed since the saved version. */
export interface FormState {
  readonly issues: readonly FieldIssue[];
  readonly changed: readonly string[];
}

export const FormContext = createContext<FormState>({ issues: [], changed: [] });

type Options<V> = readonly { readonly value: V; readonly label: string }[];

/** Marks a setting the code enforces (policy, guards), never the prompt (CLAUDE.md rule 3). */
export function CodeTag(): JSX.Element {
  return (
    <span
      className="nv-tag nv-tag--declared ps-code"
      title="L’agent la respecte à la lettre, quoi qu’il écrive."
    >
      Règle stricte
    </span>
  );
}

export function Field({
  label,
  hint,
  code = false,
  path,
  children,
  id,
  labelHidden = false,
}: {
  label: string;
  hint?: ReactNode;
  code?: boolean;
  /** The block's title already says it (« Infos en plus », « Mots-clés »): read aloud, not shown twice (CREA-17). */
  labelHidden?: boolean;
  /** Where the field sits in the persona (`strategies.kyc.max_messages`): its errors and changes come from there. */
  path?: string;
  children: ReactNode;
  /** The control's id, so that the label points at it. Leave out for a group of chips. */
  id?: string;
}): JSX.Element {
  const form = useContext(FormContext);
  const first = path === undefined ? undefined : issuesOf(form.issues, path)[0];
  const changed = path !== undefined && hasChange(form.changed, path);
  return (
    <div
      className="nv-field ps-field"
      data-path={path}
      data-invalid={first === undefined ? undefined : 'true'}
      data-changed={changed ? 'true' : undefined}
    >
      <div className={labelHidden ? 'sr-only' : 'ps-field__head'}>
        <span className="ps-changed" aria-hidden="true" />
        {id === undefined ? (
          <span className="nv-field__label">{label}</span>
        ) : (
          <label className="nv-field__label" htmlFor={id}>
            {label}
          </label>
        )}
        {code ? <CodeTag /> : null}
      </div>
      {children}
      {first === undefined ? (
        hint === undefined ? null : (
          <p className="ps-hint">{hint}</p>
        )
      ) : (
        <p className="ps-error" role="alert">
          {first.message}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  maxLength,
  placeholder,
  example,
  type = 'text',
  list,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  /** What one could write, shown « Ex. : … » in the empty field. */
  example?: string;
  type?: 'text' | 'date';
  list?: string;
  /** Refused as it stands, so that a screen reader says so on the control itself. */
  invalid?: boolean;
}): JSX.Element {
  return (
    <input
      id={id}
      type={type}
      aria-invalid={invalid ? true : undefined}
      className="nv-glass nv-field__control ps-input"
      value={isPlaceholder(value) ? '' : value}
      maxLength={maxLength}
      placeholder={placeholderOf(placeholder, example)}
      list={list}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    />
  );
}

export function TextArea({
  id,
  value,
  onChange,
  maxLength,
  rows = 3,
  placeholder,
  example,
  invalid = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows?: number;
  placeholder?: string;
  /** What one could write, shown « Ex. : … » in the empty field. */
  example?: string;
  /** Refused as it stands, even when the message is said under another field. */
  invalid?: boolean;
}): JSX.Element {
  const shown = isPlaceholder(value) ? '' : value;
  return (
    <div className="ps-area">
      <textarea
        id={id}
        className="nv-glass nv-field__control ps-input ps-area__input"
        value={shown}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={invalid ? true : undefined}
        placeholder={placeholderOf(placeholder, example)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <span className="ps-area__count" data-near={shown.length > maxLength * 0.9 ? 'true' : undefined}>
        {shown.length.toLocaleString('fr-FR')} / {maxLength.toLocaleString('fr-FR')}
      </span>
    </div>
  );
}

/**
 * A whole number with its unit after it, and − / + to step within its bounds. An emptied required field holds
 * NaN, which the schema refuses.
 */
export function NumberInput({
  id,
  value,
  onChange,
  bounds,
  unit,
  nullable = false,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  bounds: readonly [number, number];
  unit: string;
  nullable?: boolean;
}): JSX.Element {
  const [min, max] = bounds;
  const known = value !== null && !Number.isNaN(value);
  const shown = known ? String(value) : '';
  const step = (delta: number): void => {
    const from = known ? value : delta > 0 ? min - 1 : max + 1;
    onChange(Math.min(max, Math.max(min, Math.round(from) + delta)));
  };
  return (
    <div className="nv-glass nv-field__control ps-number">
      <button
        type="button"
        className="ps-step"
        aria-label="Moins"
        tabIndex={-1}
        disabled={known && value <= min}
        onClick={() => {
          step(-1);
        }}
      >
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="ps-number__input"
        min={min}
        max={max}
        step={1}
        value={shown}
        placeholder={nullable ? '—' : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === '' ? (nullable ? null : Number.NaN) : Number(raw));
        }}
      />
      <span className="ps-number__unit">{unit}</span>
      <button
        type="button"
        className="ps-step"
        aria-label="Plus"
        tabIndex={-1}
        disabled={known && value >= max}
        onClick={() => {
          step(1);
        }}
      >
        +
      </button>
    </div>
  );
}

/** One choice among a few. With `none`, the value can be left unset (a detail she does not give). */
export function Choice<V extends string | number>({
  options,
  value,
  onChange,
  none,
  label,
}: {
  options: Options<V>;
  value: V | null;
  onChange: (value: V | null) => void;
  none?: string;
  label: string;
}): JSX.Element {
  return (
    <div className="ps-chips" role="radiogroup" aria-label={label}>
      {none === undefined ? null : (
        <button
          type="button"
          role="radio"
          className="nv-chip"
          aria-checked={value === null}
          onClick={() => {
            onChange(null);
          }}
        >
          {none}
        </button>
      )}
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          className="nv-chip"
          aria-checked={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Two or three exclusive options; the thumb slides and squashes on its way (placeSegmentThumb). */
export function Segment<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Options<V>;
  value: V;
  onChange: (value: V) => void;
  label: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    placeSegmentThumb(
      element,
      index,
      options.length,
      placed.current ? (thumb.current ?? undefined) : undefined,
    );
    placed.current = true;
  }, [index, options.length]);

  return (
    <div className="nv-seg ps-seg" role="radiogroup" aria-label={label} ref={ref}>
      <span className="nv-seg__thumb ps-seg__thumb" ref={thumb} aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="nv-seg__opt"
          aria-checked={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function SwitchRow({
  label,
  detail,
  checked,
  onChange,
  code = false,
  path,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  code?: boolean;
  path?: string;
}): JSX.Element {
  const id = useId();
  const form = useContext(FormContext);
  const changed = path !== undefined && hasChange(form.changed, path);
  return (
    <div className="ps-switch nv-tap" data-path={path} data-changed={changed ? 'true' : undefined}>
      <label htmlFor={id} className="ps-switch__text">
        <span className="ps-switch__label">
          <span className="ps-changed" aria-hidden="true" />
          {label}
          {code ? <CodeTag /> : null}
        </span>
        {detail === undefined ? null : <span className="ps-hint">{detail}</span>}
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}

/**
 * A list of short entries (hobbies, pet names, keywords): Entrée or a comma adds, × removes, a double is refused
 * here already (the schema refuses it too), and so is an entry with nothing `keyOf` keeps (« !!! » as a keyword);
 * the refusal is said in words, not only in colour. Placeholders of the example are not shown; the first real entry replaces them.
 */
export function Entries({
  id,
  values,
  onChange,
  placeholder,
  maxLength,
  keyOf = (value) => value.toLocaleLowerCase('fr'),
}: {
  id: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  maxLength: number;
  /** What two entries share when they count as the same one: their case by default. */
  keyOf?: (value: string) => string;
}): JSX.Element {
  const [text, setText] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const shown = values.filter((v) => !isPlaceholder(v));

  const add = (): void => {
    const entry = text.trim();
    if (entry === '') return;
    if (keyOf(entry) === '') {
      setRefusal('Il faut au moins une lettre ou un chiffre.');
      return;
    }
    if (values.some((v) => keyOf(v) === keyOf(entry))) {
      setRefusal('Déjà dans la liste.');
      return;
    }
    onChange([...shown, entry]);
    setText('');
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && text === '' && shown.length > 0) {
      onChange(shown.slice(0, -1));
    }
  };

  return (
    <>
      <div
        className="nv-glass nv-field__control ps-entries"
        data-refused={refusal === null ? undefined : 'true'}
      >
        {shown.map((value, index) => (
          <span key={`${value}-${String(index)}`} className="ps-entry">
            <span className="ps-entry__text">{value}</span>
            <button
              type="button"
              className="ps-entry__remove"
              aria-label={`Retirer ${value}`}
              onClick={() => {
                onChange(shown.filter((_, i) => i !== index));
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="ps-entries__input"
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={refusal === null ? undefined : true}
          aria-describedby={refusal === null ? undefined : `${id}-refusal`}
          onChange={(event) => {
            setText(event.target.value);
            setRefusal(null);
          }}
          onKeyDown={onKey}
          onBlur={add}
        />
      </div>
      <p id={`${id}-refusal`} className="ps-hint" role="status" hidden={refusal === null}>
        {refusal}
      </p>
    </>
  );
}

/**
 * Several picks from a fixed list, as a select: the picks are tints in the field, typing filters the list below,
 * arrows move, Enter picks or unpicks, Backspace removes the last one, Escape closes.
 */
export function Picker<V extends string>({
  id,
  options,
  values,
  onChange,
  label,
  placeholder,
  empty,
  keepOrder = false,
}: {
  id: string;
  options: Options<V>;
  values: readonly V[];
  onChange: (values: V[]) => void;
  label: string;
  placeholder: string;
  /** Said when typing matches nothing. */
  empty: string;
  /** Her order means something: a new pick goes last instead of taking its place in the options. */
  keepOrder?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `${id}-list`;

  const shown = matchOptions(options, text);
  const labelOf = (v: V): string => options.find((o) => o.value === v)?.label ?? v;
  const toggle = (v: V): void => {
    onChange(keepOrder ? appendPick(values, v) : togglePick(options, values, v));
    setText('');
    setActive(0);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (shown.length === 0 ? 0 : (i + step + shown.length) % shown.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = shown[active];
      if (open && pick !== undefined) toggle(pick.value);
      else setOpen(true);
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div
      className="ps-picker"
      ref={rootRef}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div
        className="nv-glass nv-field__control ps-entries ps-picker__field"
        data-open={open ? 'true' : undefined}
        onClick={() => {
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {values.map((value) => (
          <span key={value} className="ps-entry">
            <span className="ps-entry__text">{labelOf(value)}</span>
            <button
              type="button"
              className="ps-entry__remove"
              aria-label={`Retirer ${labelOf(value)}`}
              onClick={(event) => {
                event.stopPropagation();
                toggle(value);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          className="ps-entries__input"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].value}` : undefined}
          autoComplete="off"
          value={text}
          placeholder={values.length === 0 ? placeholder : 'Ajouter…'}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onKeyDown={onKey}
        />
        <span className="ps-picker__chevron" aria-hidden="true" />
      </div>
      {open ? (
        <ul className="nv-glass ps-picker__list" role="listbox" id={listId} aria-multiselectable="true">
          {shown.length === 0 ? <li className="ps-picker__empty">{empty}</li> : null}
          {shown.map((option, index) => {
            const on = values.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${listId}-${option.value}`}
                role="option"
                aria-selected={on}
                className="ps-picker__option"
                data-active={index === active ? 'true' : undefined}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onMouseDown={(event) => {
                  // Keeps the focus in the field, so the list stays open for the next pick.
                  event.preventDefault();
                }}
                onClick={() => {
                  toggle(option.value);
                }}
              >
                <span className="ps-picker__check" aria-hidden="true" />
                {option.label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A folded block with its one-line summary (docs/design/README.md, « Hiérarchie »). */
export function Fold({
  title,
  summary,
  children,
  open,
  code = false,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  /** Opened when it comes to hold an error; never closed by it: only the reader folds it again. */
  open?: boolean | undefined;
  code?: boolean;
}): JSX.Element {
  // Not a controlled `open`: React would remove the attribute, and fold the block under the typing, the moment the
  // error clears (recette 28/10, a « 40 » saved as 4).
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    if (open === true && ref.current !== null) ref.current.open = true;
  }, [open]);
  return (
    <details className="nv-disclosure ps-fold" ref={ref}>
      <summary>
        <span className="nv-disclosure__title">{title}</span>
        {code ? <CodeTag /> : null}
        <span className="nv-disclosure__sum">{summary}</span>
      </summary>
      <div className="nv-disclosure__body ps-fold__body">{children}</div>
    </details>
  );
}
