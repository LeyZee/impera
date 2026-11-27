// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatorScope, isScoped, scopesCreators } from './CreatorScope';

import { scopeTo } from '@/agent/scope';

const LEA = {
  id: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
  displayName: 'Léa',
  timezone: 'Europe/Paris',
};
const ANA = {
  id: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c2'),
  displayName: 'Ana',
  timezone: 'Europe/Paris',
};

const at = vi.hoisted(() => {
  const search: Record<string, unknown> = {};
  const creators: unknown[] = [];
  return { pathname: '/', search, creators, grave: 0, navigate: vi.fn() };
});

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => at.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: at.pathname, search: at.search } }),
}));
vi.mock('@/creators/api', () => ({ useCreators: () => ({ data: at.creators }) }));
vi.mock('@/screens/tracking/api', () => ({
  todosAcrossQuery: {
    queryKey: ['dashboard', 'todos-across'],
    retry: false,
    queryFn: () =>
      Promise.resolve({
        items: [],
        creators: [{ creatorId: '0192f3a0-0000-7000-8000-0000000000c2', grave: at.grave }],
      }),
  },
}));

const show = (ui: JSX.Element): void => {
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
};
const field = (): HTMLElement => screen.getByRole('combobox', { name: 'Créatrice' });

describe('the creator selector (ADR 0134 § 3)', () => {
  afterEach(() => {
    cleanup();
    act(() => {
      scopeTo(null);
    });
    localStorage.clear();
    at.pathname = '/';
    at.search = {};
    at.creators = [];
    at.grave = 0;
    at.navigate.mockReset();
  });

  it('is the owner’s and an active manager’s, nobody else’s', () => {
    expect(scopesCreators({ role: 'owner', teamScope: 'owner' })).toBe(true);
    expect(scopesCreators({ role: 'operator', teamScope: 'agency' })).toBe(true);
    expect(scopesCreators({ role: 'operator', teamScope: 'self' })).toBe(false);
    expect(scopesCreators({ role: 'creator', teamScope: 'self' })).toBe(false);
  });

  it('applies to the Dashboard, Suivi, Fans and Créatrices', () => {
    expect(['/', '/suivi', '/suivi/fans', '/creatrices', '/entrainer/corrections'].every(isScoped)).toBe(
      true,
    );
    expect(isScoped('/paie')).toBe(false);
  });

  it('opens on « Toutes », lists every creator, and keeps the one chosen', () => {
    at.creators = [LEA, ANA];
    show(<CreatorScope place="rail" />);
    expect(field().textContent).toContain('Toutes');
    fireEvent.click(field());
    // Her face comes first, hidden from a screen reader: the names alone are read.
    expect(
      screen.getAllByRole('option').map((option) => option.querySelector('.nv-select__label')?.textContent),
    ).toEqual(['Toutes', 'Léa', 'Ana']);
    fireEvent.click(screen.getByRole('option', { name: 'Ana' }));
    expect(field().textContent).toContain('Ana');
    expect(localStorage.getItem('impera.creator-scope')).toBe(ANA.id);
    // The Dashboard reads the choice itself: its address is left alone.
    expect(at.navigate).not.toHaveBeenCalled();
  });

  it('says another creator’s urgencies beside her name', async () => {
    at.creators = [LEA, ANA];
    at.grave = 2;
    show(<CreatorScope place="rail" />);
    fireEvent.click(field());
    expect(await screen.findByRole('option', { name: 'Ana 2 urgences' })).toBeTruthy();
  });

  it('opens her sheet on Créatrices, on the tab open, and the list for « Toutes »', () => {
    at.creators = [LEA, ANA];
    at.pathname = '/creatrices';
    at.search = { onglet: 'agenda', creatrice: LEA.id };
    act(() => {
      scopeTo(LEA.id);
    });
    show(<CreatorScope place="rail" />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('option', { name: 'Ana' }));
    expect(at.navigate).toHaveBeenLastCalledWith({
      to: '/creatrices',
      search: { onglet: 'agenda', creatrice: ANA.id },
    });
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('option', { name: 'Toutes' }));
    expect(at.navigate).toHaveBeenLastCalledWith({ to: '/creatrices', search: { onglet: 'agenda' } });
  });

  it('closes the conversation open on Suivi: another creator’s would stay on screen', () => {
    at.creators = [LEA, ANA];
    at.pathname = '/suivi';
    show(<CreatorScope place="rail" />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('option', { name: 'Léa' }));
    expect(at.navigate).toHaveBeenLastCalledWith({ to: '/suivi', search: {}, replace: true });
  });

  it('counts a creator no longer listed as « Toutes », and shows nothing before any creator', () => {
    at.creators = [LEA];
    act(() => {
      scopeTo(ANA.id);
    });
    show(<CreatorScope place="rail" />);
    expect(field().textContent).toContain('Toutes');
    cleanup();
    at.creators = [];
    show(<CreatorScope place="rail" />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('heads the page on a phone only where the choice changes the screen', () => {
    at.creators = [LEA, ANA];
    at.pathname = '/paie';
    show(<CreatorScope place="page" />);
    expect(screen.queryByRole('combobox')).toBeNull();
    cleanup();
    at.pathname = '/suivi/fans';
    show(<CreatorScope place="page" />);
    expect(field()).toBeTruthy();
  });
});
