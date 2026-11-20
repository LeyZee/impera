// @vitest-environment jsdom
import { CreatorIdSchema, PreparedScriptIdSchema, type PlatformScriptViewDto } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RevealScripts } from './RevealScripts';
import { viewOf } from './prepared/fixtures';
import {
  descriptionId,
  IDENTITY_CONTENT,
  identityOf,
  mediaOf,
  revealScriptOf,
  stepOf,
} from './reveal-fixtures';

/* An invented creator and invented Reveal scripts (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');

const shown = (n: number, reviewReasons: 'unsure'[] = [], validated = false) => ({
  id: descriptionId(n),
  detailed: `Description inventée ${String(n)}.`,
  reviewReasons,
  validated,
});

const TO_READ = revealScriptOf(1, {
  name: 'Soirée inventée',
  proposable: false,
  gaps: ['media_not_described', 'identity_not_validated'],
  steps: [
    stepOf(0, 0, [mediaOf('m1', shown(1)), mediaOf('m2', shown(2))]),
    stepOf(1, 1_500, [mediaOf('m3', shown(3, ['unsure']))]),
  ],
});
const TO_NAME = revealScriptOf(2, {
  name: 'Réveil inventé',
  moment: 'day',
  proposable: false,
  gaps: ['identity_not_validated'],
  identity: identityOf(null),
});
const READY = revealScriptOf(3, { name: 'Prêt inventé', identity: identityOf('2026-11-20T01:00:00.000Z') });

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

function serve(
  routes: Record<string, (body: unknown) => Reply>,
): { method: string; path: string; body: unknown }[] {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const LIST = `GET /creators/${CREATOR}/platform-scripts`;
const PREPARED = `GET /creators/${CREATOR}/prepared-scripts`;
/** Each native given recognised as the copy of a script prepared in Impera. */
const ours =
  (...natives: PlatformScriptViewDto[]) =>
  () => ({
    status: 200,
    body: natives.map((native, at) =>
      viewOf({
        id: PreparedScriptIdSchema.parse(`0192f3a0-0000-7000-8000-00000000f0${String(at).padStart(2, '0')}`),
        state: 'matched',
        matchedPlatformScriptId: native.id,
      }),
    ),
  });
