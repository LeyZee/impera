import { DomainError } from '@impera/contracts';

/** The member is not one the viewer can see, or does not play (api.md § Erreurs: the suffix gives the HTTP status). */
export class MemberNotFound extends DomainError {
  constructor() {
    super('member_not_found', 'Membre introuvable');
  }
}
