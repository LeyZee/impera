import {
  CONTENT_DROP_FILE_NOT_FOUND,
  CONTENT_DROP_FILE_SETTLED_CONFLICT,
  CONTENT_DROP_FORBIDDEN,
  CONTENT_DROP_FORMAT_UNPROCESSABLE,
  CONTENT_DROP_ID_CONFLICT,
  CONTENT_DROP_NOT_FOUND,
  CONTENT_DROP_REQUEST_UNPROCESSABLE,
  CONTENT_DROP_SCRIPT_UNPROCESSABLE,
  CONTENT_DROP_SETTLED_CONFLICT,
  CONTENT_DROP_SLOT_NOT_FOUND,
  CONTENT_DROP_SLOTS_UNPROCESSABLE,
  CONTENT_DROP_STORAGE_UNAVAILABLE,
  CONTENT_DROP_UPLOAD_UNPROCESSABLE,
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

export class ContentDropFileNotFound extends DomainError {
  constructor() {
    super(CONTENT_DROP_FILE_NOT_FOUND, 'Ce fichier n’est pas dans ce dépôt');
  }
}

/** Its drop no longer takes bytes: withdrawn, or every file already received. */
export class ContentDropFileSettled extends DomainError {
  constructor() {
    super(CONTENT_DROP_FILE_SETTLED_CONFLICT, 'Ce dépôt ne prend plus de fichier : recharge ton contenu');
  }
}

/** The parts named are not the file's whole, or the bytes stored are not the size declared. */
export class ContentDropUploadUnprocessable extends DomainError {
  constructor(sentence: string) {
    super(CONTENT_DROP_UPLOAD_UNPROCESSABLE, sentence);
  }
}

/** No storage configured, or it does not answer: the phone tries again later. The log has the cause, never her. */
export class ContentDropStorageUnavailable extends DomainError {
  constructor(reason: string, options?: { readonly cause?: unknown }) {
    super(
      CONTENT_DROP_STORAGE_UNAVAILABLE,
      'L’envoi ne répond pas pour l’instant : réessaie dans un moment',
      {
        cause: options?.cause ?? new Error(reason),
      },
    );
  }
}

/** A file the cleaning cannot follow (a damaged photo, a video ffmpeg cannot read): refused with her sentence. */
export class UnreadableFile extends Error {}

/**
 * Its medium was erased between the receipt's look at her library and its settling, so the bytes it skipped are gone
 * (relecture Bilan de #525): thrown, the job's retry finds the medium erased and writes the bytes again.
 */
export class MediumErasedMeanwhile extends Error {}

/** A slot her script does not have (SC-02 lot b). */
export class ContentDropSlotNotFound extends DomainError {
  constructor() {
    super(CONTENT_DROP_SLOT_NOT_FOUND, 'Cet emplacement n’est pas dans ton script');
  }
}

/** « Envoyer le script » with a required slot still empty, or holding a refused file (ADR 0056 § 4). */
export class ContentDropSlotsUnprocessable extends DomainError {
  constructor(slotKeys: readonly string[]) {
    super(
      CONTENT_DROP_SLOTS_UNPROCESSABLE,
      'Il reste des emplacements à remplir avant d’envoyer ton script',
      {
        details: { slotKeys },
      },
    );
  }
}
