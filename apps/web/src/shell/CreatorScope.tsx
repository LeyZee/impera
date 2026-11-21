import type { Me } from '@impera/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useId, type JSX } from 'react';

import { Select, type SelectOption } from './Select';

import { scopedOf, useCreatorScope } from '@/agent/scope';
import { ChipFace } from '@/creators/CreatorFace';
import { useCreators } from '@/creators/api';
import { creatorsSearch, parseCreatorsSearch, sheetOf } from '@/creators/search';
import { todosAcrossQuery } from '@/screens/tracking/api';

/** The value of « Toutes » in the list: never a creator's id. */
const ALL = 'all';

/** Who gets the selector: the owner and an active manager, who see the agency's views (ADR 0134 § 3). */
export function scopesCreators(me: Pick<Me, 'role' | 'teamScope'>): boolean {
  return me.role === 'owner' || me.teamScope === 'agency';
}

/** The screens the selector applies to: elsewhere it stays in the menu and only keeps the choice. */
const SCOPED = ['/', '/creatrices', '/suivi', '/suivi/fans', '/trafic'] as const;
export function isScoped(pathname: string): boolean {
  return SCOPED.some((path) => path === pathname);
}

/** « 2 urgences » beside a creator whose queue holds grave lines, so that none hides behind the one chosen (DASH-03). */
function urgencies(count: number): string | undefined {
  return count === 0 ? undefined : count === 1 ? '1 urgence' : `${String(count)} urgences`;
}

/**
 * The creator selector (ADR 0134 § 3): at the head of the menu on a computer, at the head of the page on a phone. It
 * says which creator the Dashboard, Suivi, Fans, Trafic and Créatrices show, « Toutes » for the agency's views, and keeps the
 * choice on the device. On Créatrices the choice opens her sheet, or the list. Nothing with no creator: there is nothing
 * to choose.
 */
export function CreatorScope({ place }: { place: 'rail' | 'page' }): JSX.Element | null {
  const id = useId();
  const read = useCreators();
  const creators = read.data ?? [];
  const { chosen, choose } = useCreatorScope();
  const pathname = useRouterState({ select: ({ location }) => location.pathname });
  const search: Record<string, unknown> = useRouterState({ select: ({ location }) => location.search });
  const navigate = useNavigate();
  const queue = useQuery({ ...todosAcrossQuery, enabled: creators.length >= 2 });
  if (creators.length === 0) return null;
  // The page's own copy only heads the screens the choice changes.
  if (place === 'page' && !isScoped(pathname)) return null;

  const current = scopedOf(creators, chosen);
  const options: SelectOption<string>[] = [
    { value: ALL, label: 'Toutes', lead: <AllFaces /> },
    ...creators.map((creator) => {
      const hint = urgencies(
        queue.data?.creators.find((count) => count.creatorId === creator.id)?.grave ?? 0,
      );
      return {
        value: creator.id,
        label: creator.displayName,
        lead: <ChipFace creator={creator} />,
        ...(hint === undefined ? {} : { hint }),
      };
    }),
  ];

  const onChange = (value: string): void => {
    const next = creators.find((creator) => creator.id === value) ?? null;
    choose(next?.id ?? null);
    // On Créatrices the address is the choice: her sheet, or the list for « Toutes », on the tab open.
    if (pathname === '/creatrices')
      void navigate({
        to: '/creatrices',
        search: creatorsSearch(sheetOf(parseCreatorsSearch(search)), next?.id ?? null),
      });
    // Suivi's address names the conversation open: another creator's would stay on screen, so it is closed.
    else if (pathname === '/suivi') void navigate({ to: '/suivi', search: {}, replace: true });
  };

  return (
    <div className="nv-scope" data-place={place}>
      <label className="nv-scope__label" htmlFor={`${id}-scope`}>
        Créatrice
      </label>
      <Select<string>
        id={`${id}-scope`}
        className="nv-scope__select"
        value={current?.id ?? ALL}
        options={options}
        onChange={onChange}
        listWidth="options"
      />
    </div>
  );
}

/** « Toutes »: three discs overlapping, the mark of several faces. */
function AllFaces(): JSX.Element {
  return (
    <svg className="nv-scope__all" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="7" cy="11" r="5" />
      <circle cx="11" cy="11" r="5" />
      <circle cx="15" cy="11" r="5" />
    </svg>
  );
}
