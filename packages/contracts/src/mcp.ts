import { z } from 'zod';

import { AiUsageCapStateSchema } from './ai-usage';
import { DropCategorySchema, DropStateSchema } from './content-drops';
import { FactCategorySchema, StoredFactKindSchema } from './enums';
import { refusalBodySchema } from './errors';
import { FanCardFieldSchema, FanCardSourceSchema } from './fan-card';
import { FanFlagsSchema } from './fans';
import {
  ContentDropIdSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  McpGrantIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
} from './ids';
import {
  ScriptMomentSchema,
  ScriptStageAccessSchema,
  ScriptStructureIdSchema,
  ScriptVariantLetterSchema,
} from './scripts';

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
  /** What a creator wrote with a drop of hers. */
  'creator_sentence',
  /** A script's words, written by the agency in the owner's workshop: free text all the same. */
  'script_text',
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

/** A creator as an agent reads her (ADR 0026 § 5): never her persona, her platforms or her photo. */
export const McpCreatorSchema = z.strictObject({
  id: CreatorIdSchema,
  displayName: z.string(),
  timezone: z.string(),
});
export type McpCreator = z.infer<typeof McpCreatorSchema>;

/** `creators_list`: the creators the call may read, archived ones left out (ADR 0071 § 2), ordered by name. */
export const McpCreatorListSchema = z.strictObject({ creators: z.array(McpCreatorSchema) });
export type McpCreatorList = z.infer<typeof McpCreatorListSchema>;

/** `creator_get`: the access's creator, `null` once she is archived. */
export const McpCreatorGetSchema = z.strictObject({ creator: McpCreatorSchema.nullable() });
export type McpCreatorGet = z.infer<typeof McpCreatorGetSchema>;

/** Untrusted text of one kind: what a tool gives back that a fan wrote, or that was read in what he wrote. */
const untrustedOf = <K extends McpUntrustedKind>(kind: K) =>
  z.strictObject({ kind: z.literal(kind), text: z.string() });

/** The input of a tool on one fan: his id, and the creator when the call names one (the access's otherwise). */
export const McpFanInputSchema = z.strictObject({
  fanId: FanIdSchema,
  creatorId: CreatorIdSchema.optional(),
});

/**
 * `fan_get` (ADR 0026 § 5, `read:fans`): his name and what she knows of him, in `untrusted` fields, his limits, when he
 * was first and last seen. Never his platform's id, a link or a media. `null` for a fan she does not have.
 */
export const McpFanGetSchema = z.strictObject({
  fan: z
    .strictObject({
      id: FanIdSchema,
      name: untrustedOf('fan_name'),
      firstSeenAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      flags: FanFlagsSchema,
      facts: z.array(
        z.strictObject({
          category: FactCategorySchema,
          /** Written from what he said: free text, like the value. */
          key: untrustedOf('fan_fact'),
          kind: StoredFactKindSchema,
          observedAt: z.iso.datetime(),
          value: untrustedOf('fan_fact'),
        }),
      ),
    })
    .nullable(),
});
export type McpFanGet = z.infer<typeof McpFanGetSchema>;

const McpCardValueSchema = z.strictObject({
  items: z.array(untrustedOf('fan_card')),
  source: FanCardSourceSchema,
  observedAt: z.iso.datetime(),
  /** The chatter who noted it (ADR 0085 § 5, ADR 0105 § 4); `null` for what the AI read. */
  notedByName: z.string().nullable(),
});

/**
 * `fan_card_get` (ADR 0085, ADR 0105 § 4, `read:fans`): his card as the AI filled it, each value in `untrusted` fields,
 * and how many values wait « à vérifier ». Never the message a value was read in.
 */
export const McpFanCardGetSchema = z.strictObject({
  card: z
    .strictObject({
      fields: z.array(
        z.strictObject({
          field: FanCardFieldSchema,
          current: McpCardValueSchema.nullable(),
          toCheck: z.number().int().nonnegative(),
        }),
      ),
      others: z.array(
        z.strictObject({
          /** Written from what he said: free text, like the value. */
          key: untrustedOf('fan_card'),
          value: untrustedOf('fan_card'),
          source: FanCardSourceSchema,
          observedAt: z.iso.datetime(),
        }),
      ),
    })
    .nullable(),
});
export type McpFanCardGet = z.infer<typeof McpFanCardGetSchema>;

/** The input of a tool on one creator's content: the creator when the call names one (the access's otherwise). */
export const McpCreatorInputSchema = z.strictObject({ creatorId: CreatorIdSchema.optional() });

