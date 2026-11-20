// @vitest-environment jsdom
import {
  CreatorIdSchema,
  MEDIA_VOCABULARY_VERSION,
  PlatformAccountIdSchema,
  type MediaDescription,
  type VaultView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Bundle } from './Bundle';
import { bundleCount, bundleStepOf, trialTint, type BundleStep, type TurnMedia } from './bundle-step';

import { vaultKey } from '@/creators/vault/api';
import { setMediaBlur } from '@/shell/media-blur';

afterEach(cleanup);

const describeAs = (kind: MediaDescription['kind'], text: string): MediaDescription => ({
  vocabularyVersion: MEDIA_VOCABULARY_VERSION,
  kind,
  factualDescription: text,
  durationS: null,
  segments: [],
  intensity: 'not_visible',
  anatomyVisible: [],
  castMode: 'not_visible',
  mood: [],
  setting: null,
  audio: null,
  textVisible: null,
  quality: 'acceptable',
  confidenceLow: true,
  notVisible: false,
  flags: [],
});

const step = (over: Partial<BundleStep> = {}): BundleStep => ({
  source: 'trial',
  scriptRef: 'essai-nuit',
  stepIndex: 1,
  kind: 'paid',
  priceCents: 1200,
  state: 'waiting',
  ...over,
});

const medium = (
  ref: string,
  kind: MediaDescription['kind'],
  isLocked: boolean,
  teaser = false,
): TurnMedia => ({
  description: describeAs(kind, `Média inventé ${ref}.`),
  isLocked,
  scriptStep: step(),
  scriptMedia: { ref, teaser },
});

describe('a bundle, as Reveal says it', () => {
  it('counts what is sold, never the teaser, in her words', () => {
    expect(
      bundleCount([
        medium('m0', 'image', false, true),
        medium('m1', 'image', true),
        medium('m2', 'image', true),
        medium('m3', 'video', true),
      ]),
    ).toBe('2 photos · 1 vidéo');
    expect(bundleCount([medium('m1', 'audio', false)])).toBe('1 vocal');
  });

  it('finds the step a turn carries, and gives a trial media the same tint each time', () => {
    expect(bundleStepOf([medium('m1', 'image', true)])).toMatchObject({ kind: 'paid' });
    expect(
      bundleStepOf([{ description: describeAs('image', 'Photo du fan.'), isLocked: false }]),
    ).toBeUndefined();
    expect(trialTint('essai-media-3')).toBe(trialTint('essai-media-3'));
    expect([1, 2, 3, 4]).toContain(trialTint('autre'));
  });
});

describe('<Bundle>', () => {
  const noop = (): void => undefined;

  it('shows the step’s words, the teaser, the price and « +N », and buys fictively', () => {
    const answers: string[] = [];
    const media = [
      medium('m0', 'image', false, true),
      ...['m1', 'm2', 'm3', 'm4'].map((ref) => medium(ref, 'image', true)),
    ];
    render(
      <Bundle
        media={media}
        step={step()}
        text="Juste entre nous"
        creatorId={null}
        busy={false}
        salesFrozen={false}
        onScriptStep={(answer) => answers.push(answer)}
      />,
    );
    expect(screen.getByText('Juste entre nous')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^4 photos, 12.*flouté$/ })).toBeTruthy();
    expect(screen.getByText('Aperçu')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('Essai')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Payer 12/ }));
    expect(answers).toEqual(['buy']);
  });

  it('says in words that his sales are frozen, never in a tooltip alone', () => {
    render(
      <Bundle
        media={[medium('m1', 'image', true)]}
        step={step()}
        text=""
        creatorId={null}
        busy={false}
        salesFrozen
        onScriptStep={noop}
      />,
    );
    expect(screen.getByText(/Ventes gelées pour ce fan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Payer/ }).hasAttribute('disabled')).toBe(true);
  });

  it('draws her media from her vault: the blur while locked, the sharp picture once he holds it', () => {
    const creatorId = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
    const vault: VaultView = {
      creatorId,
      syncedAt: null,
      folders: [
        {
          platform: 'reveal',
          platformAccountId: PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000a1'),
          folderRef: null,
          folderName: null,
          moment: null,
          media: ['v1', 'v2'].map((platformMediaId) => ({
            platformMediaId,
            kind: 'image' as const,
            durationSeconds: null,
            uploadedAt: '2026-11-01T10:00:00Z',
            platformDescription: null,
            suggestedPriceMinor: null,
            blurhash: null,
            removed: false,
          })),
        },
      ],
    };
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    queries.setQueryData(vaultKey(creatorId), vault);
    setMediaBlur(false);
    const hers = (m: TurnMedia): TurnMedia => ({ ...m, scriptStep: step({ source: 'hers' }) });
    const { container } = render(
      <QueryClientProvider client={queries}>
        <Bundle
          media={[hers(medium('v1', 'image', false, true)), hers(medium('v2', 'image', true))]}
          step={step({ source: 'hers' })}
          text=""
          creatorId={creatorId}
          busy={false}
          salesFrozen={false}
          onScriptStep={noop}
        />
      </QueryClientProvider>,
    );
    const sharp = [...container.querySelectorAll('img.vx-sharp')].map((img) => img.getAttribute('src'));
    // The teaser he holds is drawn sharp; the locked one stays the platform's blur alone.
    expect(sharp).toEqual([`/v1/creators/${creatorId}/vault/media/v1/preview`]);
    expect(screen.queryByText('Essai')).toBeNull();
    setMediaBlur(true);
  });
});
