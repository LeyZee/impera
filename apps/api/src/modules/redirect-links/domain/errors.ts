import { DomainError } from '@impera/contracts';

/** What the module refuses, by its own names. */
export type RedirectLinkFault =
  'name_taken' | 'url_taken' | 'too_many_links' | 'link_not_found' | 'forbidden';

const REFUSALS: Record<RedirectLinkFault, readonly [code: string, message: string]> = {
  name_taken: ['redirect_link_name_conflict', 'Un autre lien porte déjà ce nom'],
  url_taken: ['redirect_link_url_conflict', 'Cette adresse est déjà celle d’un autre lien'],
  too_many_links: ['redirect_links_full_conflict', 'Elle a déjà le nombre maximal de liens'],
  link_not_found: ['redirect_link_not_found', 'Lien introuvable'],
  // The owner and an active manager only, for a creator that exists.
  forbidden: ['redirect_link_forbidden', 'Tu ne peux pas régler les liens de cette créatrice'],
};

/** The status follows the code's suffix (`api.md` § Erreurs). */
export class RedirectLinkError extends DomainError {
  constructor(readonly fault: RedirectLinkFault) {
    super(...REFUSALS[fault]);
  }
}
