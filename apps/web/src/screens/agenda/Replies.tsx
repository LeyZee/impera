import type { JSX } from 'react';

import { repliesText, type ReplyLine } from './replies';

/** Under the Programme of her day: one discreet line per platform, nothing when nobody is planned. */
export function DayReplies({ lines }: { lines: readonly ReplyLine[] }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="ag-replies">
      {lines.map((line) => (
        <p key={line.platform}>
          <span aria-hidden="true">💬 </span>
          Qui répond à tes fans dans {line.label} :{' '}
          <span className="ag-replies__who">{repliesText(line)}</span>
        </p>
      ))}
    </div>
  );
}

/** In a day of her week: the names and hours only, the platform said when she has several. */
export function ShortReplies({ lines }: { lines: readonly ReplyLine[] }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="ag-replies ag-replies--short">
      {lines.map((line) => (
        <p key={line.platform}>
          <span aria-hidden="true">💬 </span>
          <span className="ag-sr">Qui répond à tes fans dans {line.label} : </span>
          {lines.length > 1 ? <span aria-hidden="true">{line.label} : </span> : null}
          {repliesText(line)}
        </p>
      ))}
    </div>
  );
}
