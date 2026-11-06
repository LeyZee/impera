import {
  DomainError,
  type AgencyLogoRefusal,
  type ContractorDocumentDecision,
  type ContractorDocumentRefusal,
} from '@impera/contracts';

/** Error codes of the contractors' file (api.md § Erreurs): the suffix gives the HTTP status. */

export class TeamMemberNotFound extends DomainError {
  constructor() {
    super('team_member_not_found', 'Membre introuvable');
  }
}

/** A member who is not the owner nor an active manager, or a manager doing what only the owner does. */
export class PayrollForbidden extends DomainError {
  constructor({ ownerOnly = false }: { readonly ownerOnly?: boolean } = {}) {
    super(
      'payroll_forbidden',
      ownerOnly ? 'Réservé au propriétaire' : 'Réservé au propriétaire et aux managers actifs',
    );
  }
}

/** A contractor's new billing regime dated before today or before the last one (EQ-06): a regime never goes back. */
export class BillingRegimeBackdated extends DomainError {
  constructor(from: string) {
    super('billing_regime_backdated_unprocessable', 'Un régime de facturation ne s’applique pas en arrière', {
      details: { from },
    });
  }
}

/** A bucket did not answer, or answered an error: a passing failure, never a wrong file (ADR 0037 § 7). */
export class InvoiceStorageUnavailable extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'InvoiceStorageUnavailable';
  }
}

/**
 * The bucket refused to erase a version whose lock it has just said is over, or a delete marker, which has no lock
 * (EQ-06 lot 5c-2, Bilan on #359): almost always a missing right (`s3:DeleteObjectVersion`), never « not yet ». Told
 * as an error, never tried again quietly.
 */
export class InvoiceStorageRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceStorageRefused';
  }
}

const LOGO_REFUSALS: Readonly<Record<AgencyLogoRefusal, string>> = {
  too_heavy: 'Le logo pèse plus de 512 Ko',
  not_png: 'Le logo n’est pas un PNG',
  damaged: 'Le PNG est abîmé ou incomplet',
  opaque: 'Le PNG n’a aucun pixel transparent',
  dimensions: 'Le logo doit mesurer de 64 à 4 000 pixels de côté, 4 millions de pixels au plus',
};

/** A logo the server refuses to keep (400), `details.reason` saying why (`AGENCY_LOGO_REFUSALS`). */
export class AgencyLogoInvalid extends DomainError {
  constructor(readonly reason: AgencyLogoRefusal) {
    super('agency_logo_invalid', LOGO_REFUSALS[reason], { details: { reason } });
  }
}

/** The settings name a logo nobody added (404). */
export class AgencyLogoNotFound extends DomainError {
  constructor() {
    super('agency_logo_not_found', 'Logo introuvable : dépose-le d’abord');
  }
}

/** Réglages › Facturation is not saved yet: the accounts come after it (EQ-06 lot 7b). */
export class BillingSettingsMissing extends DomainError {
  constructor() {
    super('billing_settings_missing_conflict', 'Enregistre d’abord Réglages › Facturation, puis les comptes');
  }
}

/** The contractor has not written his file yet: nothing to check nor to prefix (EQ-06 lot 5a). */
export class ContractorProfileNotFound extends DomainError {
  constructor() {
    super('contractor_profile_not_found', 'Le prestataire n’a pas encore rempli son dossier');
  }
}

/**
 * A manager, or another member, writing a contractor's file, or a manager reading it: only the contractor and the
 * owner write it and read it (reco 10 of the recette, 05/11: the API says what the screens say).
 */
export class ContractorProfileForbidden extends DomainError {
  constructor(access: 'read' | 'write' = 'write') {
    super(
      'contractor_profile_forbidden',
      access === 'read'
        ? 'Seuls le prestataire et le propriétaire lisent ce dossier'
        : 'Seuls le prestataire et le propriétaire écrivent ce dossier',
    );
  }
}

/** The file changed since the owner read it: he checks what he sees, never a file he did not see. */
export class ContractorProfileChanged extends DomainError {
  constructor() {
    super('contractor_profile_changed_conflict', 'Le dossier a changé depuis son affichage');
  }
}

/** The contractor's first invoice froze his prefix: his numbers never change. */
export class InvoicePrefixFrozen extends DomainError {
  constructor() {
    super('invoice_prefix_frozen_conflict', 'La première facture du prestataire a figé son préfixe');
  }
}

/** Another contractor holds this prefix: each one numbers his own sequence. */
export class InvoicePrefixTaken extends DomainError {
  constructor() {
    super('invoice_prefix_taken_conflict', 'Un autre prestataire a déjà ce préfixe');
  }
}

export class ContractTextNotFound extends DomainError {
  constructor() {
    super('contract_text_not_found', 'Texte introuvable');
  }
}

/** The same id sent again with another text, another kind or another delay. */
export class ContractTextIdConflict extends DomainError {
  constructor() {
    super('contract_text_id_conflict', 'Cet identifiant est déjà pris par un autre texte');
  }
}

