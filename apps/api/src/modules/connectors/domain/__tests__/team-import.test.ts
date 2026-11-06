import { TeamMemberIdSchema, type PlatformChatter } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  isAbnormalReading,
  linkRefusal,
  proposeFor,
  type ImportableMember,
} from '../team-import';

// Invented members and accounts (ADR 0010).
const LEA = TeamMemberIdSchema.parse('00000000-0000-4000-8000-000000000001');
const MANAGER = TeamMemberIdSchema.parse('00000000-0000-4000-8000-000000000002');
const HOMONYM = TeamMemberIdSchema.parse('00000000-0000-4000-8000-000000000003');

const member = (memberId: typeof LEA, first: string, last: string, email: string): ImportableMember => ({
  memberId,
  displayName: first,
  firstName: first,
  lastName: last,
  email,
  active: true,
});

const chatter = (patch: Partial<PlatformChatter> = {}): PlatformChatter => ({
  platformChatterId: 'chatter_test_01',
  firstName: 'Léa',
  lastName: 'Test',
  email: 'lea@recette.test',
  role: 'chatter',
  isBot: false,
  isExternal: false,
  removedAt: null,
  platformModelIds: [],
  ...patch,
});

const members = [
  member(LEA, 'Lea', 'TEST', 'Lea@Recette.test'),
  member(MANAGER, 'Max', 'Test', 'max@recette.test'),
];

describe('proposeFor', () => {
  it('links to the member with the same e-mail, whatever its case, ticked', () => {
    expect(proposeFor(chatter({ firstName: 'Autre' }), { sessionChatterId: null, members })).toEqual({
      suggestion: { kind: 'member', memberId: LEA, memberDisplayName: 'Lea', match: 'email' },
      preselected: true,
    });
  });

  it('links by first and last names when no e-mail matches, accents and case aside', () => {
    const proposal = proposeFor(chatter({ email: 'autre@recette.test' }), {
      sessionChatterId: null,
      members,
    });
    expect(proposal).toEqual({
      suggestion: { kind: 'member', memberId: LEA, memberDisplayName: 'Lea', match: 'name' },
      preselected: true,
    });
  });

  it('proposes a name shared by two members unticked', () => {
    const twice = [...members, member(HOMONYM, 'Léa', 'Test', 'lea2@recette.test')];
    const proposal = proposeFor(chatter({ email: null }), { sessionChatterId: null, members: twice });
    expect(proposal.preselected).toBe(false);
    expect(proposal.suggestion.kind).toBe('member');
  });

  it('never proposes a member who left', () => {
    const gone = members.map((one) => ({ ...one, active: false }));
    expect(proposeFor(chatter(), { sessionChatterId: null, members: gone }).suggestion).toEqual({
      kind: 'invite',
    });
  });

  it('proposes the agent for the captured session’s account, ticked', () => {
    const proposal = proposeFor(chatter({ email: null, firstName: 'bot', lastName: '' }), {
      sessionChatterId: 'chatter_test_01',
      members,
    });
    expect(proposal).toEqual({ suggestion: { kind: 'agent', match: 'session' }, preselected: true });
  });

  it('proposes the agent for an account named « bot » unticked, while the session’s account is unknown', () => {
    const proposal = proposeFor(chatter({ email: null, firstName: 'Bot', lastName: '' }), {
      sessionChatterId: null,
      members,
    });
    expect(proposal).toEqual({ suggestion: { kind: 'agent', match: 'name' }, preselected: false });
  });

  it('proposes nobody for an API key’s bot, ticked', () => {
    const proposal = proposeFor(chatter({ isBot: true, email: null, firstName: 'Clé', lastName: 'CRM' }), {
      sessionChatterId: null,
      members,
    });
    expect(proposal).toEqual({ suggestion: { kind: 'none' }, preselected: true });
  });

  it('invites an agency member with an e-mail nothing matches, unticked', () => {
    const proposal = proposeFor(chatter({ email: 'nouveau@recette.test', firstName: 'Nouveau' }), {
      sessionChatterId: null,
      members,
    });
    expect(proposal).toEqual({ suggestion: { kind: 'invite' }, preselected: false });
  });

  it('never invites a provider’s account, even with an e-mail', () => {
    const external = chatter({ isExternal: true, email: 'presta@recette.test', firstName: 'Presta' });
    expect(proposeFor(external, { sessionChatterId: null, members }).suggestion).toEqual({ kind: 'none' });
  });

  it('does not match a provider by e-mail, only by name', () => {
    const external = chatter({ isExternal: true, email: 'lea@recette.test', firstName: 'Autre' });
    expect(proposeFor(external, { sessionChatterId: null, members }).suggestion).toEqual({ kind: 'none' });
  });
});

describe('actionsFor', () => {
  const manager = { kind: 'manager', memberId: MANAGER } as const;

  it('gives the owner every action on an agency member without a link', () => {
    expect(
      actionsFor({ chatter: chatter(), linkedMemberId: null, dismissed: false }, { kind: 'owner' }),
    ).toEqual(['link_member', 'link_agent', 'link_none', 'invite', 'dismiss']);
  });

  it('gives a manager nothing on a row linked to his own record', () => {
    expect(actionsFor({ chatter: chatter(), linkedMemberId: MANAGER, dismissed: false }, manager)).toEqual(
      [],
    );
  });

  it('keeps a provider’s link to a member for the owner', () => {
    const external = chatter({ isExternal: true, email: null });
    expect(actionsFor({ chatter: external, linkedMemberId: null, dismissed: false }, manager)).toEqual([
      'link_agent',
      'link_none',
      'dismiss',
    ]);
    expect(
      actionsFor({ chatter: external, linkedMemberId: null, dismissed: false }, { kind: 'owner' }),
    ).toContain('link_member');
  });
});

describe('linkRefusal', () => {
  const manager = { kind: 'manager', memberId: MANAGER } as const;

  it('lets the owner do anything', () => {
    expect(
      linkRefusal({ kind: 'owner' }, chatter(), MANAGER, { kind: 'member', memberId: MANAGER }),
    ).toBeNull();
  });

  it('refuses a manager a link to his own record, and moving one away from it', () => {
    expect(linkRefusal(manager, chatter(), null, { kind: 'member', memberId: MANAGER })).toBe('own_link');
    expect(linkRefusal(manager, chatter(), MANAGER, { kind: 'none' })).toBe('own_link');
  });

  it('refuses a manager a provider linked to a member, not set to nobody', () => {
    const external = chatter({ isExternal: true });
    expect(linkRefusal(manager, external, null, { kind: 'member', memberId: LEA })).toBe(
      'external_owner_only',
    );
    expect(linkRefusal(manager, external, LEA, { kind: 'none' })).toBeNull();
  });
});

describe('isAbnormalReading', () => {
  it('does not believe an empty list, or one that lost more than half at once', () => {
    expect(isAbnormalReading(0, 4)).toBe(true);
    expect(isAbnormalReading(1, 4)).toBe(true);
    expect(isAbnormalReading(2, 4)).toBe(false);
    expect(isAbnormalReading(0, 0)).toBe(false);
  });
});
