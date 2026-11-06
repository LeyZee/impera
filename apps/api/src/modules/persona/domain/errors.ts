import {
  DomainError,
  type CreatorErrorCode,
  type CreatorPlanned,
  type PersonaCorrectionErrorCode,
  type PersonaErrorCode,
  type PersonaSampleReplyFault,
  type PersonaSampleReplyUnprocessableDetails,
} from '@impera/contracts';

/** Error codes of the module (`PERSONA_ERROR_CODES`, api.md § Erreurs): the suffix gives the HTTP status. */

/** Another version was stored since the edit started, or its version number is taken: nothing is stored (409). */
export class PersonaVersionConflict extends DomainError {
  constructor() {
    super(
      'persona_version_conflict' satisfies PersonaErrorCode,
      'Une autre version a été enregistrée entre-temps, ou ce numéro de version existe déjà',
    );
  }
}

/**
 * A new creator sent again under the id of one already made, with another name or zone (409): nothing changes, the
 * form says so rather than show the earlier creator under the name just typed.
 */
export class CreatorConflict extends DomainError {
  constructor() {
    super(
      'creator_conflict' satisfies CreatorErrorCode,
      'Cette créatrice existe déjà sous un autre nom ou un autre fuseau',
    );
  }
}

/**
 * Another creator has this name, case, accents and spaces aside (`creatorNameKey`, 409): two creators never share a
 * name (Charles, 28/10/2026). Nothing is created.
 */
export class CreatorNameConflict extends DomainError {
  constructor() {
    super('creator_name_conflict' satisfies CreatorErrorCode, 'Une créatrice porte déjà ce nom');
  }
}

/**
 * She is still planned (ADR 0071 § 2, 409): shifts not over or weekly templates still running. Nothing is archived;
 * `details` says how many of each, for the owner to end them in the agenda first.
 */
export class CreatorPlannedConflict extends DomainError {
  constructor(planned: CreatorPlanned) {
    super(
      'creator_planned_conflict' satisfies CreatorErrorCode,
      'Elle est encore au planning : retire ses shifts à venir et arrête ses shifts réguliers avant de l’archiver',
      { details: planned },
    );
  }
}

/** No version of hers has this id (404). */
export class PersonaVersionNotFound extends DomainError {
  constructor() {
    super('persona_version_not_found' satisfies PersonaErrorCode, 'Version de persona introuvable');
  }
}

/**
 * A sample reply a hard guard of her answers would block (P5-01): nothing is stored (422). `details.faults` gives
 * each one's place and guard code, never its text (`PersonaSampleReplyUnprocessableDetailsSchema`).
 */
export class PersonaSampleReplyUnprocessable extends DomainError {
  constructor(faults: readonly PersonaSampleReplyFault[]) {
    super(
      'persona_sample_reply_unprocessable' satisfies PersonaErrorCode,
      'Une réponse type contient ce que l’agent n’a jamais le droit d’écrire : corrige-la avant d’enregistrer',
      {
        details: {
          faults: faults.map(({ index, code }) => ({ index, code })),
        } satisfies PersonaSampleReplyUnprocessableDetails,
      },
    );
  }
}

/** She has `PERSONA_CORRECTIONS_OPEN_MAX` corrections the agency has not handled yet (429): nothing is stored. */
export class PersonaCorrectionsLimited extends DomainError {
  constructor() {
    super(
      'persona_corrections_limited' satisfies PersonaCorrectionErrorCode,
      'Trop de corrections attendent déjà l’agence',
    );
  }
}

/** This id already holds another correction (409): a form sent again with a changed text. Nothing is stored. */
export class PersonaCorrectionConflict extends DomainError {
  constructor() {
    super('persona_correction_conflict' satisfies PersonaCorrectionErrorCode, 'Cette correction existe déjà');
  }
}

/** No correction of hers has this id (404). */
export class PersonaCorrectionNotFound extends DomainError {
  constructor() {
    super('persona_correction_not_found' satisfies PersonaCorrectionErrorCode, 'Correction introuvable');
  }
}
