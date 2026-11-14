/**
 * What no MCP tool ever does (ADR 0026 § 5, kept by ADR 0105 § 3), as patterns over tool names: a test fails if the
 * catalogue holds one. A gesture that one day enters the catalogue by an accepted ADR leaves this list in the same PR,
 * where the diff shows it. It reads names only: a tool with a harmless name that did a forbidden gesture would pass, so
 * it is a net for reviewing a diff, never a guarantee; what a tool does is checked by reading its handler. Lot b adds
 * the closed list of the tools that are not reads, so that a writing tool needs its name there as well.
 */
export interface NeverExposed {
  readonly pattern: RegExp;
  readonly why: string;
}

export const NEVER_EXPOSED: readonly NeverExposed[] = [
  {
    pattern: /send|reply|write_to_fan|mass_dm|broadcast|message_(create|write|post)/,
    why: 'nothing written by an agent reaches a fan (ADR 0021)',
  },
  {
    pattern: /approve|confirm/,
    why: 'approving sends to a fan, and a prepared action is confirmed by a human on screen only (ADR 0019, 0105 § 2)',
  },
  {
    pattern: /draft_(create|edit|update|write|propose|suggest)/,
    why: 'a draft is never written, proposed or touched by an external agent',
  },
  {
    pattern: /unflag|flag_clear|limit_raise|unfreeze|unblock|hand_back/,
    why: 'an agent brakes, never accelerates',
  },
  {
    pattern: /auto|blind_test|mode_raise|connector|resume|enable|activate/,
    why: 'only a human speeds the agent up or switches something on',
  },
  {
    pattern: /key|token|secret|session|credential|password|second_factor|two_factor|totp|passkey|login/,
    why: 'keys, tokens, sessions and second factors never leave nor change (ADR 0016)',
  },
  {
    pattern: /grant|access_/,
    why: 'an agent access is created, renewed and revoked by the owner on screen only (ADR 0026 § 3)',
  },
  { pattern: /persona|prompt|canary|voice/, why: 'the persona and the prompts are not exposed (ADR 0010)' },
  {
    pattern:
      /payroll_(validate|pay|close)|pay_|payout|payment|invoice|credit_note|commission_(rate|preset)|(^|_)rate(_|$)|contractor/,
    why: 'pay, invoices, rates and the contractor file are never written by an agent (ADR 0026 § 5, ADR 0105 § 3)',
  },
  {
    pattern: /validate|publish/,
    why: 'validating or publishing (a pay period, a statement, a drop) is a human gesture',
  },
  {
    pattern: /member_(create|update|role|depart|invite(?!_prepare))|invitation|role_(set|grant)/,
    why: 'members are only prepared, then confirmed by the owner with his second factor (ADR 0105 § 2)',
  },
  {
    pattern: /script_(create|update|edit|activate|price)|price_set/,
    why: 'a script is only prepared, without a price and never active (ADR 0105 § 2)',
  },
  { pattern: /delete|erase|purge|remove/, why: 'no deletion' },
  { pattern: /export|dump|bulk/, why: 'no export of fans in bulk' },
  { pattern: /note/, why: "a chatter's notes on a fan never come from a model" },
  {
    pattern: /playground|generate|describe|summari[sz]e|sync/,
    why: "nothing spends the agency's AI budget nor drives a connector",
  },
];

/** The rules a tool name breaks, empty when none. */
export function neverExposedHits(name: string): readonly NeverExposed[] {
  return NEVER_EXPOSED.filter((rule) => rule.pattern.test(name));
}
