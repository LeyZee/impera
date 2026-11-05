import { CREATOR_REPLIES_EMOJI } from '@impera/contracts';
import type { JSX } from 'react';

import type { Reply, ReplyLine } from './replies';

/** « Kofi 14 h – 18 h »: a name and its hours, never cut between two lines. */
function Who({ reply }: { reply: Reply }): JSX.Element {
  return (
    <span className="ag-replies__one">
      {reply.name} <span className="nv-num">{reply.when}</span>
    </span>
  );
}

/** The people of a line, separated by commas. */
function People({ line }: { line: ReplyLine }): JSX.Element {
  return (
    <>
      {line.replies.map((reply, index) => (
        <span key={reply.key}>
          {index > 0 ? ', ' : null}
          <Who reply={reply} />
        </span>
      ))}
    </>
  );
}

/** Under the Programme of her day: one discreet line per platform, nothing when nobody is planned. */
export function DayReplies({ lines }: { lines: readonly ReplyLine[] }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="ag-replies">
      {lines.map((line) => (
        <p key={line.platform}>
          <span aria-hidden="true">{CREATOR_REPLIES_EMOJI} </span>
          Qui répond à tes fans dans {line.label} :{' '}
          <span className="ag-replies__who">
            <People line={line} />
          </span>
        </p>
      ))}
    </div>
  );
}

/** In a day of Ma semaine: the names and hours only, the platform said when she has several. */
export function ShortReplies({ lines }: { lines: readonly ReplyLine[] }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <div className="ag-replies ag-replies--short">
      {lines.map((line) => (
        <p key={line.platform}>
          <span aria-hidden="true">{CREATOR_REPLIES_EMOJI} </span>
          <span className="sr-only">Qui répond à tes fans dans {line.label} : </span>
          {lines.length > 1 ? <span aria-hidden="true">{line.label} : </span> : null}
          <People line={line} />
        </p>
      ))}
    </div>
  );
}

/** In a column of Semaine, under the row « fans »: one person per line, the platform said when she has several. */
export function CellReplies({ lines }: { lines: readonly ReplyLine[] }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <ul className="ag-replies ag-replies--cell">
      {lines.flatMap((line) =>
        line.replies.map((reply) => (
          <li key={`${line.platform}-${reply.key}`}>
            <span className="sr-only">Qui répond à tes fans dans {line.label} : </span>
            {lines.length > 1 ? <span aria-hidden="true">{line.label} · </span> : null}
            <Who reply={reply} />
          </li>
        )),
      )}
    </ul>
  );
}
