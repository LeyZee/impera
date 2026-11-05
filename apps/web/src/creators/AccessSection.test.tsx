// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessSection } from './AccessSection';

/* An invented creator: no real data. */
const NORA = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000d4');
const LINK = {
  url: 'https://app.example.test/bienvenue#t=jeton-invente',
  expiresAt: '2030-01-04T12:00:00.000Z',
};

type Account = { email: string; invitationPending: boolean; invitationExpiresAt: string | null } | null;

/** Her account as the server answers it, in turn, and what each link request answers. */
function serve(accounts: Account[], link: { status: number; body: unknown } = { status: 200, body: LINK }) {
  let read = 0;
  const sent: unknown[] = [];
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url === `/v1/creators/${NORA}/account`) {
        const account = accounts[Math.min(read, accounts.length - 1)] ?? null;
        read += 1;
        return json({ account });
      }
      if (url === `/v1/creators/${NORA}/invitation-link` && init?.method === 'POST') {
        sent.push(JSON.parse(typeof init.body === 'string' ? init.body : ''));
        return json(link.body, link.status);
      }
      return json({}, 404);
    }),
  );
  return sent;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AccessSection creatorId={NORA} creatorName="Nora" />
    </QueryClientProvider>,
  );
}

const refusal = (code: string) => ({ error: { code, message: 'Refusé', details: {}, requestId: 'r1' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccessSection (CR-02)', () => {
  it('makes her account with her e-mail, then keeps the link on screen while her account is read again', async () => {
    const sent = serve([
      null,
      { email: 'nora@example.test', invitationPending: true, invitationExpiresAt: LINK.expiresAt },
    ]);
    show();
    expect(await screen.findByText(/n’a pas encore de compte/u)).toBeDefined();
    const make = screen.getByRole('button', { name: 'Créer son lien' });
    // No link without an e-mail that reads as one.
    expect(make).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Son e-mail'), { target: { value: ' nora@example.test ' } });
    expect(make).toHaveProperty('disabled', false);
    fireEvent.click(make);

    expect(await screen.findByRole('textbox', { name: 'Lien à envoyer' })).toHaveProperty('value', LINK.url);
    expect(sent).toEqual([{ purpose: 'invitation', email: 'nora@example.test' }]);
    await waitFor(() => {
      expect(screen.getByText(/Lien d’invitation créé pour nora@example.test/u)).toBeDefined();
    });
    // Still there once her account says « invited »: the owner has not copied it yet.
    expect(screen.getByRole('textbox', { name: 'Lien à envoyer' })).toBeDefined();
    // Her welcome names her space, never the team.
    expect(screen.getByText(/« Nora, ton espace t’attend\. Choisis ton mot de passe ici : »/u)).toBeDefined();
    expect(screen.queryByText(/équipe/u)).toBeNull();
  });

  it('gives her a new password once she is in', async () => {
    const sent = serve([{ email: 'nora@example.test', invitationPending: false, invitationExpiresAt: null }]);
    show();
    expect(await screen.findByText(/Elle se connecte avec nora@example.test/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Lien de nouveau mot de passe' }));
    await screen.findByRole('textbox', { name: 'Lien à envoyer' });
    expect(sent).toEqual([{ purpose: 'reset' }]);
    expect(screen.getByText(/« Nora, choisis ton nouveau mot de passe ici : »/u)).toBeDefined();
  });

  it('offers a new link when hers expired unopened, with the same e-mail', async () => {
    const sent = serve([
      {
        email: 'nora@example.test',
        invitationPending: true,
        invitationExpiresAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    show();
    expect(await screen.findByText(/a expiré sans être utilisé/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau lien' }));
    await screen.findByRole('textbox', { name: 'Lien à envoyer' });
    expect(sent).toEqual([{ purpose: 'invitation', email: 'nora@example.test' }]);
  });

  it('corrects her e-mail before her first sign-in, never after (ADR 0071 § 3)', async () => {
    const sent = serve([
      { email: 'nora@exmaple.test', invitationPending: true, invitationExpiresAt: LINK.expiresAt },
      { email: 'nora@example.test', invitationPending: true, invitationExpiresAt: LINK.expiresAt },
    ]);
    show();
    const field = await screen.findByLabelText('Son e-mail');
    expect(field).toHaveProperty('value', 'nora@exmaple.test');
    expect(screen.queryByText(/ancien lien cessera de marcher/u)).toBeNull();
    fireEvent.change(field, { target: { value: 'nora@example' } });
    const make = screen.getByRole('button', { name: 'Corriger et créer son lien' });
    expect(make).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: ' nora@example.test ' } });
    expect(screen.getByText(/ancien lien cessera de marcher/u)).toBeDefined();
    fireEvent.click(make);
    await screen.findByRole('textbox', { name: 'Lien à envoyer' });
    expect(sent).toEqual([{ purpose: 'invitation', email: 'nora@example.test' }]);
    await waitFor(() => {
      expect(screen.getByLabelText('Son e-mail')).toHaveProperty('value', 'nora@example.test');
    });

    cleanup();
    serve([{ email: 'nora@example.test', invitationPending: false, invitationExpiresAt: null }]);
    show();
    await screen.findByText(/Elle se connecte avec nora@example.test/u);
    expect(screen.queryByLabelText('Son e-mail')).toBeNull();
  });

  it('says a refusal in its own words, and asks for the password when the sign-in is not recent', async () => {
    serve([null], { status: 409, body: refusal('account_email_conflict') });
    show();
    fireEvent.change(await screen.findByLabelText('Son e-mail'), { target: { value: 'pris@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer son lien' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Un autre compte utilise déjà cet e-mail.');

    cleanup();
    serve([null], { status: 403, body: refusal('reauthentication_forbidden') });
    show();
    fireEvent.change(await screen.findByLabelText('Son e-mail'), { target: { value: 'nora@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer son lien' }));
    expect(await screen.findByText(/confirme ton mot de passe et ton code/u)).toBeDefined();
  });
});
