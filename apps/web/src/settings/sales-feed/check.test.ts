import type { SalesFeedChatterLink, SalesFeedCheckChatter, SalesFeedCheckReport } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  chatterLine,
  decodeExport,
  figureGap,
  fortnightsOver,
  gap,
  isWholeFortnight,
  lastDayOver,
  money,
  noteText,
  rangeLabel,
  rangeProblem,
  readBefore,
  switchLine,
  verdictOf,
} from './check';

describe('the days a check can cover', () => {
  it('ends yesterday in Paris: at 00:30 in Paris it is already the next day', () => {
    // 23:30 UTC on 2 November is 00:30 on 3 November in Paris.
    expect(lastDayOver(new Date('2026-11-02T23:30:00Z'))).toBe('2026-11-02');
    expect(lastDayOver(new Date('2026-11-02T22:30:00Z'))).toBe('2026-11-01');
  });

  it('offers the two last fortnights over, newest first', () => {
    expect(fortnightsOver(new Date('2026-11-03T10:00:00Z'))).toEqual([
      { from: '2026-10-16', to: '2026-10-31' },
      { from: '2026-10-01', to: '2026-10-15' },
    ]);
    expect(fortnightsOver(new Date('2026-11-16T10:00:00Z'))).toEqual([
      { from: '2026-11-01', to: '2026-11-15' },
      { from: '2026-10-16', to: '2026-10-31' },
    ]);
  });

  it('crosses the year and knows February', () => {
    expect(fortnightsOver(new Date('2027-01-05T10:00:00Z'))[0]).toEqual({
      from: '2026-12-16',
      to: '2026-12-31',
    });
    expect(fortnightsOver(new Date('2027-03-02T10:00:00Z'))[0]).toEqual({
      from: '2027-02-16',
      to: '2027-02-28',
    });
  });

  it('says the days in French', () => {
    expect(rangeLabel({ from: '2026-11-01', to: '2026-11-15' })).toBe('du 1er au 15 novembre');
    expect(rangeLabel({ from: '2026-10-25', to: '2026-11-07' })).toBe('du 25 octobre au 7 novembre');
    expect(rangeLabel({ from: '2026-11-03', to: '2026-11-03' })).toBe('le 3 novembre');
  });

  it('refuses what the server refuses: days in the wrong order, today, more than 31 days', () => {
    const last = '2026-11-02';
    expect(rangeProblem({ from: '2026-10-16', to: '2026-10-31' }, last)).toBeNull();
    expect(rangeProblem({ from: '2026-10-31', to: '2026-10-16' }, last)).toMatch(/après le dernier/u);
    expect(rangeProblem({ from: '2026-10-20', to: '2026-11-03' }, last)).toMatch(/déjà terminés/u);
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-31' }, last)).toBeNull();
    expect(rangeProblem({ from: '2026-10-01', to: '2026-11-01' }, last)).toMatch(/31 jours au plus/u);
    expect(rangeProblem({ from: '', to: '2026-10-31' }, last)).toMatch(/Choisis/u);
  });
});

