import type { PlatformModel } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { SalesFeedExportUnprocessable } from '../errors';
import {
  buildCheckReport,
  exportAmountToCents,
  exportDay,
  isCleanMatch,
  readDashboardExport,
  type CheckLine,
  type CheckSources,
} from '../reliability-check';

// Everything below is invented (ADR 0010).
const MODELS: PlatformModel[] = [
  {
    platformModelId: 'model_test_01',
    handle: 'creatrice_test',
    displayName: 'Créatrice test',
    isActive: true,
  },
];
const CONTEXT = { from: '2026-10-20', to: '2026-10-21', timeZone: 'Europe/Paris', models: MODELS };

function line(overrides: Partial<CheckLine> & Pick<CheckLine, 'platformSaleId'>): CheckLine {
  return {
    event: 'sale',
    occurredAt: new Date('2026-10-20T10:00:00Z'),
    platformModelId: 'model_test_01',
    platformChatterId: 'chatter_test_01',
    grossInclVat: 1200,
    grossExclVat: 1000,
    net: 800,
    agency: 300,
    creator: 500,
    linked: true,
    ...overrides,
  };
}

function sources(overrides: Partial<CheckSources> = {}): CheckSources {
  return {
    platform: 'reveal',
    from: '2026-10-20',
    to: '2026-10-21',
    timeZone: 'Europe/Paris',
    generatedAt: new Date('2026-11-02T12:00:00Z'),
    lines: [],
    stats: { ok: true, daily: [], chatters: [] },
    exported: null,
    firstLineAt: new Date('2026-10-01T00:00:00Z'),
    registerReadAt: new Date('2026-11-02T11:59:00Z'),
    models: MODELS,
    modelLinks: new Set(['model_test_01']),
    platformChatters: [],
    chatterLinks: new Map(),
    ...overrides,
  };
}

const stat = (date: string, net: number) => ({
  date,
  platformModelId: 'model_test_01',
  newSubscribers: 0,
  activeSubscribers: 0,
  revenueInclVat: (net / 800) * 1200,
  revenueExclVat: (net / 800) * 1000,
  agency: (net / 800) * 300,
  creator: (net / 800) * 500,
  ppvPurchased: 0,
  ppvSent: null,
  messagesSent: null,
  messagesReceived: null,
});

describe('the export’s cells', () => {
  it('reads amounts as a spreadsheet writes them, in cents', () => {
    expect(exportAmountToCents('12,34 €')).toBe(1234);
    expect(exportAmountToCents('1 234,5')).toBe(123450);
    expect(exportAmountToCents('1,234.56')).toBe(123456);
    expect(exportAmountToCents('-3')).toBe(-300);
    expect(exportAmountToCents('12 EUR')).toBe(1200);
    expect(exportAmountToCents('douze')).toBeNull();
    expect(exportAmountToCents('')).toBeNull();
  });

  it('reads days, an instant on its day in the platform’s zone', () => {
    expect(exportDay('2026-10-20', 'Europe/Paris')).toBe('2026-10-20');
    expect(exportDay('20/10/2026', 'Europe/Paris')).toBe('2026-10-20');
    expect(exportDay('2026-10-20T22:30:00.000Z', 'Europe/Paris')).toBe('2026-10-21');
    expect(exportDay('le 20 octobre', 'Europe/Paris')).toBeNull();
  });
});

describe('the dashboard’s export', () => {
  it('sums rows per model and day, a model named by its handle or its id, with commas and quotes', () => {
    const read = readDashboardExport(
      '﻿date,model,amountTtc,agencyRevenue,modelRevenue\n' +
        '2026-10-20,creatrice_test,"1,200.00",300,500\n' +
        '2026-10-20,model_test_01,12,3,5\n' +
        '2026-10-21,inconnue_test,12,3,5\n',
      CONTEXT,
    );
    expect(read.rows).toEqual([
      {
        date: '2026-10-20',
        platformModelId: 'model_test_01',
        totals: { grossInclVat: 121200, agency: 30300, creator: 50500, net: 80800 },
      },
    ]);
    expect(read.notes).toEqual([{ kind: 'export_unknown_model', model: 'inconnue_test' }]);
  });

  it('leaves a figure it does not give at null', () => {
    const read = readDashboardExport('Jour;Créatrice;Net\n20/10/2026;creatrice_test;8,00', CONTEXT);
    expect(read.rows[0]?.totals).toEqual({ grossInclVat: null, agency: null, creator: null, net: 800 });
  });

  it('refuses an export without the columns it compares, or with an unreadable cell, naming no value', () => {
    const refusal = (text: string) => {
      try {
        readDashboardExport(text, CONTEXT);
      } catch (error) {
        if (error instanceof SalesFeedExportUnprocessable) return error.details;
      }
      return null;
    };
    expect(refusal('')).toEqual({});
    expect(refusal('Modèle;Net\ncreatrice_test;8')).toEqual({ column: 'date' });
    expect(refusal('Date;Montant TTC\n20/10/2026;12')).toEqual({ column: 'modèle' });
    expect(refusal('Date;Modèle;Revenu agence\n20/10/2026;creatrice_test;3')).toEqual({ column: 'net' });
    expect(refusal('Date;Modèle;Net\n20/10/2026;creatrice_test;8\nhier;creatrice_test;8')).toEqual({
      column: 'date',
      line: 3,
    });
  });
});

