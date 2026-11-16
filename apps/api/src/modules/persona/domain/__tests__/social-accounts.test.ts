import {
  PutSocialAccountsBodySchema,
  SocialAccountIdSchema,
  SocialAccountUsernameSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { sharingChanges } from '../social-accounts';

// Fictive accounts only (ADR 0143 § 7): her real ones live in the CRM.
const a = {
  id: SocialAccountIdSchema.parse('0193a0a0-0000-7000-8000-000000000001'),
  usage: 'lives',
  agentMayShare: false,
} as const;
const b = {
  id: SocialAccountIdSchema.parse('0193a0a0-0000-7000-8000-000000000002'),
  usage: 'practice',
  agentMayShare: true,
} as const;

describe('sharingChanges (ADR 0143 § 20)', () => {
  it('names each account whose « l’agent peut le donner » changed, and a shared one removed', () => {
    expect(sharingChanges([a, b], [{ ...a, agentMayShare: true }, b])).toEqual([
      { id: a.id, usage: 'lives', agentMayShare: true },
    ]);
    expect(sharingChanges([a, b], [a])).toEqual([{ id: b.id, usage: 'practice', agentMayShare: false }]);
    expect(sharingChanges([], [b])).toEqual([{ id: b.id, usage: 'practice', agentMayShare: true }]);
    expect(sharingChanges([a], [a])).toEqual([]);
  });
});

describe('SocialAccountUsernameSchema', () => {
  it('keeps the user name alone: no link, no space, the leading @ dropped', () => {
    expect(SocialAccountUsernameSchema.parse(' @demo.aerienne ')).toBe('demo.aerienne');
    expect(SocialAccountUsernameSchema.safeParse('https://example.com/demo').success).toBe(false);
    expect(SocialAccountUsernameSchema.safeParse('demo aerienne').success).toBe(false);
  });

  it('refuses the same account twice, and switches off by default', () => {
    const one = { id: a.id, platform: 'instagram', username: 'demo', usage: 'lives' };
    expect(
      PutSocialAccountsBodySchema.safeParse({ accounts: [one, { ...one, id: b.id, username: 'DEMO' }] })
        .success,
    ).toBe(false);
    expect(PutSocialAccountsBodySchema.parse({ accounts: [one] }).accounts[0]?.agentMayShare).toBe(false);
  });
});
