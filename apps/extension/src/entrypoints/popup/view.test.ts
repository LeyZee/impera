// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import html from './index.html?raw';
import { accountPathOf, greetingAt, render, type Actions, type Screen } from './view';

const ME: Me = {
  id: 'u1',
  email: 'alex@exemple.fr',
  name: 'Alex <b>Morel</b>',
  role: 'owner',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  team: null,
  teamScope: 'owner',
  preferences: { sounds: true },
};

const frame = { origin: 'http://localhost:5173', version: '0.1.0', hour: 20, dev: false };

const CHATTER: Me = {
  ...ME,
  name: 'Théo Essai',
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

function draw(screen: Screen, at: typeof frame = frame): { root: HTMLElement; actions: Actions } {
  const actions: Actions = {
    signIn: vi.fn(),
    open: vi.fn(),
    retry: vi.fn(),
    grant: vi.fn(),
    editAddress: vi.fn(),
    openPanel: vi.fn(),
    saveAddress: vi.fn(),
    resetAddress: vi.fn(),
    cancelAddress: vi.fn(),
    watch: {
      link: vi.fn(),
      allow: vi.fn(),
      begin: vi.fn(),
      end: vi.fn(),
      mark: vi.fn(),
      openSecurity: vi.fn(),
    },
    copilot: { link: vi.fn(), openSecurity: vi.fn() },
    sync: { sync: vi.fn(), send: vi.fn(), cancel: vi.fn(), retry: vi.fn() },
  };
  const root = document.createElement('div');
  render(root, screen, at, actions);
  return { root, actions };
}

const buttonNamed = (root: HTMLElement, name: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
  if (found === undefined) throw new Error(`no button « ${name} »`);
  return found;
};

describe('popup', () => {
  it('mounts in #app and keeps the design system frame and the mark', () => {
    expect(html).toContain('<div id="app"></div>');
    const { root } = draw({ kind: 'signed_out' });
    expect(root.querySelector('main')?.className).toContain('nv-aura nv-popup');
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/icon/mark.svg');
    expect(root.querySelector('.nv-popup__brand')?.textContent).toBe('Impera');
  });

  it('signs in through the CRM, with no password field', () => {
    const { root, actions } = draw({ kind: 'signed_out' });
    expect(root.querySelector('input')).toBeNull();
    buttonNamed(root, 'Se connecter').click();
    expect(actions.signIn).toHaveBeenCalledOnce();
  });

  it('writes the name as text, never as markup', () => {
    const { root } = draw({
      kind: 'signed_in',
      me: ME,
      place: 'elsewhere',
      copilot: null,
      watch: null,
      sync: null,
    });
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.pp-account__name')?.textContent).toBe('Alex <b>Morel</b>');
    expect(root.querySelector('.pp-whisper')?.textContent).toBe('Bonsoir, Alex.');
  });

  it('opens the shortcuts and the account page in the CRM', () => {
    const { root, actions } = draw({
      kind: 'signed_in',
      me: ME,
      place: 'elsewhere',
      copilot: null,
      watch: null,
      sync: null,
    });
    buttonNamed(root, 'Suivi').click();
    root.querySelector<HTMLButtonElement>('.pp-account')?.click();
    expect(actions.open).toHaveBeenNthCalledWith(1, '/suivi');
    expect(actions.open).toHaveBeenNthCalledWith(2, '/reglages/securite');
  });

  const LINKED = { link: 'linked' as const, draft: '', notice: null, busy: false };

  it('shows the copilot card on Reveal only', () => {
    expect(
      draw({
        kind: 'signed_in',
        me: ME,
        place: 'reveal',
        copilot: LINKED,
        watch: null,
        sync: null,
      }).root.querySelector('[data-card="copilot"]'),
    ).not.toBeNull();
    expect(
      draw({
        kind: 'signed_in',
        me: ME,
        place: 'crm',
        copilot: null,
        watch: null,
        sync: null,
      }).root.querySelector('.pp-card'),
    ).toBeNull();
  });

  // EXT-11 and EXT-12: on Reveal, the copilot is the one neon, and the popup holds under 600 px.
  it('makes the copilot the screen’s one action, with the shortcuts on one row and no greeting', () => {
    const { root, actions } = draw({
      kind: 'signed_in',
      me: CHATTER,
      place: 'reveal',
      copilot: LINKED,
      watch: null,
      sync: null,
    });
    const neon = [...root.querySelectorAll('.nv-btn--neon')];
    expect(neon.map((one) => one.textContent)).toEqual(['Ouvrir le copilote']);
    expect(root.querySelector('.pp-tiles--compact')).not.toBeNull();
    expect(root.querySelector('.pp-whisper')).toBeNull();
    expect(root.textContent).not.toContain('Ouvrir le CRM');
    neon[0]?.dispatchEvent(new MouseEvent('click'));
    expect(actions.openPanel).toHaveBeenCalledOnce();
  });

  // EXT-09: the creator has no panel (ADR 0086 § 7).
  it('shows a creator no copilot on Reveal', () => {
    const creator: Me = { ...ME, role: 'creator', teamScope: 'self' };
    const { root } = draw({
      kind: 'signed_in',
      me: creator,
      place: 'reveal',
      copilot: null,
      watch: null,
      sync: null,
    });
    expect(root.textContent).not.toContain('copilote');
    expect(root.querySelector('.pp-whisper')).not.toBeNull();
  });

  // EXT-10: a suspended chatter saw « Connecté » and the copilot.
  it('tells a member away from work why the copilot does not open', () => {
    const away: Me = { ...CHATTER, team: { role: 'chatter', status: 'suspended' } };
    const { root } = draw({
      kind: 'signed_in',
      me: away,
      place: 'reveal',
      copilot: LINKED,
      watch: null,
      sync: null,
    });
    expect(root.querySelector('.nv-popup__head .pp-pill')?.textContent).toBe('Suspendu');
    expect(root.textContent).not.toContain('Connecté');
    expect(root.querySelector('[data-card="away"]')?.textContent).toContain('Ton compte est suspendu');
    expect(root.textContent).toContain('le copilote s’ouvre quand ton responsable te remet actif');
    expect(root.textContent).not.toContain('Ouvrir le copilote');
    expect(root.querySelector('.pp-tiles--compact')).not.toBeNull();
  });

  it('keeps one neon per screen: on a watch, « Ouvrir le CRM » steps aside', () => {
    const watch = {
      status: { allowed: true, link: 'linked' as const, watch: null, vision: null, lastCreatorId: null },
      creators: [],
      notice: null,
      busy: false,
      now: new Date(),
      draft: '',
    };
    const { root } = draw({
      kind: 'signed_in',
      me: ME,
      place: 'instagram',
      copilot: null,
      watch,
      sync: null,
    });
    expect(root.querySelector('[data-card="watch"]')).not.toBeNull();
    expect(root.querySelectorAll('.nv-btn--neon')).toHaveLength(1);
    expect(root.textContent).not.toContain('Ouvrir le CRM');
  });

  it('shows no Instagram card to someone the watch is not for', () => {
    const { root } = draw({
      kind: 'signed_in',
      me: ME,
      place: 'instagram',
      copilot: null,
      watch: null,
      sync: null,
    });
    expect(root.querySelector('[data-card="watch"]')).toBeNull();
    expect(root.textContent).not.toContain('Bientôt');
  });

  // V-EXT-21, V-EXT-26, V-EXT-27.
  it('draws no native tooltip, no neon ring, and an e-mail once for an account with no name', () => {
    const { root } = draw({
      kind: 'signed_in',
      me: { ...ME, name: ' ' },
      place: 'elsewhere',
      copilot: null,
      watch: null,
      sync: null,
    });
    expect(root.querySelector('[title]')).toBeNull();
    expect(root.querySelector('.nv-avatar--ring')).toBeNull();
    expect(root.querySelector('.pp-account__name')?.textContent).toBe('alex@exemple.fr');
    expect(root.querySelector('.pp-account__sub')?.textContent).toBe('Propriétaire');
    expect(root.querySelector('.pp-address')?.getAttribute('aria-label')).toContain(
      'Changer l’adresse du CRM',
    );
  });

  it('says an unreachable CRM in amber, never in red, with its address', () => {
    const { root, actions } = draw({ kind: 'unreachable' });
    expect(root.querySelector('.pp-notice--amber')?.textContent).toContain('localhost:5173');
    expect(root.querySelector('.nv-status--error')).not.toBeNull();
    expect(root.innerHTML).not.toMatch(/destructive|neon-urgent/u);
    buttonNamed(root, 'Réessayer').click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  // EXT-08 and EXT-18: a server error is no wrong address, and has the panel's title.
  it('says a CRM in error like the panel does, without sending to the address', () => {
    const { root, actions } = draw({ kind: 'server_down' });
    const notice = root.querySelector('.pp-notice--amber');
    expect(notice?.textContent).toContain('Le CRM ne répond pas');
    expect(notice?.textContent).toContain('son serveur est en erreur');
    expect(notice?.textContent).not.toContain('adresse');
    expect(root.querySelector('.nv-status--error')?.textContent).toContain('Indisponible');
    expect([...root.querySelectorAll('.pp-notice button')].map((b) => b.textContent.trim())).toEqual([
      'Réessayer',
    ]);
    buttonNamed(root, 'Réessayer').click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  // EXT-08: a page that is not the CRM was « Rien à l’adresse ».
  it('tells an address that answers but is not a CRM', () => {
    const { root, actions } = draw({ kind: 'not_crm' });
    expect(root.querySelector('.pp-notice__title')?.textContent).toBe('Ce n’est pas un CRM Impera');
    expect(root.textContent).toContain('Quelque chose répond à localhost:5173, mais pas le CRM.');
    expect(root.querySelector('.nv-status--error')?.textContent).toContain('Injoignable');
    expect([...root.querySelectorAll('.pp-notice button')].map((b) => b.textContent.trim())).toEqual([
      'Changer l’adresse',
      'Réessayer',
    ]);
    buttonNamed(root, 'Changer l’adresse').click();
    expect(actions.editAddress).toHaveBeenCalledOnce();
  });

  it('tells an account the CRM refuses the extension', () => {
    const { root } = draw({ kind: 'refused' });
    expect(root.querySelector('.pp-notice__title')?.textContent).toBe(
      'Ce compte ne peut pas ouvrir l’extension',
    );
    expect(root.querySelector('.nv-status--error')?.textContent).toContain('Refusé');
  });

  // EXT-07: the first opening showed « Injoignable » and a developer's address.
  it('welcomes a first opening with the address a manager gives, never a developer’s', () => {
    const { root, actions } = draw({ kind: 'address', draft: '', error: null, first: true });
    expect(root.querySelector('.pp-whisper')?.textContent).toBe('Bienvenue.');
    expect(root.querySelector('h1')?.textContent).toBe('Où s’ouvre ton CRM ?');
    expect(root.querySelector('#crm-address')?.getAttribute('placeholder')).toBe('crm.exemple.fr');
    expect(root.textContent).not.toContain('localhost');
    expect(root.querySelector('.pp-pill')).toBeNull();
    expect(root.querySelector('.pp-address')).toBeNull();
    expect([...root.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual(['Enregistrer']);
    // No way back from the welcome: Échap leaves it to the browser.
    root
      .querySelector('#crm-address')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(actions.cancelAddress).not.toHaveBeenCalled();
  });

  it('offers the way back to localhost in a development build only', () => {
    expect(draw({ kind: 'address', draft: '', error: null, first: false }).root.textContent).not.toContain(
      'localhost',
    );
    const { root, actions } = draw(
      { kind: 'address', draft: '', error: null, first: false },
      { ...frame, dev: true },
    );
    buttonNamed(root, 'Revenir à localhost:5173').click();
    expect(actions.resetAddress).toHaveBeenCalledOnce();
  });

  it('saves the address the person typed', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null, first: false });
    const input = root.querySelector<HTMLInputElement>('#crm-address');
    if (input === null) throw new Error('no field');
    input.value = 'crm.exemple.fr';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(actions.saveAddress).toHaveBeenCalledWith('crm.exemple.fr');
  });

  it('steps back from the address on Échap, without saving it nor closing the popup', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null, first: false });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    root.querySelector('#crm-address')?.dispatchEvent(escape);
    expect(actions.cancelAddress).toHaveBeenCalledOnce();
    expect(actions.saveAddress).not.toHaveBeenCalled();
    // Chrome closes the popup on an Échap left to it.
    expect(escape.defaultPrevented).toBe(true);
  });

  it('hands the focus back to the address button when the address closes', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null, first: false });
    document.body.append(root);
    root.querySelector<HTMLInputElement>('#crm-address')?.focus();
    expect(document.activeElement?.id).toBe('crm-address');
    render(root, { kind: 'signed_out' }, frame, actions);
    expect(document.activeElement?.classList.contains('pp-address')).toBe(true);
    root.remove();
  });

  it('marks a refused address', () => {
    const { root } = draw({ kind: 'address', draft: 'x', error: 'Une adresse en https.', first: false });
    expect(root.querySelector('#crm-address')?.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('.pp-hint--amber')?.textContent).toBe('Une adresse en https.');
  });

  it('greets by the hour', () => {
    expect(greetingAt(9)).toBe('Bonjour');
    expect(greetingAt(18)).toBe('Bonsoir');
    expect(greetingAt(3)).toBe('Bonsoir');
  });

  it('sends each account to its own security page', () => {
    expect(accountPathOf({ ...ME, role: 'creator', teamScope: 'self' })).toBe('/moi/securite');
    expect(accountPathOf({ ...ME, role: 'operator', teamScope: 'self' })).toBe('/compte/securite');
  });
});
