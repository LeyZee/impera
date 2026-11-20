import type { Me } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { linkCrm, type LinkDeps } from './crm-link';
import type { CrmSession } from './session';

const ME: Me = {
  id: 'u1',
  email: 'essai@impera.test',
  name: 'Alex Essai',
  role: 'owner',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  team: null,
  teamScope: 'owner',
  preferences: { sounds: true },
};

const SIGNED_IN: CrmSession = { kind: 'signed_in', me: ME };

function deps(over: Partial<LinkDeps> = {}): LinkDeps {
  return {
    contains: vi.fn(() => Promise.resolve(false)),
    request: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
    readSession: vi.fn(() => Promise.resolve(SIGNED_IN)),
    saved: vi.fn(() => Promise.resolve(null)),
    save: vi.fn(() => Promise.resolve()),
    forget: vi.fn(() => Promise.resolve()),
    builtIn: null,
    ...over,
  };
}

const SITE = { origins: ['https://crm.exemple.fr/*'] };

describe('linkCrm', () => {
  it('asks the browser for that site alone before anything else, then saves once the CRM knows the person', async () => {
    const d = deps();
    const linked = linkCrm('https://crm.exemple.fr', d);
    // Inside the click, before any await.
    expect(d.request).toHaveBeenCalledWith(SITE);
    expect(await linked).toEqual({ state: 'linked' });
    expect(d.readSession).toHaveBeenCalledWith('https://crm.exemple.fr');
    expect(d.save).toHaveBeenCalledWith('https://crm.exemple.fr');
    expect(d.forget).not.toHaveBeenCalled();
  });

  it('saves nothing when the browser is refused', async () => {
    const d = deps({ request: vi.fn(() => Promise.resolve(false)) });
    expect(await linkCrm('https://crm.exemple.fr', d)).toEqual({ state: 'failed', failure: 'denied' });
    expect(d.readSession).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it('saves nothing and gives the site back when no session is open there', async () => {
    const d = deps({ readSession: vi.fn(() => Promise.resolve<CrmSession>({ kind: 'signed_out' })) });
    expect(await linkCrm('https://crm.exemple.fr', d)).toEqual({ state: 'failed', failure: 'signed_out' });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.remove).toHaveBeenCalledWith(SITE);
  });

  it.each<[string, CrmSession]>([
    ['a page that is not the CRM', { kind: 'not_crm' }],
    ['a redirect, never followed', { kind: 'unreachable' }],
    ['a CRM unwell', { kind: 'server_down' }],
  ])('saves nothing and gives the site back for %s', async (_, session) => {
    const d = deps({ readSession: vi.fn(() => Promise.resolve(session)) });
    expect(await linkCrm('https://crm.exemple.fr', d)).toEqual({ state: 'failed', failure: 'not_crm' });
    expect(d.save).not.toHaveBeenCalled();
    expect(d.remove).toHaveBeenCalledWith(SITE);
  });

  it('keeps a site the browser had already allowed', async () => {
    const d = deps({
      contains: vi.fn(() => Promise.resolve(true)),
      readSession: vi.fn(() => Promise.resolve<CrmSession>({ kind: 'not_crm' })),
    });
    await linkCrm('https://crm.exemple.fr', d);
    expect(d.remove).not.toHaveBeenCalled();
  });

  it('asks nothing of the browser for this computer, allowed at install', async () => {
    const d = deps();
    expect(await linkCrm('http://localhost:5173', d)).toEqual({ state: 'linked' });
    expect(d.request).not.toHaveBeenCalled();
    expect(d.remove).not.toHaveBeenCalled();
  });

  it('forgets what the old address held when it changes, and only then', async () => {
    const moved = deps({ saved: vi.fn(() => Promise.resolve('https://ancien.exemple.fr')) });
    await linkCrm('https://crm.exemple.fr', moved);
    expect(moved.forget).toHaveBeenCalledOnce();
    const same = deps({ saved: vi.fn(() => Promise.resolve('https://crm.exemple.fr')) });
    await linkCrm('https://crm.exemple.fr', same);
    expect(same.forget).not.toHaveBeenCalled();
  });

  it('gives back the site it leaves, unless the manifest grants it', async () => {
    const typed = deps({ saved: vi.fn(() => Promise.resolve('https://ancien.exemple.fr')) });
    await linkCrm('https://autre.exemple.fr', typed);
    expect(typed.remove).toHaveBeenCalledWith({ origins: ['https://ancien.exemple.fr/*'] });
    expect(typed.remove).not.toHaveBeenCalledWith({ origins: ['https://autre.exemple.fr/*'] });

    const back = deps({
      saved: vi.fn(() => Promise.resolve('https://autre.exemple.fr')),
      builtIn: 'https://crm.exemple.fr',
    });
    await linkCrm('https://crm.exemple.fr', back);
    expect(back.remove).toHaveBeenCalledWith({ origins: ['https://autre.exemple.fr/*'] });

    const fromBuiltIn = deps({
      saved: vi.fn(() => Promise.resolve('https://crm.exemple.fr')),
      builtIn: 'https://crm.exemple.fr',
    });
    await linkCrm('https://autre.exemple.fr', fromBuiltIn);
    expect(fromBuiltIn.remove).not.toHaveBeenCalled();

    const fromLocal = deps({ saved: vi.fn(() => Promise.resolve('http://localhost:5173')) });
    await linkCrm('https://autre.exemple.fr', fromLocal);
    expect(fromLocal.remove).not.toHaveBeenCalled();
  });

  it('keeps the old site when the new one fails', async () => {
    const d = deps({
      saved: vi.fn(() => Promise.resolve('https://ancien.exemple.fr')),
      readSession: vi.fn(() => Promise.resolve<CrmSession>({ kind: 'signed_out' })),
    });
    await linkCrm('https://autre.exemple.fr', d);
    expect(d.remove).not.toHaveBeenCalledWith({ origins: ['https://ancien.exemple.fr/*'] });
  });
});
