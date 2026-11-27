import { useCallback, useEffect, useId, useState, type JSX } from 'react';

import { clockOf, inputOf, minuteOfInput } from './time';

/**
 * An hour on 24 hours, typed as text (« 09:00 », « 21h30 », « 22 », « 930 » from the phone's number pad, which has
 * neither « : » nor « h » on iOS): never `<input type="time">`, which Chromium writes in the system's language
 * (« 09:00 AM ») whatever the page's `lang` (recette 28/10). While it is typed, the field keeps what is written; a full
 * hour goes to the form at once, and leaving the field writes it back as `HH:MM`. What is not an hour stays as typed,
 * marked, and is told to the form through `onUnreadable`, which then refuses to save: the form never keeps an hour
 * other than the one on screen (relecture Équipe, #301). Créatrices' hours and Équipe's shifts use it alike.
 */
export function TimeField({
  value,
  label,
  className,
  disabled = false,
  spoken = false,
  onChange,
  onUnreadable,
}: {
  /** Minutes from midnight. */
  value: number;
  label: string;
  className?: string;
  disabled?: boolean;
  /**
   * Out of the field, the hour as the app writes it elsewhere (« 22 h », « 8 h 30 »), `HH:MM` again while it is typed
   * in (recette visuelle 16/11, CHA-26: Notifications said « 22:00 » over « Calme de 22 h à 8 h »).
   */
  spoken?: boolean;
  onChange: (minute: number) => void;
  /** From `useUnreadableTimes` (stable): told when the field holds what is not an hour, and when it no longer does. */
  onUnreadable: (field: string, unreadable: boolean) => void;
}): JSX.Element {
  const field = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const unreadable = draft !== null && minuteOfInput(draft) === null;
  // Set from outside (a slot reset, the defaults back) while it was unreadable: the field shows the form's hour again.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (unreadable) setDraft(null);
  }
  useEffect(() => {
    onUnreadable(field, unreadable);
  }, [field, unreadable, onUnreadable]);
  // A field taken away (a slot removed) no longer holds the form back.
  useEffect(
    () => () => {
      onUnreadable(field, false);
    },
    [field, onUnreadable],
  );
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={6}
      placeholder="HH:MM"
      className={`nv-field__control nv-glass nv-num${className === undefined ? '' : ` ${className}`}`}
      value={draft ?? (spoken && !focused ? clockOf(value) : inputOf(value))}
      aria-label={label}
      disabled={disabled}
      aria-invalid={unreadable ? true : undefined}
      onChange={(event) => {
        setDraft(event.target.value);
        // Empty or half typed: the form keeps its last full hour, and is told the field cannot be saved.
        const minute = minuteOfInput(event.target.value);
        if (minute !== null) onChange(minute);
      }}
      onFocus={(event) => {
        setFocused(true);
        // The whole hour chosen, once it reads HH:MM: what is typed replaces it, never lands in its middle (recette MOD-07).
        const input = event.currentTarget;
        requestAnimationFrame(() => {
          input.select();
        });
      }}
      onBlur={() => {
        setFocused(false);
        // A full hour is written back as HH:MM (« 22 h » when spoken); anything else stays as typed, to be corrected.
        if (!unreadable) setDraft(null);
      }}
    />
  );
}

/** The time and day fields of one form that hold what is not an hour or a day: while there is one, the form does not save. */
export function useUnreadableTimes(): {
  unreadable: boolean;
  isUnreadable: (field: string) => boolean;
  onUnreadable: (field: string, unreadable: boolean) => void;
} {
  const [fields, setFields] = useState<ReadonlySet<string>>(() => new Set());
  const onUnreadable = useCallback((field: string, unreadable: boolean) => {
    setFields((before) => {
      if (before.has(field) === unreadable) return before;
      const after = new Set(before);
      if (unreadable) after.add(field);
      else after.delete(field);
      return after;
    });
  }, []);
  const isUnreadable = useCallback((field: string) => fields.has(field), [fields]);
  return { unreadable: fields.size > 0, isUnreadable, onUnreadable };
}
