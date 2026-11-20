import type { CreatorId, PersonaVersionId, UserRole } from '@impera/contracts';

import type { PlaygroundEngine } from './engine';

/** A creator's version to play, chosen at the head of the screen (recette PRO-21); `null`: the invented persona. */
export type PersonaChoice = { readonly creatorId: CreatorId; readonly versionId: PersonaVersionId } | null;

/** Who trains, as her scripts are read for them: the owner, or an active manager (ADR 0092 § 8). */
export interface Trainer {
  readonly userId: string;
  readonly role: UserRole;
}

/**
 * One playground per signed-in user, in memory (fiche P3-06): a restart empties them, the ratings stay in
 * their store. Each user trains on their own conversation; the rate is shared, since it measures the bot.
 */
export interface PlaygroundService {
  /**
   * Their playground. `mayPlay` says whether they still reach the creator played: a manager taken off her list
   * finds the invented persona again, never her version (ADR 0092 § 8).
   */
  forUser(userId: string, mayPlay?: (creatorId: CreatorId) => boolean): PlaygroundEngine;
  /**
   * Their playground starts over with another persona: a creator's version, or the invented one. Refused while an
   * answer is under way (`answer_in_progress_conflict`), as any change of the conversation.
   */
  choose(trainer: Trainer, choice: PersonaChoice): Promise<PlaygroundEngine>;
}

export function createPlaygroundService(factories: {
  /** The invented persona's playground, each user's first. */
  readonly invented: () => PlaygroundEngine;
  /**
   * A creator's version's, for this user: her scripts are read as this user reads them. Throws
   * `PlaygroundPersonaNotFound` when she has no such version.
   */
  readonly ofVersion: (choice: NonNullable<PersonaChoice>, trainer: Trainer) => Promise<PlaygroundEngine>;
}): PlaygroundService {
  const engines = new Map<string, PlaygroundEngine>();
  const played = new Map<string, CreatorId>();
  return {
    forUser(userId, mayPlay = () => true) {
      let engine = engines.get(userId);
      const creatorId = played.get(userId);
      if (engine === undefined || (creatorId !== undefined && !mayPlay(creatorId))) {
        engine = factories.invented();
        engines.set(userId, engine);
        played.delete(userId);
      }
      return engine;
    },
    async choose(trainer, choice) {
      // Throws while an answer runs: the conversation under way is never cut.
      engines.get(trainer.userId)?.reset();
      const engine = choice === null ? factories.invented() : await factories.ofVersion(choice, trainer);
      engines.set(trainer.userId, engine);
      if (choice === null) played.delete(trainer.userId);
      else played.set(trainer.userId, choice.creatorId);
      return engine;
    },
  };
}
