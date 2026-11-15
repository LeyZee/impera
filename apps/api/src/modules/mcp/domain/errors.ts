import { DomainError } from '@impera/contracts';

/** An access the owner has not, or already revoked. */
export class McpGrantNotFound extends DomainError {
  constructor() {
    super('mcp_grant_not_found', 'Cet accès n’existe pas ou est déjà révoqué');
  }
}

/**
 * A read another module refused to the access's person (its own rule, read again in its transaction): the call is
 * refused and written down as such, never answered as an internal error. The wiring turns the module's refusal into it.
 */
export class McpReadRefused extends Error {
  constructor(readonly refusal: 'creator_forbidden' | 'role_forbidden') {
    super(`read refused: ${refusal}`);
    this.name = 'McpReadRefused';
  }
}
