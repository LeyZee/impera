import {
  CreatorIdSchema,
  TeamMemberIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type TeamImportRow,
  type TeamMember,
  type TeamMemberId,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  choiceOf,
  gapLine,
  initialBatch,
  invitePrefill,
  linkOf,
  matchLine,
  modelsLine,
  newcomersLine,
  optionsOf,
  removalsLine,
  removedLine,
  sectionsOf,
  tickedCount,
} from './reveal';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mid = (n: number): TeamMemberId => TeamMemberIdSchema.parse(id(n));
const cid = (n: number): CreatorId => CreatorIdSchema.parse(id(n));

/** An account of the platform's team, invented, without a link nor a proposal. */
function row(
  patch: Partial<TeamImportRow> = {},
  chatter: Partial<TeamImportRow['chatter']> = {},
): TeamImportRow {
  return {
    chatter: {
      platformChatterId: 'c1',
      firstName: 'Ana',
      lastName: 'Test',
      email: 'ana@example.test',
      role: 'chatter',
      isBot: false,
      isExternal: false,
      removedAt: null,
      platformModelIds: [],
      ...chatter,
    },
    link: null,
    dismissedAt: null,
    suggestion: null,
    preselected: false,
    actions: ['link_member', 'link_agent', 'link_none', 'invite', 'dismiss'],
    models: [],
    modelGap: { inImperaOnly: [], onPlatformOnly: [] },
    removal: null,
    ...patch,
  };
}

const member = (n: number, displayName: string, status: TeamMember['status'] = 'active'): TeamMember =>
  TeamMemberSchema.parse({
    id: id(n),
    userId: id(n + 100),
    email: `m${String(n)}@example.test`,
    firstName: displayName,
    lastName: 'Test',
    displayName,
    teamRole: 'chatter',
    status,
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: null,
    joinedOn: '2026-01-01',
    creatorIds: [],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
  });

const PERSON = { isBot: false, isExternal: false };

describe('sectionsOf', () => {
  it('puts the rows to confirm, the rows linked, and the set aside with the bots in the fold', () => {
    const rows = [
      row({}, { platformChatterId: 'new' }),
      row({ link: { kind: 'agent' } }, { platformChatterId: 'linked' }),
      row({ dismissedAt: '2026-11-06T10:00:00.000Z' }, { platformChatterId: 'aside' }),
      row({ suggestion: { kind: 'none' } }, { platformChatterId: 'bot', isBot: true }),
      row({ link: { kind: 'none' } }, { platformChatterId: 'bot-linked', isBot: true }),
    ];
    const ids = (list: readonly TeamImportRow[]): string[] =>
      list.map((one) => one.chatter.platformChatterId);
    const { toConfirm, linked, folded } = sectionsOf(rows);
    expect(ids(toConfirm)).toEqual(['new']);
    expect(ids(linked)).toEqual(['linked']);
    expect(ids(folded)).toEqual(['aside', 'bot', 'bot-linked']);
  });
});

describe('a choice', () => {
  it('starts on the proposal, and an invitation never goes in the batch', () => {
    expect(
      choiceOf({
        kind: 'member',
        memberId: mid(1),
        memberDisplayName: 'Léa',
        match: 'email',
        departedOn: null,
      }),
    ).toBe(`member:${id(1)}`);
    expect(choiceOf({ kind: 'agent', match: 'session' })).toBe('agent');
    expect(choiceOf(null)).toBe('none');
    expect(linkOf(`member:${id(1)}`)).toEqual({ kind: 'member', memberId: mid(1) });
    expect(linkOf('agent')).toEqual({ kind: 'agent' });
    expect(linkOf('none')).toEqual({ kind: 'none' });
    expect(linkOf('invite')).toBeNull();
  });

  it('offers only what the server lets this reader do on the row', () => {
    const team = [member(2, 'Zoé'), member(1, 'Léa'), member(3, 'Parti', 'left')];
    expect(optionsOf(row(), team).map((option) => option.label)).toEqual([
      'Léa',
      'Zoé',
      'Parti (parti)',
      'L’agent',
      'Inviter dans l’équipe',
      'Personne',
    ]);
    // A provider's account, for a manager (ADR 0076 § 2): nobody, or aside.
    expect(optionsOf(row({ actions: ['link_none', 'dismiss'] }), team).map((option) => option.value)).toEqual(
      ['none'],
    );
  });

  it('keeps the member the server named, even when the team cannot be read', () => {
    const named = row({
      suggestion: {
        kind: 'member',
        memberId: mid(7),
        memberDisplayName: 'Nora',
        match: 'name',
        departedOn: null,
      },
    });
    expect(optionsOf(named, [])[0]).toEqual({ value: `member:${id(7)}`, label: 'Nora' });
  });

  it('keeps a departed member the server named, marked as departed, even when the team cannot be read', () => {
    const named = row({
      suggestion: {
        kind: 'member',
        memberId: mid(7),
        memberDisplayName: 'Nora',
        match: 'email',
        departedOn: '2026-11-01',
      },
    });
    expect(optionsOf(named, [])[0]).toEqual({ value: `member:${id(7)}`, label: 'Nora (parti)' });
  });

  it('says why each proposal was made', () => {
    expect(
      matchLine(
        {
          kind: 'member',
          memberId: mid(1),
          memberDisplayName: 'Léa',
          match: 'email',
          departedOn: '2026-11-01',
        },
        PERSON,
      ),
    ).toBe('Même e-mail · parti le 1er novembre 2026');
    expect(
      matchLine(
        {
          kind: 'member',
          memberId: mid(1),
          memberDisplayName: 'Léa',
          match: 'email',
          departedOn: null,
        },
        PERSON,
      ),
    ).toBe('Même e-mail');
    expect(
      matchLine(
        {
          kind: 'member',
          memberId: mid(1),
          memberDisplayName: 'Léa',
          match: 'name',
          departedOn: null,
        },
        PERSON,
      ),
    ).toBe('Mêmes prénom et nom');
    expect(matchLine({ kind: 'agent', match: 'name' }, PERSON)).toBe('Nommé « bot »');
    expect(matchLine({ kind: 'invite' }, PERSON)).toBe('Personne de l’équipe Impera avec cet e-mail');
    expect(matchLine({ kind: 'none' }, { isBot: true, isExternal: false })).toBe('Bot d’une clé d’API');
    expect(matchLine({ kind: 'none' }, { isBot: false, isExternal: true })).toBe(
      'Compte d’un prestataire : jamais invité',
    );
    expect(matchLine({ kind: 'none' }, { isBot: false, isExternal: false })).toBe(
      'Sans e-mail : rien à proposer',
    );
    expect(matchLine(null, PERSON)).toBeNull();
  });
});

