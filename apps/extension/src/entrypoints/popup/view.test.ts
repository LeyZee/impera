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
};

const frame = { origin: 'http://localhost:5173', version: '0.1.0', hour: 20 };

function draw(screen: Screen): { root: HTMLElement; actions: Actions } {
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
    sync: { link: vi.fn(), sync: vi.fn(), retry: vi.fn(), openSecurity: vi.fn() },
  };
  const root = document.createElement('div');
  render(root, screen, frame, actions);
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
    const { root } = draw({ kind: 'signed_in', me: ME, place: 'elsewhere', watch: null, sync: null });
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.pp-account__name')?.textContent).toBe('Alex <b>Morel</b>');
    expect(root.querySelector('.pp-whisper')?.textContent).toBe('Bonsoir, Alex.');
  });

  it('opens the shortcuts and the account page in the CRM', () => {
    const { root, actions } = draw({
      kind: 'signed_in',
      me: ME,
      place: 'elsewhere',
      watch: null,
      sync: null,
    });
    buttonNamed(root, 'Suivi').click();
    root.querySelector<HTMLButtonElement>('.pp-account')?.click();
    expect(actions.open).toHaveBeenNthCalledWith(1, '/suivi');
    expect(actions.open).toHaveBeenNthCalledWith(2, '/reglages/securite');
  });

  it('shows the Reveal card only on Reveal', () => {
    expect(
      draw({ kind: 'signed_in', me: ME, place: 'reveal', watch: null, sync: null }).root.querySelector(
        '[data-place="reveal"]',
      ),
    ).not.toBeNull();
    expect(
      draw({ kind: 'signed_in', me: ME, place: 'crm', watch: null, sync: null }).root.querySelector(
        '.pp-place',
      ),
    ).toBeNull();
  });

  it('opens the copilot beside a Reveal tab in one click (ADR 0086 § 1)', () => {
    const { root, actions } = draw({ kind: 'signed_in', me: ME, place: 'reveal', watch: null, sync: null });
    const open = [...root.querySelectorAll('button')].find((one) => one.textContent === 'Ouvrir le copilote');
    open?.click();
    expect(actions.openPanel).toHaveBeenCalledOnce();
  });

  it('keeps one neon per screen: on a watch, « Ouvrir le CRM » steps back', () => {
    const watch = {
      status: { allowed: true, link: 'linked' as const, watch: null, vision: null, lastCreatorId: null },
      creators: [],
      notice: null,
      busy: false,
      now: new Date(),
      draft: '',
    };
    const { root } = draw({ kind: 'signed_in', me: ME, place: 'instagram', watch, sync: null });
    expect(root.querySelector('[data-place="instagram"]')).not.toBeNull();
    expect(root.querySelectorAll('.nv-btn--neon')).toHaveLength(1);
    expect(buttonNamed(root, 'Ouvrir le CRM').className).toContain('nv-btn--soft');
  });

  it('shows no Instagram card to someone the watch is not for', () => {
    const { root } = draw({ kind: 'signed_in', me: ME, place: 'instagram', watch: null, sync: null });
    expect(root.querySelector('[data-place="instagram"]')).toBeNull();
    expect(root.textContent).not.toContain('Bientôt');
  });

  it('says an unreachable CRM in amber, never in red, with its address', () => {
    const { root, actions } = draw({ kind: 'unreachable' });
    expect(root.querySelector('.pp-notice--amber')?.textContent).toContain('localhost:5173');
    expect(root.querySelector('.nv-status--error')).not.toBeNull();
    expect(root.innerHTML).not.toMatch(/destructive|neon-urgent/u);
    buttonNamed(root, 'Réessayer').click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  it('says a CRM whose API is down like the CRM does, without sending to the address', () => {
    const { root, actions } = draw({ kind: 'server_down' });
    const notice = root.querySelector('.pp-notice--amber');
    expect(notice?.textContent).toContain('Le serveur ne répond pas');
    expect(notice?.textContent).not.toContain('adresse');
    expect(root.querySelector('.nv-status--error')?.textContent).toContain('Indisponible');
    expect([...root.querySelectorAll('.pp-notice button')].map((b) => b.textContent.trim())).toEqual([
      'Réessayer',
    ]);
    buttonNamed(root, 'Réessayer').click();
    expect(actions.retry).toHaveBeenCalledOnce();
  });

  it('saves the address the person typed', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null });
    const input = root.querySelector<HTMLInputElement>('#crm-address');
    if (input === null) throw new Error('no field');
    input.value = 'crm.exemple.fr';
    root.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(actions.saveAddress).toHaveBeenCalledWith('crm.exemple.fr');
  });

  it('steps back from the address on Échap, without saving it nor closing the popup', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null });
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    root.querySelector('#crm-address')?.dispatchEvent(escape);
    expect(actions.cancelAddress).toHaveBeenCalledOnce();
    expect(actions.saveAddress).not.toHaveBeenCalled();
    // Chrome closes the popup on an Échap left to it.
    expect(escape.defaultPrevented).toBe(true);
  });

  it('hands the focus back to the address button when the address closes', () => {
    const { root, actions } = draw({ kind: 'address', draft: 'localhost:5173', error: null });
    document.body.append(root);
    root.querySelector<HTMLInputElement>('#crm-address')?.focus();
    expect(document.activeElement?.id).toBe('crm-address');
    render(root, { kind: 'signed_out' }, frame, actions);
    expect(document.activeElement?.classList.contains('pp-address')).toBe(true);
    root.remove();
  });

  it('marks a refused address', () => {
    const { root } = draw({ kind: 'address', draft: 'x', error: 'Une adresse en https.' });
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
