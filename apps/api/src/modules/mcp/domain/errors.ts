import { DomainError } from '@impera/contracts';

/** An access the owner has not, or already revoked. */
export class McpGrantNotFound extends DomainError {
  constructor() {
    super('mcp_grant_not_found', 'Cet accès n’existe pas ou est déjà révoqué');
  }
}
