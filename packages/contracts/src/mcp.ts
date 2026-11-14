import { z } from 'zod';

import { refusalBodySchema } from './errors';
import { CreatorIdSchema, McpGrantIdSchema } from './ids';

/**
 * The MCP server (ADR 0026, amended by ADR 0105): what an agent access may be granted. A closed list in code; the
 * screen never ticks one by default.
 */
export const MCP_CAPABILITIES = [
  'read:status',
  'read:conversations',
  'read:conversation_content',
  'read:fans',
  'read:team',
  'read:payroll',
  'read:sales',
  'read:media',
  'read:script_content',
  /** Only refuses a pending draft with a bounded reason (`draft_reject`, ADR 0026 § 4): never writes, edits nor approves one. */
  'write:drafts',
  'write:brakes',
  'write:tasks',
  'write:drops',
  'prepare:team',
] as const;
export const McpCapabilitySchema = z.enum(MCP_CAPABILITIES);
export type McpCapability = z.infer<typeof McpCapabilitySchema>;

/**
 * Capabilities ticked only on an access in the owner's own name (ADR 0105 § 2.5 and § 4): the agency's method, and the
 * gestures that touch the team or the money, never go through a manager's or a creator's agent.
 */
export const MCP_OWNER_ONLY_CAPABILITIES: readonly McpCapability[] = ['read:script_content', 'prepare:team'];

/**
 * Where an MCP tool's text came from a fan, or from what he wrote (ADR 0026 § 6): data, never an instruction. His card
 * (ADR 0085) is filled from his own words, and his name or handle in a list is his own choice.
 */
export const McpUntrustedKindSchema = z.enum([
  'fan_message',
  'fan_fact',
  'fan_summary',
  'fan_card',
  'fan_name',
  'draft',
]);
export type McpUntrustedKind = z.infer<typeof McpUntrustedKindSchema>;

export const McpUntrustedSchema = z.object({ kind: McpUntrustedKindSchema, text: z.string() });
export type McpUntrusted = z.infer<typeof McpUntrustedSchema>;

/**
 * An agent's token (ADR 0026 § 3, ADR 0105 § 1): a prefix that gitleaks knows (`.gitleaks.toml`), then 256 random bits
 * in base64url. Shown once at its creation, kept as its SHA-256 only, read from `Authorization: Bearer` only.
 */
export const MCP_TOKEN_PREFIX = 'impmcp_';
export const McpTokenSchema = z.string().regex(/^impmcp_[A-Za-z0-9_-]{43}$/);
export type McpToken = z.infer<typeof McpTokenSchema>;

/** An access lives 90 days at most (ADR 0026 § 3); renewing it is making a new one. */
export const MCP_GRANT_MAX_DAYS = 90;

/** The agent's name, as the owner gives it (« Claude Code du PC »). */
export const McpGrantLabelSchema = z.string().trim().min(1).max(40);

/** An agent access as the screen shows it: never its token nor its fingerprint. */
export const McpGrantSchema = z.strictObject({
  id: McpGrantIdSchema,
  label: z.string(),
  /** The creator the access is bound to, `null` for the agency's tools only. */
  creatorId: CreatorIdSchema.nullable(),
  capabilities: z.array(McpCapabilitySchema),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type McpGrant = z.infer<typeof McpGrantSchema>;

/** `GET /v1/settings/mcp-grants`: the owner's accesses, the newest first, revoked and expired ones included. */
export const McpGrantListSchema = z.strictObject({ items: z.array(McpGrantSchema) });
export type McpGrantList = z.infer<typeof McpGrantListSchema>;

/** `POST /v1/settings/mcp-grants`: no capability is ever ticked by default, the screen sends what the owner ticked. */
export const CreateMcpGrantBodySchema = z.strictObject({
  label: McpGrantLabelSchema,
  creatorId: CreatorIdSchema.nullable(),
  capabilities: z.array(McpCapabilitySchema).max(MCP_CAPABILITIES.length),
  days: z.int().min(1).max(MCP_GRANT_MAX_DAYS),
});
export type CreateMcpGrantBody = z.infer<typeof CreateMcpGrantBodySchema>;

/** Its answer: the access and its token, once. */
export const McpGrantCreatedSchema = McpGrantSchema.extend({ token: McpTokenSchema });
export type McpGrantCreated = z.infer<typeof McpGrantCreatedSchema>;

/** Why an access is refused at its creation: the screen says it in French, by its kind. */
export const McpGrantRefusalKindSchema = z.enum(['capability_repeated', 'owner_only', 'role_forbidden']);
export type McpGrantRefusalKind = z.infer<typeof McpGrantRefusalKindSchema>;
export const MCP_GRANT_UNPROCESSABLE = 'mcp_grant_unprocessable';
export const McpGrantRefusalBodySchema = refusalBodySchema(McpGrantRefusalKindSchema);

/**
 * Why a call of a tool is refused (ADR 0026 § 4, ADR 0105 § 1), given back to the agent as is: it names a rule, never
 * a person, a creator or a datum. `tool_unknown`: a name outside the catalogue, or one not served yet.
 */
export const McpCallRefusalSchema = z.enum([
  'tool_unknown',
  'arguments_invalid',
  'second_factor_required',
  'capability_missing',
  'owner_only',
  'creator_required',
  'creator_forbidden',
  'role_forbidden',
  'rate_limited',
]);
export type McpCallRefusal = z.infer<typeof McpCallRefusalSchema>;

/** `whoami` (ADR 0026 § 5): the access the agent calls with, never its token, and the catalogue it is served. */
export const McpWhoamiSchema = z.strictObject({
  grantId: McpGrantIdSchema,
  label: z.string(),
  creatorId: CreatorIdSchema.nullable(),
  capabilities: z.array(McpCapabilitySchema),
  expiresAt: z.iso.datetime(),
  catalogueVersion: z.string(),
});
export type McpWhoami = z.infer<typeof McpWhoamiSchema>;
