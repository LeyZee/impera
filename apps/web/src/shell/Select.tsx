import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

/** One choice of a `Select`: what the form keeps, what the list says, and optionally its group and a quieter line. */
export interface SelectOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** Said after the label, quieter (« 2 comptes », a handle). */
  readonly hint?: string;
  /** The heading it is listed under; options of one group follow each other. */
  readonly group?: string;
  readonly disabled?: boolean;
}

/** Lower case without accents, for « éq » to find « Équipe ». */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * The options whose label holds the typed text, all of them while nothing is typed. Within its group, a choice with a
 * word that begins with the text comes first: « mont » gives « Montréal » before « Edmonton ».
 */
export function matchSelect<V extends string>(
  options: readonly SelectOption<V>[],
  text: string,
): SelectOption<V>[] {
  const wanted = fold(text.trim());
  if (wanted === '') return [...options];
  const groups: (string | undefined)[] = [];
  const found = options
    .map((one, at) => {
      const words = fold(`${one.label} ${one.hint ?? ''}`);
      if (!words.includes(wanted)) return null;
      if (!groups.includes(one.group)) groups.push(one.group);
      const starts = words.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(wanted));
      return { one, at, group: groups.indexOf(one.group), rank: starts ? 0 : 1 };
    })
    .filter((hit) => hit !== null);
  return found.toSorted((a, b) => a.group - b.group || a.rank - b.rank || a.at - b.at).map((hit) => hit.one);
}

/** Above this many options, the list opens with a field to find one by typing. */
const SEARCH_FROM = 10;
/** The room the list wants under its field, search included, before it opens above it instead. */
const POP_ROOM = 360;
/** The space between the field and its list. */
const GAP = 4;
/**
 * How far the list reaches past each side of its field: its rounded corners then fall outside the text under the field,
 * so nothing of it shows between the field and the list (recette #566).
 */
const OUTSET = 4;

/**
 * The design system's list (consigne de Charles, 05/11: no control of the system, a `<select>` least of all): a field
 * that says the choice, and under it the list in a plate of its own, Nuit and Jour alike. Arrows, Home and End move,
 * Enter or a click picks, Escape or a click elsewhere closes and gives the focus back. A long list (more than ten)
 * opens with a field to find a choice by typing; a short one finds it from its first letters. A handful of choices
 * (five or fewer) reads better as chips (`nv-chip` in a radiogroup) than as a list.
 */
