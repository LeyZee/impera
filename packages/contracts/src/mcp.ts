import { z } from 'zod';

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
