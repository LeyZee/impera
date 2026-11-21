import { describe, expect, it } from 'vitest';

import { dotOf, lineOf } from './view';

describe('the redirect service card', () => {
  it('says what is true of the key, and never anything of the key itself', () => {
    expect(dotOf({ state: 'off', connectedAt: null })).toBe('off');
    expect(lineOf({ state: 'off', connectedAt: null })).toContain('au déploiement');
    expect(dotOf({ state: 'not_connected', connectedAt: null })).toBe('off');
    expect(lineOf({ state: 'not_connected', connectedAt: null })).toContain('Aucune clé');
    expect(dotOf({ state: 'needs_reconnect', connectedAt: '2026-11-02T13:05:00.000Z' })).toBe('bad');
    expect(lineOf({ state: 'needs_reconnect', connectedAt: null })).toContain('Colle-la de nouveau');
    expect(dotOf({ state: 'connected', connectedAt: '2026-11-02T13:05:00.000Z' })).toBe('ok');
    expect(lineOf({ state: 'connected', connectedAt: '2026-11-02T13:05:00.000Z' })).toMatch(
      /connectée le 2 nov\./u,
    );
    expect(lineOf({ state: 'connected', connectedAt: null })).toBe('Clé acceptée par le service.');
  });
});
