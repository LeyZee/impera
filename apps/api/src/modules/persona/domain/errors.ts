import {
  DomainError,
  type CreatorErrorCode,
  type PersonaErrorCode,
  type PersonaSampleReplyFault,
  type PersonaSampleReplyUnprocessableDetails,
} from '@nirvana/contracts';

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
