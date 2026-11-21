import { CreatorIdSchema } from '@impera/contracts';
import type { JSX } from 'react';

import { useCreatorLimits } from '../her-limits/api';
import { limitLinesOf } from '../her-limits/model';

import { useChatterPersona } from './api';
import { HER_LINES_MAX, herLinesOf } from './model';

/**
 * « Elle, en trois lignes », inside the shift's hero: what she told the agency herself first (her absence, what she no
 * longer does, Charles 21/11), always all of it, then her sheet's lines up to three. Nothing while it loads or fails.
 */
export function HerLines({ creatorId }: { creatorId: string }): JSX.Element | null {
  const sheet = useChatterPersona(creatorId).data?.sheet ?? null;
  const parsed = CreatorIdSchema.safeParse(creatorId);
  const told = limitLinesOf(useCreatorLimits(parsed.success ? parsed.data : null).data);
  const fromSheet =
    sheet === null ? [] : herLinesOf(sheet).slice(0, Math.max(0, HER_LINES_MAX - told.length));
  if (told.length + fromSheet.length === 0) return null;
  return (
    <div className="sc-her" aria-labelledby="sc-her-title">
      <b id="sc-her-title" className="sc-her__title">
        Elle, en trois lignes
      </b>
      <ul className="sc-her__lines">
        {told.map((line) => (
          <li key={line} data-told="true">
            {line}
          </li>
        ))}
        {fromSheet.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
