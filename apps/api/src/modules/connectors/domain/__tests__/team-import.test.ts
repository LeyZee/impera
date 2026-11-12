import { CreatorIdSchema, TeamMemberIdSchema, type PlatformChatter } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  actionsFor,
  isAbnormalReading,
  linkRefusal,
  proposeFor,
  teamImportOverview,
  type ImportableMember,
  type TeamImportContext,
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
  leftOn: null,
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
      suggestion: {
        kind: 'member',
        memberId: LEA,
        memberDisplayName: 'Lea',
        match: 'email',
        departedOn: null,
      },
      preselected: true,
    });
  });

  it('links by first and last names when no e-mail matches, accents and case aside', () => {
    const proposal = proposeFor(chatter({ email: 'autre@recette.test' }), {
      sessionChatterId: null,
      members,
    });
    expect(proposal).toEqual({
      suggestion: {
        kind: 'member',
        memberId: LEA,
        memberDisplayName: 'Lea',
        match: 'name',
        departedOn: null,
      },
      preselected: true,
    });
  });

  it('proposes a name shared by two members unticked', () => {
    const twice = [...members, member(HOMONYM, 'Léa', 'Test', 'lea2@recette.test')];
    const proposal = proposeFor(chatter({ email: null }), { sessionChatterId: null, members: twice });
    expect(proposal?.preselected).toBe(false);
    expect(proposal?.suggestion.kind).toBe('member');
  });

  it('proposes a member who left on his e-mail, marked as departed and unticked, never an invitation', () => {
    const gone = members.map((one) => ({ ...one, leftOn: '2026-11-01' }));
    expect(proposeFor(chatter(), { sessionChatterId: null, members: gone })).toEqual({
      suggestion: {
        kind: 'member',
        memberId: LEA,
        memberDisplayName: 'Lea',
        match: 'email',
        departedOn: '2026-11-01',
      },
      preselected: false,
    });
  });

  it('prefers a member still in the team when a departed one had the same e-mail', () => {
    const back = [{ ...members[0]!, memberId: HOMONYM, leftOn: '2026-10-01' }, ...members];
    expect(proposeFor(chatter(), { sessionChatterId: null, members: back })?.suggestion).toMatchObject({
      memberId: LEA,
      departedOn: null,
    });
  });

  it('never proposes a member who left by name alone', () => {
    const gone = members.map((one) => ({ ...one, leftOn: '2026-11-01' }));
    const proposal = proposeFor(chatter({ email: null }), { sessionChatterId: null, members: gone });
    expect(proposal?.suggestion).toEqual({ kind: 'none' });
  });

  it('proposes nothing for an account the platform removed, unless its e-mail is a member’s', () => {
    const removed = chatter({ email: 'nouveau@recette.test', removedAt: '2026-11-05T10:00:00.000Z' });
    expect(proposeFor(removed, { sessionChatterId: null, members })).toBeNull();
    expect(proposeFor({ ...removed, email: null }, { sessionChatterId: null, members })).toBeNull();
    const gone = members.map((one) => ({ ...one, leftOn: '2026-11-01' }));
    expect(
      proposeFor({ ...removed, email: 'lea@recette.test' }, { sessionChatterId: null, members: gone })
        ?.suggestion,
    ).toMatchObject({ kind: 'member', memberId: LEA, departedOn: '2026-11-01' });
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
    expect(proposeFor(external, { sessionChatterId: null, members })?.suggestion).toEqual({ kind: 'none' });
  });

  it('does not match a provider by e-mail, only by name', () => {
    const external = chatter({ isExternal: true, email: 'lea@recette.test', firstName: 'Autre' });
    expect(proposeFor(external, { sessionChatterId: null, members })?.suggestion).toEqual({ kind: 'none' });
  });
});

