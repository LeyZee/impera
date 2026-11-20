import type { PreparedScriptView } from '@impera/contracts';
import type { JSX } from 'react';

import { gapText, momentLabel, priceLabel, scriptPaths, stateLabel } from './model';

/** The prices of the default path, step by step, drawn as a stair: an offered step lies flat. */
function Stairs({ prices }: { prices: readonly number[] }): JSX.Element {
  const top = Math.max(1, ...prices);
  return (
    <span className="se-stairs" aria-hidden="true">
      {prices.map((minor, at) => (
        <i
          key={String(at)}
          data-free={minor === 0 ? '' : undefined}
          style={{ height: `${String(minor === 0 ? 4 : 6 + (28 * minor) / top)}px` }}
        />
      ))}
    </span>
  );
}

/** « Ses scripts »: her scripts in preparation, the latest changed first, each with where it stands. */
export function PreparedList({
  scripts,
  onOpen,
}: {
  scripts: readonly PreparedScriptView[];
  onOpen: (view: PreparedScriptView) => void;
}): JSX.Element {
  return (
    <ul className="se-list" aria-label="Ses scripts en préparation">
      {[...scripts]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((view) => {
          const state = stateLabel(view);
          const steps = view.content.steps.length;
          const branches = view.content.steps.reduce((most, step) => Math.max(most, step.branches.length), 1);
          const first = scriptPaths(view.content).shown[0];
          const prices = first?.prices ?? [];
          const top = Math.max(
            0,
            ...view.content.steps.flatMap((step) => step.branches.map((b) => b.priceMinor)),
          );
          const gap = view.state === 'editing' ? view.gaps[0] : undefined;
          const why =
            view.state === 'matched'
              ? 'Rattaché au script importé'
              : view.state === 'ready_to_copy'
                ? 'Prêt : l’équipe le recopie, l’import suivant le reconnaîtra'
                : gap === undefined
                  ? 'Rien ne manque : il peut passer « Prêt à copier »'
                  : gapText(view.content, gap);
          return (
            <li key={view.id}>
              <button
                type="button"
                className="nv-plate se-row"
                onClick={() => {
                  onOpen(view);
                }}
              >
                <span className="se-row__name">
                  <span className="se-row__title">
                    {view.content.name === '' ? 'Sans nom' : view.content.name}
                  </span>
                  <span className="se-row__meta">
                    {momentLabel(view.content.moment)} · {steps === 1 ? '1 étape' : `${String(steps)} étapes`}
                    {branches > 1 ? ` · jusqu’à ${String(branches)} branches` : ''}
                  </span>
                </span>
                <span className="se-row__price">
                  <Stairs prices={prices} />
                  <span className="se-stairs-cap nv-num">
                    {top === 0 ? 'Offert' : `jusqu’à ${priceLabel(top)}`}
                  </span>
                </span>
                <span className="se-row__side">
                  <span className={`se-pill se-pill--${state.tone}`}>{state.text}</span>
                  <span className="se-why">{why}</span>
                </span>
              </button>
            </li>
          );
        })}
    </ul>
  );
}
