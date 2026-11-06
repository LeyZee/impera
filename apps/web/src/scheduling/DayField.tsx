import { useEffect, useRef, useState, type JSX } from 'react';

import { dayOf, dayOfInput, inputOfDay, isDayShaped, readerZone, type DayToward } from './time';

/** What a form says under a day field holding a day no calendar has (« 31/02 »), rather than how to write one. */
export const NO_SUCH_DAY = 'Ce jour n’existe pas.';

/**
 * A day, typed as text (« 28/03/2027 », « 28/3 », « 2803 » from the phone's number pad): never `<input type="date">`,
 * which Chromium writes in the system's language (« 03/28/2027 ») whatever the page's `lang`, with the system's own
 * calendar (recette #561), as `TimeField` does the hours. While it is typed, the field keeps what is written; a full day
 * goes to the form at once, and leaving the field writes it back as `jj/mm/aaaa`. What is not a day stays as typed,
 * marked once the field is left, and is told to the form through `onUnreadable`, which then refuses to save. A field the form may leave empty
 * (`optional`) gives it `''` once emptied. Shared by every day of the CRM (consigne de Charles du 05/11 : aucun
 * sélecteur de date du système).
 */
export function DayField({
  id,
  value,
  today = dayOf(new Date(), readerZone()),
  invalid = false,
  className,
  toward = 'ahead',
  optional = false,
  disabled = false,
  autofocus = false,
  describedBy,
  onChange,
  onUnreadable,
}: {
  /** For the form's `<label htmlFor>`. */
  id?: string | undefined;
  /** `YYYY-MM-DD`. */
  value: string;
  /** The day a year left out is counted from: « 28/3 » is the first 28 March from it on. The reader's own by default. */
  today?: string;
  /** The form refuses the day (before today, before the member's arrival): marked as such. */
  invalid?: boolean;
  className?: string;
  /** Where a day typed without its year is looked for: from `today` on, or up to it (a birth, a validation). */
  toward?: DayToward;
  /** The form may leave it empty: emptied, it gives `''`, which is no fault. */
  optional?: boolean;
  disabled?: boolean;
  /** The field a dialog focuses first (`data-autofocus`, read by `Dialog`). */
  autofocus?: boolean;
  describedBy?: string | undefined;
  onChange: (day: string) => void;
  /**
   * Told when the field holds what is not a day, and when it no longer does: the form then refuses to save.
   * `noSuchDay` says it is written as a day the calendar has not (« 31/02 »), for the form to say so in its words.
   */
  onUnreadable?: (unreadable: boolean, noSuchDay: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  // Marked once left, not at the first digit typed: « 2 » is no day yet, « 28/3 » is.
  const [left, setLeft] = useState(false);
  const isEmpty = (text: string): boolean => optional && text.trim() === '';
  const unreadable = draft !== null && !isEmpty(draft) && dayOfInput(draft, today, toward) === null;
  const noSuchDay = draft !== null && unreadable && isDayShaped(draft);
  // Set from outside (a form emptied once saved, a preset chosen): the field shows the form's day again, unless it is
  // the very day being typed.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    const typed = draft === null ? null : isEmpty(draft) ? '' : dayOfInput(draft, today, toward);
    if (typed !== value) setDraft(null);
  }
  // The form's latest callback, so that it may be written inline.
  const tell = useRef(onUnreadable);
  useEffect(() => {
    tell.current = onUnreadable;
  });
  useEffect(() => {
    tell.current?.(unreadable, noSuchDay);
  }, [unreadable, noSuchDay]);
  // A field taken away no longer holds the form back.
  useEffect(
    () => () => {
      tell.current?.(false, false);
    },
    [],
  );
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={10}
      placeholder="jj/mm/aaaa"
      className={`nv-field__control nv-glass nv-num${className === undefined ? '' : ` ${className}`}`}
      value={draft ?? (value === '' ? '' : inputOfDay(value))}
      disabled={disabled}
      data-autofocus={autofocus ? true : undefined}
      aria-invalid={(unreadable && left) || invalid ? true : undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        setDraft(event.target.value);
        setLeft(false);
        if (isEmpty(event.target.value)) {
          onChange('');
          return;
        }
        // Empty or half typed: the form keeps its last full day, and is told the field cannot be saved.
        const day = dayOfInput(event.target.value, today, toward);
        if (day !== null) onChange(day);
      }}
      onBlur={() => {
        setLeft(true);
        if (!unreadable) setDraft(null);
      }}
    />
  );
}
