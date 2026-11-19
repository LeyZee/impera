// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import html from './index.html?raw';
import type { SyncView } from './reveal-view';
import { accountPathOf, greetingAt, render, type Actions, type Frame, type Screen } from './view';

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

const frame: Frame = {
  origin: 'http://localhost:5173',
  version: '0.1.0',
  hour: 20,
  dev: false,
  builtIn: null,
};

const CHATTER: Me = {
  ...ME,
  name: 'Théo Essai',
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

function draw(screen: Screen, at: Frame = frame): { root: HTMLElement; actions: Actions } {
  const actions: Actions = {
    signIn: vi.fn(),
    open: vi.fn(),
    retry: vi.fn(),
    grant: vi.fn(),
    editAddress: vi.fn(),
    openPanel: vi.fn(),
    saveAddress: vi.fn(),
    linkFromPage: vi.fn(),
    declineLink: vi.fn(),
    typeAddress: vi.fn(),
    resetAddress: vi.fn(),
    cancelAddress: vi.fn(),
    keepCrm: vi.fn(),
    changeCrm: vi.fn(),
    revertCrm: vi.fn(),
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

  // Avis Design du 19/11: « CRM relié » above a card that says the CRM does not answer.
  it('says « CRM injoignable » in the head when the session card heard no answer', () => {
    const head = (accounts: SyncView['accounts']): string =>
      draw({
        kind: 'signed_in',
        me: ME,
        place: 'reveal',
        copilot: LINKED,
        watch: null,
        sync: {
          accounts,
          outcome: null,
          pending: null,
          confirm: null,
          now: new Date(2026, 10, 19, 18, 0),
          crm: 'localhost:5173',
        },
      }).root.querySelector('.pp-pill')?.textContent ?? '';
    expect(head({ state: 'ok', accounts: [] })).toBe('CRM relié');
    expect(head({ state: 'unreachable', accounts: [] })).toBe('CRM injoignable');
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
    expect(root.textContent).not.toContain('CRM relié');
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
    expect([...root.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual([
      'Enregistrer',
      'Annuler',
    ]);
    // Typed from the welcome, it steps back to it (ADR 0067, amendement du 19/11).
    root
      .querySelector('#crm-address')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(actions.cancelAddress).toHaveBeenCalledOnce();
  });

  // ADR 0067, amendement du 19/11: the way to link is in the CRM, typing behind a small link.
  it('sends a first opening to the CRM’s page, and types only on demand', () => {
    const { root, actions } = draw({ kind: 'welcome' });
    expect(root.querySelector('.pp-whisper')?.textContent).toBe('Bienvenue.');
    expect([...root.querySelectorAll('.pp-steps li')].map((step) => step.textContent)).toEqual([
      'Ouvre ton CRM.',
      'Menu de ton compte, puis Extension.',
      'Clique « Relier l’extension à ce CRM », puis de nouveau sur l’icône Impera.',
    ]);
    expect(root.querySelector('.pp-pill')).toBeNull();
    expect(root.querySelector('.pp-address')).toBeNull();
    expect(root.querySelector('input')).toBeNull();
    buttonNamed(root, 'Saisir l’adresse').click();
    expect(actions.typeAddress).toHaveBeenCalledOnce();
  });

  it('asks before linking to the CRM of the open tab, its host in full, and warns of the browser’s question', () => {
    const { root, actions } = draw({
      kind: 'link-offer',
      offer: { origin: 'https://crm.exemple.fr', host: 'crm.exemple.fr' },
      error: null,
    });
    expect(root.querySelector('h1')?.textContent).toBe('Relier l’extension à crm.exemple.fr ?');
    expect(root.textContent).toContain('Ton navigateur va te demander d’autoriser ce site. Accepte.');
    expect(root.querySelector('.pp-address')).toBeNull();
    buttonNamed(root, 'Relier').click();
    expect(actions.linkFromPage).toHaveBeenCalledOnce();
    buttonNamed(root, 'Pas maintenant').click();
    expect(actions.declineLink).toHaveBeenCalledOnce();
  });

  it('names this computer rather than a site, with no browser question to announce', () => {
    const { root } = draw({
      kind: 'link-offer',
      offer: { origin: 'http://localhost:5173', host: null },
      error: null,
    });
    expect(root.querySelector('h1')?.textContent).toBe('Relier l’extension au CRM de cet ordinateur ?');
    expect(root.textContent).not.toContain('localhost');
    expect(root.textContent).not.toContain('Ton navigateur va te demander');
  });

  it('says why a link failed in place of the browser’s question', () => {
    const { root } = draw({
      kind: 'link-offer',
      offer: { origin: 'https://crm.exemple.fr', host: 'crm.exemple.fr' },
      error: 'Cette adresse ne répond pas comme un CRM Impera. Recharge la page et réessaie.',
    });
    expect(root.querySelector('.pp-hint--amber')?.textContent).toBe(
      'Cette adresse ne répond pas comme un CRM Impera. Recharge la page et réessaie.',
    );
    expect(root.textContent).not.toContain('Ton navigateur va te demander');
  });

  it('says once that the extension is linked', () => {
    const { root } = draw({ kind: 'linked', host: 'crm.exemple.fr' });
    expect(root.textContent).toContain('Extension reliée à crm.exemple.fr');
    expect(root.querySelector('.nv-status--sent')?.textContent).toContain('CRM relié');
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

  // ADR 0067, second amendement, § 5: leaving the CRM a hosted build was made for is asked, both hosts named.
  it('asks before leaving the built-in CRM, the safe choice first and focused', () => {
    const { root, actions } = draw({ kind: 'change-crm', from: 'crm.exemple.fr', to: 'autre.exemple.fr' });
    document.body.append(root);
    // Drawn again once in the page, as the popup is: the focus needs a mounted element.
    render(root, { kind: 'change-crm', from: 'crm.exemple.fr', to: 'autre.exemple.fr' }, frame, actions);
    expect(root.textContent).toContain('Cette extension est prévue pour crm.exemple.fr.');
    expect(root.querySelector('h1')?.textContent).toBe('La relier à autre.exemple.fr à la place ?');
    expect(root.textContent).toContain('Fais-le seulement si ton responsable te l’a demandé.');
    const keep = buttonNamed(root, 'Garder crm.exemple.fr');
    const change = buttonNamed(root, 'Relier à autre.exemple.fr');
    expect(keep.classList.contains('nv-btn--neon')).toBe(true);
    expect(change.classList.contains('nv-btn--neon')).toBe(false);
    expect(document.activeElement).toBe(keep);
    expect([...root.querySelectorAll('.pp-actions button')]).toEqual([keep, change]);
    expect(root.querySelector('.pp-address')).toBeNull();
    keep.click();
    expect(actions.keepCrm).toHaveBeenCalledOnce();
    change.click();
    expect(actions.changeCrm).toHaveBeenCalledOnce();
    root.remove();
  });

  it('shows another CRM than the built-in one in amber, with the way back named for screen readers', () => {
    const hosted: Frame = { ...frame, origin: 'https://autre.exemple.fr', builtIn: 'https://crm.exemple.fr' };
    const { root, actions } = draw({ kind: 'signed_out' }, hosted);
    expect(root.querySelector('.pp-address')?.classList.contains('pp-address--changed')).toBe(true);
    const back = root.querySelector<HTMLButtonElement>('.pp-revert');
    expect(back?.textContent).toBe('Revenir à l’adresse d’origine');
    expect(back?.getAttribute('aria-label')).toBe('Revenir à l’adresse d’origine (crm.exemple.fr)');
    back?.click();
    expect(actions.revertCrm).toHaveBeenCalledOnce();
  });

  it('keeps the footer quiet on the built-in CRM, and without one', () => {
    for (const at of [
      { ...frame, origin: 'https://crm.exemple.fr', builtIn: 'https://crm.exemple.fr' },
      frame,
    ]) {
      const { root } = draw({ kind: 'signed_out' }, at);
      expect(root.querySelector('.pp-address--changed')).toBeNull();
      expect(root.querySelector('.pp-revert')).toBeNull();
    }
  });
});
