import type {
  CreatePersonaVersionBody,
  CreatorId,
  Persona,
  PersonaOverview,
  PersonaVersionId,
  PersonaVersionSummary,
} from '@nirvana/contracts';

/** Her active version, the one the agent writes with (ADR 0010, 0022), and her name for a placeholder first name. */
interface ActivePersonaVersion {
  readonly id: PersonaVersionId;
  readonly version: string;
  readonly creatorName: string;
  readonly persona: Persona;
}

/** A creator's persona versions (ADR 0010), read and written within her tenant. */
export interface PersonaVersionStore {
  /**
   * Her only active version, read from the base at each call (ADR 0022: nothing kept in memory can be stale); `null`
   * when she has none, or does not exist. A stored content that no longer reads as `Persona` throws: never a guess.
   */
  active(creatorId: CreatorId): Promise<ActivePersonaVersion | null>;
  overview(creatorId: CreatorId): Promise<PersonaOverview>;
  /** Stores a new version, never active; throws `PersonaVersionConflict` when `basedOn` is stale or the number is taken. */
  create(
    creatorId: CreatorId,
    body: CreatePersonaVersionBody,
    userId: string,
  ): Promise<PersonaVersionSummary>;
  /**
   * Makes a stored version her only active one, audited with who did it; the active one is returned as it is.
   * Throws `PersonaVersionNotFound` when she has no version with this id, and `PersonaVersionConflict` when her
   * active version is no longer `expectedActive` (null: none), what the caller last read.
   */
  activate(
    creatorId: CreatorId,
    versionId: PersonaVersionId,
    expectedActive: PersonaVersionId | null,
    userId: string,
  ): Promise<PersonaVersionSummary>;
  /**
   * `pnpm persona:load`: stores a version read from a YAML file, or finds the same one already stored, and with
   * `activate` makes it her only active version. A number already stored with another content is a conflict.
   */
  load(
    creatorId: CreatorId,
    persona: Persona,
    options: { readonly sourcePath: string; readonly activate: boolean },
  ): Promise<{
    readonly version: PersonaVersionSummary;
    readonly created: boolean;
    readonly activated: boolean;
  }>;
}
