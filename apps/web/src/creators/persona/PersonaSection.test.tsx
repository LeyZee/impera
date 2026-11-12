// @vitest-environment jsdom
import { PersonaSchema, personaSheetFromV1, type PersonaV2 } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

import formerYaml from '../../../../../personas/demo/v0.2.0.yaml?raw';
import demoYaml from '../../../../../personas/demo/v0.3.0.yaml?raw';

import { PersonaSection } from './PersonaSection';
import { parsePersonaYaml } from './source';

/** Her stored version: the demo, under the number of the newest summary. */
const stored = (): Promise<PersonaV2> =>
  parsePersonaYaml(demoYaml.replace('version: 0.3.0', 'version: 0.2.0'));

/** A version stored at format 2: the draft is the version itself, nothing moved (ADR 0079 § 5). */
const asDraft = (persona: PersonaV2) => ({ draft: persona, moved: [] });

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
  const persona = await stored();
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify(saved[1]), { status: saved[0] }));
    }
    if (url === `/v1/creators/${CREATOR}/persona`) {
      const overview = {
        creatorId: CREATOR,
        latest: { summary: SUMMARY, persona, ...asDraft(persona) },
        versions: [SUMMARY],
      };
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

/** A panel of her sheet, by its title: its header is a button that folds it. */
const panel = (title: string): HTMLElement => {
  const toggle = screen.getByText(title, { selector: '.ps-sheet-panel__title' }).closest('button');
  if (toggle === null) throw new Error(`« ${title} » has a toggle`);
  return toggle;
};

describe('Créatrices › Persona, Desirali’s sheet (ADR 0079)', () => {
  it('shows how complete she is out of 59, and opens the panel of a question still to answer', async () => {
    await serve([500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const gauge = await screen.findByRole('progressbar', { name: 'Complétude de la fiche' });
    // The demo leaves her weight and her number of partners unanswered: 57 of 59.
    expect(gauge.getAttribute('aria-valuenow')).toBe('97');
    expect(gauge.getAttribute('aria-valuetext')).toBe('57 questions sur 59');
    const missing = screen.getByText(/^À compléter\s:$/u).parentElement;
    if (missing === null) throw new Error('the panels still to complete have a line');
    expect(
      within(missing)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Identité et informations de base (1)', 'Relations (1)']);

    expect(panel('Relations').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(tab('Réglages de l’agent'));
    fireEvent.click(within(missing).getByRole('button', { name: 'Relations (1)' }));
    expect(tab('Sa fiche').getAttribute('aria-selected')).toBe('true');
    expect(panel('Relations').getAttribute('aria-expanded')).toBe('true');

    fireEvent.change(screen.getByLabelText('Passions'), { target: { value: '' } });
    expect(gauge.getAttribute('aria-valuetext')).toBe('56 questions sur 59');
  });

  it('opens on her identity, the six other panels folded, the agent’s settings in their own tab', async () => {
    await serve([500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Sa fiche', 'Réglages de l’agent']);
    const toggles = screen.getAllByRole('button', { expanded: false });
    expect(toggles.map((t) => t.querySelector('.ps-sheet-panel__title')?.textContent)).toEqual([
      'Mode de vie',
      'Préférences',
      'Style de conversation',
      'Relations',
      'Intimité',
    ]);
    expect(panel('Identité et informations de base').getAttribute('aria-expanded')).toBe('true');
    // « Zones interdites » has no title at Desirali: an open plate, its one question in view.
    expect(screen.getByLabelText('Zones interdites')).toBeDefined();
    expect(panel('Identité et informations de base').textContent).toContain('14/15');

    fireEvent.click(tab('Réglages de l’agent'));
    const settings = screen.getByRole('tabpanel');
    expect([...settings.querySelectorAll('.ps-block__title')].map((t) => t.firstChild?.textContent)).toEqual([
      'Stratégies',
      'Relances',
      'Te prévenir quand',
      'Mots-clés d’alerte',
      'Comportement',
      'Règles strictes',
    ]);
  });

  it('puts a 422 on the lines of « Réponses typiques » the agent would not send, until that text changes', async () => {
    const fake = await serve(refusal([{ index: 1, code: 'ai_disclosure' }]));
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    fireEvent.change(screen.getByLabelText('Passions'), { target: { value: 'La danse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));

    const refused = 'L’agent ne les enverrait pas : ligne 2 (un aveu d’IA). Corrige ou retire cette ligne.';
    expect(await screen.findByText(refused)).toBeDefined();
    expect(screen.getByText('1 champ à corriger')).toBeDefined();
    expect(within(tab('Sa fiche')).getByLabelText('1 à corriger')).toBeDefined();
    expect(within(panel('Style de conversation')).getByLabelText('1 à corriger')).toBeDefined();
    expect(fake.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);

    // Another edit leaves the refusal where it is; « Réponses typiques » changed lifts it.
    fireEvent.change(screen.getByLabelText('Passions'), { target: { value: 'La danse, le yoga' } });
    expect(screen.getByText(refused)).toBeDefined();
    fireEvent.change(screen.getByLabelText('Réponses typiques'), {
      target: { value: 'Il dit bonjour : coucou toi' },
    });
    expect(screen.queryByText(refused)).toBeNull();
  });

  it('says a refusal it cannot read as a failed save', async () => {
    await serve(refusal([{ index: 999, code: 'ai_disclosure' }]));
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    fireEvent.change(screen.getByLabelText('Passions'), { target: { value: 'La danse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));
    expect(await screen.findByText(/L’enregistrement n’a pas abouti/u)).toBeDefined();
  });

  it('opens a version stored at format 1 converted, says what moved, and saves it as it is', async () => {
    const former = PersonaSchema.parse(parse(formerYaml));
    const { persona: draft, moved } = personaSheetFromV1(former);
    const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
      if (init?.method === 'POST')
        return Promise.resolve(new Response(JSON.stringify(NEWEST), { status: 201 }));
      const latest = { summary: SUMMARY, persona: former, draft, moved };
      return Promise.resolve(
        new Response(JSON.stringify({ creatorId: CREATOR, latest, versions: [SUMMARY] }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fake);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    expect(await screen.findByLabelText('Surnom')).toHaveProperty('value', 'Elena');
    expect(moved.length).toBeGreaterThan(0);
    const moves = screen.getByText('Passage à la nouvelle fiche').closest('details');
    if (moves === null) throw new Error('what moved is a fold');
    expect(within(moves).getAllByRole('button')).toHaveLength(moved.length);

    const save = screen.getByRole('button', { name: 'Enregistrer une version' });
    expect(save).toHaveProperty('disabled', false);
    fireEvent.click(save);
    await waitFor(() => {
      expect(fake.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    });
    const [, init] = fake.mock.calls.find(([, i]) => i?.method === 'POST') ?? [];
    if (typeof init?.body !== 'string') throw new Error('a save sends its body as JSON text');
    expect(JSON.parse(init.body)).toMatchObject({ persona: { meta: { schema: 2, version: '0.2.1' } } });
  });
});

/** Her stored versions (newest first), the demo as the newest one's content; POSTs answer `answer`. */
async function serveVersions(
  versions: readonly (typeof SUMMARY)[],
  answer: (url: string) => readonly [number, unknown],
) {
  const persona = await stored();
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) => {
    if (init?.method === 'POST') {
      const [status, body] = answer(url);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }
    if (url === `/v1/creators/${CREATOR}/persona`) {
      const latest =
        versions[0] === undefined ? null : { summary: versions[0], persona, ...asDraft(persona) };
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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activer' }));

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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activer' }));

    expect(await screen.findByText(/Pour l’activer, confirme ton mot de passe/u)).toBeDefined();
    expect(screen.queryByText(/Seuls le propriétaire et la créatrice/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByText(/Pour l’activer, confirme ton mot de passe/u)).toBeNull();
  });

  it('says nothing of the state while nothing waits, and says the changes once there are some (CREA-05)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const name = await screen.findByLabelText('Surnom');
    expect(screen.queryByText('Aucune modification')).toBeNull();
    expect(screen.queryByText(/Tout est décrit/u)).toBeNull();
    fireEvent.change(name, { target: { value: 'Elenaa' } });
    expect(screen.getByText('1 modification, prête à enregistrer')).toBeDefined();
  });

  it('says the agent writes with her active version, and nothing without one (recette G4)', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const note = await screen.findByText(/C’est avec elle que l’agent écrit ses brouillons/u);
    expect(note.textContent).toContain('Version active\u00a0: 0.2.0.');
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
    const name = await screen.findByLabelText('Surnom');
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
    fireEvent.change(await screen.findByLabelText('Passions'), { target: { value: 'La danse' } });
    fireEvent.click(tab('Réglages de l’agent'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer une version' }));
    await waitFor(() => {
      expect(saved).toBe(true);
    });
    await waitFor(() => {
      expect(fake.mock.calls.filter(([url]) => url === `/v1/creators/${CREATOR}/persona`)).toHaveLength(2);
    });
    expect(
      (await screen.findByRole('tab', { name: /^Réglages de l’agent/u })).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('starts a new creator from the example without its date of birth, its number or its date', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const birth = await screen.findByLabelText('Date de naissance');
    expect(birth).toHaveProperty('value', '');
    // Typed day first, never the browser's own order (recette 05/11, PRO-11).
    expect(birth.getAttribute('type')).toBe('text');
    expect(birth.getAttribute('placeholder')).toBe('jj/mm/aaaa');
    expect(screen.queryByText(/^\d+ ans$/u)).toBeNull();
    expect(screen.queryByText(/^Version /u)).toBeNull();
    expect(screen.getByText('Jamais enregistrée')).toBeDefined();
  });

  it('greets a persona never written calmly, with her name, and flags fields only once she types (CREA-13)', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} creatorName="Léa Martin" canSave timezone="Europe/Paris" />);
    const name = await screen.findByLabelText('Surnom');
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

describe('Créatrices › Persona, « Ses versions » (recette AGT-07)', () => {
  const FIRST = {
    ...SUMMARY,
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c3f',
    version: '0.0.1',
    contentHash: 'c'.repeat(64),
    isActive: false,
    createdAt: '2026-10-20T08:00:00.000Z',
  };
  /** A bad 0.2.0 made active: the 0.1.0 before it is the one to go back to. */
  const BAD = { ...NEWEST, isActive: true };
  const PREVIOUS = { ...OLDER, isActive: false };

  const versionsFold = () => {
    const title = screen.getByText('Ses versions');
    const fold = title.closest('details');
    if (fold === null) throw new Error('« Ses versions » is a fold');
    return fold;
  };

  it('puts an older version back in service over the active one, once its dialog says « Activer »', async () => {
    const fake = await serveVersions([BAD, PREVIOUS, FIRST], () => [200, { ...PREVIOUS, isActive: true }]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    const fold = versionsFold();
    expect(fold.open).toBe(false);
    expect(within(fold).getByText('3 versions · active : 0.2.0')).toBeDefined();
    // Every older version offers it, the active one says so, the head offers nothing (its newest is active).
    expect(within(fold).getByRole('button', { name: 'Réactiver la version 0.0.1' })).toBeDefined();
    expect(within(fold).getByText('Active')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^Activer la version/u })).toBeNull();

    fireEvent.click(within(fold).getByRole('button', { name: 'Réactiver la version 0.1.0' }));
    expect(fake.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    const dialog = screen.getByRole('dialog', { name: 'Activer la version 0.1.0' });
    expect(within(dialog).getByText(/à la place de la version 0\.2\.0/u)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Activer' }));

    expect(await screen.findByText('Version 0.1.0 marquée active')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    const [url, init] = fake.mock.calls.find(([, i]) => i?.method === 'POST') ?? [];
    expect(url).toBe(`/v1/creators/${CREATOR}/persona/versions/${PREVIOUS.id}/activate`);
    expect(init?.body).toBe(JSON.stringify({ expectedActive: BAD.id }));
  });

  it('asks for the password, then puts back the version it was asked for', async () => {
    let calls = 0;
    const fake = await serveVersions([BAD, PREVIOUS], () => {
      calls += 1;
      return calls === 1
        ? [403, { error: { code: 'reauthentication_forbidden', message: 'x', details: {}, requestId: 'r' } }]
        : [200, { ...PREVIOUS, isActive: true }];
    });
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    fireEvent.click(within(versionsFold()).getByRole('button', { name: 'Réactiver la version 0.1.0' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activer' }));
    expect(await screen.findByRole('dialog', { name: 'Activer la version 0.1.0' })).toBeDefined();
    const activations = fake.mock.calls.filter(([url]) => url.endsWith('/activate'));
    expect(activations.map(([url]) => url)).toEqual([
      `/v1/creators/${CREATOR}/persona/versions/${PREVIOUS.id}/activate`,
    ]);
  });

  it('keeps what is typed and not saved when an older version is put back', async () => {
    const fake = await serveVersions([BAD, PREVIOUS], () => [200, { ...PREVIOUS, isActive: true }]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    fireEvent.change(await screen.findByLabelText('Surnom'), { target: { value: 'Elenaa' } });
    fireEvent.click(within(versionsFold()).getByRole('button', { name: 'Réactiver la version 0.1.0' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activer' }));
    // The page reads her versions again; the draft, the newest version's content, stays as typed.
    await waitFor(() => {
      expect(fake.mock.calls.filter(([url]) => url === `/v1/creators/${CREATOR}/persona`)).toHaveLength(2);
    });
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elenaa');
    expect(screen.getByText('1 modification, prête à enregistrer')).toBeDefined();
  });

  it('says why a version stored before a guard changed is not put back', async () => {
    await serveVersions([BAD, PREVIOUS], () => [
      422,
      {
        error: {
          code: 'persona_sample_reply_unprocessable',
          message: 'x',
          details: { faults: [{ index: 0, code: 'ai_disclosure' }] },
          requestId: 'r',
        },
      },
    ]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    fireEvent.click(within(versionsFold()).getByRole('button', { name: 'Réactiver la version 0.1.0' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activer' }));
    expect(
      await screen.findByText(/La version 0.1.0 n’est pas activée : une de ses réponses typiques/u),
    ).toBeDefined();
    expect(screen.queryByText(/Impera ne répond pas/u)).toBeNull();
  });

  it('lets a manager read the list without any button, and shows nothing for one version', async () => {
    await serveVersions([BAD, PREVIOUS], () => [500, {}]);
    const { unmount } = render(
      <PersonaSection creatorId={CREATOR} canSave={false} timezone="Europe/Paris" />,
    );
    await screen.findByLabelText('Surnom');
    expect(within(versionsFold()).queryByRole('button')).toBeNull();
    expect(within(versionsFold()).getByText(/Seul le propriétaire choisit la version/u)).toBeDefined();
    unmount();

    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    expect(screen.queryByText('Ses versions')).toBeNull();
  });

  it('leaves the newest inactive version to the head, never twice', async () => {
    await serveVersions([NEWEST, OLDER], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    expect(await screen.findByRole('button', { name: 'Activer la version 0.2.0' })).toBeDefined();
    expect(within(versionsFold()).getByText('La plus récente')).toBeDefined();
    expect(within(versionsFold()).queryByRole('button')).toBeNull();
  });
});

describe('Créatrices › Persona, her date of birth (recette PRO-04, reco 22)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks her age on the day of the save, never on the date of the last version', async () => {
    // The stored version is of 28/10; she turns 18 on 05/11, the day of the save. Typed day first (PRO-11).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 5, 12));
    await serve([201, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    const birth = await screen.findByLabelText('Date de naissance');
    fireEvent.change(birth, { target: { value: '05/11/2008' } });
    expect(screen.queryByText(/au moins 18 ans/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Enregistrer une version' })).toHaveProperty('disabled', false);

    fireEvent.change(birth, { target: { value: '06/11/2008' } });
    expect(await screen.findByText(/au moins 18 ans/u)).toBeDefined();
  });

  it('says a date of birth 100 years back is a typo', async () => {
    await serve([201, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    fireEvent.change(await screen.findByLabelText('Date de naissance'), { target: { value: '01/01/1920' } });
    expect(await screen.findByText(/vérifie l’année de naissance/u)).toBeDefined();
  });
});

/** A persona file as picked in « Importer un fichier »: the demo, renumbered and renamed, or any text. */
const draftFile = (text: string, name = 'brouillon.yaml'): File =>
  new File([text], name, { type: 'text/yaml' });
const DRAFT_YAML = demoYaml
  .replace('version: 0.3.0', 'version: 1.0.0')
  .replace('nickname: Elena', 'nickname: Zoé');

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
    await screen.findByLabelText('Surnom');
    pick(draftFile(DRAFT_YAML));

    const ask = await screen.findByRole('alertdialog');
    expect(ask.textContent).toContain(
      'Ce fichier est celui de Zoé (demo) : l’importer sur la fiche d’Elena ?',
    );
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elena');
    fireEvent.click(within(ask).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elena');
    expect(screen.queryByText(/^Importé de/u)).toBeNull();

    // Her own file, renumbered: taken at once.
    pick(draftFile(demoYaml.replace('version: 0.3.0', 'version: 1.0.0')));
    expect(await screen.findByText(/^Importé de « brouillon\.yaml »/u)).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('puts the file in the draft to read, then saves it under its own number, never active', async () => {
    const fake = await serveVersions([SUMMARY], () => [201, { ...NEWEST, version: '1.0.0' }]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    pick(draftFile(DRAFT_YAML));
    await anyway();

    expect(
      await screen.findByText(
        'Importé de « brouillon.yaml » : relis chaque panneau avant d’enregistrer. Ce sera la version 1.0.0, inactive jusqu’à ce que tu l’actives.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Zoé');
    // The head still says her stored version, and nothing was sent.
    expect(screen.getByText('Version 0.2.0')).toBeDefined();
    // Her nickname, and the file's own number and date: the fields the file changes.
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
      persona: {
        meta: { schema: 2, version: '1.0.0', creator: CREATOR },
        sheet: { identity: { nickname: 'Zoé' } },
      },
    });
  });

  it('undoes an import with « Tout annuler », and numbers a file older than her versions after them', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');
    pick(draftFile(DRAFT_YAML.replace('version: 1.0.0', 'version: 0.1.0')));
    await anyway();
    expect(await screen.findByText(/Ce sera la version 0\.2\.1,/u)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Tout annuler' }));
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elena');
    expect(screen.queryByText(/^Importé de/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Importer un fichier' })).toBeDefined();
  });

  it('says what a file lacks and where, or that it is not a persona, and changes nothing', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    await screen.findByLabelText('Surnom');

    pick(draftFile(DRAFT_YAML.replace('nickname: Zoé', 'nickname: ""')));
    expect(
      await screen.findByText(
        'Ce fichier ne passe pas la vérification de la persona : un problème, dans « Identité et informations de base » (sheet.identity.nickname) : À remplir. Rien n’a changé.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elena');

    pick(draftFile('meta: [ pas du yaml', 'notes.txt'));
    expect(
      await screen.findByText(
        'Ce fichier ne se lit pas comme une persona : il faut le fichier YAML de sa fiche. Rien n’a changé.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elena');
  });

  it('offers no import to a chatter, nor before a creator exists', async () => {
    await serveVersions([SUMMARY], () => [500, {}]);
    const { unmount } = render(
      <PersonaSection creatorId={CREATOR} canSave={false} timezone="Europe/Paris" />,
    );
    await screen.findByLabelText('Surnom');
    expect(screen.queryByRole('button', { name: 'Importer un fichier' })).toBeNull();
    unmount();

    render(<PersonaSection creatorId={null} canSave timezone={null} />);
    await screen.findByLabelText('Surnom');
    expect(screen.queryByRole('button', { name: 'Importer un fichier' })).toBeNull();
  });

  it('starts her first version from a file, under the number it carries', async () => {
    await serveVersions([], () => [500, {}]);
    render(<PersonaSection creatorId={CREATOR} canSave timezone="Europe/Paris" />);
    expect(await screen.findByText(/deviendra sa version 0\.0\.1\./u)).toBeDefined();
    // Her nickname not written yet: nothing tells the file from hers, it is taken at once.
    pick(draftFile(DRAFT_YAML));
    expect(await screen.findByText(/deviendra sa version 1\.0\.0\./u)).toBeDefined();
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Zoé');
  });
});
