import { DomainError } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { McpReadRefused } from '../modules/mcp';

import { refusedAsMcp } from './mcp';

describe('refusedAsMcp (ADR 0026 § 1: a module read that refuses the person)', () => {
  it('turns the connectors’ refusals into a refusal of the call', async () => {
    const creator = refusedAsMcp(() =>
      Promise.reject(new DomainError('connector_reads_forbidden', 'Réservé')),
    );
    await expect(creator).rejects.toEqual(new McpReadRefused('creator_forbidden'));
    const team = refusedAsMcp(() => Promise.reject(new DomainError('sales_feed_team_forbidden', 'Réservé')));
    await expect(team).rejects.toEqual(new McpReadRefused('role_forbidden'));
  });

  it('leaves any other failure an error, and a read that answers as it is', async () => {
    const other = new DomainError('connector_reads_range_unprocessable', 'Période');
    await expect(refusedAsMcp(() => Promise.reject(other))).rejects.toBe(other);
    await expect(refusedAsMcp(() => Promise.resolve(3))).resolves.toBe(3);
  });
});