describe('what a report says of the switch (CRM-03)', () => {
  it('knows a whole fortnight, February and the 31st included', () => {
    expect(isWholeFortnight({ from: '2026-10-16', to: '2026-10-31' })).toBe(true);
    expect(isWholeFortnight({ from: '2026-11-01', to: '2026-11-15' })).toBe(true);
    expect(isWholeFortnight({ from: '2027-02-16', to: '2027-02-28' })).toBe(true);
    expect(isWholeFortnight({ from: '2026-10-16', to: '2026-10-30' })).toBe(false);
    expect(isWholeFortnight({ from: '2026-10-20', to: '2026-10-20' })).toBe(false);
    expect(isWholeFortnight({ from: '', to: '2026-10-31' })).toBe(false);
  });

  const fortnight: Pick<SalesFeedCheckReport, 'from' | 'to' | 'verdict' | 'notes'> = {
    from: '2026-10-16',
    to: '2026-10-31',
    verdict: 'match',
    notes: [],
  };

  it('says a clean report can carry the switch, and nothing before the server said', () => {
    expect(switchLine(fortnight, true)?.tone).toBe('ok');
    expect(switchLine(fortnight, null)).toBeNull();
  });

  it('says why a report that agrees cannot: days that are not a fortnight, or a note to settle', () => {
    expect(switchLine({ ...fortnight, from: '2026-10-20', to: '2026-10-20' }, false)?.text).toMatch(
      /mais pas sur une quinzaine entière/u,
    );
    expect(switchLine(fortnight, false)?.text).toMatch(/une note ci-dessus reste à régler/u);
  });

  it('adds nothing to a verdict that already says it differs or misses a source', () => {
    expect(switchLine({ ...fortnight, verdict: 'mismatch' }, false)).toBeNull();
    expect(switchLine({ ...fortnight, verdict: 'incomplete' }, false)).toBeNull();
  });

  it('names the export in a match only when one was given, as it is optional', () => {
    expect(verdictOf('match', false).line).toBe(
      'Le registre et les statistiques disent la même chose, jour par jour puis membre par membre.',
    );
    expect(verdictOf('match', true).line).toMatch(/^Le registre, les statistiques et l’export disent/u);
    expect(verdictOf('incomplete', false).line).toBe(
      'Les statistiques manquent ou une partie n’a pas pu être comparée : les notes disent quoi.',
    );
  });

  it('says how long before the check the register had been read', () => {
    expect(readBefore('2026-11-03T08:59:30Z', '2026-11-03T09:00:05Z')).toBe('juste avant');
    expect(readBefore('2026-11-03T08:57:00Z', '2026-11-03T09:00:05Z')).toBe('3 min avant');
    expect(readBefore('2026-11-03T06:00:00Z', '2026-11-03T09:00:05Z')).toBe('3 h avant');
    expect(readBefore('2026-11-01T06:00:00Z', '2026-11-03T09:00:05Z')).toMatch(/^le 1er nov\. à/u);
  });
});

describe('the export', () => {
  const bytes = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;

  it('reads UTF-8 and drops its BOM', () => {
    const text = new TextEncoder().encode('Revenu modèle;Net');
    expect(decodeExport(bytes([0xef, 0xbb, 0xbf, ...text]))).toBe('Revenu modèle;Net');
  });

  it('reads a French spreadsheet’s Windows-1252 when the bytes are not UTF-8', () => {
    // « modèle » with è as the single byte 0xE8.
    expect(decodeExport(bytes([0x6d, 0x6f, 0x64, 0xe8, 0x6c, 0x65]))).toBe('modèle');
  });
});

describe('money', () => {
  it('writes cents in euros and a gap with its sign', () => {
    expect(money(123_456)).toMatch(/^1\s234,56\s€$/u);
    expect(gap(120)).toMatch(/^\+1,20\s€$/u);
    expect(gap(-50)).toMatch(/^−0,50\s€$/u);
  });

  it('compares a figure only when both sources give it', () => {
    const register = { grossInclVat: 1200, agency: 400, creator: 600, net: 1000 };
    expect(figureGap(register, { ...register, net: 1100 }, 'net')).toBe(100);
    expect(
      figureGap(register, { grossInclVat: null, agency: null, creator: null, net: 1000 }, 'agency'),
    ).toBeNull();
  });
});

const CHATTERS: SalesFeedChatterLink[] = [
  {
    platformChatterId: 'c-bot',
    firstName: 'Bot',
    lastName: 'Impera',
    email: null,
    role: 'chatter',
    isBot: true,
    isExternal: false,
    removedAt: null,
    platformModelIds: ['m1'],
    link: null,
  },
  {
    platformChatterId: 'c-ana',
    firstName: 'Ana',
    lastName: 'Test',
    email: null,
    role: 'chatter',
    isBot: false,
    isExternal: false,
    removedAt: null,
    platformModelIds: ['m1'],
    link: { kind: 'member', memberId: '00000000-0000-4000-8000-00000000000a' },
  },
];

