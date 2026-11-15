import type { McpCapability } from '@impera/contracts';

/**
 * The catalogue of the MCP server (ADR 0026 § 5, ADR 0105 § 4): every tool an agent may call, with the capability it
 * needs and what it reaches. Pure data; the dispatcher reads it, and a snapshot test pins it so that any change shows
 * in the PR (ADR 0026 § 9).
 */

/** What a tool does: lot a only reads (ADR 0105 § 6). */
type McpToolKind = 'read';

/**
 * What the tool reaches: one creator (the access's, which it must have), the agency (within the person's team scope),
 * or nothing but the access itself.
 */
type McpToolScope = 'creator' | 'agency' | 'access';

export interface McpToolSpec {
  /** English, `snake_case`, `<object>_<verb>` (ADR 0026 § 9). */
  readonly name: string;
  /** `null` only for `whoami`, which reads the access itself. */
  readonly capability: McpCapability | null;
  readonly kind: McpToolKind;
  readonly scope: McpToolScope;
  /**
   * The owner's alone, whatever the capability: agency-wide figures no manager reads on the screen. Called on an access
   * of the agency only, never one bound to a creator, whose agent has no business with them.
   */
  readonly ownerOnly?: true;
  /**
   * The agency's as a whole, never cut by creator (the team imported from a platform, the commission statements): an
   * access bound to a creator never calls nor lists it, whoever its person is.
   */
  readonly agencyOnly?: true;
}

/** Semver of the catalogue, announced in `serverInfo` (`impera-mcp`). */
export const MCP_CATALOGUE_VERSION = '0.1.0';

export const MCP_CATALOGUE: readonly McpToolSpec[] = [
  { name: 'whoami', capability: null, kind: 'read', scope: 'access' },
  // State of the chatting agent, À traiter, figures (ADR 0026 § 5; ADR 0105 § 4: Bilan, daily stats, AI usage).
  { name: 'creators_list', capability: 'read:status', kind: 'read', scope: 'agency' },
  { name: 'creator_get', capability: 'read:status', kind: 'read', scope: 'creator' },
  { name: 'agent_status', capability: 'read:status', kind: 'read', scope: 'creator' },
  { name: 'todo_list', capability: 'read:status', kind: 'read', scope: 'agency' },
  { name: 'stats_get', capability: 'read:status', kind: 'read', scope: 'agency' },
  { name: 'fortnight_review_get', capability: 'read:status', kind: 'read', scope: 'agency' },
  { name: 'platform_daily_stats_list', capability: 'read:status', kind: 'read', scope: 'creator' },
  { name: 'ai_usage_get', capability: 'read:status', kind: 'read', scope: 'agency', ownerOnly: true },
  // Conversations: their metadata, then their text, which only `read:conversation_content` opens (ADR 0026 § 4).
  { name: 'conversations_list', capability: 'read:conversations', kind: 'read', scope: 'creator' },
  { name: 'conversation_get', capability: 'read:conversations', kind: 'read', scope: 'creator' },
  { name: 'conversation_messages', capability: 'read:conversation_content', kind: 'read', scope: 'creator' },
  { name: 'drafts_pending', capability: 'read:conversation_content', kind: 'read', scope: 'creator' },
  // Fans: facts, summary, flags, and the card the AI fills (ADR 0085).
  { name: 'fan_get', capability: 'read:fans', kind: 'read', scope: 'creator' },
  { name: 'fan_card_get', capability: 'read:fans', kind: 'read', scope: 'creator' },
  // Team (the former lot 3 of ADR 0026, taken into lot a by ADR 0105 § 6).
  { name: 'shifts_list', capability: 'read:team', kind: 'read', scope: 'agency' },
  { name: 'on_shift_now', capability: 'read:team', kind: 'read', scope: 'agency' },
  { name: 'shift_reports_list', capability: 'read:team', kind: 'read', scope: 'agency' },
  { name: 'team_import_list', capability: 'read:team', kind: 'read', scope: 'agency', agencyOnly: true },
  {
    name: 'commission_statements_list',
    capability: 'read:payroll',
    kind: 'read',
    scope: 'agency',
    agencyOnly: true,
  },
  // Sales read from the platform, and by chatter (ADR 0073, 0078).
  { name: 'sales_list', capability: 'read:sales', kind: 'read', scope: 'agency' },
  { name: 'sales_by_chatter', capability: 'read:sales', kind: 'read', scope: 'agency' },
  // Drops and scripts: titles, number of steps, statuses; the steps' text only with `read:script_content`.
  { name: 'drops_list', capability: 'read:media', kind: 'read', scope: 'creator' },
  { name: 'scripts_list', capability: 'read:media', kind: 'read', scope: 'creator' },
  { name: 'script_steps_get', capability: 'read:script_content', kind: 'read', scope: 'creator' },
];

/** The tool of that name, or `undefined`: an unknown name is refused, never guessed. */
export function toolNamed(name: string): McpToolSpec | undefined {
  return MCP_CATALOGUE.find((tool) => tool.name === name);
}
