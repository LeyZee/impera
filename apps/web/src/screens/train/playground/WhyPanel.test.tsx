// @vitest-environment jsdom
import type { PlaygroundAnswer, PlaygroundState } from '@nirvana/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WhyPanel } from './WhyPanel';

const STATE: PlaygroundState = {
  presets: [],
  presetId: null,
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
  persona: { name: 'Elena' },
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
});
