/**
 * What no MCP tool ever does (ADR 0026 § 5, kept by ADR 0105 § 3), as patterns over tool names: a test fails if the
 * catalogue holds one. A gesture that one day enters the catalogue by an accepted ADR leaves this list in the same PR,
 * where the diff shows it.
 */
export interface NeverExposed {
  readonly pattern: RegExp;
  readonly why: string;
}

export const NEVER_EXPOSED: readonly NeverExposed[] = [
  { pattern: /send|reply|write_to_fan|mass_dm/, why: 'nothing written by an agent reaches a fan (ADR 0021)' },
  {
    pattern: /approve/,
    why: 'approving a draft sends it to a fan: Automatic through a back door (ADR 0019)',
  },
  {
    pattern: /draft_(create|edit|update|write)/,
    why: 'a draft is never written or touched by an external agent',
  },
  {
    pattern: /age_confirm|confirm_age|unflag|flag_clear|limit_raise/,
    why: 'an agent brakes, never accelerates',
  },
  {
    pattern: /automatic|blind_test|mode_raise|connector_writes|resume/,
    why: 'only a human speeds the agent up',
  },
  {
    pattern: /key|token|secret|session|credential|password/,
    why: 'keys, tokens and sessions never leave (ADR 0016)',
  },
  { pattern: /persona|prompt|canary|voice/, why: 'the persona and the prompts are not exposed (ADR 0010)' },
  {
    pattern: /payroll_(validate|pay|close)|payout|invoice|credit_note|commission_(rate|preset)|contractor/,
    why: 'pay, invoices, rates and the contractor file are never written by an agent (ADR 0026 § 5, ADR 0105 § 3)',
  },
  {
    pattern: /member_(create|update|delete|remove|role)|role_(set|grant)/,
    why: 'members are only prepared, then confirmed by the owner with his second factor (ADR 0105 § 2)',
  },
  { pattern: /delete|erase|purge|remove/, why: 'no deletion' },
  { pattern: /export|dump|bulk/, why: 'no export of fans in bulk' },
  { pattern: /operator_note/, why: "a chatter's notes never come from a model" },
  { pattern: /playground|generate/, why: "nothing spends the agency's AI budget" },
];

/** The rules a tool name breaks, empty when none. */
export function neverExposedHits(name: string): readonly NeverExposed[] {
  return NEVER_EXPOSED.filter((rule) => rule.pattern.test(name));
}
