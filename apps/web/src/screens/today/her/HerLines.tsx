import type { JSX } from 'react';

import { useChatterPersona } from './api';
import { herLinesOf } from './model';

/** « Elle, en trois lignes », inside the shift's hero: nothing while it loads, fails, or she has no sheet. */
export function HerLines({ creatorId }: { creatorId: string }): JSX.Element | null {
  const read = useChatterPersona(creatorId);
  const sheet = read.data?.sheet ?? null;
  if (sheet === null) return null;
  const lines = herLinesOf(sheet);
  if (lines.length === 0) return null;
  return (
    <div className="sc-her" aria-labelledby="sc-her-title">
      <b id="sc-her-title" className="sc-her__title">
        Elle, en trois lignes
      </b>
      <ul className="sc-her__lines">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
