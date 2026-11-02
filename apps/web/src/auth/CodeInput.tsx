import type { JSX, KeyboardEvent, Ref } from 'react';

/**
 * The code every confirmation asks with the password (ADR 0046 § 3): the 6 digits of the authenticator app, or a
 * backup code. Digits on a phone keyboard, filled by the system when it offers the code; short, beside the password.
 */
export function CodeInput({
  ref,
  disabled,
  invalid,
  label = 'Code à 6 chiffres',
  onKeyDown,
}: {
  ref: Ref<HTMLInputElement>;
  disabled: boolean;
  invalid: boolean;
  label?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <input
      ref={ref}
      className="nv-field__control nv-glass max-w-[11rem] font-mono tracking-[0.12em]"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoCapitalize="off"
      spellCheck={false}
      maxLength={13}
      placeholder="123 456"
      aria-label={label}
      aria-invalid={invalid}
      disabled={disabled}
      onKeyDown={onKeyDown}
    />
  );
}
