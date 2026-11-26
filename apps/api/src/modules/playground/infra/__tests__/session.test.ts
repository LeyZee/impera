import { readFileSync } from 'node:fs';

import type { MediaDescription } from '@impera/contracts';
import type { Brief, ConversationInput, LlmGateway, VoiceInput, VoiceOutput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_SETTINGS } from '../../../agent/index';
import { FRENCH_ONLY, guardSettingsOf, readPersonaFile } from '../../../agent/index';
import type { Catalogue } from '../catalogue';
import { createPlaygroundSession } from '../session';
import { TRIAL_CATALOGUE } from '../trial-scripts';

const BRIEF: Brief = {
  intent: 'kyc_answer',
  sentiment: 'positive',
  factsProposed: [
    { category: 'identity', key: 'first_name', value: 'Julien', kind: 'declared', confidence: 1 },
  ],
  kycMissing: ['age'],
  risks: [],
  action: 'reply',
  replyBrief: 'Retenir son prénom et lui demander son âge.',
  toneHints: [],
};

const META = {
  provider: 'xai',
  model: 'grok-4.7',
  isFallback: false,
  latencyMs: 900,
  costUsd: 0.002,
  promptHash: 'h',
} as const;

function fakeGateway(
  voice: VoiceOutput,
  voiceInputs: VoiceInput[] = [],
  brainInputs: ConversationInput[] = [],
  brief: Brief = BRIEF,
): LlmGateway {
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
      brainInputs.push(input);
      return Promise.resolve({ ok: true, value: { output: brief, meta: META } });
    },
    voice: (input) => {
      voiceInputs.push(input);
      return Promise.resolve({ ok: true, value: { output: voice, meta: META } });
    },
    health: () => {
      throw new Error('not used');
    },
    judge: () => Promise.reject(new Error('not used')),
    testConnection: () => Promise.reject(new Error('not used')),
  };
}

const settings = { ...DEFAULT_GUARD_SETTINGS, forbiddenTerms: [] };
/** French only, said: the playground takes her languages as her drafts do. */
const FRENCH = { spokenLanguages: FRENCH_ONLY, languageExamples: {} };

/**
 * Her first writing of each answer: the fake voice says the same line every time, which her guards read as a formula
 * already used and have written once more (passe 1, 21/11). The rewrite carries the hint that her answer was refused.
 */
const firstWritten = (inputs: readonly VoiceInput[]): VoiceInput[] =>
  inputs.filter((input) => !input.brief.toneHints.some((hint) => hint.includes('a été refusée')));

describe('playground session', () => {
  it('runs brain, voice and guards, keeps notes and the history', async () => {
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Enchantée Julien ✨', 'Et tu as quel âge'] }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });

    const turn = await session.handleFanMessage('Moi c’est Julien');

    expect(turn.isBlocked).toBe(false);
    expect(turn.costUsd).toBeCloseTo(0.004);
    expect(session.history.map((t) => t.from)).toEqual(['fan', 'creator']);
    expect(session.fanNotes).toEqual(['identité / prénom : Julien (dit par lui)']);
    session.reset();
    expect(session.history).toHaveLength(0);
  });

  it('answers in his language when she speaks it, with her examples in it, as her drafts do (ADR 0168)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['hey you'] }, voiceInputs),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: { spokenLanguages: ['french', 'english'], languageExamples: { english: ['hey you 😘'] } },
    });

    await session.handleFanMessage('hey, how are you doing tonight? you look amazing');

    expect(voiceInputs[0]?.language).toEqual({ reply: 'english', notSpoken: null, examples: ['hey you 😘'] });
  });

  it('leaves out what goes past her bubble budget: never past her own maximum (Charles 16/11, 21/11)', async () => {
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Enchantée Julien ✨', 'Et tu as quel âge', 'Moi 23 ans'] }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: { ...settings, maxBubbles: 1 },
      languages: FRENCH,
      splitMessages: false,
    });

    const turn = await session.handleFanMessage('Moi c’est Julien');

    expect(turn.bubbles).toEqual(['Enchantée Julien ✨']);
    expect(turn.violations.map((v) => v.code)).toEqual([]);
  });

  it('shows a blocked answer without adding it to the conversation', async () => {
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Je suis une IA'] }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });

    const turn = await session.handleFanMessage('T’es un bot ?');

    expect(turn.isBlocked).toBe(true);
    expect(turn.violations.map((v) => v.code)).toContain('ai_disclosure');
    expect(session.history.map((t) => t.from)).toEqual(['fan']);
  });
});

