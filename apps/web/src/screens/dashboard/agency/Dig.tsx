import type { JSX, ReactNode } from 'react';

/*
 * « Pour creuser » on the owner's Dashboard (maquette du 27/11, D4 and D5 of the audit): each analysis folded on one
 * line that already gives its answer, opened on demand. Its body mounts when it opens, so its figures draw in then.
 * A card with nothing to say is not listed: it is named in one quiet line under the others.
 */

export interface DigItem {
  readonly key: string;
  readonly title: string;
  readonly icon: ReactNode;
  /** The answer without opening, one line; null when the card has nothing to say yet. */
  readonly answer: string | null;
  /** What the quiet line says while the card has nothing to say. */
  readonly silent: string;
  readonly body: () => ReactNode;
}

export function Dig({
  items,
  opened,
  onToggle,
}: {
  items: readonly DigItem[];
  opened: ReadonlySet<string>;
  onToggle: (key: string, open: boolean) => void;
}): JSX.Element | null {
  const speaking = items.filter((item) => item.answer !== null);
  const silent = items.filter((item) => item.answer === null);
  if (speaking.length === 0 && silent.length === 0) return null;
  return (
    <>
      {speaking.length === 0 ? null : (
        <div className="nv-plate own-dig">
          {speaking.map((item) => {
            const open = opened.has(item.key);
            return (
              <details
                key={item.key}
                id={`creuser-${item.key}`}
                className="nv-disclosure own-dig__item"
                open={open}
                onToggle={(event) => {
                  const now = event.currentTarget.open;
                  if (now !== open) onToggle(item.key, now);
                }}
              >
                <summary>
                  <span className="own-dig__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="own-dig__text">
                    <span className="nv-disclosure__title">{item.title}</span>
                    <span className="own-dig__answer-m">{item.answer}</span>
                  </span>
                  <span className="nv-disclosure__sum own-dig__answer">{item.answer}</span>
                </summary>
                {open ? <div className="own-dig__body">{item.body()}</div> : null}
              </details>
            );
          })}
        </div>
      )}
      {silent.length === 0 ? null : (
        <p className="own-quiet">
          <em>Se montreront quand ils auront de quoi dire :</em>{' '}
          {silent.map((item) => item.silent).join(', ')}.
        </p>
      )}
    </>
  );
}
