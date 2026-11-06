import type { CreatorId, PersonaVersionId } from '@impera/contracts';

import type { PlaygroundEngine } from './engine';

/** A creator's version to play, chosen at the head of the screen (recette PRO-21); `null`: the invented persona. */
export type PersonaChoice = { readonly creatorId: CreatorId; readonly versionId: PersonaVersionId } | null;

/**
 * One playground per signed-in user, in memory (fiche P3-06): a restart empties them, the ratings stay in
 * their store. Each user trains on their own conversation; the rate is shared, since it measures the bot.
 */
export interface PlaygroundService {
  forUser(userId: string): PlaygroundEngine;
  /**
   * Their playground starts over with another persona: a creator's version, or the invented one. Refused while an
   * answer is under way (`answer_in_progress_conflict`), as any change of the conversation.
   */
  choose(userId: string, choice: PersonaChoice): Promise<PlaygroundEngine>;
}

export function createPlaygroundService(factories: {
  /** The invented persona's playground, each user's first. */
  readonly invented: () => PlaygroundEngine;
  /** A creator's version's; throws `PlaygroundPersonaNotFound` when she has no such version. */
  readonly ofVersion: (choice: NonNullable<PersonaChoice>) => Promise<PlaygroundEngine>;
}): PlaygroundService {
  const engines = new Map<string, PlaygroundEngine>();
  return {
    forUser(userId) {
      let engine = engines.get(userId);
      if (engine === undefined) {
        engine = factories.invented();
        engines.set(userId, engine);
      }
      return engine;
    },
    async choose(userId, choice) {
      // Throws while an answer runs: the conversation under way is never cut.
      engines.get(userId)?.reset();
      const engine = choice === null ? factories.invented() : await factories.ofVersion(choice);
      engines.set(userId, engine);
      return engine;
    },
  };
}
