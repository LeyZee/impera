import type { JSX, ReactNode } from 'react';

/** A card of Réglages › Facturation: its title, what it prints and where, and its « Changer ». */
export function Card({
  index,
  title,
  sub,
  action = 'Changer',
  onChange,
  children,
}: {
  index: number;
  title: string;
  sub: string;
  /** The button's word: « Changer » a setting, « Nouvelle version » of a text that never changes. */
  action?: string;
  onChange: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="nv-plate rp-account nv-enter" style={{ '--nv-i': Math.min(index + 1, 8) }}>
      <div className="rp-account__head">
        <div className="rp-account__who">
          <h2 className="rp-account__name">{title}</h2>
          <p className="rp-account__handle">{sub}</p>
        </div>
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          aria-label={`${action} : ${title}`}
          onClick={onChange}
        >
          {action}
        </button>
      </div>
      <div className="bf-card__body">{children}</div>
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