export function Select<V extends string>({
  id,
  value,
  options,
  onChange,
  placeholder = 'Choisir…',
  disabled = false,
  invalid = false,
  className,
  searchLabel = 'Chercher',
  empty = 'Aucun choix ne correspond.',
  describedBy,
  ariaLabel,
  autofocus = false,
}: {
  /** For the form's `<label htmlFor>`: the field is named by its label. */
  id?: string;
  /** The current choice; one not in `options` shows as itself. */
  value: V | '';
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  /** Said while nothing is chosen. */
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** The name of the field that finds a choice in a long list. */
  searchLabel?: string;
  /** Said when the typed text finds nothing. */
  empty?: string;
  describedBy?: string;
  /** Its name where no visible label names it (a row's own list: « Compte de Lune »). */
  ariaLabel?: string;
  /** The field a dialog focuses first (`data-autofocus`, read by `Dialog`). */
  autofocus?: boolean;
}): JSX.Element {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ host: HTMLElement; style: CSSProperties; above: boolean } | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const searchable = options.length > SEARCH_FROM;
  const shown = searchable ? matchSelect(options, text) : [...options];
  const current = options.find((one) => one.value === value);

  const openAt = (index: number): void => {
    if (disabled) return;
    setText('');
    setActive(Math.max(0, index));
    setOpen(true);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (option: SelectOption<V> | undefined): void => {
    if (option === undefined || option.disabled === true) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };
  const move = (from: number, step: number): number => {
    if (shown.length === 0) return 0;
    let next = from;
    do {
      next += step;
      if (next < 0 || next >= shown.length) return from;
    } while (shown[next]?.disabled === true);
    return next;
  };

  /*
   * The list lives at the top of the page (or of the dialog around it), placed under its field: no plate drawn after it,
   * no scrolling panel, can cover or cut it. It opens above its field when the screen has no room for it below (a field
   * low in the page, a phone), and follows its field when the page scrolls.
   */
  useLayoutEffect(() => {
    const field = trigger.current;
    if (!open || field === null) {
      setPlace(null);
      return;
    }
    const host = field.closest<HTMLElement>('.tm-scrim') ?? document.body;
    const follow = (): void => {
      const box = field.getBoundingClientRect();
      const below = window.innerHeight - box.bottom;
      const above = below < POP_ROOM && box.top > below;
      setPlace({
        host,
        above,
        style: {
          left: box.left - OUTSET,
          width: box.width + 2 * OUTSET,
          ...(above ? { bottom: window.innerHeight - box.top + GAP } : { top: box.bottom + GAP }),
        },
      });
    };
    follow();
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);
  // The search field takes the focus when the list opens; the active option stays in view.
  const placed = place !== null;
  useEffect(() => {
    if (open && placed && searchable) search.current?.focus();
  }, [open, placed, searchable]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, placed, active]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    const key = event.key;
    if (!open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        openAt(options.findIndex((one) => one.value === value));
      }
      return;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => move(index, key === 'ArrowDown' ? 1 : -1));
    } else if (key === 'Home' || key === 'End') {
      event.preventDefault();
      setActive(key === 'Home' ? move(-1, 1) : move(shown.length, -1));
    } else if (key === 'Enter' || (key === ' ' && !searchable)) {
      event.preventDefault();
      pick(shown[active]);
    } else if (key === 'Escape') {
      event.preventDefault();
      // The list closes, not the dialog around it.
      event.stopPropagation();
      close(true);
    } else if (key === 'Tab') {
      // From the search field, the focus goes back to the field first: Tab then goes on from there.
      close(searchable);
    } else if (!searchable && key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // A short list finds a choice from the first letters typed in a row.
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + fold(key), at: now };
      const found = shown.findIndex(
        (one) => one.disabled !== true && fold(one.label).startsWith(typed.current.text),
      );
      if (found >= 0) setActive(found);
    }
  };

  let lastGroup: string | undefined;
  const items: ReactNode[] = [];
  shown.forEach((option, index) => {
    if (option.group !== undefined && option.group !== lastGroup) {
      items.push(
        <li key={`group-${option.group}`} className="nv-select__group" role="presentation">
          {option.group}
        </li>,
      );
    }
    lastGroup = option.group;
    items.push(
      <li
        key={option.value}
        id={`${listId}-${String(index)}`}
        role="option"
        className="nv-select__option"
        data-value={option.value}
        aria-selected={option.value === value}
        aria-disabled={option.disabled === true ? true : undefined}
        data-active={index === active ? 'true' : undefined}
        onMouseEnter={() => {
          if (option.disabled !== true) setActive(index);
        }}
        onMouseDown={(event) => {
          // The focus stays where it is until the pick moves it back to the field.
          event.preventDefault();
        }}
        onClick={() => {
          pick(option);
        }}
      >
        <span className="nv-select__label">
          {option.label}
          {/* A space for the name read aloud: « Lune, relié à @lune », never « Lunerelié ». */}
          {option.hint === undefined ? null : (
            <>
              {' '}
              <span className="nv-select__hint">{option.hint}</span>
            </>
          )}
        </span>
        <svg className="nv-select__tick" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3.5 8.5 3 3 6-7" />
        </svg>
      </li>,
    );
  });

  const activeId = open && shown[active] !== undefined ? `${listId}-${String(active)}` : undefined;
  return (
    <div
      ref={root}
      className={cn('nv-select', className)}
      data-open={open ? 'true' : undefined}
      onBlur={(event) => {
        const to = event.relatedTarget;
        if (!(root.current?.contains(to) ?? false) && !(pop.current?.contains(to) ?? false)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className="nv-field__control nv-glass nv-select__field"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={searchable ? undefined : activeId}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        data-autofocus={autofocus ? true : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) close(false);
          else openAt(options.findIndex((one) => one.value === value));
        }}
        onKeyDown={onKeyDown}
      >
        <span
          className={cn(
            'nv-select__value',
            current === undefined && value === '' && 'nv-select__value--empty',
          )}
        >
          {current === undefined ? (value === '' ? placeholder : value) : current.label}
          {current?.hint === undefined ? null : (
            <>
              {' '}
              <span className="nv-select__hint">{current.hint}</span>
            </>
          )}
        </span>
        <svg className="nv-select__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && place !== null
        ? createPortal(
            <div
              ref={pop}
              className="nv-select__pop"
              data-side={place.above ? 'top' : undefined}
              style={place.style}
              onMouseDown={(event) => {
                // A press on the plate keeps the focus where it is: only the search field takes it.
                if (event.target !== search.current) event.preventDefault();
              }}
            >
              {searchable ? (
                <input
                  ref={search}
                  className="nv-select__search"
                  type="text"
                  role="combobox"
                  aria-label={searchLabel}
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={`${searchLabel}…`}
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKeyDown}
                />
              ) : null}
              <ul ref={list} id={listId} className="nv-select__list" role="listbox">
                {shown.length === 0 ? (
                  <li className="nv-select__empty" role="presentation">
                    {empty}
                  </li>
                ) : (
                  items
                )}
              </ul>
            </div>,
            place.host,
          )
        : null}
    </div>
  );
}