/** `drops_list`'s input: a page of 50 at most, after the last drop of the page before. */
export const McpDropsInputSchema = z.strictObject({
  creatorId: CreatorIdSchema.optional(),
  after: ContentDropIdSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/**
 * `drops_list` (ADR 0105 § 4, `read:media`): her drops, newest first, what they are and where they stand, how many
 * files of each kind. Her sentence in an `untrusted` field; never a medium, its key nor its address.
 */
export const McpDropsListSchema = z.strictObject({
  drops: z.array(
    z.strictObject({
      id: ContentDropIdSchema,
      category: DropCategorySchema,
      state: DropStateSchema,
      sentence: untrustedOf('creator_sentence').nullable(),
      requestId: ContentRequestIdSchema.nullable(),
      scriptNumber: z.number().int().nonnegative().nullable(),
      files: z.strictObject({
        image: z.number().int().nonnegative(),
        video: z.number().int().nonnegative(),
        audio: z.number().int().nonnegative(),
      }),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** The `after` of the next page; `null` on the last. */
  next: ContentDropIdSchema.nullable(),
});
export type McpDropsList = z.infer<typeof McpDropsListSchema>;

const McpScriptSizeShape = {
  moment: ScriptMomentSchema,
  stages: z.number().int().nonnegative(),
  bridges: z.number().int().nonnegative(),
};

/**
 * `scripts_list` (ADR 0105 § 4, `read:media`): her scripts asked and dropped, newest first, then the structures her
 * queue holds, in order. Names in `untrusted` fields; never a step's text (`script_steps_get`), never a price.
 */
export const McpScriptsListSchema = z.strictObject({
  scripts: z.array(
    z.strictObject({
      dropId: ContentDropIdSchema,
      number: z.number().int().nonnegative().nullable(),
      name: untrustedOf('script_text').nullable(),
      moment: ScriptMomentSchema.nullable(),
      stages: z.number().int().nonnegative(),
      bridges: z.number().int().nonnegative(),
      state: DropStateSchema,
      dueOn: z.iso.date(),
      exportedAt: z.iso.datetime().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  /** `null` when the reader may not read her queue. */
  queue: z
    .array(
      z.strictObject({
        structureId: ScriptStructureIdSchema,
        name: untrustedOf('script_text'),
        ...McpScriptSizeShape,
      }),
    )
    .nullable(),
});
export type McpScriptsList = z.infer<typeof McpScriptsListSchema>;

/** `script_steps_get`'s input: a script drop of hers. */
export const McpScriptStepsInputSchema = z.strictObject({
  dropId: ContentDropIdSchema,
  creatorId: CreatorIdSchema.optional(),
});

const scriptText = untrustedOf('script_text');

/** A frame to fill: its kind, whether it may be left out, its lengths; its hint in an `untrusted` field. */
const McpMediaSlotSchema = z.strictObject({
  kind: z.enum(['image', 'video', 'audio']),
  optional: z.boolean(),
  hint: scriptText.nullable(),
  minSeconds: z.number().int().positive().nullable(),
  maxSeconds: z.number().int().positive().nullable(),
});

/**
 * `script_steps_get` (ADR 0105 § 4, `read:script_content`, ticked on the owner's access only): the steps of a script of
 * hers, its frozen version. Every word in an `untrusted` field; offered or paid, never a price. `null` for a drop that
 * is not a script of hers.
 */
export const McpScriptStepsGetSchema = z.strictObject({
  script: z
    .strictObject({
      dropId: ContentDropIdSchema,
      name: scriptText,
      moment: ScriptMomentSchema,
      segments: z.array(
        z.discriminatedUnion('kind', [
          z.strictObject({
            kind: z.literal('stage'),
            key: scriptText,
            name: scriptText,
            intention: scriptText,
            access: ScriptStageAccessSchema,
            mood: scriptText.nullable(),
            outfit: scriptText.nullable(),
            place: scriptText.nullable(),
            mediaSlots: z.array(McpMediaSlotSchema),
            variants: z.array(z.strictObject({ letter: ScriptVariantLetterSchema, hint: scriptText })),
          }),
          z.strictObject({
            kind: z.literal('bridge'),
            key: scriptText,
            from: scriptText,
            to: scriptText,
            teaser: scriptText,
            mediaSlots: z.array(McpMediaSlotSchema),
          }),
        ]),
      ),
    })
    .nullable(),
});
export type McpScriptStepsGet = z.infer<typeof McpScriptStepsGetSchema>;

/**
 * `on_shift_now` (ADR 0026 § 5, `read:team`): who is on shift now on the creators the access reads, read as its person
 * (a manager, only what he plans). The member by id and name, the shift's end; never an account of a platform, a margin
 * nor a rate.
 */
export const McpOnShiftNowSchema = z.strictObject({
  onShift: z.array(
    z.strictObject({
      shiftId: ShiftIdSchema,
      creatorId: CreatorIdSchema,
      memberId: TeamMemberIdSchema,
      memberName: z.string(),
      endsAt: z.iso.datetime(),
    }),
  ),
});
export type McpOnShiftNow = z.infer<typeof McpOnShiftNowSchema>;

const euros = z.number().nonnegative();

/**
 * `ai_usage_get` (ADR 0091, ADR 0105 § 4, the owner's alone): what the AI costs the agency, as the screen shows it.
 * Today against the daily cap, the last days, the month's pace, the last call. Never a provider's balance or key.
 */
export const McpAiUsageSchema = z.strictObject({
  readAt: z.iso.datetime({ offset: true }),
  today: z.strictObject({
    day: z.iso.date(),
    eur: euros,
    capEur: z.number().positive(),
    alertAtEur: z.number().positive(),
    state: AiUsageCapStateSchema,
    calls: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  days: z.array(z.strictObject({ day: z.iso.date(), eur: euros, calls: z.number().int().nonnegative() })),
  pace: z.strictObject({
    perDayEur: euros.nullable(),
    perDayOver: z.number().int().min(0).max(7),
    monthEur: euros,
    monthForecastEur: euros.nullable(),
    month: z.string().regex(/^\d{4}-\d{2}$/u),
  }),
  lastCallAt: z.iso.datetime({ offset: true }).nullable(),
});
export type McpAiUsage = z.infer<typeof McpAiUsageSchema>;
