// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RailCount } from './RailCount';

const read = vi.hoisted(() => ({ todos: 3, fails: false, statements: 0 }));

vi.mock('@/screens/tracking/api', () => ({
  todosAcrossQuery: {
    queryKey: ['dashboard', 'todos-across'],
    retry: false,
    queryFn: () =>
      read.fails
        ? Promise.reject(new Error('GET /v1/dashboard/todos: 500'))
        : Promise.resolve({ items: Array.from({ length: read.todos }, (_, index) => ({ index })) }),
  },
}));
vi.mock('@/screens/pay/data', () => ({ useValidateCount: () => read.statements }));
vi.mock('@/reports/api', () => ({ useReports: () => ({ data: undefined }) }));

const show = (ui: JSX.Element): void => {
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
};

describe('the count of a tab of the rail (ADR 0134 § 8)', () => {
  afterEach(() => {
    cleanup();
    read.todos = 3;
    read.fails = false;
    read.statements = 0;
  });

  it('says how many conversations wait on Suivi, in figures and in words for a screen reader', async () => {
    show(<RailCount section="/suivi" />);
    expect((await screen.findByText('3')).getAttribute('title')).toBe('3 conversations à traiter');
    expect(screen.getByText(', 3 conversations à traiter').className).toBe('sr-only');
  });

  it('writes one in the singular, and caps a long queue at « 99+ »', async () => {
    read.todos = 1;
    show(<RailCount section="/suivi" />);
    expect((await screen.findByText('1')).getAttribute('title')).toBe('1 conversation à traiter');
    cleanup();
    read.todos = 140;
    show(<RailCount section="/suivi" />);
    expect((await screen.findByText('99+')).getAttribute('title')).toBe('140 conversations à traiter');
  });

  it('shows the tab bare when nothing waits, and when the read fails: never a wrong figure', async () => {
    read.statements = 0;
    show(<RailCount section="/paie" />);
    expect(document.querySelector('.nv-rail__count')).toBeNull();
    cleanup();
    read.fails = true;
    show(<RailCount section="/suivi" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector('.nv-rail__count')).toBeNull();
    cleanup();
    show(<RailCount section="/equipe" />);
    expect(document.querySelector('.nv-rail__count')).toBeNull();
  });

  it('counts the statements to validate on Paie, and nothing on a tab that has no queue', () => {
    read.statements = 2;
    show(<RailCount section="/paie" />);
    expect(screen.getByText('2').getAttribute('title')).toBe('2 relevés à valider');
    cleanup();
    show(<RailCount section="/creatrices" />);
    expect(document.body.textContent).toBe('');
  });
});
