import type {
  CreatorId,
  PersonaCorrection,
  PersonaCorrectionId,
  ProposePersonaCorrectionBody,
} from '@impera/contracts';

/**
 * Her corrections of her sheet (recette CREA-01 b): she proposes from her own account, the owner and a manager read
 * them, the owner marks one handled. Never deleted.
 */
export interface PersonaCorrectionStore {
  /** Hers, newest first, read from her own account (`userId` is hers). */
  mine(userId: string): Promise<readonly PersonaCorrection[]>;
  /**
   * Stores one, `open`. Sent again with the same id and the same words, answers the one stored; with other words,
   * `PersonaCorrectionConflict`. Past `PERSONA_CORRECTIONS_OPEN_MAX` open ones, `PersonaCorrectionsLimited`.
   */
  propose(userId: string, body: ProposePersonaCorrectionBody): Promise<PersonaCorrection>;
  /** Hers, newest first, read by the owner or an active manager (`userId`). */
  list(creatorId: CreatorId, userId: string): Promise<readonly PersonaCorrection[]>;
  /** Marks it handled by the owner (`userId`); already handled, answers it as it is. */
  markDone(
    creatorId: CreatorId,
    correctionId: PersonaCorrectionId,
    userId: string,
  ): Promise<PersonaCorrection>;
}