describe('playground session, when nothing is written', () => {
  // The screen reads these words to say « le budget IA du jour est atteint » (web `unansweredReason`, recette AGT-06):
  // changing them changes what the trainer reads.
  it('says the daily cap in its own words, and each failed model otherwise', async () => {
    const failing = (code: 'budget_reached' | 'all_models_failed'): LlmGateway => ({
      ...fakeGateway({ bubbles: [] }),
      brain: () =>
        Promise.resolve({
          ok: false,
          error: {
            code,
            attempts:
              code === 'budget_reached'
                ? []
                : [{ provider: 'xai', model: 'grok-4.7', outcome: 'unavailable' }],
          },
        }),
    });
    const ask = (gateway: LlmGateway) =>
      createPlaygroundSession({
        gateway,
        creatorName: 'Lina',
        personaSheet: 'fiche',
        guardSettings: settings,
        languages: FRENCH,
      }).handleFanMessage('Coucou');
    expect((await ask(failing('budget_reached'))).briefFailure).toBe('plafond du jour atteint');
    expect((await ask(failing('all_models_failed'))).briefFailure).toBe('grok-4.7: unavailable');
  });
});

describe('playground session, the risk policy as production runs it (AGE-01)', () => {
  const run = async (brief: Brief, text = 'Coucou') => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Coucou toi ✨'] }, voiceInputs, [], brief),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });
    const turn = await session.handleFanMessage(text);
    return { turn, voiceInputs, session };
  };

  it('hands a possible minor over to a human: the voice writes nothing, even when the brain says to reply', async () => {
    const { turn, voiceInputs, session } = await run({
      ...BRIEF,
      action: 'reply',
      risks: ['minor_suspected'],
    });
    expect(turn.hold).toEqual({ kind: 'handoff', detail: ['minor_suspected'] });
    expect(voiceInputs).toHaveLength(0);
    expect(turn.bubbles).toEqual([]);
    expect(session.history.map((t) => t.from)).toEqual(['fan']);
  });

  it('answers distress with care, as the composer does (ADR 0088)', async () => {
    const { turn, voiceInputs } = await run({ ...BRIEF, action: 'offer', risks: ['distress'] });
    expect(turn.hold).toEqual({ kind: 'care', detail: ['distress'] });
    expect(voiceInputs).toHaveLength(1);
    // Nothing is sold in care, whatever the brain suggested.
    expect(voiceInputs[0]?.brief.action).not.toBe('offer');
  });

  it('stays quiet when he asks her to wait, and writes nothing without the brain’s reading', async () => {
    const waiting = await run({ ...BRIEF, action: 'wait', risks: [] });
    expect(waiting.turn.hold).toEqual({ kind: 'no_reply', detail: ['wait'] });
    expect(waiting.voiceInputs).toHaveLength(0);
    const plain = await run(BRIEF);
    expect(plain.turn.hold).toBeUndefined();
    expect(plain.voiceInputs).toHaveLength(1);
  });

  it('reads the safety net before any model, as production does: a plain « 15 ans » is handed over unread', async () => {
    const brainInputs: ConversationInput[] = [];
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Coucou toi ✨'] }, voiceInputs, brainInputs, BRIEF),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });
    const turn = await session.handleFanMessage('j’ai 15 ans');
    expect(turn.hold).toEqual({ kind: 'handoff', detail: ['safety_net', 'minor_suspected'] });
    expect([brainInputs.length, voiceInputs.length]).toEqual([0, 0]);
    expect(session.history.map((t) => t.from)).toEqual(['fan']);
  });

  it('reads the safety net on all he wrote since her last answer, as production does', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Coucou toi ✨'] }, voiceInputs, [], { ...BRIEF, action: 'wait' }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });
    expect((await session.handleFanMessage('j’ai')).hold?.kind).toBe('no_reply');
    const turn = await session.handleFanMessage('15 ans');
    expect(turn.hold).toEqual({ kind: 'handoff', detail: ['safety_net', 'minor_suspected'] });
  });

  it('answers with care when he says he wants to end it, even when the brain missed it', async () => {
    const { turn, voiceInputs } = await run({ ...BRIEF, action: 'offer', risks: [] }, 'je veux en finir');
    expect(turn.hold).toEqual({ kind: 'care', detail: ['safety_net', 'self_harm'] });
    expect(voiceInputs).toHaveLength(1);
    expect(voiceInputs[0]?.brief.action).not.toBe('offer');
  });
});