const url = (script: PlatformScriptViewDto, what: string) =>
  `POST /creators/${CREATOR}/platform-scripts/${script.id}/${what}`;

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RevealScripts creatorId={CREATOR} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Ses scripts dans Reveal » (ADR 0099 § 4)', () => {
  it('lists only the copies of scripts prepared in Impera, never her other Reveal scripts', async () => {
    const other = revealScriptOf(9, { name: 'Ancien PPV inventé' });
    serve({
      [LIST]: () => ({ status: 200, body: [READY, other] }),
      [PREPARED]: ours(READY),
    });
    show();
    expect(await screen.findByText('1 prêt à proposer sur 1')).toBeDefined();
    expect(screen.getByText(/Prêt inventé/u)).toBeDefined();
    expect(screen.queryByText(/Ancien PPV inventé/u)).toBeNull();
  });

  it('says where a copy comes from while none of ours is recognised yet', async () => {
    serve({
      [LIST]: () => ({ status: 200, body: [revealScriptOf(9, { name: 'Ancien PPV inventé' })] }),
      [PREPARED]: () => ({ status: 200, body: [viewOf()] }),
    });
    show();
    expect(await screen.findByText('Aucun de nos scripts recopié dans Reveal')).toBeDefined();
    expect(screen.getByText(/Ses autres scripts Reveal n’y figurent pas/u)).toBeDefined();
    expect(screen.queryByText(/Ancien PPV inventé/u)).toBeNull();
  });

  it('says what each script lacks, and opens the first to review on its descriptions', async () => {
    serve({
      [LIST]: () => ({ status: 200, body: [TO_READ, TO_NAME, READY] }),
      [PREPARED]: ours(TO_READ, TO_NAME, READY),
    });
    show();
    expect(await screen.findByText('1 prêt à proposer sur 3 · 2 à valider ou importer')).toBeDefined();
    expect(screen.getByText('3 descriptions à valider.')).toBeDefined();
    expect(screen.getByText('Son identité à valider.')).toBeDefined();
    expect(screen.getByText('L’IA peut le proposer.')).toBeDefined();
    const open = screen.getByRole('button', { name: /Soirée inventée/u });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Description inventée 1.')).toBeDefined();
    expect(screen.getByText('L’IA n’est pas sûre')).toBeDefined();
    // Those validated at once, then the one read alone, each group with its count.
    expect(screen.getByText('À relire · 2')).toBeDefined();
    expect(screen.getByText('À regarder de près · 1')).toBeDefined();
    expect(screen.getByText('Étape 1 · Photo 2 sur 2')).toBeDefined();
    // A ready script has nothing to open.
    expect(screen.queryByRole('button', { name: /Prêt inventé/u })).toBeNull();
  });

  it('validates the descriptions with nothing holding them back at once, the doubted one alone', async () => {
    const after = {
      ...TO_READ,
      steps: [
        stepOf(0, 0, [mediaOf('m1', shown(1, [], true)), mediaOf('m2', shown(2, [], true))]),
        stepOf(1, 1_500, [mediaOf('m3', shown(3, ['unsure']))]),
      ],
    };
    const calls = serve({
      [LIST]: () => ({ status: 200, body: [TO_READ] }),
      [PREPARED]: ours(TO_READ),
      [url(TO_READ, 'descriptions/validate')]: () => ({ status: 200, body: after }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Valider les 2 descriptions' }));
    await waitFor(() => {
      expect(screen.getByText('1 description à valider.')).toBeDefined();
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      descriptionIds: [descriptionId(1), descriptionId(2)],
    });
    expect(screen.queryByRole('button', { name: /Valider les/u })).toBeNull();
    expect(screen.getByRole('button', { name: 'Valider celle-ci' })).toBeDefined();
  });

  it('rewrites a description by hand, validated as it is saved', async () => {
    const calls = serve({
      [LIST]: () => ({ status: 200, body: [TO_READ] }),
      [PREPARED]: ours(TO_READ),
      [url(TO_READ, 'descriptions/correct')]: () => ({ status: 200, body: TO_READ }),
    });
    show();
    const item = (await screen.findByText('Description inventée 2.')).closest('li');
    if (item === null) throw new Error('item');
    fireEvent.click(within(item).getByRole('button', { name: 'Corriger' }));
    fireEvent.change(within(item).getByLabelText('Ce que montre la photo'), {
      target: { value: '  Une photo relue par l’agence.  ' },
    });
    fireEvent.click(within(item).getByRole('button', { name: 'Enregistrer et valider' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true);
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      descriptionId: descriptionId(2),
      detailed: 'Une photo relue par l’agence.',
    });
  });

  it('shows the identity the AI wrote and validates it as it is', async () => {
    const calls = serve({
      [LIST]: () => ({ status: 200, body: [TO_NAME] }),
      [PREPARED]: ours(TO_NAME),
      [url(TO_NAME, 'identity/validate')]: () => ({
        status: 200,
        body: { ...TO_NAME, gaps: [], proposable: true, identity: identityOf('2026-11-20T01:00:00.000Z') },
      }),
    });
    show();
    expect(await screen.findByText(IDENTITY_CONTENT.ambiance)).toBeDefined();
    expect(screen.getByText('qui monte')).toBeDefined();
    expect(screen.getByText('il raconte sa soirée')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Valider l’identité' }));
    expect(await screen.findByText('L’IA peut le proposer.')).toBeDefined();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ identityId: identityOf(null).id });
  });

  it('says a refusal as the server words it, and reads the list again', async () => {
    const calls = serve({
      [LIST]: () => ({ status: 200, body: [TO_NAME] }),
      [PREPARED]: ours(TO_NAME),
      [url(TO_NAME, 'identity/validate')]: () => ({
        status: 409,
        body: {
          error: {
            code: 'script_identity_stale_conflict',
            message: 'Le script a changé depuis ta lecture : recharge-le avant de valider son identité',
            details: {},
            requestId: 'r1',
          },
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Valider l’identité' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le script a changé depuis ta lecture : recharge-le avant de valider son identité.',
    );
    expect(
      calls.filter((call) => call.method === 'GET' && call.path.endsWith('platform-scripts')).length,
    ).toBe(2);
  });
});
