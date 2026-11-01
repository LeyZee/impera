// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import blocksYaml from '../../../../../personas/demo/v0.2.0.yaml?raw';

import { PersonaSection, tabsOutOfView } from './PersonaSection';
import { parsePersonaYaml } from './source';

const CREATOR = '6f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const SUMMARY = {
  id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  version: '0.2.0',
  contentHash: 'a'.repeat(64),
  isActive: true,
  createdAt: '2026-10-28T08:00:00.000Z',
};

beforeEach(() => {
  // jsdom has no matchMedia: a reduced motion, so the tab lens does not play.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  // jsdom has no layout: bringing the picked tab into view is a no-op.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Her stored persona is the demo with every block; a save answers `saved` (status, body). */
async function serve(saved: readonly [number, unknown]) {
  const persona = await parsePersonaYaml(blocksYaml);
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify(saved[1]), { status: saved[0] }));
    }
    if (url === `/v1/creators/${CREATOR}/persona`) {
      const overview = { creatorId: CREATOR, latest: { summary: SUMMARY, persona }, versions: [SUMMARY] };
      return Promise.resolve(new Response(JSON.stringify(overview), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

const refusal = (faults: unknown) =>
  [
    422,
    {
      error: {
        code: 'persona_sample_reply_unprocessable',
        message: 'Une réponse type est refusée.',
        details: { faults },
        requestId: 'req-1',
      },
    },
  ] as const;

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name: new RegExp(`^${name}`, 'u') });

describe('Créatrices › Persona, the P5-01 blocks', () => {
  it('shows how complete she is, and opens the tab of a block still to write', async () => {
    await serve([500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const gauge = await screen.findByRole('progressbar', { name: 'Complétude de la persona' });
    expect(gauge.getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText('100 %')).toBeDefined();

    fireEvent.click(tab('Elle en détail'));
    // Her three replies: each « Retirer » removes the first one left.
    for (let left = 3; left > 0; left -= 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Retirer la 1re réponse' }));
    }
    expect(screen.queryByRole('button', { name: /^Retirer la/u })).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Complétude de la persona' }).getAttribute('aria-valuenow'),
    ).not.toBe('100');
    const missing = screen.getByText('À compléter :').parentElement;
    if (missing === null) throw new Error('the missing blocks have a line');
    fireEvent.click(within(missing).getByRole('button', { name: 'Réponses types' }));
    expect(tab('Elle en détail').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tab('Détails'));
    fireEvent.click(within(missing).getByRole('button', { name: 'Réponses types' }));
    expect(tab('Elle en détail').getAttribute('aria-selected')).toBe('true');
  });

  it('puts a 422 on the reply the agent would not send, until that reply changes', async () => {
    const fake = await serve(refusal([{ index: 1, code: 'ai_disclosure' }]));
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByRole('progressbar', { name: 'Complétude de la persona' });

    fireEvent.click(tab('Elle en détail'));
    fireEvent.change(screen.getByLabelText('Situation de la 1re réponse'), {
      target: { value: 'Il lui demande ce qu’elle fait ce soir' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));

    expect((await screen.findByRole('alert')).textContent).toBe('L’agent ne l’enverrait pas : un aveu d’IA.');
    expect(screen.getByText('1 champ à corriger')).toBeDefined();
    expect(within(tab('Elle en détail')).getByLabelText('1 à corriger')).toBeDefined();
    expect(fake.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    // Another edit, even on the same reply's situation, leaves the refusal where it is.
    fireEvent.change(screen.getByLabelText('Situation de la 2e réponse'), { target: { value: '' } });
    fireEvent.click(tab('Elle en détail'));
    fireEvent.change(screen.getByLabelText('Ses projets'), { target: { value: 'Ouvrir un studio' } });
    fireEvent.click(tab('Elle en détail'));
    expect(screen.getByRole('alert').textContent).toBe('L’agent ne l’enverrait pas : un aveu d’IA.');

    const refused = screen.getAllByLabelText('Sa réponse')[1];
    if (refused === undefined) throw new Error('the second reply has its field');
    fireEvent.change(refused, { target: { value: 'Arrête tu vas me faire rougir' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says a refusal it cannot read as a failed save', async () => {
    await serve(refusal([{ index: 99, code: 'ai_disclosure' }]));
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByRole('progressbar', { name: 'Complétude de la persona' });
    fireEvent.click(tab('Elle en détail'));
    fireEvent.change(screen.getByLabelText('Ses projets'), { target: { value: 'Ouvrir un studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));
    expect(await screen.findByText(/L’enregistrement n’a pas abouti/u)).toBeDefined();
  });
});

/** Her stored versions (newest first), the demo as the newest one's content; POSTs answer `answer`. */
async function serveVersions(
  versions: readonly (typeof SUMMARY)[],
  answer: (url: string) => readonly [number, unknown],
) {
  const persona = await parsePersonaYaml(blocksYaml);
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (init?.method === 'POST') {
      const [status, body] = answer(url);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }
    if (url === `/v1/creators/${CREATOR}/persona`) {
      const latest = versions[0] === undefined ? null : { summary: versions[0], persona };
      return Promise.resolve(
        new Response(JSON.stringify({ creatorId: CREATOR, latest, versions }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

const OLDER = {
  ...SUMMARY,
  id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c40',
  version: '0.1.0',
  contentHash: 'b'.repeat(64),
};
const NEWEST = { ...SUMMARY, id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41', isActive: false };

describe('Créatrices › Persona, recette 28/10', () => {
  it('activates over the active version it read, and says so when another tab changed it', async () => {
    const fake = await serveVersions([NEWEST, OLDER], () => [
      409,
      { error: { code: 'persona_version_conflict', message: 'x', details: {}, requestId: 'r' } },
    ]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la version 0.2.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’activation' }));

    expect(
      await screen.findByText(/Sa version active a changé depuis l’ouverture de cette page/u),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recharger' })).toBeDefined();
    const [url, init] = fake.mock.calls.find(([, i]) => i?.method === 'POST') ?? [];
    expect(url).toBe(`/v1/creators/${CREATOR}/persona/versions/${NEWEST.id}/activate`);
    expect(init?.body).toBe(JSON.stringify({ expectedActive: OLDER.id }));
  });

  it('says nothing of the state while nothing waits, and says the changes once there are some (CREA-05)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const name = await screen.findByLabelText('Prénom');
    expect(screen.queryByText('Aucune modification')).toBeNull();
    expect(screen.queryByText(/Tout est décrit/u)).toBeNull();
    fireEvent.change(name, { target: { value: 'Elenaa' } });
    expect(screen.getByText('1 modification, prête à enregistrer')).toBeDefined();
  });

  it('gathers the five P5-01 blocks, folded, in « Elle en détail » (CREA-02)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');
    expect(screen.getAllByRole('tab')).toHaveLength(8);
    fireEvent.click(tab('Elle en détail'));
    const panel = screen.getByRole('tabpanel');
    const folds = [...panel.querySelectorAll('details > summary .nv-disclosure__title')].map(
      (t) => t.textContent,
    );
    expect(folds).toEqual(['Mode de vie', 'Goûts', 'Intime', 'Style d’écriture', 'Réponses types']);
    expect(panel.querySelectorAll('details[open]')).toHaveLength(0);
  });

  it('says the agent writes with her active version, and nothing without one (recette G4)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const note = await screen.findByText(/C’est avec elle que l’agent écrit ses brouillons/u);
    expect(note.textContent).toContain('Version active : 0.2.0.');
    expect(note.textContent).not.toMatch(/persona fixée sur le serveur/u);
  });

  it('says the agent writes nothing for her while no version is active', async () => {
    await serveVersions([{ ...SUMMARY, isActive: false }], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    expect(
      await screen.findByText(/aucun message ne peut partir avant l’activation d’une version/u),
    ).toBeDefined();
  });

  it('shows a chatter her persona read-only, never « prête à enregistrer »', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave={false} timezone="Europe/Paris" />);
    const name = await screen.findByLabelText('Prénom');
    // Disabled by the fieldset around the panel: every field reads, none takes a change.
    expect(name.matches(':disabled')).toBe(true);
    expect(
      screen.getByText('Lecture seule : seuls le propriétaire et la créatrice modifient sa persona.'),
    ).toBeDefined();
  });

  it('stays on the tab it saved from', async () => {
    let saved = false;
    const fake = await serveVersions([SUMMARY], () => {
      saved = true;
      return [201, { ...NEWEST, isActive: false }];
    });
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');
    fireEvent.click(tab('Elle en détail'));
    fireEvent.change(screen.getByLabelText('Ses projets'), { target: { value: 'Ouvrir un studio' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));
    await waitFor(() => {
      expect(saved).toBe(true);
    });
    await waitFor(() => {
      expect(fake.mock.calls.filter(([url]) => url === `/v1/creators/${CREATOR}/persona`)).toHaveLength(2);
    });
    expect((await screen.findByRole('tab', { name: /^Elle en détail/u })).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('starts a new creator from the example without its date of birth, its number or its date', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const birth = await screen.findByLabelText('Date de naissance');
    expect(birth).toHaveProperty('value', '');
    expect(screen.queryByText(/ans aujourd’hui/u)).toBeNull();
    expect(screen.queryByText(/^Version /u)).toBeNull();
    expect(screen.getByText('Jamais enregistrée')).toBeDefined();
  });

  it('greets a persona never written calmly, with her name, and flags fields only once she types (CREA-13)', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} creatorName="Léa Martin" canSave timezone="Europe/Paris" />);
    const name = await screen.findByLabelText('Prénom');
    expect(name).toHaveProperty('value', 'Léa');
    expect(screen.getByText(/^\d+ champs? à remplir avant d’enregistrer$/u)).toBeDefined();
    expect(screen.queryByText(/à corriger/u)).toBeNull();
    expect(screen.queryByText('À remplir')).toBeNull();
    expect(screen.getByRole('button', { name: 'Enregistrer une version' })).toHaveProperty('disabled', true);

    fireEvent.change(name, { target: { value: 'Léana' } });
    expect(screen.getByText(/^\d+ champs? à corriger$/u)).toBeDefined();
    expect(screen.getAllByText('À remplir').length).toBeGreaterThan(0);
  });
});

describe('Créatrices › Persona, the tabs past an edge (CREA-01)', () => {
  /** A bar 300 px wide scrolled by `scroll`, its tabs 100 px each, side by side. */
  const barOf = (ids: readonly string[], scroll: number): HTMLElement => {
    const bar = document.createElement('div');
    Object.defineProperties(bar, {
      scrollLeft: { value: scroll },
      clientWidth: { value: 300 },
      scrollWidth: { value: ids.length * 100 },
    });
    ids.forEach((id, index) => {
      const item = document.createElement('button');
      item.dataset['tab'] = id;
      Object.defineProperties(item, { offsetLeft: { value: index * 100 }, offsetWidth: { value: 100 } });
      bar.append(item);
    });
    return bar;
  };

  it('names the tabs hidden on each side, none when they all fit', () => {
    const ids = ['details', 'additional_info', 'in_depth', 'behavior', 'strategies', 'follow_ups'];
    expect(tabsOutOfView(barOf(ids.slice(0, 3), 0))).toEqual({ start: [], end: [] });
    expect(tabsOutOfView(barOf(ids, 0))).toEqual({
      start: [],
      end: ['in_depth', 'behavior', 'strategies', 'follow_ups'],
    });
    expect(tabsOutOfView(barOf(ids, 200))).toEqual({
      start: ['details', 'additional_info', 'in_depth'],
      end: ['strategies', 'follow_ups'],
    });
  });
});