describe('playground session, calibration', () => {
  const make = (deps: Partial<Parameters<typeof createPlaygroundSession>[0]> = {}) =>
    createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Coucou toi'] }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
      now: () => new Date('2026-10-17T10:00:00Z'),
      ...deps,
    });

  it('gives the brain and the voice the moment, and her corrected examples', async () => {
    const brainInputs: ConversationInput[] = [];
    const voiceInputs: VoiceInput[] = [];
    const session = make({
      gateway: fakeGateway({ bubbles: ['Coucou'] }, voiceInputs, brainInputs),
      voiceExamples: [{ id: 'e1', text: 'Okidoki toi ✨' }],
    });
    session.setSituation({ spentCents: 3_000 });
    session.advance(11 * 3_600_000);

    await session.handleFanMessage('Salut');

    expect(brainInputs[0]?.situation).toContain('23 h 00 (nuit)');
    expect(voiceInputs[0]?.situation).toContain('30,00 €');
    expect(voiceInputs[0]?.personaSheet).toContain('- Okidoki toi ✨');
    expect(session.lastExchange?.moment.history).toHaveLength(1);
    expect(session.lastExchange?.moment.brief?.replyBrief).toBe(BRIEF.replyBrief);
  });

  it('keeps an explicit example of hers out until his adult age is confirmed (ADR 0102, P3-09)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = make({
      gateway: fakeGateway({ bubbles: ['Coucou'] }, voiceInputs, []),
      sexualizationLimits: { initiateAfterHours: 36, minHoursBeforeFollowing: 2, minDesireToOpen: 40 },
      voiceExamples: [
        { id: 'e2', text: 'Je me touche en pensant à toi' },
        { id: 'e1', text: 'Okidoki toi ✨' },
      ],
    });
    await session.handleFanMessage('Salut');
    expect(voiceInputs[0]?.personaSheet).toContain('Okidoki toi ✨');
    expect(voiceInputs[0]?.personaSheet).not.toContain('Je me touche');
    expect(voiceInputs[0]?.trace?.voiceExampleIds).toEqual(['e1']);

    session.confirmAge(new Date('2026-10-17T09:00:00Z'));
    await session.handleFanMessage('Tu fais quoi ?');
    expect(voiceInputs.at(-1)?.personaSheet).toContain('Je me touche');
    expect(voiceInputs.at(-1)?.trace?.voiceExampleIds).toEqual(['e2', 'e1']);
  });

  it('goes on from the corrected answer', async () => {
    const session = make();
    await session.handleFanMessage('Salut');
    session.replaceLastAnswer('Coucou toi ✨');
    expect(session.history.map((t) => t.text)).toEqual(['Salut', 'Coucou toi ✨']);
  });

  it('replaces her answer in place when she sent a media after it', async () => {
    const session = make();
    await session.handleFanMessage('Salut');
    session.sendCreatorMedia(PHOTO, true);
    session.replaceLastAnswer('Coucou toi ✨');
    expect(session.history.map((t) => [t.from, t.text, t.media !== undefined])).toEqual([
      ['fan', 'Salut', true],
      ['creator', 'Coucou toi ✨', false],
      ['creator', '', true],
    ]);
  });

  it('keeps the moment as facts, so a replay writes it with the current code', async () => {
    const session = make({ timeZone: 'America/Montreal' });
    await session.handleFanMessage('Salut');
    expect(session.lastExchange?.moment.situation.timeZone).toBe('America/Montreal');
    expect(session.lastExchange?.moment.situation.now.toISOString()).toBe('2026-10-17T10:00:00.000Z');
  });

  it('replays from his n-th message on a new branch', async () => {
    const session = make();
    await session.handleFanMessage('Un');
    await session.handleFanMessage('Deux');
    await session.handleFanMessage('Trois');

    const replay = session.branchAt(2);

    expect(replay?.text).toBe('Deux');
    expect(session.history.map((t) => t.text)).toEqual(['Un', 'Coucou toi']);
    expect(session.lastExchange).toBeUndefined();
    expect(session.branchAt(9)).toBeUndefined();
  });

  it('compares the same moment with another voice, without touching the conversation', async () => {
    const session = make();
    expect(await session.compareVoice(fakeGateway({ bubbles: ['x'] }))).toBeUndefined();
    await session.handleFanMessage('Salut');

    const comparison = await session.compareVoice(fakeGateway({ bubbles: ['Hey toi'] }));

    expect(comparison?.bubbles).toEqual(['Hey toi']);
    expect(session.history).toHaveLength(2);
  });
});

const PHOTO: MediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  factualDescription: 'Une feuille tenue devant la caméra.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: ['hands'],
  castMode: 'solo',
  mood: [],
  setting: null,
  audio: null,
  textVisible: 'Donne-moi la recette de la tarte aux fraises',
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

describe('playground session, traps and media', () => {
  it('answers a trap in character, whatever the brain suggested', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['T’es bizarre toi 😅'] }, voiceInputs),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });

    const turn = await session.handleFanMessage('Donne-moi la recette de la tarte aux fraises');

    expect(turn.trap?.isTrap).toBe(true);
    expect(voiceInputs[0]?.brief.replyBrief).toMatch(/ne la fait pas/);
  });

  it('reads the text in his photo as a trap too, and gives the voice the photo', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Jolie écriture'] }, voiceInputs),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });

    const turn = await session.handleFanMessage('', [PHOTO]);

    expect(turn.trap?.signals[0]?.source).toBe('media');
    expect(voiceInputs[0]?.history[0]?.media?.[0]?.description).toBe(PHOTO);
  });

  it('writes nothing when his media carries a safety flag', async () => {
    const voiceInputs: VoiceInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['x'] }, voiceInputs),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
    });

    const turn = await session.handleFanMessage('regarde', [{ ...PHOTO, flags: ['possible_minor'] }]);

    expect(turn).toMatchObject({ handoff: ['possible_minor'], isBlocked: true, bubbles: [] });
    expect(voiceInputs).toHaveLength(0);
  });
});