/** The fingerprint the screen sent is not this version's: the contractor accepts only the text he read. */
export class ContractTextChanged extends DomainError {
  constructor() {
    super(
      'contract_text_changed_conflict',
      'Ce texte n’est pas celui que tu as lu : relis-le avant de l’accepter',
    );
  }
}

/** A newer version of the same kind replaced it: the contractor reads and accepts that one. */
export class ContractTextSuperseded extends DomainError {
  constructor() {
    super(
      'contract_text_superseded_conflict',
      'Une version plus récente remplace ce texte : lis-la avant de l’accepter',
    );
  }
}

/** Only the contractor accepts his contract and his mandate, never the owner nor a manager for him. */
export class ContractAcceptanceForbidden extends DomainError {
  constructor() {
    super('contract_acceptance_forbidden', 'Seul le prestataire accepte son contrat et son mandat');
  }
}

/** No regime with this id (EQ-06 lot 5b). */
export class BillingRegimeNotFound extends DomainError {
  constructor() {
    super('billing_regime_not_found', 'Ce régime de facturation n’existe pas');
  }
}

/** The same id sent again with another regime: a regime is never changed, a new text is a new regime. */
export class BillingRegimeIdConflict extends DomainError {
  constructor() {
    super('billing_regime_id_conflict', 'Cet identifiant est déjà pris par un autre régime');
  }
}

/** The accountant's validation is recorded already, on another day: it is recorded once, never moved. */
export class BillingRegimeValidated extends DomainError {
  constructor(validatedOn: string) {
    super('billing_regime_validated_conflict', 'La validation du comptable est déjà notée pour ce régime', {
      details: { validatedOn },
    });
  }
}

/** A validation the accountant has not given yet: recorded for a day still to come. */
export class BillingRegimeValidationAhead extends DomainError {
  constructor(validatedOn: string) {
    super(
      'billing_regime_validation_future_unprocessable',
      'La validation du comptable se note le jour où il l’a donnée, jamais à l’avance',
      { details: { validatedOn } },
    );
  }
}

/** A regime of other countries than the contractor's: its mentions and its VAT are not his. */
export class BillingRegimeCountryMismatch extends DomainError {
  constructor(country: string) {
    super('billing_regime_country_unprocessable', 'Ce régime n’est pas celui du pays du prestataire', {
      details: { country },
    });
  }
}

/** The same id sent again with another contractor, regime or day. */
export class ContractorRegimeIdConflict extends DomainError {
  constructor() {
    super('contractor_regime_id_conflict', 'Cet identifiant est déjà pris par une autre attribution');
  }
}

const DOCUMENT_REFUSALS: Readonly<Record<ContractorDocumentRefusal, string>> = {
  too_heavy: 'Le fichier pèse plus de 10 Mo',
  not_supported: 'Le fichier doit être un PDF, ou une photo JPEG ou PNG',
};

/** A document's file the server refuses to keep (400, lot 5c), `details.reason` saying why. */
export class ContractorDocumentInvalid extends DomainError {
  constructor(readonly reason: ContractorDocumentRefusal) {
    super('contractor_document_invalid', DOCUMENT_REFUSALS[reason], { details: { reason } });
  }
}

/** The same document id sent again with another file or other dates (lot 5c). */
export class ContractorDocumentIdConflict extends DomainError {
  constructor() {
    super('contractor_document_id_conflict', 'Cet identifiant est déjà pris par une autre pièce');
  }
}

/** A document issued on a day still to come in the agency's zone (lot 5c). */
export class ContractorDocumentIssuedAhead extends DomainError {
  constructor(issuedOn: string) {
    super('contractor_document_issued_future_unprocessable', 'La date de délivrance est encore à venir', {
      details: { issuedOn },
    });
  }
}

/** No such document, or not one the reader sees (lot 5c). */
export class ContractorDocumentNotFound extends DomainError {
  constructor() {
    super('contractor_document_not_found', 'Pièce introuvable');
  }
}

/** The owner checked the document already, otherwise: a document is checked once (lot 5c). */
export class ContractorDocumentReviewed extends DomainError {
  constructor(decision: ContractorDocumentDecision) {
    super(
      'contractor_document_reviewed_conflict',
      decision === 'accepted' ? 'Cette pièce est déjà acceptée' : 'Cette pièce est déjà refusée',
      { details: { decision } },
    );
  }
}

/**
 * The file of a refused document was erased once its upload lock ended (lot 5c-2, « ok purge a »): its row, its reason
 * and its fingerprint stay, its bytes are gone for good.
 */
export class ContractorDocumentFileGone extends DomainError {
  constructor() {
    super('contractor_document_file_gone', 'Le fichier de cette pièce refusée a été effacé');
  }
}

/** The bucket did not give the document's file with its fingerprint: an altered file is never served (lot 5c). */
export class ContractorDocumentUnavailable extends DomainError {
  constructor() {
    super(
      'contractor_document_unavailable',
      'La pièce est momentanément indisponible, réessaie dans un instant',
    );
  }
}
