import type { ScriptMoment, ShotMoment } from '@impera/contracts';

/**
 * The moment a script is shot as, fixed when it is asked (SC-03, Charles « ok alternance » 06/11): a structure of
 * day or of night is shot as itself; a « both » structure as the other moment than her last script asked, `night`
 * for her first. Never asked of anyone: the folder, its cards and its archive follow it.
 */
export function shotMoment(structure: ScriptMoment, previous: ShotMoment | null): ShotMoment {
  if (structure !== 'both') return structure;
  return previous === 'night' ? 'day' : 'night';
}
