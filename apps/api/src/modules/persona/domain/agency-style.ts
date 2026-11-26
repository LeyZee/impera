import {
  DomainError,
  type AgencyStyleContent,
  type AgencyStyleErrorCode,
  type AgencyStyleId,
  type AgencyStyleOverview,
  type AgencyStyleVersion,
} from '@impera/contracts';

/**
 * The agency's base style (ADR 0171): versions saved by the owner, one active, activated by the owner; every write is
 * audited with him. The agent reads the active one at each draft, on the service connection.
 */
export interface AgencyStyleStore {
  /** The active version and the latest ones, newest first; the owner's alone (RLS). */
  overview(userId: string): Promise<AgencyStyleOverview>;
  /** A new version, never active, numbered after the last (`agency_style.create`). */
  save(content: AgencyStyleContent, userId: string): Promise<AgencyStyleVersion>;
  /**
   * Makes it the active one (`agency_style.activate`), only over the active version the screen read: otherwise
   * `AgencyStyleConflict`. Already active, nothing is written.
   */
  activate(
    versionId: AgencyStyleId,
    expectedActive: AgencyStyleId | null,
    userId: string,
  ): Promise<AgencyStyleVersion>;
  /** The active version, read as the system for the agent; `null` without one. */
  activeUnscoped(): Promise<AgencyStyleVersion | null>;
}

/** Another version was activated since the screen read it (409): nothing changes. */
export class AgencyStyleConflict extends DomainError {
  constructor() {
    super(
      'agency_style_conflict' satisfies AgencyStyleErrorCode,
      'Une autre version du style de base a été activée entre-temps',
    );
  }
}

/** No version of the base style has this id (404). */
export class AgencyStyleNotFound extends DomainError {
  constructor() {
    super('agency_style_not_found' satisfies AgencyStyleErrorCode, 'Version du style de base introuvable');
  }
}
