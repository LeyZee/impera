import type {
  BrainInput,
  Brief,
  HealthReport,
  LlmFailure,
  LlmGateway,
  VoiceInput,
  VoiceOutput,
} from '@impera/llm';

/** The brain's plain reading of a fan's message: small talk, answer him. */
export const BRIEF: Brief = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui demander sa journée.',
  toneHints: [],
};

export const META = {
  provider: 'xai',
  model: 'grok-4.7',
  isFallback: false,
  latencyMs: 700,
  costUsd: 0.002,
  promptHash: 'h',
} as const;

/** The gateway's health: its voice has a key or not; the budget is never what stops it here. */
export function fakeHealth(hasKey: boolean): HealthReport {
  return {
    state: hasKey ? 'ok' : 'down',
    at: new Date(),
    roles: [
      {
        role: 'voice',
        state: hasKey ? 'ok' : 'down',
        active: { provider: 'xai', model: 'grok-4.7', label: 'Grok 4.7' },
        hasKey,
        isOnFallback: false,
        callsLastHour: 0,
        errorRateLastHour: 0,
        costTodayUsd: 0,
      },
    ],
    providers: [],
    costTodayUsd: 0,
    budget: { day: '2026-10-17', spentEur: 0, capEur: 25, alertAtEur: 20, state: 'ok' },
    trendWatchBudget: { day: '2026-10-17', spentEur: 0, capEur: 1, alertAtEur: 0.8, state: 'ok' },
  };
}

/** What the fake models answer: the brain's reading (or its failure), the voice's bubbles (or its failure). */
export interface GatewayScript {
  readonly brief?: Brief;
  readonly brain?: LlmFailure;
  readonly voice?: VoiceOutput | LlmFailure;
  readonly hasKey?: boolean;
  /** What the voice writes from its second call on: her answer written once more after a guard refused it. */
  readonly voiceAfter?: VoiceOutput;
}

/** What the fake models were asked. */
export interface GatewaySeen {
  voiceCalls: number;
  traces: unknown[];
  brainInputs?: BrainInput[];
  dropped?: { conversationId: string; count: number }[];
  voiceInputs?: VoiceInput[];
}

/**
 * An LLM gateway whose brain and voice answer what the script says, and remember what they were asked. The script is
 * read at each call when given as a function: a journey changes what the models answer from one message to the next.
 */
export function fakeGateway(script: GatewayScript | (() => GatewayScript), seen: GatewaySeen): LlmGateway {
  const now = (): GatewayScript => (typeof script === 'function' ? script() : script);
  return {
    sense: () => Promise.reject(new Error('not used')),
    transcribe: () => Promise.reject(new Error('not used')),
    describeTrendCaptures: () => Promise.reject(new Error('not used')),
    describeDrop: () => Promise.reject(new Error('not used')),
    channelPost: () => Promise.reject(new Error('not used')),
    instagramComment: () => Promise.reject(new Error('not used')),
    proposeCaptions: () => Promise.reject(new Error('not used')),
    summarizeScript: () => Promise.reject(new Error('not used')),
    identifyScript: () => Promise.reject(new Error('not used')),
    readCard: () => Promise.reject(new Error('not used')),
    promptHashes: { creatorDrop: 'drop-v1', scriptSummary: 'summary-v1', scriptIdentity: 'identity-v1' },
    brain: (input) => {
      const current = now();
      seen.traces.push(input.trace);
      seen.brainInputs?.push(input);
      return Promise.resolve(
        current.brain === undefined
          ? { ok: true, value: { output: current.brief ?? BRIEF, meta: META } }
          : { ok: false, error: current.brain },
      );
    },
    voice: (input) => {
      const current = now();
      seen.voiceCalls += 1;
      seen.voiceInputs?.push(input);
      const voice =
        seen.voiceCalls > 1 && current.voiceAfter !== undefined
          ? current.voiceAfter
          : (current.voice ?? { bubbles: ['Coucou toi ✨'] });
      return Promise.resolve(
        'bubbles' in voice ? { ok: true, value: { output: voice, meta: META } } : { ok: false, error: voice },
      );
    },
    health: () => fakeHealth(now().hasKey ?? true),
    judge: () => Promise.reject(new Error('not used')),
    testConnection: () => Promise.reject(new Error('not used')),
  };
}