describe('the reliability check', () => {
  it('takes a refund off its sale’s day and matches when every source agrees', () => {
    const report = buildCheckReport(
      sources({
        lines: [
          line({ platformSaleId: 'sale_a' }),
          line({ platformSaleId: 'sale_b' }),
          line({ platformSaleId: 'sale_a', event: 'refund', occurredAt: new Date('2026-10-25T10:00:00Z') }),
        ],
        stats: { ok: true, daily: [stat('2026-10-20', 800)], chatters: [] },
        exported: {
          rows: [
            {
              date: '2026-10-20',
              platformModelId: 'model_test_01',
              totals: { grossInclVat: 1200, agency: 300, creator: 500, net: 800 },
            },
          ],
          notes: [],
        },
      }),
    );
    expect(report.days).toHaveLength(1);
    expect(report.days[0]).toMatchObject({ register: { net: 800 }, differs: [] });
    // The member statistics are empty here: a member's register differs from them.
    expect(report.chatters).toEqual([
      expect.objectContaining({
        platformChatterId: 'chatter_test_01',
        register: { net: 800, sales: 1 },
        differs: true,
      }),
    ]);
    expect(report.verdict).toBe('mismatch');
  });

  it('is only incomplete without the export or the statistics, and says why', () => {
    const lines = [line({ platformSaleId: 'sale_a', platformChatterId: null })];
    const withoutExport = buildCheckReport(
      sources({
        lines,
        stats: {
          ok: true,
          daily: [stat('2026-10-20', 800)],
          chatters: [
            {
              date: '2026-10-20',
              platformChatterId: null,
              platformModelId: 'model_test_01',
              salesCount: 1,
              revenueInclVat: 1200,
              agency: 300,
              creator: 500,
              ppvPurchased: 0,
              ppvSent: null,
              messagesSent: null,
            },
          ],
        },
      }),
    );
    expect(withoutExport.verdict).toBe('incomplete');
    const withoutStats = buildCheckReport(
      sources({ lines, stats: { ok: false, errorKind: 'rate_limited' } }),
    );
    expect(withoutStats).toMatchObject({
      verdict: 'incomplete',
      total: { stats: null },
      notes: [{ kind: 'stats_unavailable', errorKind: 'rate_limited' }],
    });
  });

  it('counts a refund whose sale is older than the register in a note, and names a bot not linked to the agent', () => {
    const report = buildCheckReport(
      sources({
        lines: [
          line({ platformSaleId: 'sale_old', event: 'refund', occurredAt: new Date('2026-10-21T08:00:00Z') }),
        ],
        platformChatters: [
          {
            platformChatterId: 'bot_test_01',
            firstName: 'Bot',
            lastName: 'Test',
            isBot: true,
            isExternal: false,
            removedAt: null,
            platformModelIds: ['model_test_01'],
          },
        ],
      }),
    );
    expect(report.days).toEqual([]);
    expect(report.notes).toEqual([
      { kind: 'refund_without_sale', count: 1 },
      { kind: 'bot_not_linked_to_agent', platformChatterId: 'bot_test_01' },
    ]);
    const bot = buildCheckReport(
      sources({
        platformChatters: [
          {
            platformChatterId: 'bot_test_01',
            firstName: 'Bot',
            lastName: 'Test',
            isBot: true,
            isExternal: false,
            removedAt: null,
            platformModelIds: ['model_test_01'],
          },
        ],
        chatterLinks: new Map([['bot_test_01', { kind: 'agent' }]]),
      }),
    );
    expect(bot.notes).toEqual([]);
  });

  it('counts a sale on its day in the platform’s zone, not in UTC', () => {
    const report = buildCheckReport(
      sources({
        lines: [line({ platformSaleId: 'sale_late', occurredAt: new Date('2026-10-20T22:30:00Z') })],
      }),
    );
    expect(report.days.map((day) => day.date)).toEqual(['2026-10-21']);
  });

  it('is never a match with days before the register or a model of the export left out', () => {
    const exported = {
      rows: [],
      notes: [{ kind: 'export_unknown_model' as const, model: 'inconnue_test' }],
    };
    expect(buildCheckReport(sources({ exported })).verdict).toBe('incomplete');
    const late = buildCheckReport(
      sources({ exported: { rows: [], notes: [] }, firstLineAt: new Date('2026-10-21T08:00:00Z') }),
    );
    expect(late).toMatchObject({
      verdict: 'incomplete',
      notes: [{ kind: 'register_starts_after', firstLineAt: '2026-10-21T08:00:00.000Z' }],
    });
    expect(buildCheckReport(sources({ exported: { rows: [], notes: [] } })).verdict).toBe('match');
  });

  it('compares a member’s net, not the count Reveal may keep after a refund', () => {
    const report = buildCheckReport(
      sources({
        lines: [line({ platformSaleId: 'sale_a' })],
        stats: {
          ok: true,
          daily: [stat('2026-10-20', 800)],
          chatters: [
            {
              date: '2026-10-20',
              platformChatterId: 'chatter_test_01',
              platformModelId: 'model_test_01',
              salesCount: 2,
              revenueInclVat: 1200,
              agency: 300,
              creator: 500,
              ppvPurchased: 0,
              ppvSent: null,
              messagesSent: null,
            },
          ],
        },
      }),
    );
    expect(report.chatters[0]).toMatchObject({ register: { sales: 1 }, stats: { sales: 2 }, differs: false });
  });
});

