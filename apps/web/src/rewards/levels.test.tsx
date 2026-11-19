// @vitest-environment jsdom
import { PayPeriodSchema, type ShiftChallenge, type TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LEVEL_NAMES, LevelInsignia, levelName } from './LevelInsignia';
import { LevelsPanel, thresholdFault, thresholdsTyped } from './LevelsPanel';
import { MemberGameBlock } from './MemberGameBlock';
import { MyRankCard, rankPercent } from './MyRankCard';
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
  level: { rank: 1, name: 'Étincelle' },
  nextLevel: { rank: 2, name: 'Allumeur', thresholdMinor: 200_000, currentMinor: 50_000, currency: 'EUR' },
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
    expect(screen.getByRole('img', { name: 'Insigne du rang « Incendiaire »' })).toBeTruthy();
    cleanup();
    render(<LevelInsignia rank={2} size={28} earned={false} />);
    expect(
      screen.getByRole('img', { name: 'Insigne du rang « Allumeur », pas encore atteint' }),
    ).toBeTruthy();
    expect(levelName(0)).toBeNull();
    expect(levelName(9)).toBeNull();
  });

  it('burns with its glow from 40 px, keeps the fire alone under it, and a silhouette when not reached', () => {
    const large = render(<LevelInsignia rank={4} size={72} glow />).container;
    expect(large.querySelectorAll('filter')).toHaveLength(1);
    expect(large.querySelectorAll('.rw-level__ember')).toHaveLength(1);
    expect(large.querySelectorAll('.rw-level__glow')).toHaveLength(1);
    cleanup();
    const small = render(<LevelInsignia rank={8} size={28} glow />).container;
    expect(small.querySelectorAll('.rw-level__ember, .rw-level__glow')).toHaveLength(0);
    expect(small.querySelectorAll('[filter]')).toHaveLength(0);
    expect(small.querySelectorAll('g[transform] path')).toHaveLength(1);
    cleanup();
    const locked = render(<LevelInsignia rank={5} size={44} earned={false} />).container;
    expect(locked.querySelectorAll('defs')).toHaveLength(0);
    expect(locked.querySelector('g[transform]')?.getAttribute('fill')).toBe('currentColor');
  });

  it('gives a new rank its reveal, with no amount, and none to a rank it does not know', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    expect(rankOfKind('level:3')).toBe(3);
    expect(rankOfKind('tier:2026-11-01:100000')).toBeNull();
    const words = revealWordsOf({ kind: 'level:3' }, period, []);
    expect(words?.kicker).toBe('Nouveau rang');
    expect(words?.title).toBe('Charmeur');
    expect(`${words?.text ?? ''}${words?.chip ?? ''}`).not.toMatch(/€|\$/u);
    expect(revealWordsOf({ kind: 'level:12' }, period, [])).toBeNull();
  });

  it('says the threshold just passed when the case carries it', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    const words = revealWordsOf({ kind: 'level:3', basis: { minor: 500_000, currency: 'EUR' } }, period, []);
    expect(words?.text.replace(/\s/gu, ' ')).toBe('Ton net depuis ton arrivée vient de passer 5 000 €.');
  });

  it('no longer promises that a rank is kept for ever (ADR 0118 § 5)', () => {
    const period = PayPeriodSchema.parse('2026-11-01');
    for (const kind of ['level:1', 'level:4']) {
      expect(revealWordsOf({ kind }, period, [])?.text).not.toMatch(/jamais|ne se perd/u);
    }
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
    show(<ShiftChallengeCard user={THEO_ME} zone="Europe/Paris" />);
    expect(await screen.findByText('Fais mieux que ton jeudi habituel')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Avancée du défi' }).getAttribute('aria-valuenow')).toBe(
      '25',
    );
    const note = screen.getByText(/Encore 150,00\s€ de net/u).textContent;
    expect(note).toContain('ton jeudi habituel sur ce créneau');
    expect(note).toContain('Sans effet sur ta paie.');
  });

  it('names the shift’s day in the member’s zone, not the device’s, and says the figures are net', async () => {
    // Monday 0 h in Paris is still Sunday evening in New York.
    serve({ challenge: { ...CHALLENGE, shiftStartsAt: '2026-11-15T23:00:00.000Z' } });
    show(<ShiftChallengeCard user={THEO_ME} zone="Europe/Paris" />);
    expect(await screen.findByText('Fais mieux que ton lundi habituel')).toBeTruthy();
    expect(screen.getByText(/sur 200,00\s€ de net/u)).toBeTruthy();
    cleanup();
    serve({ challenge: { ...CHALLENGE, shiftStartsAt: '2026-11-15T23:00:00.000Z' } });
    show(<ShiftChallengeCard user={THEO_ME} zone="America/New_York" />);
    expect(await screen.findByText('Fais mieux que ton dimanche habituel')).toBeTruthy();
  });

  it('says a challenge met, and shows nothing without one or to the owner', async () => {
    serve({ challenge: { ...CHALLENGE, netMinor: 21_000, met: true } });
    show(<ShiftChallengeCard user={THEO_ME} zone="Europe/Paris" />);
    expect(await screen.findByText('Défi réussi')).toBeTruthy();
    cleanup();
    const none = serve({ challenge: null });
    show(<ShiftChallengeCard user={THEO_ME} zone="Europe/Paris" />);
    await waitFor(() => {
      expect(none.sent).toHaveLength(1);
    });
    expect(document.querySelector('.rw-challenge')).toBeNull();
    cleanup();
    const owner = serve({ challenge: CHALLENGE });
    show(<ShiftChallengeCard user={OWNER} zone="Europe/Paris" />);
    expect(owner.sent).toHaveLength(0);
    expect(document.querySelector('.rw-challenge')).toBeNull();
  });
});

