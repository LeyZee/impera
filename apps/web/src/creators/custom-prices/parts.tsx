import { useId, type JSX, type ReactNode } from 'react';

/* The pieces of the custom price sheet: a card, a number with its unit, « Elle le fait ». */

export function Card({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <div className="nv-plate ps-panel smp-card" role="group" aria-labelledby={id}>
      <div className="smp-card__head">
        <h3 className="nv-h2 smp-card__title" id={id}>
          {title}
        </h3>
        <p className="ps-muted">{lead}</p>
      </div>
      {children}
    </div>
  );
}

/** A number typed in a field with its unit inside, at its end (€, €/min, %, min). */
export function UnitInput({
  label,
  value,
  unit,
  problem,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  unit: string;
  problem: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="smp-unit">
      <label className="smp-unit__label" htmlFor={id}>
        {label}
      </label>
      <div className="smp-unit__box">
        <input
          id={id}
          className="nv-glass nv-field__control ps-input smp-unit__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="—"
          value={value}
          disabled={disabled}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : `${id}-error`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className="smp-unit__sign" aria-hidden="true">
          {unit}
        </span>
      </div>
      {problem === undefined ? null : (
        <p className="ps-error smp-unit__error" id={`${id}-error`}>
          {problem}
        </p>
      )}
    </div>
  );
}

/** « Elle le fait » : the design system's switch, never a bare checkbox. */
export function Offered({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="smp-offered">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={checked}
        disabled={disabled}
        aria-label={`${label} : elle le fait`}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label htmlFor={id} className="smp-offered__text" aria-hidden="true">
        {checked ? 'Elle le fait' : 'Jamais'}
      </label>
    </div>
  );
}
