import type { JSX, ReactNode } from 'react';

import type { HelpGuide } from './guides';

import { NavIcon } from '@/shell/NavIcon';

/** `<kbd>X</kbd>` in a guide's text becomes the design system's key; everything else stays plain text. */
export function withKeys(text: string): ReactNode {
  const parts = text.split(/<kbd>(.*?)<\/kbd>/u);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <kbd key={index} className="nv-kbd">
        {part}
      </kbd>
    ) : (
      part
    ),
  );
}

const STAR = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2.8l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.4l6.2-.9z" />
  </svg>
);

function Box({
  kind,
  title,
  lines,
}: {
  kind: 'rule' | 'never' | 'stuck';
  title: string;
  lines: readonly string[] | undefined;
}): JSX.Element | null {
  if (lines === undefined || lines.length === 0) return null;
  return (
    <div className={`nv-guide__box nv-guide__box--${kind}`}>
      <h4>{title}</h4>
      <ul>
        {lines.map((line) => (
          <li key={line}>{withKeys(line)}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One guide, folded: its icon, its title, why it matters in a line, its time. Opened: the steps, each with what proves
 * it worked, then « À savoir », « Jamais » and « Si ça coince ». The colour is the page's (`colour`), never the guide's
 * own (choix de Charles du 21/11 : une couleur par page, celle de la personne).
 */
export function Guide({
  guide,
  colour,
  index = 0,
  open = false,
}: {
  guide: HelpGuide;
  /** A CSS colour: the person's, the same for every guide of the page. */
  colour: string;
  /** Its rank on the page, for the entrance one stagger apart. */
  index?: number;
  open?: boolean;
}): JSX.Element {
  return (
    <details
      className="nv-guide"
      id={`guide-${guide.id}`}
      style={{ '--_c': colour, '--nv-i': index }}
      open={open}
    >
      <summary>
        <span className="nv-guide__icon" aria-hidden="true">
          <NavIcon name={guide.icon} />
        </span>
        <span className="nv-guide__head">
          <span className="nv-guide__title">
            {guide.title}
            {guide.essential === true ? (
              <span className="nv-guide__key">
                {STAR}
                Essentiel
              </span>
            ) : null}
          </span>
          <span className="nv-guide__sum">{guide.summary}</span>
        </span>
        <span className="nv-guide__time">{guide.minutes}</span>
        <span className="nv-guide__chev" aria-hidden="true" />
      </summary>
      <div className="nv-guide__body">
        {guide.why === undefined ? null : <p className="nv-guide__why">{guide.why}</p>}
        {guide.chips === undefined ? null : (
          <div className="nv-guide__chips">
            {guide.chips.map((chip) => (
              <span key={chip.text} className={`nv-guide__chip nv-guide__chip--${chip.tone}`}>
                {chip.text}
              </span>
            ))}
          </div>
        )}
        <ol className="nv-guide__steps">
          {guide.steps.map((step) => (
            <li key={step.do}>
              <div>
                <span className="nv-guide__do">{withKeys(step.do)}</span>
                <span className="nv-guide__see">Tu dois voir : {withKeys(step.see)}</span>
              </div>
            </li>
          ))}
        </ol>
        <Box kind="rule" title="À savoir" lines={guide.rule} />
        <Box kind="never" title="Jamais" lines={guide.never} />
        <Box kind="stuck" title="Si ça coince" lines={guide.stuck} />
      </div>
    </details>
  );
}
