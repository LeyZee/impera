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

  // Audit de sécurité du 02/11 (M1): her persona speaks to every fan, an old sign-in confirms the password first.
  it('asks for the password again when the sign-in is too old to activate, and lets it go on cancel', async () => {
    await serveVersions([NEWEST, OLDER], () => [
      403,
      { error: { code: 'reauthentication_forbidden', message: 'x', details: {}, requestId: 'r' } },
    ]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activer la version 0.2.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’activation' }));

    expect(await screen.findByText(/pour l’activer, confirme ton mot de passe/u)).toBeDefined();
    expect(screen.queryByText(/Seuls le propriétaire et la créatrice/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText(/pour l’activer, confirme ton mot de passe/u)).toBeNull();
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
    // Typed day first, never the browser's own order (recette 05/11, PRO-11).
    expect(birth.getAttribute('type')).toBe('text');
    expect(birth.getAttribute('placeholder')).toBe('jj/mm/aaaa');
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

describe('Créatrices › Persona, her date of birth (recette PRO-04, reco 22)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks her age on the day of the save, never on the date of the last version', async () => {
    // The stored version is of 28/10; she turns 18 on 05/11, the day of the save.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
    await serve([201, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const birth = await screen.findByLabelText('Date de naissance');
    fireEvent.change(birth, { target: { value: '2008-11-05' } });
    expect(screen.queryByText(/au moins 18 ans/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Enregistrer une version' })).toHaveProperty('disabled', false);

    fireEvent.change(birth, { target: { value: '2008-11-06' } });
    expect(await screen.findByText(/au moins 18 ans/u)).toBeDefined();
  });

  it('says a date of birth 100 years back is a typo', async () => {
    await serve([201, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    fireEvent.change(await screen.findByLabelText('Date de naissance'), { target: { value: '1890-01-01' } });
    expect(await screen.findByText(/vérifie l’année de naissance/u)).toBeDefined();
  });
});

/** A persona file as picked in « Importer un fichier »: the demo, renumbered and renamed, or any text. */
const draftFile = (text: string, name = 'brouillon.yaml'): File =>
  new File([text], name, { type: 'text/yaml' });
const DRAFT_YAML = blocksYaml
  .replace('version: 0.2.0', 'version: 1.0.0')
  .replace('first_name: Elena', 'first_name: Zoé');

const pick = (file: File): void => {
  fireEvent.change(screen.getByLabelText('Fichier de persona'), { target: { files: [file] } });
};

/** The file names Zoé on Elena's sheet: asked first (PRO-27), then taken. */
const anyway = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'L’importer quand même' }));
};

describe('Créatrices › Persona, « Importer un fichier »', () => {
  it('asks before taking another creator’s file, and changes nothing when told no (recette 05/11, PRO-27)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');
    pick(draftFile(DRAFT_YAML));

    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain(
      'Ce fichier est celui de Zoé (demo) : l’importer sur la fiche d’Elena ?',
    );
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elena');
    fireEvent.click(within(ask).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elena');
    expect(screen.queryByText(/^Importé de/u)).toBeNull();

    // Her own file, renumbered: taken at once.
    pick(draftFile(blocksYaml.replace('version: 0.2.0', 'version: 1.0.0')));
    expect(await screen.findByText(/^Importé de « brouillon\.yaml »/u)).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('puts the file in the draft to read, then saves it under its own number, never active', async () => {
    const fake = await serveVersions([SUMMARY], () => [201, { ...NEWEST, version: '1.0.0' }]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');
    pick(draftFile(DRAFT_YAML));
    await anyway();

    expect(
      await screen.findByText(
        'Importé de « brouillon.yaml » : relis chaque onglet avant d’enregistrer. Ce sera la version 1.0.0, inactive jusqu’à ce que tu l’actives.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Zoé');
    // The head still says her stored version, and nothing was sent.
    expect(screen.getByText('Version 0.2.0')).toBeDefined();
    // Her first name, and the file's own number and date: the fields the file changes.
    expect(screen.getByText(/^\d+ modifications, prête à enregistrer$/u)).toBeDefined();
    expect(fake.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    // What waits on screen is never replaced by a file: « Tout annuler » first.
    expect(screen.queryByRole('button', { name: 'Importer un fichier' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));
    await waitFor(() => {
      expect(fake.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    });
    const [url, init] = fake.mock.calls.find(([, i]) => i?.method === 'POST') ?? [];
    expect(url).toBe(`/v1/creators/${CREATOR}/persona/versions`);
    if (typeof init?.body !== 'string') throw new Error('a save sends its body as JSON text');
    const body: unknown = JSON.parse(init.body);
    expect(body).toMatchObject({
      basedOn: SUMMARY.contentHash,
      persona: { meta: { version: '1.0.0', creator: CREATOR }, details: { first_name: 'Zoé' } },
    });
  });

  it('undoes an import with « Tout annuler », and numbers a file older than her versions after them', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');
    pick(draftFile(DRAFT_YAML.replace('version: 1.0.0', 'version: 0.1.0')));
    await anyway();
    expect(await screen.findByText(/Ce sera la version 0\.2\.1,/u)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Tout annuler' }));
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elena');
    expect(screen.queryByText(/^Importé de/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Importer un fichier' })).toBeDefined();
  });

  it('says what a file lacks and where, or that it is not a persona, and changes nothing', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Prénom');

    pick(draftFile(DRAFT_YAML.replace('first_name: Zoé', 'first_name: ""')));
    expect(
      await screen.findByText(
        'Ce fichier ne passe pas la vérification de la persona : un problème, dans « Détails » (details.first_name) : À remplir. Rien n’a changé.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elena');

    pick(draftFile('meta: [ pas du yaml', 'notes.txt'));
    expect(
      await screen.findByText(
        'Ce fichier ne se lit pas comme une persona : il faut le fichier YAML de sa fiche. Rien n’a changé.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elena');
  });

  it('offers no import to a chatter, nor before a creator exists', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    const { unmount } = render(
      <PersonaSection creatorId={CREATOR} canSave={false} timezone="Europe/Paris" />,
    );
    await screen.findByLabelText('Prénom');
    expect(screen.queryByRole('button', { name: 'Importer un fichier' })).toBeNull();
    unmount();

    render(<PersonaSection creatorId={null} canSave timezone={null} />);
    await screen.findByLabelText('Prénom');
    expect(screen.queryByRole('button', { name: 'Importer un fichier' })).toBeNull();
  });

  it('starts her first version from a file, under the number it carries', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    expect(await screen.findByText(/deviendra sa version 0\.0\.1\./u)).toBeDefined();
    pick(draftFile(DRAFT_YAML));
    await anyway();
    expect(await screen.findByText(/deviendra sa version 1\.0\.0\./u)).toBeDefined();
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Zoé');
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