describe('the batch', () => {
  it('ticks what the server preselected, never an invitation nor a row without action', () => {
    const rows = [
      row(
        {
          suggestion: {
            kind: 'member',
            memberId: mid(1),
            memberDisplayName: 'Léa',
            match: 'email',
            departedOn: null,
          },
          preselected: true,
        },
        { platformChatterId: 'a' },
      ),
      row({ suggestion: { kind: 'invite' }, preselected: true }, { platformChatterId: 'b' }),
      row({ suggestion: { kind: 'agent', match: 'name' }, preselected: false }, { platformChatterId: 'c' }),
      row({ actions: [], preselected: true }, { platformChatterId: 'own' }),
      row({ link: { kind: 'agent' }, preselected: true }, { platformChatterId: 'linked' }),
    ];
    expect(initialBatch(rows)).toEqual({
      choices: { a: `member:${id(1)}`, b: 'invite', c: 'agent' },
      ticked: ['a'],
    });
  });
});

describe('what a row says', () => {
  const models = [
    { platformModelId: 'm1', handle: 'lune', creatorId: cid(11), creatorDisplayName: 'Lune' },
    { platformModelId: 'm2', handle: 'soleil', creatorId: null, creatorDisplayName: null },
  ];

  it('names its models, a model not imported by its handle', () => {
    expect(modelsLine(row({ models }), 'Reveal')).toBe(
      'Modèles sur Reveal : Lune, soleil (modèle Reveal non importée)',
    );
    expect(modelsLine(row(), 'Reveal')).toBeNull();
  });

  it('says the gap with the member’s creators, both ways', () => {
    const gap = row({
      modelGap: {
        inImperaOnly: [{ creatorId: cid(12), creatorDisplayName: 'Étoile' }],
        onPlatformOnly: ['soleil'],
      },
    });
    expect(gapLine(gap, 'Reveal')).toBe(
      'Écart de créatrices, chez Impera seulement : Étoile ; sur Reveal seulement : soleil.',
    );
    expect(gapLine(row(), 'Reveal')).toBeNull();
  });

  it('counts the newcomers and the removals', () => {
    expect(newcomersLine(1, 'Reveal')).toBe('1 nouveau chatteur sur Reveal');
    expect(newcomersLine(3, 'Reveal')).toBe('3 nouveaux chatteurs sur Reveal');
    expect(removalsLine(1, 'Reveal')).toBe('1 retiré de Reveal, toujours dans l’équipe');
    expect(removalsLine(2, 'Reveal')).toBe('2 retirés de Reveal, toujours dans l’équipe');
  });

  it('says the ticked rows hidden in the fold', () => {
    expect(tickedCount(1, 0)).toBe('1 coché');
    expect(tickedCount(3, 1)).toBe('3 cochés, dont 1 dans « Bots et comptes écartés »');
  });

  it('fills an invitation from the platform, with only the creators the inviter may give', () => {
    const prefill = invitePrefill(
      row({ models: [...models, models[0]].filter((one) => one !== undefined) }),
      [id(11)],
    );
    expect(prefill).toEqual({
      firstName: 'Ana',
      lastName: 'Test',
      displayName: 'Ana',
      email: 'ana@example.test',
      creatorIds: [id(11)],
    });
    expect(invitePrefill(row({ models }), []).creatorIds).toEqual([]);
  });
});

describe('an account removed from the platform', () => {
  it('says it on a row without a member to alert about, and nothing on an account still there', () => {
    expect(removedLine(row({}, { removedAt: '2026-11-05T12:00:00.000Z' }), 'Reveal')).toBe(
      'Retiré de Reveal le 5 nov.',
    );
    expect(removedLine(row(), 'Reveal')).toBeNull();
    expect(
      removedLine(
        row(
          { removal: { memberId: mid(2), removedAt: '2026-11-05T12:00:00.000Z', absent: false } },
          { removedAt: '2026-11-05T12:00:00.000Z' },
        ),
        'Reveal',
      ),
    ).toBeNull();
  });
});
