import type { SalesFeedModelLink, SalesFeedStatus } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  accountOptionsOf,
  ago,
  dotOf,
  lineOf,
  modelQuarantineLine,
  quarantineLine,
  webhookViewOf,
} from './view';

const NOW = new Date('2026-11-02T22:00:00.000Z');

function status(patch: Partial<SalesFeedStatus> = {}): SalesFeedStatus {
  return {
    platform: 'reveal',
    state: 'connected',
    capabilities: ['sales', 'stats'],
    verifiedAt: '2026-11-02T20:00:00.000Z',
    lastReadAt: '2026-11-02T21:57:00.000Z',
    lastErrorKind: null,
    message: 'Les ventes et les remboursements de Reveal remontent chaque minute.',
    quarantined: 0,
    webhook: null,
    ...patch,
  };
}

function model(
  platformModelId: string,
  handle: string,
  platformAccountId: string | null,
): SalesFeedModelLink {
  return { platformModelId, handle, displayName: '', platformAccountId, linkedBy: null, quarantined: 0 };
}

describe('dotOf', () => {
  it('is red only when reading stopped, amber for a passing problem, hollow without a key', () => {
    expect(dotOf(status())).toBe('ok');
    expect(dotOf(status({ lastErrorKind: 'unreachable' }))).toBe('low');
    expect(dotOf(status({ state: 'needs_reconnect', lastErrorKind: 'unauthorized' }))).toBe('bad');
    expect(dotOf(status({ state: 'not_connected', lastReadAt: null }))).toBe('off');
  });
});

describe('lineOf', () => {
  it('adds the last read to the server’s sentence while the register is read', () => {
    expect(lineOf(status(), NOW)).toBe(
      'Les ventes et les remboursements de Reveal remontent chaque minute. Dernière lecture il y a 3 min.',
    );
  });

  it('keeps the server’s sentence alone when reading stopped', () => {
    const stopped = status({ state: 'needs_reconnect', message: 'La lecture des ventes est arrêtée.' });
    expect(lineOf(stopped, NOW)).toBe('La lecture des ventes est arrêtée.');
  });
});

describe('ago', () => {
  it('counts minutes, then hours, then gives the day', () => {
    expect(ago('2026-11-02T21:59:40.000Z', NOW)).toBe('à l’instant');
    expect(ago('2026-11-02T19:00:00.000Z', NOW)).toBe('il y a 3 h');
    expect(ago('2026-10-30T09:05:00.000Z', NOW)).toMatch(/^le 30 oct\. à \d\d:05$/u);
    expect(ago('2026-10-01T12:05:00.000Z', NOW)).toMatch(/^le 1er oct\. à \d\d:05$/u);
  });
});

describe('webhookViewOf', () => {
  it('says nothing to do when no sale came for hours: silence only means no sale', () => {
    const view = webhookViewOf(
      {
        createdAt: '2026-11-01T08:00:00.000Z',
        lastDeliveryAt: '2026-11-02T08:00:00.000Z',
        lastRejectedAt: null,
      },
      NOW,
    );
    expect(view.kind).toBe('active');
    expect(view.kind === 'active' ? view.line : '').toMatch(/dernière vente reçue il y a 14 h\.$/u);
  });

  it('says so when no sale came through it yet, still without a warning', () => {
    const view = webhookViewOf(
      { createdAt: NOW.toISOString(), lastDeliveryAt: null, lastRejectedAt: null },
      NOW,
    );
    expect(view.kind).toBe('active');
    expect(view.kind === 'active' ? view.line : '').toContain('aucune vente reçue');
  });

  it('asks to register it again after a refused delivery, and says nothing is lost', () => {
    const view = webhookViewOf(
      {
        createdAt: '2026-11-01T08:00:00.000Z',
        lastDeliveryAt: '2026-11-02T21:00:00.000Z',
        lastRejectedAt: '2026-11-02T21:30:00.000Z',
      },
      NOW,
    );
    expect(view.kind).toBe('rejected');
    const warning = view.kind === 'rejected' ? view.warning : '';
    expect(warning).toContain('Réinscris le webhook');
    expect(warning).toContain('rien n’est perdu');
  });

  it('is nothing without a webhook', () => {
    expect(webhookViewOf(null, NOW)).toEqual({ kind: 'none' });
  });
});

describe('accountOptionsOf', () => {
  const ACCOUNT_A = '00000000-0000-4000-8000-00000000000a';
  const ACCOUNT_B = '00000000-0000-4000-8000-00000000000b';
  const accounts = [
    { platformAccountId: ACCOUNT_A, handle: 'lune', creatorDisplayName: 'Lune', linkedTo: 'm1' },
    { platformAccountId: ACCOUNT_B, handle: 'soleil', creatorDisplayName: '', linkedTo: null },
  ];
  const models = [model('m1', 'lune', ACCOUNT_A), model('m2', 'soleil_off', null)];

  it('shows an account linked to another model, not choosable, with that model’s handle', () => {
    expect(accountOptionsOf(models[1] ?? model('x', 'x', null), accounts, models)).toEqual([
      { value: ACCOUNT_A, label: '@lune · Lune', hint: 'relié à @lune', disabled: true },
      { value: ACCOUNT_B, label: '@soleil', disabled: false },
    ]);
  });

  it('keeps the model’s own account choosable', () => {
    const own = accountOptionsOf(models[0] ?? model('x', 'x', null), accounts, models);
    expect(own[0]).toEqual({ value: ACCOUNT_A, label: '@lune · Lune', disabled: false });
  });
});

describe('quarantine lines', () => {
  it('agree in number', () => {
    expect(quarantineLine(1)).toMatch(/^1 vente attend un modèle relié : elle ne compte/u);
    expect(quarantineLine(4)).toMatch(/^4 ventes attendent un modèle relié : elles ne comptent/u);
    expect(modelQuarantineLine(1)).toBe('1 vente en attente : relier ce modèle la fait entrer au registre.');
    expect(modelQuarantineLine(2)).toBe(
      '2 ventes en attente : relier ce modèle les fait entrer au registre.',
    );
  });
});
