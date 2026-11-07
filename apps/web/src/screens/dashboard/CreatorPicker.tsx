import { useQuery } from '@tanstack/react-query';
import { useRef, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { followedOf, useFollowedCreatorId } from '@/agent/followed';
import { ChipFace, ChipName } from '@/creators/CreatorFace';
import { useCreators } from '@/creators/api';
import { todosAcrossQuery } from '@/screens/tracking/api';

/** Arrow keys of the radio group and the way they move. */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Whose agent the Dashboard shows and pilots, when the account sees several creators: the chips of Créatrices, one per
 * creator. The choice is shared with the bar's pill and Suivi's « À traiter » (`agent/followed.ts`). Nothing with one
 * creator or none: her name above is enough. Another creator's urgencies show on her chip, so that none hides behind
 * the one followed (DASH-03).
 */
export function CreatorPicker({
  onChoose,
  agency,
}: {
  /** Told after the choice is followed: the Dashboard writes her in its address (recette 05/11, PRO-28). */
  onChoose?: ((creatorId: string) => void) | undefined;
  /**
   * « Toute l'agence » in front of the creators, for the owner and an active manager (ADR 0078): checked on the
   * agency's view, where no creator is.
   */
  agency?: { readonly selected: boolean; readonly onChoose: () => void } | undefined;
} = {}): JSX.Element | null {
  const creators = useCreators().data ?? [];
  const { chosen, follow: followOnly } = useFollowedCreatorId();
  const follow = (creatorId: string): void => {
    followOnly(creatorId);
    onChoose?.(creatorId);
  };
  const ref = useRef<HTMLDivElement>(null);
  const several = creators.length >= 2;
  const shown = several || (agency !== undefined && creators.length >= 1);
  const queue = useQuery({ ...todosAcrossQuery, enabled: shown });
  if (!shown) return null;
  // Unread, the chips would say nothing of the others' urgencies, as if there were none: the line under them says so.
  const unread = queue.isError && queue.data === undefined;
  const graveOf = (creatorId: string): number =>
    queue.data?.creators.find((count) => count.creatorId === creatorId)?.grave ?? 0;

  const current = agency?.selected === true ? undefined : followedOf(creators, chosen)?.id;
  const index = creators.findIndex((creator) => creator.id === current);
  // The agency's chip is the stop before the first creator: -1 in the creators' order.
  const options = agency === undefined ? creators.length : creators.length + 1;
  const position = agency === undefined ? Math.max(0, index) : index + 1;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = (position + step + options) % options;
    const next = creators[agency === undefined ? target : target - 1];
    if (next === undefined) {
      ref.current?.querySelector<HTMLButtonElement>('[data-creator="agency"]')?.focus();
      agency?.onChoose();
      return;
    }
    ref.current?.querySelector<HTMLButtonElement>(`[data-creator="${next.id}"]`)?.focus();
    follow(next.id);
  };

  return (
    <>
      <div
        className="db-creators"
        role="radiogroup"
        aria-label={agency === undefined ? 'Créatrice suivie' : 'Ce que montre le Dashboard'}
        ref={ref}
        onKeyDown={onKeyDown}
      >
        {agency === undefined ? null : (
          <button
            type="button"
            role="radio"
            className="nv-chip db-creators__agency"
            data-creator="agency"
            aria-checked={agency.selected}
            tabIndex={agency.selected ? 0 : -1}
            onClick={agency.onChoose}
          >
            <span className="db-creators__agency-mark" aria-hidden="true">
              ◎
            </span>
            Toute l’agence
          </button>
        )}
        {creators.map((creator, i) => {
          const grave = creator.id === current ? 0 : graveOf(creator.id);
          return (
            <button
              key={creator.id}
              type="button"
              role="radio"
              className="nv-chip"
              data-creator={creator.id}
              aria-checked={creator.id === current}
              tabIndex={agency?.selected === true ? -1 : i === Math.max(0, index) ? 0 : -1}
              onClick={() => {
                follow(creator.id);
              }}
              aria-label={
                grave === 0
                  ? undefined
                  : `${creator.displayName}, ${grave === 1 ? 'une urgence' : `${String(grave)} urgences`}`
              }
            >
              <ChipFace creator={creator} />
              <ChipName name={creator.displayName} />
              {grave === 0 ? null : (
                <span className="db-creators__grave nv-num" aria-hidden="true">
                  {grave}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Mounted before it speaks, empty while the queue reads: a live region added with its text is not announced. */}
      <p className="db-creators__unread" role="status">
        {unread
          ? 'Les urgences des autres créatrices n’ont pas pu être lues : regarde-les dans Suivi.'
          : null}
      </p>
    </>
  );
}
