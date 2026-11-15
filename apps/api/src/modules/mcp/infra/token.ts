import { createHash, randomBytes } from 'node:crypto';

import { MCP_TOKEN_PREFIX } from '@impera/contracts';

import type { MintedToken } from '../domain/ports';

/** 256 random bits, base64url: 43 characters after the prefix (`McpTokenSchema`). */
const TOKEN_BYTES = 32;

/** Only the SHA-256 of a token is stored or compared, in base64url (`mcp_grants_token_hash_check`). */
export const hashOfToken = (token: string): string => createHash('sha256').update(token).digest('base64url');

export function mintToken(): MintedToken {
  const token = `${MCP_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return { token, hash: hashOfToken(token) };
}