describe('actionsFor', () => {
  const manager = { kind: 'manager', memberId: MANAGER } as const;
  const lea = { kind: 'member', memberId: LEA } as const;

  it('gives the owner every action on an agency member without a link', () => {
    expect(
      actionsFor({ chatter: chatter(), link: null, listed: true, invitable: true }, { kind: 'owner' }),
    ).toEqual(['link_member', 'link_agent', 'link_none', 'invite', 'dismiss']);
  });

  it('gives a manager nothing on a row linked to his own record', () => {
    expect(
      actionsFor(
        { chatter: chatter(), link: { kind: 'member', memberId: MANAGER }, listed: true, invitable: true },
        manager,
      ),
    ).toEqual([]);
  });

  it('never offers the agent for a provider, and keeps his link to a member for the owner', () => {
    const external = chatter({ isExternal: true, email: null });
    expect(actionsFor({ chatter: external, link: null, listed: true, invitable: true }, manager)).toEqual([
      'link_none',
      'dismiss',
    ]);
    expect(
      actionsFor({ chatter: external, link: null, listed: true, invitable: true }, { kind: 'owner' }),
    ).toEqual(['link_member', 'link_none', 'dismiss']);
  });

  it('neither invites nor sets aside an account already linked, to the agent or a member', () => {
    for (const link of [{ kind: 'agent' } as const, lea]) {
      const actions = actionsFor(
        { chatter: chatter(), link, listed: true, invitable: true },
        { kind: 'owner' },
      );
      expect(actions).not.toContain('invite');
      expect(actions).not.toContain('dismiss');
    }
  });

  it('never offers to invite an account that is not invitable, and keeps linking and dismissing it', () => {
    expect(
      actionsFor({ chatter: chatter(), link: null, listed: true, invitable: false }, { kind: 'owner' }),
    ).toEqual(['link_member', 'link_agent', 'link_none', 'dismiss']);
  });

  it('only unlinks an account gone from the list, and offers nothing on one never linked', () => {
    expect(
      actionsFor({ chatter: chatter(), link: lea, listed: false, invitable: true }, { kind: 'owner' }),
    ).toEqual(['link_none']);
    expect(
      actionsFor({ chatter: chatter(), link: null, listed: false, invitable: true }, { kind: 'owner' }),
    ).toEqual([]);
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

  it('never links a provider to the agent, not even for the owner', () => {
    const external = chatter({ isExternal: true });
    expect(linkRefusal({ kind: 'owner' }, external, null, { kind: 'agent' })).toBe('external_no_agent');
    expect(linkRefusal(manager, external, null, { kind: 'agent' })).toBe('external_no_agent');
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

describe('teamImportOverview', () => {
  const MAYA = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000a1');
  const ZOE = CreatorIdSchema.parse('00000000-0000-4000-8000-0000000000a2');
  const context = (patch: Partial<TeamImportContext> = {}): TeamImportContext => ({
    viewer: { kind: 'owner' },
    members: [{ ...members[0]!, creatorIds: [MAYA, ZOE] }],
    links: new Map([['chatter_test_01', { kind: 'member', memberId: LEA }]]),
    reviews: new Map(),
    modelCreators: new Map([['model_a', { creatorId: MAYA, displayName: 'Maya' }]]),
    creatorNames: new Map([
      [MAYA, 'Maya'],
      [ZOE, 'Zoé'],
    ]),
    abnormalRead: false,
    ...patch,
  });
  const live = (chatters: PlatformChatter[] | null) => ({
    chatters,
    handles: new Map([['model_a', 'maya_test']]),
    listError: null,
    sessionChatterId: null,
  });

  it('names each model and shows the gap with the member’s creators, rewriting nothing', () => {
    const [row] = teamImportOverview(
      context(),
      live([chatter({ platformModelIds: ['model_a', 'model_b'] })]),
    ).rows;
    expect(row?.models).toEqual([
      { platformModelId: 'model_a', handle: 'maya_test', creatorId: MAYA, creatorDisplayName: 'Maya' },
      { platformModelId: 'model_b', handle: 'model_b', creatorId: null, creatorDisplayName: null },
    ]);
    expect(row?.modelGap).toEqual({
      inImperaOnly: [{ creatorId: ZOE, creatorDisplayName: 'Zoé' }],
      onPlatformOnly: ['model_b'],
    });
    expect(row?.suggestion).toBeNull();
  });

  it('keeps a linked account the platform no longer lists, with its alert, and counts nothing new', () => {
    const gone = teamImportOverview(
      context({
        reviews: new Map([
          [
            'chatter_test_01',
            {
              decision: null,
              decidedAt: null,
              platformRemovedAt: null,
              absentSince: new Date(),
              isBot: false,
            },
          ],
        ]),
      }),
      live([]),
    );
    expect(gone.rows[0]?.removal).toEqual({ memberId: LEA, removedAt: null, absent: true });
    expect([gone.newCount, gone.removalCount]).toEqual([0, 1]);
  });

  it('never alerts for a member who left', () => {
    const left = context({ members: [{ ...members[0]!, leftOn: '2026-11-01', creatorIds: [] }] });
    const [row] = teamImportOverview(left, live([chatter({ removedAt: '2026-11-05T10:00:00.000Z' })])).rows;
    expect(row?.removal).toBeNull();
  });

  it('lists an account removed from the platform without counting it, proposing nor inviting it', () => {
    const removed = chatter({
      platformChatterId: 'chatter_test_02',
      email: 'nouveau@recette.test',
      removedAt: '2026-11-05T10:00:00.000Z',
    });
    const overview = teamImportOverview(context(), live([chatter(), removed]));
    const row = overview.rows.find((one) => one.chatter.platformChatterId === 'chatter_test_02');
    expect(row?.suggestion).toBeNull();
    expect(row?.preselected).toBe(false);
    expect(row?.actions).toEqual(['link_member', 'link_agent', 'link_none', 'dismiss']);
    expect(overview.newCount).toBe(0);
  });

  it('offers a departed member for an account with his e-mail, with no invitation, removed or not', () => {
    const left = context({
      members: [{ ...members[0]!, leftOn: '2026-11-01', creatorIds: [] }],
      links: new Map(),
    });
    for (const removedAt of [null, '2026-11-05T10:00:00.000Z']) {
      const [row] = teamImportOverview(left, live([chatter({ removedAt })])).rows;
      expect(row?.suggestion).toMatchObject({ kind: 'member', memberId: LEA, departedOn: '2026-11-01' });
      expect(row?.preselected).toBe(false);
      expect(row?.actions).not.toContain('invite');
    }
  });
});
