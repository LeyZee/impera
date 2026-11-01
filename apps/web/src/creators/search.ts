import { CreatorIdSchema, type CreatorId } from '@nirvana/contracts';

/**
 * The tab of Créatrices and the creator picked, in the address (`?onglet=heures&creatrice=<id>`), so that a link, a
 * reload or a step back lands on the same sheet of the same creator (lessons of #217 and of the recette 28/10).
 */
export interface CreatorsSearch {
  readonly onglet?: 'heures';
  readonly creatrice?: CreatorId;
}

/** Anything but a known tab reads as the persona; anything but a creator id, as no creator picked. */
export function parseCreatorsSearch(search: Record<string, unknown>): CreatorsSearch {
  const creator = CreatorIdSchema.safeParse(search['creatrice']);
  return {
    ...(search['onglet'] === 'heures' ? { onglet: 'heures' } : {}),
    ...(creator.success ? { creatrice: creator.data } : {}),
  };
}

/** The address of a sheet: the persona leaves `onglet` out, no creator leaves `creatrice` out. */
export function creatorsSearch(tab: 'persona' | 'hours', creatorId: CreatorId | null): CreatorsSearch {
  return {
    ...(tab === 'hours' ? { onglet: 'heures' } : {}),
    ...(creatorId === null ? {} : { creatrice: creatorId }),
  };
}
