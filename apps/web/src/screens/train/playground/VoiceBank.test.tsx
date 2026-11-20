// @vitest-environment jsdom
import {
  CreatorIdSchema,
  PersonaVersionIdSchema,
  type PlaygroundState,
  type VoiceBank,
  type VoiceBankExample,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { bankSummary, exampleStatus, VoiceBankFold } from './VoiceBank';
import type { PlaygroundClient } from './client';
import type { Playground } from './usePlayground';

/* Invented creator, version and phrases: no real data (ADR 0010). */
const MIA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const DRAFT = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e3');

const example = (id: string, text: string, more: Partial<VoiceBankExample> = {}): VoiceBankExample => ({
  id,
  text,
  fanMessage: 'Salut toi',
  ratedAt: '2026-11-16T15:00:00.000Z',
  state: 'active',
  isRead: true,
  blockedBy: [],
  ...more,
});
const READ = example('00000000-0000-4000-8000-000000000001', 'Hey toi, tu fais quoi ?');
const STOPPED = example('00000000-0000-4000-8000-000000000002', 'Phrase arrêtée', {
  state: 'blocked',
  isRead: false,
  blockedBy: [{ code: 'ai_disclosure', label: 'Elle se dit IA', severity: 'blocking' }],
});

const STATE: PlaygroundState = {
  persona: { name: 'Mia', played: { creatorId: MIA, versionId: DRAFT, version: '0.0.3' } },
  presets: [],
  presetId: null,
  desireThresholds: { open: 40, script: 70 },
  situation: {
    now: '2026-10-17T21:40:00.000Z',
    timeZone: 'Europe/Paris',
    relationshipStartedAt: '2026-10-17T21:40:00.000Z',
    spentCents: 0,
    isNight: true,
  },
  fanNotes: [],
  history: [],
  rate: { rate: null, rated: 0, validated: 0, target: 0.8, trendPoints: null, previousVersion: null },
  version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
  rejectReasons: [],
  sessionCostEur: 0,
  voice: { reachable: true },
  pending: null,
  scripts: { source: 'trial', unavailable: null, run: null, fictiveSpentCents: 0, salesFrozen: false },
};

afterEach(cleanup);

function first(elements: readonly HTMLElement[]): HTMLElement {
  const [element] = elements;
  if (element === undefined) throw new Error('none');
  return element;
}
function last(elements: readonly HTMLElement[]): HTMLElement {
  const element = elements.at(-1);
  if (element === undefined) throw new Error('none');
  return element;
}

const unused = (): never => {
  throw new Error('not used');
};

function playground(client: Pick<PlaygroundClient, 'bank' | 'withdrawExample'>): Playground {
  return {
    client: {
      isDemo: false,
      state: unused,
      choosePreset: unused,
      choosePersona: unused,
      reset: unused,
      send: unused,
      rate: unused,
      branch: unused,
      markDesire: unused,
      desireMarks: unused,
      compare: unused,
      advance: unused,
      setNotes: unused,
      setSpent: unused,
      sendCreatorMedia: unused,
      answerScriptStep: unused,
      ...client,
    },
    state: undefined,
    isLoading: false,
    busy: false,
    error: undefined,
    run: unused,
    fail: () => undefined,
    retry: () => undefined,
    switchToDemo: () => undefined,
  };
}

function mount(
  state: PlaygroundState,
  bank: VoiceBank,
  withdraw?: (id: string) => Promise<VoiceBank>,
  mayWithdraw = true,
) {
  const asked: string[] = [];
  const pg = playground({
    bank: () => Promise.resolve(bank),
    withdrawExample: (_creatorId, _versionId, id) => {
      asked.push(id);
      return withdraw === undefined ? Promise.resolve({ examples: [] }) : withdraw(id);
    },
  });
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queries}>
      <VoiceBankFold state={state} pg={pg} mayWithdraw={mayWithdraw} />
    </QueryClientProvider>,
  );
  return { asked, view };
}

describe('Sa banque (ADR 0102 § 5)', () => {
  it('sums up what her voice reads, and says why a guard stops one', () => {
    expect(bankSummary({ examples: [] })).toBe('vide');
    expect(bankSummary({ examples: [READ, STOPPED] })).toBe('1 lu sur 2');
    expect(exampleStatus(READ)).toBe('Lu par sa voix');
    expect(exampleStatus({ ...READ, isRead: false })).toBe('En réserve');
    expect(exampleStatus(STOPPED)).toBe('Arrêté : elle se dit IA');
  });

  it('shows nothing for the invented persona, which has no bank', () => {
    const { view } = mount({ ...STATE, persona: { name: 'Elena', played: null } }, { examples: [READ] });
    expect(view.container.textContent).toBe('');
  });

  it('withdraws only once confirmed, and says where it stops counting', async () => {
    const { asked } = mount(STATE, { examples: [READ, STOPPED] }, () =>
      Promise.resolve({ examples: [STOPPED] }),
    );
    expect(await screen.findByText('Hey toi, tu fais quoi ?')).toBeTruthy();
    expect(screen.getByText('1 lu sur 2')).toBeTruthy();

    fireEvent.click(first(screen.getAllByRole('button', { name: 'Retirer' })));
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }));
    expect(asked).toEqual([]);

    fireEvent.click(first(screen.getAllByRole('button', { name: 'Retirer' })));
    // The confirmation takes the place of its « Retirer »; the other examples wait meanwhile.
    fireEvent.click(first(screen.getAllByRole('button', { name: 'Retirer' })));
    await waitFor(() => {
      expect(asked).toEqual([READ.id]);
    });
    expect((await screen.findByRole('status')).textContent).toBe(
      'Exemple retiré. Ses vrais brouillons ne le lisent plus ; ici, ce sera à la prochaine conversation.',
    );
    await waitFor(() => {
      expect(screen.queryByText('Hey toi, tu fais quoi ?')).toBeNull();
    });
  });

  it('says so when the bank cannot withdraw', async () => {
    mount(STATE, { examples: [READ] }, () => Promise.reject(new Error('down')));
    await screen.findByText('Hey toi, tu fais quoi ?');
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    fireEvent.click(last(screen.getAllByRole('button', { name: 'Retirer' })));
    expect((await screen.findByRole('alert')).textContent).toContain('Pas retiré');
  });

  it('lets a manager read her bank, never withdraw from it (ADR 0092 § 8)', async () => {
    mount(STATE, { examples: [READ, STOPPED] }, undefined, false);
    expect(await screen.findByText('Hey toi, tu fais quoi ?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retirer' })).toBeNull();
    expect(screen.getByText(/^Les corrections rangées en Exemple de voix par le propriétaire,/)).toBeTruthy();
  });
});
