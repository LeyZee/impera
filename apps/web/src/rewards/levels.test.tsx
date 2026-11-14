// @vitest-environment jsdom
import { PayPeriodSchema, type ShiftChallenge, type TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEVEL_NAMES, LevelInsignia, levelName } from './LevelInsignia';
import { LevelsPanel, thresholdsTyped } from './LevelsPanel';
import { MemberGameBlock } from './MemberGameBlock';
import { MyRankCard } from './MyRankCard';
import { challengePercent, ShiftChallengeCard } from './ShiftChallengeCard';
import { rankOfKind, revealWordsOf } from './reveal-words';

import { OWNER, THEO_ME } from '@/test/pay';

/** Answers every read with `body`, and keeps what was sent. */
function serve(body: unknown): { readonly sent: { method: string; url: string; body: unknown }[] } {
  const sent: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const text = typeof init?.body === 'string' ? init.body : null;
    sent.push({ method: init?.method ?? 'GET', url, body: text === null ? null : JSON.parse(text) });
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  return { sent };
}

const show = (element: ReactElement): void => {
  render(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CASE: TrophyCase = {
  items: [
    {
      kind: 'first_sale',
      family: 'trophy',
      earnedAt: '2026-11-02T10:00:00.000Z',
      progress: null,
      revealedAt: null,
    },
    { kind: 'day_record', family: 'trophy', earnedAt: null, progress: null, revealedAt: null },
    {
      kind: 'tier:2026-11-01:100000',
      family: 'medal',
      earnedAt: '2026-11-08T10:00:00.000Z',
      progress: null,
      revealedAt: null,
    },
    {
      kind: 'level:1',
      family: 'level',
      earnedAt: '2026-11-03T10:00:00.000Z',
      progress: null,
      revealedAt: null,
    },
  ],
  streaks: [{ kind: 'shift', current: 3, best: 9 }],
  level: { rank: 1, name: 'Recrue' },
  nextLevel: { rank: 2, name: 'Légionnaire', thresholdMinor: 200_000, currentMinor: 50_000, currency: 'EUR' },
};

const CHALLENGE: ShiftChallenge = {
  shiftStartsAt: '2026-11-12T19:00:00.000Z',
  shiftEndsAt: '2026-11-13T01:00:00.000Z',
  currency: 'EUR',
  targetMinor: 20_000,
  netMinor: 5_000,
  met: false,
};

describe('LevelInsignia (ADR 0104 § 16)', () => {
  it('names each of the eight ranks, reached or not, and nothing past the list', () => {
    expect(LEVEL_NAMES).toHaveLength(8);
    render(<LevelInsignia rank={8} size={72} />);
    expect(screen.getByRole('img', { name: 'Insigne du rang « Imperator »' })).toBeTruthy();
    cleanup();
    render(<LevelInsignia rank={2} size={28} earned={false} />);
    expect(
      screen.getByRole('img', { name: 'Insigne du rang « Légionnaire », pas encore atteint' }),
    ).toBeTruthy();
    expect(levelName(0)).toBeNull();
    expect(levelName(9)).toBeNull();
  });

  it('gives a new rank its reveal, with no amount, and none to a rank it does not know', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    expect(rankOfKind('level:3')).toBe(3);
    expect(rankOfKind('tier:2026-11-01:100000')).toBeNull();
    const words = revealWordsOf({ kind: 'level:3' }, period, []);
    expect(words?.kicker).toBe('Nouveau rang');
    expect(words?.title).toBe('Décurion');
    expect(`${words?.text ?? ''}${words?.chip ?? ''}`).not.toMatch(/€|\$/u);
    expect(revealWordsOf({ kind: 'level:12' }, period, [])).toBeNull();
  });
});

describe('ShiftChallengeCard (ADR 0104 § 14)', () => {
  it('reads the way to the target between nothing and all of it', () => {
    expect(challengePercent({ netMinor: 5_000, targetMinor: 20_000 })).toBe(25);
    expect(challengePercent({ netMinor: -300, targetMinor: 20_000 })).toBe(0);
    expect(challengePercent({ netMinor: 90_000, targetMinor: 20_000 })).toBe(100);
  });

  it('shows the chatter’s own target and what is left, and says it has no effect on pay', async () => {
    serve({ challenge: CHALLENGE });
    show(<ShiftChallengeCard user={THEO_ME} />);
    expect(await screen.findByText('Fais mieux que ton jeudi habituel')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Avancée du défi' }).getAttribute('aria-valuenow')).toBe(
      '25',
    );
    expect(screen.getByText(/Encore 150,00\s€ de net/u).textContent).toContain('Sans effet sur ta paie.');
  });

  it('says a challenge met, and shows nothing without one or to the owner', async () => {
    serve({ challenge: { ...CHALLENGE, netMinor: 21_000, met: true } });
    show(<ShiftChallengeCard user={THEO_ME} />);
    expect(await screen.findByText('Défi réussi')).toBeTruthy();
    cleanup();
    const none = serve({ challenge: null });
    show(<ShiftChallengeCard user={THEO_ME} />);
    await waitFor(() => {
      expect(none.sent).toHaveLength(1);
    });
    expect(document.querySelector('.rw-challenge')).toBeNull();
    cleanup();
    const owner = serve({ challenge: CHALLENGE });
    show(<ShiftChallengeCard user={OWNER} />);
    expect(owner.sent).toHaveLength(0);
    expect(document.querySelector('.rw-challenge')).toBeNull();
  });
});

describe('MyRankCard (ADR 0104 § 16)', () => {
  it('shows the rank held and the way to the next, and says a rank is honorary', async () => {
    serve(CASE);
    show(<MyRankCard user={THEO_ME} />);
    expect(await screen.findByText('Recrue')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText(/honorifique/u)).toBeTruthy();
  });

  it('shows the first rank ahead before any is held, and nothing while no threshold is set', async () => {
    serve({ ...CASE, level: null, nextLevel: { ...CASE.nextLevel, rank: 1, name: 'Recrue' } });
    show(<MyRankCard user={THEO_ME} />);
    expect(await screen.findByText('Pas encore de rang')).toBeTruthy();
    cleanup();
    const none = serve({ ...CASE, level: null, nextLevel: null });
    show(<MyRankCard user={THEO_ME} />);
    await waitFor(() => {
      expect(none.sent).toHaveLength(1);
    });
    expect(document.querySelector('.rw-rank')).toBeNull();
  });
});

describe('MemberGameBlock (ADR 0104 § 20)', () => {
  it('shows a member’s rank, streak and trophies earned, with no amount', async () => {
    const { sent } = serve({ ...CASE, nextLevel: null });
    show(<MemberGameBlock memberId="member-1" name="Théo" />);
    expect(await screen.findByText('Recrue')).toBeTruthy();
    expect(sent[0]?.url).toBe('/v1/rewards/members/member-1/trophy-case');
    expect(screen.getByText('3 shifts')).toBeTruthy();
    expect(screen.getByText('Première vente')).toBeTruthy();
    expect(screen.queryByText('Record du jour')).toBeNull();
    // The coin drawn on a trophy aside, no amount is written: the facts hold a rank, a streak and a count.
    expect(document.querySelector('.rw-member__facts')?.textContent).toBe(
      'RangRecrueSérie en cours3 shifts · meilleure : 9Paliers atteints1',
    );
  });
});

describe('LevelsPanel (ADR 0104 § 16)', () => {
  it('reads the fields as thresholds: filled from the first rank, each above the one before', () => {
    expect(thresholdsTyped(['', '', ''])).toEqual([]);
    expect(thresholdsTyped(['500', '2 000,50', ''])).toEqual([50_000, 200_050]);
    expect(thresholdsTyped(['500', '', '900'])).toBeNull();
    expect(thresholdsTyped(['500', '500'])).toBeNull();
    expect(thresholdsTyped(['500', '400'])).toBeNull();
    expect(thresholdsTyped(['0'])).toBeNull();
    expect(thresholdsTyped(['abc'])).toBeNull();
  });

  it('shows each rank with its threshold and sends what the owner types', async () => {
    const settings = {
      ranks: LEVEL_NAMES.map((name, index) => ({ rank: index + 1, name })),
      thresholdsMinor: [50_000],
    };
    const { sent } = serve(settings);
    show(<LevelsPanel />);
    expect(await screen.findByText(/à 500,00\s€/u)).toBeTruthy();
    expect(screen.getAllByText('Pas de seuil')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Régler les seuils' }));
    fireEvent.change(screen.getByLabelText('Net cumulé pour le rang Légionnaire'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les seuils' }));
    expect(await screen.findByText(/plus haut que le précédent/u)).toBeTruthy();
    expect(sent.filter((one) => one.method === 'PUT')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Net cumulé pour le rang Légionnaire'), {
      target: { value: '2000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les seuils' }));
    await waitFor(() => {
      expect(sent.find((one) => one.method === 'PUT')?.body).toEqual({ thresholdsMinor: [50_000, 200_000] });
    });
  });
});
