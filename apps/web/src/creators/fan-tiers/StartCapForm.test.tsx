// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StartCapForm } from './StartCapForm';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/* An invented creator and an invented setting (ADR 0010): never the agency's own. */
const CREATOR = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const REAUTH = {
  status: 403,
  body: {
    error: {
      code: 'reauthentication_forbidden',
      message: 'reauthentication_forbidden',
      details: {},
      requestId: 'r',
    },
  },
};

let stored: unknown;
let answer: { status: number; body: unknown };
const writes: unknown[] = [];

beforeEach(() => {
  stored = {};
  answer = { status: 200, body: {} };
  writes.length = 0;
  confirmIdentity.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'PUT') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        writes.push(body);
        if (answer.status === 200) stored = body;
        return json(answer.status === 200 ? body : answer.body, answer.status);
      }
      if (input.endsWith('/staircase')) return json(stored);
      return json({ passkeys: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StartCapForm creatorId={CREATOR} />
    </QueryClientProvider>,
  );
}

describe('Créatrices › Compte › Paliers de ses fans › Plafond au lancement', () => {
  it('says what the cap is, empty when unset, and the line of error for a wrong number', async () => {
    show();
    const field = await screen.findByLabelText<HTMLInputElement>('Plafond au lancement');
    expect(field.value).toBe('');
    expect(screen.getByText(/plus gros achat que le fan a pris/u)).toBeDefined();
    fireEvent.change(field, { target: { value: '1' } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Un multiple au-dessus de 1, jusqu’à 10, ou rien pour couper le plafond.',
    );
    expect(screen.getByRole('button', { name: 'Enregistrer le plafond' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('asks for the password and the code before saving it, then saves the same once confirmed (EQ-15)', async () => {
    answer = REAUTH;
    confirmIdentity.mockImplementation(() => {
      answer = { status: 200, body: {} };
      return Promise.resolve('ok');
    });
    show();
    fireEvent.change(await screen.findByLabelText('Plafond au lancement'), { target: { value: '1,25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le plafond' }));
    expect(
      await screen.findByText('Ce geste touche à l’argent : confirme ton mot de passe et ton code.'),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mot-de-passe-invente' } });
    fireEvent.change(screen.getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByText('Plafond enregistré.')).toBeDefined();
    expect(writes).toEqual([{ startCapMultiple: 1.25 }, { startCapMultiple: 1.25 }]);
  });

  it('saves an empty field as no cap', async () => {
    stored = { startCapMultiple: 1.25 };
    show();
    const field = await screen.findByLabelText<HTMLInputElement>('Plafond au lancement');
    expect(field.value).toBe('1,25');
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le plafond' }));
    expect(await screen.findByText('Plafond enregistré.')).toBeDefined();
    expect(writes).toEqual([{}]);
  });
});