describe('the report a switch can rest on (CRM-03)', () => {
  const FORTNIGHT = { from: '2026-10-16', to: '2026-10-31' };
  const matching = () => buildCheckReport(sources({ ...FORTNIGHT, exported: { rows: [], notes: [] } }));

  it('is a match over a whole fortnight, with no bot outside the agent nor model of the export unknown', () => {
    expect(matching().verdict).toBe('match');
    expect(isCleanMatch(matching())).toBe(true);
    expect(
      isCleanMatch({
        ...matching(),
        from: '2026-11-01',
        to: '2026-11-15',
        generatedAt: '2026-11-16T09:00:00.000Z',
      }),
    ).toBe(true);
    expect(isCleanMatch({ ...matching(), notes: [{ kind: 'export_rows_outside', count: 2 }] })).toBe(true);
    expect(
      isCleanMatch({
        ...matching(),
        notes: [{ kind: 'bot_not_linked_to_agent', platformChatterId: 'bot_test_01' }],
      }),
    ).toBe(false);
    expect(
      isCleanMatch({ ...matching(), notes: [{ kind: 'export_unknown_model', model: 'inconnue_test' }] }),
    ).toBe(false);
  });

  it('is never a part of a fortnight, nor one astride two', () => {
    expect(isCleanMatch(buildCheckReport(sources({ exported: { rows: [], notes: [] } })))).toBe(false);
    expect(isCleanMatch({ ...matching(), to: '2026-10-30' })).toBe(false);
    expect(isCleanMatch({ ...matching(), from: '2026-10-01', to: '2026-10-31' })).toBe(false);
    expect(isCleanMatch({ ...matching(), from: '2026-10-10', to: '2026-10-25' })).toBe(false);
  });

  it('is never a fortnight checked before it was over in the platform’s zone', () => {
    // 5 November: the 1st to the 15th compares five days only.
    expect(
      isCleanMatch({
        ...matching(),
        from: '2026-11-01',
        to: '2026-11-15',
        generatedAt: '2026-11-05T12:00:00.000Z',
      }),
    ).toBe(false);
    // 31 October at 23:30 in Paris (22:30 UTC): the fortnight's last day is not over there.
    expect(isCleanMatch({ ...matching(), generatedAt: '2026-10-31T22:30:00.000Z' })).toBe(false);
    // 1 November at 00:30 in Paris (23:30 UTC on the 31st): the fortnight is over there.
    expect(isCleanMatch({ ...matching(), generatedAt: '2026-10-31T23:30:00.000Z' })).toBe(true);
  });

  it('is never an incomplete or differing report', () => {
    expect(isCleanMatch(buildCheckReport(sources({ ...FORTNIGHT })))).toBe(false);
    expect(isCleanMatch({ ...matching(), verdict: 'mismatch' })).toBe(false);
  });
});