describe('MyRankCard (ADR 0104 § 16)', () => {
  it('shows the rank held and the way to the next, and says a rank is honorary', async () => {
    serve(CASE);
    show(<MyRankCard user={THEO_ME} />);
    expect(await screen.findByText('Étincelle')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText(/Honorifique/u)).toBeTruthy();
    // ADR 0118 § 5: a rank follows the net, and the card says what may bring it down.
    expect(
      screen.getByText(/Il redescend si une vente est remboursée ou un rapport\s+corrigé\./u),
    ).toBeTruthy();
    expect(screen.queryByText(/ne redescend jamais/u)).toBeNull();
  });

  it('never fills the bar before the rank is noted, and shows the true net past the threshold', async () => {
    expect(rankPercent({ currentMinor: 199_999, thresholdMinor: 200_000 })).toBe(99);
    expect(rankPercent({ currentMinor: 124_400, thresholdMinor: 10_000 })).toBe(99);
    expect(rankPercent({ currentMinor: 0, thresholdMinor: 10_000 })).toBe(0);
    serve({ ...CASE, nextLevel: { ...CASE.nextLevel, thresholdMinor: 10_000, currentMinor: 124_400 } });
    show(<MyRankCard user={THEO_ME} />);
    expect(await screen.findByText(/1\s244,00\s€ de net à ce jour/u)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('99');
  });

  it('shows the first rank ahead before any is held, and nothing while no threshold is set', async () => {
    serve({ ...CASE, level: null, nextLevel: { ...CASE.nextLevel, rank: 1, name: 'Étincelle' } });
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
    const later = { kind: 'streak_5', family: 'streak', progress: null, revealedAt: null } as const;
    const { sent } = serve({
      ...CASE,
      items: [...CASE.items, { ...later, earnedAt: '2026-11-09T10:00:00.000Z' }],
      nextLevel: null,
    });
    show(<MemberGameBlock memberId="member-1" name="Théo" />);
    expect(await screen.findByText('Étincelle')).toBeTruthy();
    expect(sent[0]?.url).toBe('/v1/rewards/members/member-1/trophy-case');
    expect(screen.getByText('Première vente')).toBeTruthy();
    expect(screen.queryByText('Record du jour')).toBeNull();
    // The rank comes first, then the two figures, then the trophies, the latest first (Charles, 16/11).
    const block = document.querySelector('.rw-member');
    const order = ['.rw-member__rank', '.rw-member__facts', '.rw-member__trophies'].map((selector) =>
      [...(block?.querySelectorAll('*') ?? [])].indexOf(block?.querySelector(selector) ?? document.body),
    );
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(block?.querySelector('.rw-member__label')?.textContent).toBe('Trophées 2 sur 3');
    expect(
      [...(block?.querySelectorAll('.rw-member__trophies li > span') ?? [])].map((one) => one.textContent),
    ).toEqual(['Série de 5', 'Première vente']);
    // The coin drawn on a trophy aside, no amount is written: the facts hold a streak and a count.
    expect(document.querySelector('.rw-member__facts')?.textContent).toBe(
      'Série en cours3shifts avec le rapport à l’heureMeilleure : 9Quinzaines avec un palier1',
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

  it('says the one cause that stops the save, on the one field at fault', () => {
    expect(thresholdFault(['500', '2 000', ''])).toBeNull();
    expect(thresholdFault(['', '', ''])).toBeNull();
    expect(thresholdFault(['500', '', '900'])).toEqual({ index: 1, cause: 'gap' });
    expect(thresholdFault(['500', '12,555'])).toEqual({ index: 1, cause: 'amount' });
    expect(thresholdFault(['0'])).toEqual({ index: 0, cause: 'amount' });
    expect(thresholdFault(['10 000 000', '10 000 001'])).toEqual({ index: 1, cause: 'max' });
    expect(thresholdFault(['500', '99999999999'])).toEqual({ index: 1, cause: 'max' });
    expect(thresholdFault(['500', '400'])).toEqual({ index: 1, cause: 'order' });
    // Whatever stops the save has a cause, and nothing else does.
    for (const fields of [['500', '', '900'], ['abc'], ['500', '500'], ['10 000 000'], ['1', '2', '3']])
      expect(thresholdFault(fields) === null).toBe(thresholdsTyped(fields) !== null);
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
    // ADR 0118 § 7: moving a threshold takes no rank back; a corrected net may.
    expect(screen.getByText(/Honorifique\s: ni taux, ni palier, ni paie\./u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Régler les seuils' }));
    // ADR 0118 § 7, said where the owner sets them: a threshold takes no rank back, a corrected net may.
    expect(
      screen.getByText(/ne reprend pas un rang déjà gagné\. Un rang suit le net du chatteur/u),
    ).toBeTruthy();
    const form = screen.getByLabelText('Net cumulé pour le rang Allumeur').closest('ul');
    expect(form?.querySelectorAll('svg[data-earned="true"]')).toHaveLength(1);
    expect(form?.querySelectorAll('svg[data-earned="false"]')).toHaveLength(7);
    fireEvent.change(screen.getByLabelText('Net cumulé pour le rang Allumeur'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les seuils' }));
    expect(await screen.findByText(/plus haut que le précédent/u)).toBeTruthy();
    expect(sent.filter((one) => one.method === 'PUT')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Net cumulé pour le rang Allumeur'), {
      target: { value: '2000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les seuils' }));
    await waitFor(() => {
      expect(sent.find((one) => one.method === 'PUT')?.body).toEqual({ thresholdsMinor: [50_000, 200_000] });
    });
  });
});

describe('LevelsPanel with no threshold (recette EQU-04, ADR 0118 § 7)', () => {
  it('says that no new rank opens and that a rank already earned stays', async () => {
    serve({ ranks: LEVEL_NAMES.map((name, index) => ({ rank: index + 1, name })), thresholdsMinor: [] });
    show(<LevelsPanel />);
    expect(
      await screen.findByText(/Sans seuil, aucun nouveau rang ne s’ouvre\s; un rang déjà gagné reste\./u),
    ).toBeTruthy();
    expect(screen.queryByText(/aucun chatteur n’a de rang/u)).toBeNull();
  });
});
