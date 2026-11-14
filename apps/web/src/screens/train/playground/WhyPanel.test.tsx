// @vitest-environment jsdom
import type { PlaygroundAnswer, PlaygroundState } from '@impera/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WhyPanel } from './WhyPanel';

const STATE: PlaygroundState = {
  presets: [],
  presetId: null,
  desireThresholds: { open: 40, script: 70 },
  situation: {
    now: '2026-10-28T20:40:00.000Z',
    timeZone: 'Europe/Paris',
    relationshipStartedAt: '2026-10-28T20:40:00.000Z',
    spentCents: 0,
    isNight: false,
  },
  fanNotes: [],
  history: [],
  rate: { rate: null, rated: 0, validated: 0, target: 0.8, trendPoints: null, previousVersion: null },
  version: { voicePrompt: '1.4.0', voiceModel: 'grok-4.7' },
  rejectReasons: [],
  sessionCostEur: 0,
  voice: { reachable: true },
  persona: { name: 'Elena', played: null },
  pending: null,
};

const ANSWER: PlaygroundAnswer = {
  bubbles: [],
  isBlocked: false,
  violations: [],
  latencyMs: 1000,
  costEur: 0.001,
  isFallback: false,
};

function why(pending: PlaygroundAnswer): void {
  render(<WhyPanel state={{ ...STATE, pending }} open onToggle={() => undefined} />);
}

describe('WhyPanel', () => {
  afterEach(cleanup);

  it('says a handoff is one, and passes no review on an answer that was never written', () => {
    why({
      ...ANSWER,
      brief: {
        intent: 'kyc_answer',
        sentiment: 'negative',
        action: 'handoff',
        replyBrief: '',
        risks: ['minor_suspected'],
        kycMissing: [],
      },
    });
    expect(screen.getByText('Relayée à un humain')).toBeTruthy();
    expect(screen.queryByText('Relecture avant envoi')).toBeNull();
    expect(screen.queryByText(/rien qui ressemble à une IA/)).toBeNull();
  });

  it('says a blocked answer is blocked, and lists a manipulation once, under the trap', () => {
    why({
      ...ANSWER,
      isBlocked: true,
      bubbles: ['Voici une recette'],
      violations: [{ code: 'assistant_output', label: 'Répond comme un assistant', severity: 'blocking' }],
      trap: {
        signals: [
          { kind: 'override', source: 'fan_message', label: 'Il essaie de lui faire ignorer ses règles' },
        ],
      },
      brief: {
        intent: 'off_topic_request',
        sentiment: 'neutral',
        action: 'reply',
        replyBrief: '',
        risks: ['manipulation_attempt'],
        kycMissing: [],
      },
    });
    expect(screen.getByText('Bloquée avant envoi')).toBeTruthy();
    expect(screen.getByText('Il essaie de lui faire ignorer ses règles')).toBeTruthy();
    expect(screen.queryByText('Tentative de manipulation')).toBeNull();
    expect(screen.getByText('Relecture avant envoi')).toBeTruthy();
  });

  it('says no model answered, not « bloquée », and passes no review on what was never written (recette AGT 06/11)', () => {
    why({
      ...ANSWER,
      isBlocked: true,
      failure: 'grok-4.7: unavailable, mistral-large-latest: unavailable',
    });
    expect(screen.getByText('Pas de réponse')).toBeTruthy();
    expect(screen.queryByText('Bloquée avant envoi')).toBeNull();
    expect(screen.queryByText('Relecture avant envoi')).toBeNull();
    // The models' error stays in the technical details, folded.
    expect(screen.getByText('grok-4.7: unavailable, mistral-large-latest: unavailable')).toBeTruthy();
  });

  it('shows his desire against her two thresholds, each signal with its points, and why an offer was refused', () => {
    why({
      ...ANSWER,
      bubbles: ['Mmh'],
      desire: {
        before: 40,
        score: 58,
        band: 'playful',
        signals: [
          { signal: 'states_desire', points: 12 },
          { signal: 'suggestive_emoji', points: 4 },
          { signal: 'suggestive_emoji', points: 4 },
          { signal: 'short_reply', points: -4 },
        ],
        weightsVersion: 'desire-1',
      },
      offerRefused: { code: 'low_desire', label: 'Désir sous le seuil du script' },
    });
    expect(screen.getByRole('meter', { name: 'Note de désir' }).getAttribute('aria-valuenow')).toBe('58');
    expect(screen.getByText('Intime à 40 · Script à 70')).toBeTruthy();
    expect(screen.getByText('Elle peut ouvrir l’intime, pas encore de script')).toBeTruthy();
    expect(screen.getByText('+18')).toBeTruthy();
    // Two emojis are one line, their points added.
    expect(screen.getByText('emoji suggestif ×2')).toBeTruthy();
    expect(screen.getByText('+8')).toBeTruthy();
    expect(screen.getByText('−4')).toBeTruthy();
    expect(screen.getByText(/la règle a dit non : Désir sous le seuil du script/)).toBeTruthy();
  });
});
