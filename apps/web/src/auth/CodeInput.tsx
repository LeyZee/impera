import type { JSX, KeyboardEvent, Ref } from 'react';

import './code-input.css';

/**
 * The code every confirmation asks with the password (ADR 0046 § 3): the 6 digits of the authenticator app, or a
 * backup code. Its label stays visible above the field, so nobody wonders which code (relecture Extension de SEC-02).
 * Digits on a phone keyboard, filled by the system when it offers the code; short, beside the password.
 */
export function CodeInput({
  ref,
  disabled,
  invalid,
  label = 'Code à 6 chiffres ou de secours',
  onKeyDown,
}: {
  ref: Ref<HTMLInputElement>;
  disabled: boolean;
  invalid: boolean;
  label?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label className="nv-field nv-code">
      <span className="nv-field__label nv-code__label">{label}</span>
      <input
        ref={ref}
        className="nv-field__control nv-glass font-mono tracking-[0.12em]"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={13}
        placeholder="123 456"
        aria-invalid={invalid}
        disabled={disabled}
        onKeyDown={onKeyDown}
      />
    </label>
  );
}
