import { useState, type JSX } from 'react';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * The day a date field holds, as `YYYY-MM-DD`: « 28/02/1999 », « 28.02.1999 », « 28-02-1999 », « 28 02 1999 » or
 * « 28021999 » from the phone's number pad; null while it is half typed or not a day of the calendar (« 31/02 »).
 */
export function dayOfInput(text: string): string | null {
  const typed = text.trim();
  const match =
    /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/u.exec(typed) ?? /^(\d{2})(\d{2})(\d{4})$/u.exec(typed);
  if (match === null) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? `${String(year)}-${pad(month)}-${pad(day)}` : null;
}

/** `YYYY-MM-DD` into the field's « 28/02/1999 »; anything else, the empty field. */
export function inputOfDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  return match === null ? '' : `${match[3] ?? ''}/${match[2] ?? ''}/${match[1] ?? ''}`;
}

/**
 * A day typed as text, « jj/mm/aaaa » (recette 05/11, PRO-11): never `<input type="date">`, which Chromium writes in
 * the system's language (« mm/dd/yyyy » on a machine in English) whatever the page's `lang`, as `TimeField` does for
 * the hours. While it is typed the field keeps what is written; a full day goes to the form at once, and anything
 * else gives it the empty day, which the form refuses to save: it never keeps a day other than the one on screen.
 */
export function DayField({
  id,
  value,
  onChange,
  className = 'nv-glass nv-field__control ps-input',
  invalid = false,
  disabled = false,
  describedBy,
}: {
  id: string;
  /** `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (day: string) => void;
  className?: string;
  /** Refused by the form as it stands (a day too early): said on the control itself. */
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string | undefined;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const unreadable = draft !== null && draft.trim() !== '' && dayOfInput(draft) === null;
  // Set from outside (the draft undone, a save): the field shows the form's day again.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const produced = draft === null ? null : (dayOfInput(draft) ?? '');
    if (produced !== value) setDraft(null);
  }
  const error = `${id}-unreadable`;
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        placeholder="jj/mm/aaaa"
        className={className}
        value={draft ?? inputOfDay(value)}
        disabled={disabled}
        aria-invalid={invalid || unreadable ? true : undefined}
        aria-describedby={unreadable && left ? error : describedBy}
        onChange={(event) => {
          setDraft(event.target.value);
          setLeft(false);
          onChange(dayOfInput(event.target.value) ?? '');
        }}
        onBlur={() => {
          setLeft(true);
          if (!unreadable) setDraft(null);
        }}
      />
      {unreadable && left ? (
        <p className="ps-error" id={error}>
          Une date comme 28/02/1999 : jour, mois, année.
        </p>
      ) : null}
    </>
  );
}
