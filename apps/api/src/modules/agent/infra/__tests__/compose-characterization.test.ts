import { emptyCustomPriceGrid, type MediaDescription } from '@impera/contracts';
import type { Brief, VoiceOutput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { BRIEF, fakeGateway, type GatewayScript, type GatewaySeen } from '../../../../__tests__/support/llm';
import { DEFAULT_GUARD_SETTINGS } from '../../domain/guards';
import type { PlatformScriptView, ScriptRun } from '../../domain/script-run';
import { composeTurn, type ComposerPersona, type ComposeTurnInput } from '../compose';

/**
 * A characterization of `composeTurn` (refactor « compose-split »): each turn below runs the whole path, fake models
 * only, and its snapshot keeps everything that leaves it: the composed turn and what the brain and the voice were
 * asked. The persona is the invented demo creator; nothing here is a real fan or a real creator.
 */

const NOW = new Date('2026-11-20T21:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const hoursAgo = (hours: number) => minutesAgo(hours * 60);

const PERSONA: ComposerPersona = {
  creatorName: 'Elena',
  personaSheet: 'Fiche de démonstration : Elena, étudiante inventée.',
  guardSettings: {
    ...DEFAULT_GUARD_SETTINGS,
    forbiddenTerms: ['olives'],
    neverDo: ['pieds'],
    degradingWords: ['chienne'],
    closeOnlyWords: [{ words: ['mon coeur'], minTier: 3 }],
  },
  playsJealous: true,
  profileBio: 'Étudiante, amoureuse des toits de Lyon.',
  voiceExamples: [
    { id: 'ex-1', text: 'Coucou toi, ta journée ?' },
    { id: 'ex-2', text: 'Tu me fais rire 😄' },
  ],
  spokenLanguages: ['french', 'english'],
  languageExamples: { english: ['Hey you, how was your day?'] },
};

const reading = (overrides: Partial<Brief>): Brief => ({ ...BRIEF, ...overrides });

const BASE: ComposeTurnInput = {
  history: [
    { from: 'fan', text: 'Salut, ça va ?', at: hoursAgo(30) },
    { from: 'creator', text: 'Coucou, oui et toi ?', at: hoursAgo(29.9) },
    { from: 'fan', text: 'Ça va bien, tu fais quoi ce soir ?', at: minutesAgo(2) },
  ],
  fanText: 'Ça va bien, tu fais quoi ce soir ?',
  media: [],
  fanNotes: 'Prénom : Max\nAime la lingerie et les jeux de rôle',
  brainNotes: 'A de l’argent en début de mois',
  situation: {
    now: NOW,
    timeZone: 'Europe/Paris',
    relationshipStartedAt: hoursAgo(30),
    spentCents: 0,
  },
  trace: { creatorId: 'creator-demo', conversationId: 'conversation-demo', draftId: 'draft-demo' },
  random: () => 0,
};

const MEDIA_FLAGGED: MediaDescription = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  factualDescription: 'Une photo floue.',
  durationS: null,
  segments: [],
  intensity: 'soft',
  anatomyVisible: [],
  castMode: 'solo',
  mood: [],
  setting: 'salon',
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: ['self_harm'],
};

const CATALOGUE: readonly PlatformScriptView[] = [
  {
    scriptRef: 'script-a',
    moment: null,
    description: 'Lingerie rouge, une soirée de démonstration',
    steps: [
      {
        stepRef: 'a-0',
        kind: 'free',
        priceMinor: null,
        mediaRefs: ['m-a0'],
        mediaSheet: 'Elle en lingerie rouge',
      },
      {
        stepRef: 'a-1',
        kind: 'paid',
        priceMinor: 1_500,
        mediaRefs: ['m-a1'],
        mediaSheet: 'Elle enlève le haut',
        instruction: 'Faire monter la tension',
      },
      { stepRef: 'a-2', kind: 'paid', priceMinor: 2_500, mediaRefs: ['m-a2'], mediaSheet: 'Le final' },
    ],
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  },
  {
    scriptRef: 'script-b',
    moment: 'night',
    description: 'Jeu de rôle infirmière',
    steps: [{ stepRef: 'b-0', kind: 'paid', priceMinor: 1_000, mediaRefs: ['m-b0'] }],
    mediaValidated: true,
    descriptionValidated: true,
    touchesLimits: false,
  },
];

const OFFER: NonNullable<ComposeTurnInput['offer']> = {
  now: NOW,
  lastOfferAt: null,
  hasNoBudget: false,
  flags: { ageConfirmedAt: '2026-11-01T10:00:00.000Z' },
  limits: { cooldownHours: 24, minDesire: 60 },
};

const READY: NonNullable<ComposeTurnInput['availability']> = {
  state: 'confirmed',
  signal: 'free_now',
  at: minutesAgo(5),
  expiresAt: new Date(NOW.getTime() + 2 * 3_600_000),
  seen: ['alone', 'free_now'],
  sexualizedAt: minutesAgo(5),
  askedAt: null,
  hotAt: minutesAgo(10),
};

const ADULT = {
  limits: { initiateAfterHours: 2, minHoursBeforeFollowing: 1, minDesireToOpen: 40 },
  ageConfirmed: true,
  noExplicit: false,
};

const HOT = {
  previous: { score: 90, at: minutesAgo(1) },
  measured: { lengthRatio: 1.5, replySeconds: 20, suggestiveEmojis: 1, inARow: 1 },
  ageDisputed: false,
  counted: false,
};

const runOf = (overrides: Partial<ScriptRun>): ScriptRun => ({
  scriptRef: 'script-a',
  status: 'open',
  steps: [],
  ignoredMessages: 0,
  startedAt: minutesAgo(40),
  endedAt: null,
  ...overrides,
});

const RUN_WAITING = runOf({
  steps: [
    {
      stepIndex: 0,
      kind: 'free',
      outcome: 'opened',
      priceMinor: null,
      sentAt: minutesAgo(30),
      at: minutesAgo(29),
    },
    {
      stepIndex: 1,
      kind: 'paid',
      outcome: 'sent',
      priceMinor: 1_500,
      sentAt: minutesAgo(10),
      at: minutesAgo(10),
    },
  ],
});

const RUN_BOUGHT = runOf({
  steps: [
    {
      stepIndex: 0,
      kind: 'free',
      outcome: 'opened',
      priceMinor: null,
      sentAt: minutesAgo(30),
      at: minutesAgo(29),
    },
    {
      stepIndex: 1,
      kind: 'paid',
      outcome: 'bought',
      priceMinor: 1_500,
      sentAt: minutesAgo(20),
      at: minutesAgo(15),
    },
  ],
});

const SCRIPTS = (latest: ScriptRun | null, sent: readonly number[] = [], bought: readonly number[] = []) => ({
  conversationRef: 'thread-demo',
  catalogue: CATALOGUE,
  history: {
    scripts:
      sent.length === 0 ? [] : [{ scriptRef: 'script-a', sentStepIndexes: sent, boughtStepIndexes: bought }],
  },
  latest,
  countsHisMessage: true,
});

const hotHistory = (text: string) => [
  { from: 'fan' as const, text: 'Coucou ma belle', at: hoursAgo(30) },
  { from: 'creator' as const, text: 'Coucou toi', at: hoursAgo(29.9) },
  { from: 'fan' as const, text: 'Tu me rends fou', at: minutesAgo(45) },
  { from: 'creator' as const, text: 'Ah oui ? raconte', at: minutesAgo(44) },
  { from: 'fan' as const, text, at: minutesAgo(1) },
];

interface Case {
  readonly name: string;
  readonly script: GatewayScript;
  readonly input: ComposeTurnInput;
  readonly persona?: ComposerPersona;
}

const say = (...bubbles: string[]): VoiceOutput => ({ bubbles });

const CASES: readonly Case[] = [
  { name: 'small talk', script: {}, input: BASE },
  {
    name: 'brain fails',
    script: { brain: { code: 'all_models_failed', attempts: [] } },
    input: BASE,
  },
  {
    name: 'voice fails',
    script: { voice: { code: 'all_models_failed', attempts: [] } },
    input: BASE,
  },
  { name: 'media flagged', script: {}, input: { ...BASE, media: [MEDIA_FLAGGED] } },
  {
    name: 'follow-up with meeting tiers',
    script: { voice: say('Tu es passé où mon coeur ?') },
    input: {
      ...BASE,
      followUp: { silentHours: 26.4, spirit: 'légère et drôle' },
      meetingTiers: { newFanHours: 24, closeFanHours: 72, veryCloseFanHours: 240 },
    },
  },
  {
    name: 'aftercare in a running script',
    script: { voice: say('Alors, ça t’a plu ?') },
    input: { ...BASE, aftercare: { saleType: 'ppv', scriptGoesOn: true } },
  },
  {
    name: 'aftercare after a tip',
    script: { voice: say('Merci toi 🥰', 'Vraiment') },
    input: {
      ...BASE,
      aftercare: { saleType: 'tip', scriptGoesOn: false },
      keptLanguage: { value: 'english', source: 'detected' },
    },
  },
  {
    name: 'flirt, age unknown',
    script: { brief: reading({ intent: 'flirt', desireSignals: ['body_compliment'] }) },
    input: {
      ...BASE,
      fanText: 'Tu es vraiment canon',
      sexualization: { ...ADULT, ageConfirmed: false },
    },
  },
  {
    name: 'sexting goes too fast, age unknown',
    script: {
      brief: reading({ intent: 'sexting', sentiment: 'aroused', desireSignals: ['states_desire'] }),
    },
    input: {
      ...BASE,
      fanText: 'J’ai envie de toi',
      sexualization: { ...ADULT, ageConfirmed: false },
    },
  },
  {
    name: 'he states his age',
    script: {
      brief: reading({
        intent: 'kyc_answer',
        factsProposed: [
          { category: 'identity', key: 'age', value: '34', kind: 'declared', confidence: 0.95 },
        ],
      }),
    },
    input: { ...BASE, fanText: 'J’ai 34 ans', sexualization: { ...ADULT, ageConfirmed: false } },
  },
  {
    name: 'hot fan, the brain picks a script',
    script: {
      brief: reading({
        intent: 'sexting',
        sentiment: 'aroused',
        action: 'offer',
        scriptPick: 's1',
        desireSignals: ['states_desire', 'alone', 'free_now'],
      }),
      voice: say('J’ai quelque chose pour toi 😏'),
    },
    input: {
      ...BASE,
      history: hotHistory('Je suis seul chez moi et j’ai envie de toi'),
      fanText: 'Je suis seul chez moi et j’ai envie de toi',
      fanNotes: 'Prénom : Max\nFantasme : lingerie rouge',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(null),
      availability: READY,
      meetingTiers: { newFanHours: 24, closeFanHours: 72, veryCloseFanHours: 240 },
    },
  },
  {
    name: 'a paid step waits, he asks how to pay',
    script: {
      brief: reading({ intent: 'payment_help', sentiment: 'aroused', desireSignals: ['states_desire'] }),
      voice: say('Clique sur le message, c’est 15 €'),
    },
    input: {
      ...BASE,
      history: hotHistory('Comment je fais pour l’ouvrir ?'),
      fanText: 'Comment je fais pour l’ouvrir ?',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(RUN_WAITING, [0, 1]),
      availability: READY,
    },
  },
  {
    name: 'he refuses the paid step',
    script: {
      brief: reading({ intent: 'sexting', scriptReply: 'refused', sentiment: 'negative' }),
      voice: say('Ah bon ? dis-moi pourquoi'),
    },
    input: {
      ...BASE,
      history: hotHistory('Non merci, pas ce soir'),
      fanText: 'Non merci, pas ce soir',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(RUN_WAITING, [0, 1]),
      availability: READY,
    },
  },
  {
    name: 'he just bought, still in the run',
    script: {
      brief: reading({
        intent: 'media_reaction',
        sentiment: 'aroused',
        desireSignals: ['hot_media_reaction', 'close_to_coming'],
      }),
      voice: say('Retiens-toi encore un peu'),
    },
    input: {
      ...BASE,
      history: hotHistory('Wow, je vais craquer'),
      fanText: 'Wow, je vais craquer',
      sexualization: ADULT,
      desire: HOT,
      offer: { ...OFFER, lastPurchaseAt: minutesAgo(15) },
      scripts: SCRIPTS(RUN_BOUGHT, [0, 1], [1]),
      availability: READY,
      situation: { ...BASE.situation, spentCents: 1_500, lastSpentAt: minutesAgo(15) },
    },
  },
  {
    name: 'he came during the run',
    script: {
      brief: reading({ intent: 'sexting', sentiment: 'positive', desireSignals: ['just_came'] }),
      voice: say('Mmh, c’était bon'),
    },
    input: {
      ...BASE,
      history: hotHistory('Je viens de jouir'),
      fanText: 'Je viens de jouir',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(RUN_WAITING, [0, 1]),
      availability: READY,
    },
  },
  {
    name: 'care mode',
    script: {
      brief: reading({ intent: 'distress', risks: ['distress'], sentiment: 'negative' }),
      voice: say('Je suis là'),
    },
    input: {
      ...BASE,
      fanText: 'Je vais pas bien',
      care: (brief) => brief?.risks.includes('distress') === true,
    },
  },
  {
    name: 'voice skipped',
    script: { brief: reading({ action: 'handoff' }) },
    input: { ...BASE, skipVoice: (brief) => brief?.action === 'handoff' },
  },
  {
    name: 'custom order, nobody on shift',
    script: {
      brief: reading({ intent: 'asks_for_service' }),
      voice: say('Je vais voir ce que je peux faire'),
    },
    input: {
      ...BASE,
      fanText: 'Tu peux me faire une vidéo rien que pour moi ?',
      customOrder: { chatterOnShift: false, orderOpen: false, flags: undefined },
    },
  },
  {
    name: 'custom order kept',
    script: { brief: reading({ intent: 'asks_for_service' }), voice: say('Dis-m’en plus') },
    input: {
      ...BASE,
      fanText: 'Tu peux me faire une vidéo rien que pour moi ?',
      customOrder: {
        chatterOnShift: true,
        orderOpen: false,
        flags: undefined,
        order: null,
        grid: emptyCustomPriceGrid(),
      },
    },
  },
  {
    name: 'price objection',
    script: {
      brief: reading({ intent: 'price_objection', objection: 'too_expensive' }),
      voice: say('Je vaux bien ça'),
    },
    input: {
      ...BASE,
      fanText: 'C’est trop cher',
      objections: {
        bank: { too_expensive: [{ id: 'reply0001', text: 'Elle assume son prix.' }] },
        usedReplyIds: new Set<string>(),
      },
    },
  },
  {
    name: 'asks a discount',
    script: { brief: reading({ intent: 'small_talk' }), voice: say('Non, pas de prix') },
    input: { ...BASE, fanText: 'Fais-moi un prix' },
  },
  {
    name: 'asks to meet',
    script: {
      brief: reading({ intent: 'asks_to_meet', risks: ['meet_request'] }),
      voice: say('C’est trop tôt'),
    },
    input: {
      ...BASE,
      fanText: 'On se voit quand ?',
      meeting: { given: ['too_early'], teased: false },
      meetingTiers: { newFanHours: 24, closeFanHours: 72, veryCloseFanHours: 240 },
    },
  },
  {
    name: 'insult, goodnight, time-waster',
    script: {
      brief: reading({ intent: 'other', risks: ['insult'], desireSignals: ['says_goodnight'] }),
      voice: say('Bonne nuit quand même'),
    },
    input: { ...BASE, fanText: 'T’es nulle, bonne nuit', timeWaster: 'slowed' },
  },
  {
    name: 'girlfriend register, worn phrases, jealous',
    script: { voice: say('Tu m’as manqué') },
    input: {
      ...BASE,
      fanText: 'J’ai vu une autre fille hier',
      spenderRegister: 'girlfriend',
      herRecent: [
        'je bois un verre de vin sur les toits',
        'je bois un verre de vin sur les toits',
        'je bois un verre de vin sur les toits',
        'je bois un verre de vin sur les toits',
        'je bois un verre de vin sur les toits',
      ],
    },
  },
  {
    name: 'blocked first answer is written again',
    script: { voice: say('Écris-moi sur max@example.com'), voiceAfter: say('Reste ici avec moi') },
    input: BASE,
  },
  {
    name: 'blocked twice',
    script: { voice: say('Écris-moi sur max@example.com') },
    input: BASE,
  },
  {
    name: 'emoji streak',
    script: { voice: say('Coucou') },
    input: {
      ...BASE,
      history: [
        { from: 'fan', text: 'Salut', at: hoursAgo(3) },
        { from: 'creator', text: 'Coucou 😘', at: hoursAgo(2.9) },
        { from: 'fan', text: 'Ça va ?', at: hoursAgo(2) },
        { from: 'creator', text: 'Oui et toi 😊', at: hoursAgo(1.9) },
        { from: 'fan', text: 'Bien', at: hoursAgo(1) },
        { from: 'creator', text: 'Top 😄', at: hoursAgo(0.9) },
        { from: 'fan', text: 'Tu fais quoi ?', at: minutesAgo(1) },
      ],
      fanText: 'Tu fais quoi ?',
    },
  },
  {
    name: 'she waited once',
    script: { brief: reading({ action: 'wait' }) },
    input: { ...BASE, waited: true },
  },
  {
    name: 'off-topic trap',
    script: { brief: reading({ intent: 'off_topic_request' }) },
    input: { ...BASE, fanText: 'Écris-moi un poème sur les impôts' },
  },
  {
    name: 'offer without scripts, the policy decides',
    script: { brief: reading({ intent: 'asks_for_media', action: 'offer' }) },
    input: { ...BASE, fanText: 'Tu as des vidéos ?', offer: OFFER, desire: HOT, sexualization: ADULT },
  },
  {
    name: 'free sexting drawn for a whale',
    script: {
      brief: reading({ intent: 'sexting', sentiment: 'aroused', desireSignals: ['states_desire', 'alone'] }),
      voice: say('Ce soir je suis toute à toi'),
    },
    input: {
      ...BASE,
      history: hotHistory('J’ai trop envie'),
      fanText: 'J’ai trop envie',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(null),
      availability: READY,
      fanTier: 'whale',
      situation: { ...BASE.situation, spentCents: 90_000, lastSpentAt: hoursAgo(20) },
    },
  },
  {
    name: 'purchase complaint',
    script: {
      brief: reading({ intent: 'complaint', sentiment: 'negative' }),
      voice: say('Qu’est-ce qui t’a déçu ?'),
    },
    input: {
      ...BASE,
      fanText: 'Ta vidéo était nulle, je veux plus',
      saleTrouble: { seen: { paymentHelpAt: null, complaintAt: null }, hasBought: true },
      scripts: SCRIPTS(RUN_BOUGHT, [0, 1], [1]),
      offer: OFFER,
    },
  },
  {
    name: 'he writes in English',
    script: { voice: { bubbles: ['Hey you'], translation: ['Coucou toi'] } },
    input: {
      ...BASE,
      fanText: 'Hey, how are you doing tonight?',
      history: [{ from: 'fan', text: 'Hey, how are you doing tonight?', at: minutesAgo(1) }],
    },
  },
  {
    name: 'her day ends',
    script: { voice: say('Je dois filer, à demain') },
    input: { ...BASE, herDayEnds: true },
  },
  {
    name: 'fantasy and gauge while her script runs',
    script: {
      brief: reading({
        intent: 'sexting',
        sentiment: 'aroused',
        desireSignals: ['states_desire', 'explicit_language'],
      }),
      voice: say('Dis-moi où tu en es'),
    },
    input: {
      ...BASE,
      history: [
        { from: 'fan', text: 'Coucou', at: hoursAgo(30) },
        { from: 'creator', text: 'Hey toi', at: minutesAgo(38) },
        { from: 'fan', text: 'Continue', at: minutesAgo(30) },
        { from: 'creator', text: 'Regarde bien', at: minutesAgo(28) },
        { from: 'fan', text: 'Encore', at: minutesAgo(16) },
        { from: 'creator', text: 'Tu aimes ?', at: minutesAgo(14) },
        { from: 'fan', text: 'Oui, la lingerie rouge me rend fou', at: minutesAgo(1) },
      ],
      fanText: 'Oui, la lingerie rouge me rend fou',
      fanNotes:
        'desires : lingerie rouge · se faire gronder · jeu de rôle infirmière · pirates\noutfits : lingerie',
      sexualization: ADULT,
      desire: HOT,
      offer: { ...OFFER, lastPurchaseAt: minutesAgo(15) },
      scripts: SCRIPTS(RUN_BOUGHT, [0, 1], [1]),
      availability: READY,
      situation: { ...BASE.situation, spentCents: 1_500, lastSpentAt: minutesAgo(15) },
      meetingTiers: { newFanHours: 24, closeFanHours: 72, veryCloseFanHours: 240 },
    },
  },
  {
    name: 'projection on the step he sees',
    script: {
      brief: reading({ intent: 'sexting', sentiment: 'aroused', desireSignals: ['states_desire'] }),
      voice: say('Imagine-toi là'),
    },
    input: {
      ...BASE,
      history: [
        { from: 'fan', text: 'Coucou', at: hoursAgo(30) },
        { from: 'creator', text: 'Regarde bien', at: minutesAgo(28) },
        { from: 'fan', text: 'Elle est belle', at: minutesAgo(1) },
      ],
      fanText: 'Elle est belle',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: SCRIPTS(RUN_WAITING, [0, 1]),
      availability: READY,
    },
  },
  {
    name: 'he comes back after leaving her script',
    script: {
      brief: reading({ intent: 'sexting', sentiment: 'aroused', desireSignals: ['states_desire'] }),
      voice: say('Tu m’avais laissée en plan'),
    },
    input: {
      ...BASE,
      history: hotHistory('Me revoilà, j’ai envie'),
      fanText: 'Me revoilà, j’ai envie',
      sexualization: ADULT,
      desire: HOT,
      offer: OFFER,
      scripts: {
        ...SCRIPTS(
          runOf({
            status: 'stalled',
            startedAt: hoursAgo(30),
            endedAt: hoursAgo(26),
            steps: [
              {
                stepIndex: 0,
                kind: 'free',
                outcome: 'opened',
                priceMinor: null,
                sentAt: hoursAgo(29),
                at: hoursAgo(29),
              },
              {
                stepIndex: 1,
                kind: 'paid',
                outcome: 'sent',
                priceMinor: 1_500,
                sentAt: hoursAgo(28),
                at: hoursAgo(28),
              },
            ],
          }),
          [0, 1],
        ),
        earlier: [],
        teased: 0,
      },
      availability: READY,
    },
  },
];

async function run(one: Case) {
  const seen: GatewaySeen = { voiceCalls: 0, traces: [], brainInputs: [], voiceInputs: [] };
  const composed = await composeTurn(fakeGateway(one.script, seen), one.persona ?? PERSONA, one.input);
  return {
    composed,
    brainInputs: seen.brainInputs,
    voiceInputs: seen.voiceInputs,
    voiceCalls: seen.voiceCalls,
  };
}

describe('composeTurn, characterized (refactor compose-split)', () => {
  it.each(CASES.map((one) => [one.name, one] as const))('%s', async (_name, one) => {
    expect(await run(one)).toMatchSnapshot();
  });
});
