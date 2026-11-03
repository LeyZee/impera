import {
  CONTENT_DROP_FORBIDDEN,
  CONTENT_DROP_FORMAT_UNPROCESSABLE,
  CONTENT_DROP_ID_CONFLICT,
  CONTENT_DROP_NOT_FOUND,
  CONTENT_DROP_REQUEST_UNPROCESSABLE,
  CONTENT_DROP_SCRIPT_UNPROCESSABLE,
  CONTENT_DROP_SETTLED_CONFLICT,
  CONTENT_REQUEST_CLOSED_CONFLICT,
  CONTENT_REQUEST_ID_CONFLICT,
  CONTENT_REQUEST_NOT_FOUND,
  CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE,
  DomainError,
} from '@impera/contracts';

import type { DropRefusal } from './drops';

/** Her drops' and the agency's requests' refusals (contracts `content-drops.ts`), in her words. */

export class ContentDropNotFound extends DomainError {
  constructor() {
    super(CONTENT_DROP_NOT_FOUND, 'Ce dépôt n’est pas dans ton contenu');
  }
}

/** A drop replayed under its id with another content, or an id another creator's drop holds. */
export class ContentDropIdConflict extends DomainError {
  constructor() {
    super(CONTENT_DROP_ID_CONFLICT, 'Cet identifiant sert déjà à un autre dépôt : recharge ton contenu');
  }
}

/** Files that do not fit the category, each with its sentence (ADR 0055 § 2): nothing is stored. */
export class ContentDropFormatUnprocessable extends DomainError {
  constructor(refusals: readonly DropRefusal[]) {
    super(
      CONTENT_DROP_FORMAT_UNPROCESSABLE,
      refusals[0]?.sentence ?? 'Ce dépôt ne colle pas à sa catégorie',
      {
        details: { refusals },
      },
    );
  }
}

export class ContentDropScriptUnprocessable extends DomainError {
  constructor() {
    super(CONTENT_DROP_SCRIPT_UNPROCESSABLE, 'Un script se dépose depuis la demande de l’agence');
  }
}

/** The request is not hers, not open, of another category, or already has its drop. */
export class ContentDropRequestUnprocessable extends DomainError {
  constructor(message = 'Cette demande n’attend plus de dépôt') {
    super(CONTENT_DROP_REQUEST_UNPROCESSABLE, message);
  }
}

/** A drop already scheduled or out: withdrawing it is the plan's business (CR-08), not hers here. */
export class ContentDropSettled extends DomainError {
  constructor() {
    super(
      CONTENT_DROP_SETTLED_CONFLICT,
      'Ce dépôt est déjà programmé ou publié : il ne se retire plus d’ici',
    );
  }
}

/** A chatter, or a creator the session does not reach. */
export class ContentDropForbidden extends DomainError {
  constructor() {
    super(CONTENT_DROP_FORBIDDEN, 'Le contenu de la créatrice est réservé au propriétaire et aux managers');
  }
}

export class ContentRequestNotFound extends DomainError {
  constructor() {
    super(CONTENT_REQUEST_NOT_FOUND, 'Cette demande n’existe pas');
  }
}

export class ContentRequestIdConflict extends DomainError {
  constructor() {
    super(CONTENT_REQUEST_ID_CONFLICT, 'Cet identifiant sert déjà à une autre demande');
  }
}

/** Refused, cancelled, or already answered by a drop: nothing more to decide on it. */
export class ContentRequestClosed extends DomainError {
  constructor() {
    super(CONTENT_REQUEST_CLOSED_CONFLICT, 'Cette demande est déjà close');
  }
}

/** A script structure that does not exist, is archived, or is kept for another creator. */
export class ContentRequestStructureUnprocessable extends DomainError {
  constructor() {
    super(
      CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE,
      'Cette structure n’est pas disponible pour cette créatrice',
    );
  }
}
