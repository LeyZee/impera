import { useEffect, useState, type JSX } from 'react';

import { dayOfInput, inputOfDay } from './time';

/**
 * A day, typed as text (« 28/03/2027 », « 28/3 », « 2803 » from the phone's number pad): never `<input type="date">`,
 * which Chromium writes in the system's language (« 03/28/2027 ») whatever the page's `lang`, with the system's own
 * calendar (recette #561), as `TimeField` does the hours. While it is typed, the field keeps what is written; a full day
 * goes to the form at once, and leaving the field writes it back as `jj/mm/aaaa`. What is not a day stays as typed,
 * marked, and is told to the form through `onUnreadable`, which then refuses to save.
 */
export function DayField({
  id,
  value,
  today,
  invalid = false,
  className,
  onChange,
  onUnreadable,
}: {
  /** For the form's `<label htmlFor>`. */
  id: string;
  /** `YYYY-MM-DD`. */
  value: string;
  /** The day a year left out is counted from: « 28/3 » is the first 28 March from it on. */
  today: string;
  /** The form refuses the day (before today, before the member's arrival): marked as such. */
  invalid?: boolean;
  className?: string;
  onChange: (day: string) => void;
  /** Stable: told when the field holds what is not a day, and when it no longer does. */
  onUnreadable: (unreadable: boolean) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const unreadable = draft !== null && dayOfInput(draft, today) === null;
  // Set from outside while it was unreadable: the field shows the form's day again.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (unreadable) setDraft(null);
  }
  useEffect(() => {
    onUnreadable(unreadable);
  }, [unreadable, onUnreadable]);
  // A field taken away no longer holds the form back.
  useEffect(
    () => () => {
      onUnreadable(false);
    },
    [onUnreadable],
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
      value={draft ?? inputOfDay(value)}
      aria-invalid={unreadable || invalid ? true : undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        // Empty or half typed: the form keeps its last full day, and is told the field cannot be saved.
        const day = dayOfInput(event.target.value, today);
        if (day !== null) onChange(day);
      }}
      onBlur={() => {
        if (!unreadable) setDraft(null);
      }}
    />
  );
}
