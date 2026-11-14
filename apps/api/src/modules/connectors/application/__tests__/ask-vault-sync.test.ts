import { ConnectorConfigSchema, CreatorIdSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { ConnectorAccount } from '../../domain/ports';
import { createAskVaultSync, type VaultSyncAsked } from '../vault';

const hers = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000b1');
const other = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000b2');

const account = (id: string, creatorId = hers): ConnectorAccount => ({
  id: PlatformAccountIdSchema.parse(id),
  creatorId,
  platform: 'reveal',
  sessionState: 'valid',
  lastPollAt: null,
  consecutiveErrors: 0,
  pausedUntil: null,
  config: ConnectorConfigSchema.parse({}),
});

/** The owner's « Synchroniser » (fiche vault-sync): one job per account of hers, and `onAsked` told once per account. */
describe('ask a vault sync', () => {
  it('queues each of her accounts, then tells `onAsked` once per account, after its enqueue', async () => {
    const steps: string[] = [];
    const told: VaultSyncAsked[] = [];
    const ask = createAskVaultSync({
      accounts: {
        listPollable: () =>
          Promise.resolve([
            account('0199f2a0-0000-7000-8000-0000000000a1'),
            account('0199f2a0-0000-7000-8000-0000000000a2', other),
            account('0199f2a0-0000-7000-8000-0000000000a3'),
          ]),
      },
      jobs: {
        enqueueVaultSync: (queued) => {
          steps.push(`enqueue ${queued.id}`);
          return Promise.resolve();
        },
      },
      platforms: ['reveal'],
      onAsked: (input) => {
        steps.push(`told ${input.platformAccountId}`);
        told.push(input);
        return Promise.resolve();
      },
    });

    expect(await ask(hers, 'request:1')).toBe(2);
    expect(steps).toEqual([
      'enqueue 0199f2a0-0000-7000-8000-0000000000a1',
      'told 0199f2a0-0000-7000-8000-0000000000a1',
      'enqueue 0199f2a0-0000-7000-8000-0000000000a3',
      'told 0199f2a0-0000-7000-8000-0000000000a3',
    ]);
    expect(told).toEqual([
      {
        platformAccountId: '0199f2a0-0000-7000-8000-0000000000a1',
        creatorId: hers,
        correlationId: 'request:1',
      },
      {
        platformAccountId: '0199f2a0-0000-7000-8000-0000000000a3',
        creatorId: hers,
        correlationId: 'request:1',
      },
    ]);
  });

  it('queues the same without `onAsked`', async () => {
    const queued: string[] = [];
    const ask = createAskVaultSync({
      accounts: { listPollable: () => Promise.resolve([account('0199f2a0-0000-7000-8000-0000000000a1')]) },
      jobs: {
        enqueueVaultSync: (a) => {
          queued.push(a.id);
          return Promise.resolve();
        },
      },
      platforms: ['reveal'],
    });
    expect(await ask(hers, 'request:2')).toBe(1);
    expect(queued).toEqual(['0199f2a0-0000-7000-8000-0000000000a1']);
  });
});
