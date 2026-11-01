import type { JSX, ReactNode } from 'react';

import { initials } from './model';

/**
 * « Ce que reçoit le groupe »: a Telegram chat drawn with invented content, so the reader sees the message before
 * the first one arrives. Nothing here is real: no fan, no group of ours, no sale.
 */
export function GroupPreview({
  isOpen,
  group,
  heading,
  points,
  children,
}: {
  /** Folded once the groups have received real messages: the example then only takes room (recette du 29/10). */
  isOpen: boolean;
  group: string;
  heading: string;
  points: readonly ReactNode[];
  children: ReactNode;
}): JSX.Element {
  return (
    <details className="nv-disclosure nv-plate" open={isOpen}>
      <summary>
        <span className="nv-disclosure__title">Voir un exemple de message</span>
        <span className="nv-disclosure__sum">Ce que reçoit le groupe {group}</span>
      </summary>
      <div className="nv-disclosure__body tg-preview">
        <div className="tg-phone" role="img" aria-label={`Exemple de message dans ${group}`}>
          <div className="tg-phone__bar">
            <span className="tg-phone__av">{initials(group)}</span>
            <div>
              <b>{group}</b>
              <small>groupe · avec le bot</small>
            </div>
          </div>
          {children}
        </div>
        <div className="tg-preview__note">
          <h3>{heading}</h3>
          <ul>
            {points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

export function PreviewMessage({
  from,
  time,
  isSilent = false,
  quote,
  edit,
  children,
}: {
  from: string;
  time: string;
  isSilent?: boolean;
  quote?: string;
  edit?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="tg-msg" data-reply={quote !== undefined}>
      <div className="tg-msg__from">{from}</div>
      {quote === undefined ? null : <span className="tg-msg__quote">{quote}</span>}
      {children}
      {edit === undefined ? null : <span className="tg-msg__edit">{edit}</span>}
      <span className="tg-msg__meta">
        {time}
        {isSilent ? ' 🔕' : ''}
      </span>
    </div>
  );
}
