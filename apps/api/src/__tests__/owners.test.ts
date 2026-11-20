import type { SecurityAlertPayload } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ownerNotice } from '../owners';

const account = { userId: 'owner-2', role: 'owner' as const, network: null };

describe('what the owners are told in the app (ADR 0096 §§ 2 and 5)', () => {
  it('tells every owner of a change among them, and the one removed too', () => {
    const changes: SecurityAlertPayload[] = [
      { reason: 'owner_added', ...account, by: 'owner-1' },
      {
        reason: 'owner_removal_requested',
        ...account,
        by: 'owner-1',
        effectiveAt: '2026-11-23T10:00:00.000Z',
      },
      { reason: 'owner_removal_cancelled', ...account },
    ];
    for (const alert of changes) {
      expect(ownerNotice(alert)).toMatchObject({ also: null, except: null });
    }
    expect(
      ownerNotice({ reason: 'owner_removed', ...account, role: 'operator', by: 'owner-1' }),
    ).toMatchObject({ also: 'owner-2', except: null });
  });

  it('tells a sign-in on a new device to the other owner only, and only an owner’s', () => {
    for (const reason of ['new_device_sign_in', 'passkey_new_sign_in'] as const) {
      expect(ownerNotice({ reason, ...account })).toMatchObject({ also: null, except: 'owner-2' });
      expect(ownerNotice({ reason, ...account, role: 'operator' })).toBeNull();
      expect(ownerNotice({ reason, ...account, userId: null })).toBeNull();
    }
  });

  it('relays nothing else, and every message opens Réglages › Sécurité without a name or an id', () => {
    expect(ownerNotice({ reason: 'persona_activated', userId: 'owner-1', version: '1.0.0' })).toBeNull();
    expect(ownerNotice({ reason: 'passkey_added', ...account })).toBeNull();
    const notice = ownerNotice({
      reason: 'owner_removal_requested',
      ...account,
      by: 'owner-1',
      effectiveAt: '2026-11-23T10:00:00.000Z',
    });
    expect(notice?.message).toEqual({
      title: 'Retrait d’un propriétaire demandé',
      body: 'Il prend effet dans 72 h. Le propriétaire visé peut l’annuler dans Réglages › Sécurité.',
      url: '/reglages/securite',
    });
    expect(JSON.stringify(notice)).not.toContain('owner-1');
  });
});