describe('the notes', () => {
  it('names the bot by its platform name and says where to link it', () => {
    expect(
      noteText({ kind: 'bot_not_linked_to_agent', platformChatterId: 'c-bot' }, 'Reveal', CHATTERS),
    ).toBe(
      'Le compte bot « Bot Impera » n’est pas relié à l’agent : ses ventes ne compteraient pour personne. Relie-le dans « Équipe Reveal ».',
    );
  });

  it('says loudest a bot linked to a member: the agent’s sales would count for that member', () => {
    const toAna: SalesFeedChatterLink['link'] = {
      kind: 'member',
      memberId: '00000000-0000-4000-8000-00000000000a',
    };
    const linked = CHATTERS.map((chatter) =>
      chatter.platformChatterId === 'c-bot' ? { ...chatter, link: toAna } : chatter,
    );
    const names = (id: string): string | null =>
      id === '00000000-0000-4000-8000-00000000000a' ? 'Ana T.' : null;
    expect(
      noteText({ kind: 'bot_not_linked_to_agent', platformChatterId: 'c-bot' }, 'Reveal', linked, names),
    ).toBe(
      'Le compte bot « Bot Impera » est relié à « Ana T. » : ses ventes lui compteraient. Relie-le à l’agent dans « Équipe Reveal ».',
    );
  });

  it('says the link the report saw, not the one set since: a kept report is read again later', () => {
    const reported: SalesFeedCheckChatter[] = [
      {
        platformChatterId: 'c-bot',
        isBot: true,
        link: 'member',
        register: { net: 0, sales: 0 },
        stats: null,
        differs: false,
      },
    ];
    // Linked to nobody now, linked to a member when the check ran.
    expect(
      noteText(
        { kind: 'bot_not_linked_to_agent', platformChatterId: 'c-bot' },
        'Reveal',
        CHATTERS,
        () => null,
        reported,
      ),
    ).toBe(
      'Le compte bot « Bot Impera » est relié à un membre : ses ventes lui compteraient. Relie-le à l’agent dans « Équipe Reveal ».',
    );
  });

  it('places a refund of a sale before the days outside the period, compared nowhere', () => {
    expect(noteText({ kind: 'refund_without_sale', count: 2 }, 'Reveal', CHATTERS)).toBe(
      '2 remboursements portent sur des ventes d’avant ces jours : Reveal les retire du jour de leur vente, hors de la période, et ils ne sont comparés nulle part.',
    );
  });

  it('says a register that starts late is not a gap', () => {
    expect(noteText({ kind: 'register_starts_after', firstLineAt: null }, 'Reveal', CHATTERS)).toMatch(
      /Ce n’est pas un écart/u,
    );
    expect(
      noteText(
        { kind: 'register_starts_after', firstLineAt: '2026-10-20T08:00:00.000Z' },
        'Reveal',
        CHATTERS,
      ),
    ).toMatch(/^Le registre commence le 20 oct\. à \d\d:00 : les jours d’avant/u);
  });

  it('says the statistics are required, the export alone not enough', () => {
    expect(noteText({ kind: 'stats_unavailable', errorKind: 'rate_limited' }, 'Reveal', CHATTERS)).toBe(
      'Les statistiques de Reveal n’ont pas pu être lues : la vérification les exige, l’export seul ne suffit pas. Réessaie dans un moment.',
    );
  });

  it('agrees in number', () => {
    expect(noteText({ kind: 'export_rows_outside', count: 1 }, 'Reveal', CHATTERS)).toMatch(
      /^1 ligne de l’export tombe/u,
    );
    expect(noteText({ kind: 'refund_without_sale', count: 3 }, 'Reveal', CHATTERS)).toMatch(
      /^3 remboursements portent/u,
    );
  });
});

describe('chatterLine', () => {
  const row = (patch: Partial<SalesFeedCheckChatter>): SalesFeedCheckChatter => ({
    platformChatterId: 'c-ana',
    isBot: false,
    link: 'member',
    register: { net: 1000, sales: 2 },
    stats: { net: 1000, sales: 2 },
    differs: false,
    ...patch,
  });
  const names = (id: string): string | null =>
    id === '00000000-0000-4000-8000-00000000000a' ? 'Ana T.' : null;

  it('gives the platform’s name and the member it is linked to', () => {
    expect(chatterLine(row({}), CHATTERS, names)).toEqual({ name: 'Ana Test', link: 'Ana T.' });
  });

  it('says the sales without a chatter count for nobody, without guessing what they are', () => {
    expect(chatterLine(row({ platformChatterId: null, link: null }), CHATTERS, names)).toEqual({
      name: 'Sans chatteur',
      link: 'Ne compte pour personne',
    });
  });

  it('says an unlinked member, and the agent', () => {
    expect(chatterLine(row({ platformChatterId: 'c-bot', link: null }), CHATTERS, names).link).toBe(
      'Relié à personne',
    );
    expect(chatterLine(row({ platformChatterId: 'c-bot', link: 'agent' }), CHATTERS, names).link).toBe(
      'L’agent',
    );
  });
});
