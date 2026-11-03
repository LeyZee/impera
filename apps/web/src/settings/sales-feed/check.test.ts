import type { SalesFeedChatterLink, SalesFeedCheckChatter } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  chatterLine,
  decodeExport,
  figureGap,
  fortnightsOver,
  gap,
  lastDayOver,
  money,
  noteText,
  rangeLabel,
  rangeProblem,
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
    lastName: 'Nirvana',
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
      'Le compte bot « Bot Nirvana » n’est pas relié à l’agent : ses ventes ne compteraient pour personne. Relie-le dans « Équipe Reveal ».',
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

  it('says the sales of nobody for the line without a member', () => {
    expect(chatterLine(row({ platformChatterId: null, link: null }), CHATTERS, names).name).toBe('Personne');
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