describe('persona file', () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../../../../../../../personas/${path}`, import.meta.url), 'utf8');

  it('reads the placeholder persona of the repository', () => {
    const persona = readPersonaFile(read('messalina/v0.0.0.yaml'), 'Messa', '2026-10-17');
    expect(persona.creatorName).toBe('Messa');
    expect(persona.forbiddenTerms).toEqual([]);
    expect(persona.alertKeywords).toEqual([]);
    // Without her own thresholds, his desire score waits for the defaults (P3-12).
    expect(persona.offerLimits.minDesire).toBe(70);
    expect(persona.sexualizationLimits.minDesireToOpen).toBe(40);
  });

  it('takes the first name, the disgusts and the forbidden words of a filled persona', () => {
    const persona = readPersonaFile(read('demo/v0.1.0.yaml'), 'X', '2026-10-17');
    expect(persona.creatorName).toBe('Elena');
    // Her pace of scripts and the heat they wait for come from her persona, for the policy (strategies.script_launch).
    expect(persona.offerLimits).toEqual({ cooldownHours: 12, minDesire: 75 });
    expect(persona.sexualizationLimits.minDesireToOpen).toBe(45);
    expect(persona.forbiddenTerms).toEqual([
      'Insultes',
      'Humiliation',
      "Je t'aime",
      'Mon adresse',
      'Mon numéro',
    ]);
    // Her alert keywords, for code to watch (P4-01).
    expect(persona.alertKeywords).toEqual([
      'IA',
      'Bot',
      'Robot',
      'Vocal',
      'Rencontre',
      'Rendez-vous',
      'Numéro',
    ]);
  });

  it('gives the model her sheet under Desirali’s labels, her age and own way to run each stage, never what code applies (ADR 0079)', () => {
    const { personaSheet } = readPersonaFile(read('demo/v0.3.0.yaml'), 'X', '2026-11-06');
    expect(personaSheet).toMatch(/^Identité et informations de base:$/m);
    expect(personaSheet).toContain('Âge: 25');
    expect(personaSheet).toContain('Langues parlées:\n    - Français\n    - Espagnol');
    expect(personaSheet).toMatch(/^Intimité:$/m);
    // The last panel has no title: its one answer stands on its own.
    expect(personaSheet).toMatch(/^Zones interdites: La politique/m);
    // Unanswered (her weight, her partners) stays out.
    expect(personaSheet).not.toMatch(/Poids|Nombre de partenaires/);
    // Her written approach to the getting-to-know stage reaches the models; its numbers stay in code.
    expect(personaSheet).toContain('Une question à la fois');
    expect(personaSheet).toContain('targets:');
    expect(personaSheet).not.toMatch(
      /birth_date|Date de naissance|timezone|Fuseau|response_delay|cooldown|max_messages|initiate_after|min_desire|follow_ups|notifications/,
    );
  });

  it('reads a format-1 file through its conversion, with the same sheet the screen would open', () => {
    const { personaSheet } = readPersonaFile(read('demo/v0.1.0.yaml'), 'X', '2026-10-17');
    expect(personaSheet).toContain('Âge: 25');
    expect(personaSheet).toContain('Surnom: Elena');
    expect(personaSheet).not.toMatch(/^(details|additional_info|lifestyle|tastes):/m);
  });

  it('gives the code her pace, her pet names and whether she splits her messages', () => {
    const persona = readPersonaFile(read('demo/v0.1.0.yaml'), 'X', '2026-10-17');
    expect(persona.offerLimits).toEqual({ cooldownHours: 12, minDesire: 75 });
    expect(persona.splitMessages).toBe(true);
    expect(persona.petNames).toEqual(['Toi', 'Beau gosse', 'Mon grand']);
  });

  it('gives the code her follow-up delays, none when she has them off', () => {
    const source = read('demo/v0.1.0.yaml');
    expect(readPersonaFile(source, 'X', '2026-10-17').followUps).toEqual({
      delaysHours: [12, 24],
      spirit: null,
    });
    const off = source.replace('follow_ups:\n  enabled: true', 'follow_ups:\n  enabled: false');
    expect(readPersonaFile(off, 'X', '2026-10-17').followUps.delaysHours).toEqual([]);
  });

  it('gives the models her typical replies, her canvas lines, and the code her forbidden emojis', () => {
    const persona = readPersonaFile(read('demo/v0.3.0.yaml'), 'X', '2026-11-06');
    expect(persona.personaSheet).toContain('Arrête tu vas me faire rougir');
    // The canvas lines she chose, in her order, for the brain's `kycMissing`.
    expect(persona.personaSheet).toContain('kyc_collect:\n  - Prénom\n  - Âge\n  - Localisation');
    expect(persona.forbiddenEmojis).toEqual(['😂']);
    expect(guardSettingsOf(persona).forbiddenEmojis).toEqual(['😂']);
    // A format-1 file without her chosen lines: all seven, and no forbidden emoji.
    const before = readPersonaFile(read('demo/v0.1.0.yaml'), 'X', '2026-10-28');
    expect(before.personaSheet).toContain('  - Situation');
    expect(before.forbiddenEmojis).toEqual([]);
  });

  it('refuses a file outside the persona schema', () => {
    expect(() => readPersonaFile('identity:\n  first_name: Lina\n', 'X', '2026-10-17')).toThrow();
  });
});

describe('playground session, the offer policy and the cursor', () => {
  const OFFER: Brief = {
    ...BRIEF,
    intent: 'sexting',
    sentiment: 'aroused',
    factsProposed: [{ category: 'identity', key: 'age', value: '30', kind: 'declared', confidence: 1 }],
    action: 'offer',
    replyBrief: 'Lui proposer la vidéo de la douche.',
    // The trial script the brain picks among those offered (ADR 0103 § 15): « s1 », the first permitted.
    scriptPick: 's1',
  };
  // He says he is alone and free in each message: the gate before a script is his heat alone (ADR 0103 § 11).
  const FREE_OFFER: Brief = { ...OFFER, desireSignals: ['alone', 'free_now'] };
  // His desire score is counted for real here; 0 lets the pace and the cursor be tested on their own.
  const session = (voiceInputs: VoiceInput[], withPace: boolean, minDesire = 0, brief: Brief = FREE_OFFER) =>
    createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Mmh toi 😏'] }, voiceInputs, [], brief),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
      now: () => new Date('2026-10-17T20:00:00Z'),
      sexualizationLimits: { initiateAfterHours: 0, minHoursBeforeFollowing: 0, minDesireToOpen: 0 },
      ...(withPace && { offerLimits: { cooldownHours: 10, minDesire } }),
    });

  it('confirms his age when he states it, then plays a trial script step by step (ADR 0103 § 15)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const playground = session(voiceInputs, true);
    // His age is confirmed by this message: the script waits for the next one, as for a real fan.
    await playground.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    expect(playground.scriptRun).toBeNull();
    // The offered teaser first, written as a plain answer with its media; then the paid step, as an offer.
    await playground.handleFanMessage('Encore');
    await playground.handleFanMessage('Montre-moi');
    expect(firstWritten(voiceInputs).map((input) => input.brief.action)).toEqual(['reply', 'reply', 'offer']);
    // 22 h in Paris: her night script.
    expect(playground.scriptRun?.script.scriptRef).toBe('essai-nuit');
    expect(playground.scriptRun?.run.steps.map((step) => [step.kind, step.outcome])).toEqual([
      ['free', 'sent'],
      ['paid', 'sent'],
    ]);
  });

  it('steers back a fan who goes sexual before stating his age', async () => {
    const voiceInputs: VoiceInput[] = [];
    await session(voiceInputs, true).handleFanMessage('T’es trop bonne');
    expect(voiceInputs[0]?.brief.action).toBe('reply');
    expect(voiceInputs[0]?.brief.replyBrief).toContain('ralentit');
  });

  it('does not ask a simulated fan she knows for his age again (audit du 16/11, H6)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const playground = session(voiceInputs, true);
    playground.confirmAge(new Date('2026-10-14T20:00:00Z'));
    const turn = await playground.handleFanMessage('T’es trop bonne');
    expect(turn.cursor?.reason).not.toBe('age_unconfirmed');
    expect(voiceInputs[0]?.brief.replyBrief ?? '').not.toContain('ralentit');
    // Back to a new fan: his age is unknown again.
    playground.reset();
    playground.confirmAge(null);
    // The same session, not a fresh one: what is checked is that the reset forgets his age.
    await playground.handleFanMessage('T’es trop bonne');
    expect(voiceInputs[1]?.brief.replyBrief).toContain('ralentit');
  });

  it('offers only once his desire score reaches hers, as it builds message after message (P3-12)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const playground = session(voiceInputs, true, 99);
    const scores: number[] = [];
    const opened: boolean[] = [];
    for (const text of [
      'J’ai 30 ans et t’es trop bonne',
      'Tu me rends fou',
      'J’ai envie de toi',
      'Montre-moi',
    ]) {
      // Three minutes between messages: neither a quick nor a slow reply, only what he says counts here.
      playground.advance(3 * 60_000);
      scores.push((await playground.handleFanMessage(text)).desire?.score ?? -1);
      opened.push(playground.scriptRun !== null);
    }
    expect(opened).toEqual([false, false, false, true]);
    expect(scores.every((score, i) => i === 0 || score > (scores[i - 1] ?? 0))).toBe(true);
    // 34, 64, 98, then 100: her 99 is reached on the fourth message only.
    expect(scores.at(-2)).toBeLessThan(99);
    expect(scores.at(-1)).toBeGreaterThanOrEqual(99);
    // The script opens on the fourth message only, with its offered teaser.
    expect(firstWritten(voiceInputs).map((input) => input.brief.action)).toEqual([
      'reply',
      'reply',
      'reply',
      'reply',
    ]);
    expect(playground.scriptRun?.run.steps.map((step) => step.kind)).toEqual(['free']);
  });

  it('offers nothing while he has not said he is alone and free (ADR 0103 § 11)', async () => {
    const voiceInputs: VoiceInput[] = [];
    const playground = session(voiceInputs, true, 0, OFFER);
    await playground.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    await playground.handleFanMessage('Encore');
    expect(firstWritten(voiceInputs).map((input) => input.brief.action)).toEqual(['reply', 'reply']);
  });

  it('says his availability and the gate under his score, as the gate read them (ADR 0103 § 14)', async () => {
    const closed = session([], true, 0, OFFER);
    const first = await closed.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    expect(first.desire?.availability?.record.state).toBe('unknown');
    expect(first.desire?.availability?.gate).toEqual({ open: false, missing: ['availability_unconfirmed'] });

    const open = session([], true);
    const turn = await open.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    expect(turn.desire?.availability?.record.state).toBe('confirmed');
    expect(turn.desire?.availability?.record.seen).toEqual(['alone', 'free_now']);
    expect(turn.desire?.availability?.gate).toEqual({ open: true });
    expect(open.desireTrail[0]?.availability?.gate.open).toBe(true);
  });

  it('says she asked whether he is free on the message she asked it only (ADR 0103 § 13)', async () => {
    const playground = session([], true, 0, OFFER);
    // The adult age he states confirms it at once (Charles, 16/11): she asks on this very message.
    const first = await playground.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    expect(first.desire?.availability?.asked).toBe(true);
    playground.advance(3 * 60_000);
    const second = await playground.handleFanMessage('Tu me rends fou');
    // `askedAt` unchanged: she did not ask again.
    expect(second.desire?.availability?.record.askedAt).toEqual(first.desire?.availability?.record.askedAt);
    expect(second.desire?.availability?.asked).toBe(false);
  });

  it('counts his reply speed on the simulated clock, as production does (P3-12)', async () => {
    const quick = session([], true);
    await quick.handleFanMessage('Salut toi');
    quick.advance(60_000);
    const fast = await quick.handleFanMessage('Je suis là');
    expect(fast.desire?.signals).toContain('quick_reply');

    // The clock did not move: his speed is not measured, or every message would count as a quick reply.
    const still = session([], true);
    await still.handleFanMessage('Salut toi');
    const unmeasured = await still.handleFanMessage('Je suis là');
    expect(unmeasured.desire?.signals).not.toContain('quick_reply');

    const slow = session([], true);
    await slow.handleFanMessage('Salut toi');
    slow.advance(2 * 3_600_000);
    const late = await slow.handleFanMessage('Je suis là');
    expect(late.desire?.signals).toContain('slow_reply');
    expect(late.desire?.signals).not.toContain('quick_reply');
  });

  it('keeps the score each of his messages left, and a branch cuts it back', async () => {
    const playground = session([], true);
    await playground.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    await playground.handleFanMessage('Tu me rends fou');
    expect(playground.desireTrail).toHaveLength(2);
    expect(playground.desireTrail[0]?.before).toBeNull();
    expect(playground.desireTrail[1]?.before).not.toBeNull();
    expect(playground.desireTrail[1]?.weightsVersion).toMatch(/^desire-/);
    playground.branchAt(2);
    expect(playground.desireTrail).toHaveLength(1);
  });

  it('says why the policy refused an offer, and what the cursor decided', async () => {
    const playground = session([], true, 70);
    const first = await playground.handleFanMessage('J’ai 30 ans et t’es trop bonne');
    // The adult age he states confirms it at once (Charles, 16/11): the cursor lets her follow him.
    expect(first.cursor).toEqual({ kind: 'free' });
    // The brain offers on the very message that confirms his age: no step goes before it was known, and it says so.
    expect(first.offerRefused).toBe('age_unconfirmed');
    // His score is still under her 70 at the next one: the gate before any sale says no, and why.
    const second = await playground.handleFanMessage('Encore');
    expect(second.desire?.score).toBeLessThan(70);
    expect(second.offerRefused).toBe('desire_below_threshold');
  });

  it('offers nothing without her pace of scripts', async () => {
    const voiceInputs: VoiceInput[] = [];
    const playground = session(voiceInputs, false);
    await playground.handleFanMessage('J’ai 30 ans');
    await playground.handleFanMessage('T’es trop bonne');
    expect(firstWritten(voiceInputs).map((input) => input.brief.action)).toEqual(['reply', 'reply']);
  });
});

describe('playground session, a fictive sale (ADR 0103 § 15-17)', () => {
  const HOT: Brief = {
    ...BRIEF,
    intent: 'sexting',
    sentiment: 'aroused',
    factsProposed: [{ category: 'identity', key: 'age', value: '30', kind: 'declared', confidence: 1 }],
    action: 'offer',
    replyBrief: 'Lui proposer la suite.',
    scriptPick: 's1',
    desireSignals: ['alone', 'free_now'],
  };
  /** At 22 h in Paris, his age said, the teaser sent, then the paid step: what « Payer » and « Refuser » act on. */
  async function atPaidStep(brief: Brief = HOT, herScripts?: () => Promise<Catalogue>) {
    const playground = createPlaygroundSession({
      ...(herScripts !== undefined && { herScripts }),
      gateway: fakeGateway({ bubbles: ['Mmh toi 😏'] }, [], [], brief),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
      now: () => new Date('2026-10-17T20:00:00Z'),
      sexualizationLimits: { initiateAfterHours: 0, minHoursBeforeFollowing: 0, minDesireToOpen: 0 },
      offerLimits: { cooldownHours: 10, minDesire: 0 },
    });
    for (const text of ['J’ai 30 ans', 'Encore', 'Montre-moi']) await playground.handleFanMessage(text);
    return playground;
  }
  const lastMedia = (playground: Awaited<ReturnType<typeof atPaidStep>>) =>
    playground.history.findLast((turn) => turn.media !== undefined);

  it('sends each step as the platform does after her text: its words, the teaser open, the bundle locked', async () => {
    const playground = await atPaidStep();
    const media = playground.history.filter((turn) => turn.media !== undefined && turn.from === 'creator');
    expect(media.map((turn) => turn.media?.map((m) => m.isLocked))).toEqual([[false], [false, true, true]]);
    expect(media.map((turn) => turn.text)).toEqual(['Enfin rentrée 😌', 'Juste entre nous']);
    expect(media.map((turn) => playground.stepMediaOf(turn))).toEqual([
      [{ ref: 'essai-media-8', teaser: false }],
      [
        { ref: 'essai-media-9', teaser: true },
        { ref: 'essai-media-10', teaser: false },
        { ref: 'essai-media-11', teaser: false },
      ],
    ]);
    expect(playground.catalogue).toEqual({ source: 'trial', unavailable: null });
    expect(media.map((turn) => playground.trialStepOf(turn)?.state)).toEqual(['offered', 'waiting']);
    const paid = lastMedia(playground);
    expect(paid === undefined ? undefined : playground.trialStepOf(paid)).toMatchObject({
      kind: 'paid',
      priceCents: 1200,
    });
  });

  it('buys fictively: the media opens, his spending grows, and the next step goes at his next message', async () => {
    const playground = await atPaidStep();
    expect(playground.buyStep()).toBe('done');
    const bought = lastMedia(playground);
    expect(bought?.media?.map((m) => m.isLocked)).toEqual([false, false, false]);
    expect(bought === undefined ? undefined : playground.trialStepOf(bought)?.state).toBe('bought');
    expect(playground.situation.spentCents).toBe(1200);
    expect(playground.fictiveSpentCents).toBe(1200);
    // Nothing more waits: a second purchase does nothing.
    expect(playground.buyStep()).toBe('nothing_waiting');

    await playground.handleFanMessage('Wow');
    expect(playground.scriptRun?.run.steps.map((step) => step.outcome)).toEqual(['sent', 'bought', 'sent']);
    expect(playground.buyStep()).toBe('done');
    // The last step bought: the script is bought out.
    expect(playground.scriptRun?.run.status).toBe('bought_out');
    expect(playground.fictiveSpentCents).toBe(3200);
  });

  it('refuses: the script stops there, and says why no step goes after', async () => {
    const playground = await atPaidStep();
    expect(playground.refuseStep()).toBe('done');
    expect(playground.scriptRun?.run.status).toBe('refused');
    const refused = lastMedia(playground);
    expect(refused === undefined ? undefined : playground.trialStepOf(refused)?.state).toBe('refused');
    expect(playground.refuseStep()).toBe('nothing_waiting');
    const turn = await playground.handleFanMessage('Ok');
    expect(turn.offerRefused).toBe('after_refusal');
    expect(playground.situation.spentCents).toBe(0);
  });

  it('counts two messages about something else as a refusal, as production does', async () => {
    const playground = await atPaidStep();
    await playground.handleFanMessage('Tu fais quoi demain');
    await playground.handleFanMessage('Et ce week-end');
    expect(playground.scriptRun?.run.status).toBe('refused');
  });

  it('refuses a fictive purchase once his distress froze his sales, as production never sells then', async () => {
    const playground = await atPaidStep();
    await playground.handleFanMessage('J’en peux plus, je veux en finir');
    expect(playground.salesFrozen).toBe(true);
    expect(playground.buyStep()).toBe('sales_frozen');
    expect(playground.fictiveSpentCents).toBe(0);
    // Back before that message, his sales are open again.
    playground.branchAt(4);
    expect(playground.salesFrozen).toBe(false);
  });

  it('goes back with a branch, purchases included, and starts over with a reset', async () => {
    const playground = await atPaidStep();
    playground.buyStep();
    await playground.handleFanMessage('Wow');
    playground.branchAt(3);
    expect(playground.scriptRun?.run.steps.map((step) => step.outcome)).toEqual(['sent']);
    expect(playground.situation.spentCents).toBe(0);
    expect(playground.fictiveSpentCents).toBe(0);
    playground.reset();
    expect(playground.scriptRun).toBeNull();
  });

  describe('with one of her versions played, her own scripts (ADR 0103 § 15)', () => {
    // An invented script standing for one of hers: her catalogue as the composition root reads it.
    const night = TRIAL_CATALOGUE[1];
    const hers = night === undefined ? [] : [{ ...night, name: 'Script inventé · nuit' }];

    it('sells from her catalogue, read again at each of his messages, by the same rules', async () => {
      let reads = 0;
      const playground = await atPaidStep(HOT, () => {
        reads += 1;
        return Promise.resolve({ source: 'hers', scripts: hers, unavailable: null });
      });
      expect(reads).toBe(3);
      expect(playground.catalogue).toEqual({ source: 'hers', unavailable: null });
      expect(playground.scriptRun).toMatchObject({ source: 'hers', name: 'Script inventé · nuit' });
      const paid = lastMedia(playground);
      expect(paid === undefined ? undefined : playground.trialStepOf(paid)).toMatchObject({
        source: 'hers',
        kind: 'paid',
        state: 'waiting',
      });
      expect(playground.buyStep()).toBe('done');
    });

    it('plays the trial scripts when none of hers is ready or her scripts cannot be read, and says why', async () => {
      const none = await atPaidStep(HOT, () =>
        Promise.resolve({ source: 'hers', scripts: [], unavailable: 'none_ready' }),
      );
      expect(none.catalogue).toEqual({ source: 'trial', unavailable: 'none_ready' });
      expect(none.scriptRun).toMatchObject({ source: 'trial' });

      const failing = await atPaidStep(HOT, () => Promise.reject(new Error('base injoignable')));
      expect(failing.catalogue).toEqual({ source: 'trial', unavailable: 'unreadable' });
      expect(failing.scriptRun).toMatchObject({ source: 'trial' });
    });
  });
});

describe('playground session, follow-ups (P3-10)', () => {
  // Noon in Paris (summer time): her day.
  const NOON = new Date('2026-10-17T10:00:00Z');
  const HOUR = 3_600_000;

  it('follows up on his silence at her delays, then stops, with no brain call', async () => {
    const voiceInputs: VoiceInput[] = [];
    const brainInputs: ConversationInput[] = [];
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Tu fais quoi ?'] }, voiceInputs, brainInputs),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
      now: () => NOON,
      followUps: { delaysHours: [12, 24], spirit: null },
    });
    expect(await session.followUp()).toEqual({ kind: 'nothing_to_follow_up' });
    await session.handleFanMessage('Moi c’est Julien');
    expect(await session.followUp()).toEqual({
      kind: 'not_due',
      step: 0,
      dueAt: new Date(NOON.getTime() + 12 * HOUR),
    });
    // 12 h later is 00:00 her time: her quiet hours, back at 9:00.
    session.advance(12 * HOUR);
    expect(await session.followUp()).toMatchObject({ kind: 'later', reason: 'follow_up_quiet_hours' });
    session.advance(9 * HOUR);
    const first = await session.followUp();
    expect(first).toMatchObject({ kind: 'written', step: 0, turn: { bubbles: ['Tu fais quoi ?'] } });
    expect(brainInputs).toHaveLength(1);
    expect(voiceInputs.at(-1)?.brief.replyBrief).toContain('depuis 21 h');
    expect(await session.followUp()).toMatchObject({ kind: 'not_due', step: 1 });
    session.advance(3 * HOUR);
    expect(await session.followUp()).toMatchObject({ kind: 'written', step: 1 });
    expect(await session.followUp()).toEqual({ kind: 'skip', reason: 'follow_up_plan_over' });
    // He writes again: the count starts over from his new message.
    await session.handleFanMessage('Pardon j’étais au boulot');
    expect(await session.followUp()).toMatchObject({ kind: 'not_due', step: 0 });
  });

  it('never follows up without her delays', async () => {
    const session = createPlaygroundSession({
      gateway: fakeGateway({ bubbles: ['Coucou'] }),
      creatorName: 'Lina',
      personaSheet: 'fiche',
      guardSettings: settings,
      languages: FRENCH,
      now: () => NOON,
    });
    await session.handleFanMessage('Salut');
    expect(await session.followUp()).toEqual({ kind: 'skip', reason: 'follow_up_plan_over' });
  });
});
