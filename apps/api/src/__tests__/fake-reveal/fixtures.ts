import type { FakeFixture, FakeMessage } from './model';

/**
 * FakeReveal's starting worlds. Everything is invented (CLAUDE.md: no real fan or creator data): pseudonyms
 * `fan_test_NN`, texts « Message de test N ». The default world follows docs/reference/fake-reveal.md: 12 fans
 * (3 payers, 1 who never wrote), one conversation over 300 messages, 15 media in 3 folders, 4 scripts of 3 steps
 * at 5, 15 and 30, one sent whole to a fan and one sent up to step 2 to another.
 */

const START = Date.parse('2026-10-01T10:00:00.000Z');
const MINUTE = 60_000;

function at(minutes: number): string {
  return new Date(START + minutes * MINUTE).toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function message(
  input: Partial<FakeMessage> & Pick<FakeMessage, 'id' | 'conversationId' | 'direction' | 'createdAt'>,
): FakeMessage {
  return {
    kind: 'text',
    text: '',
    mediaIds: [],
    teaserMediaIds: [],
    priceCents: null,
    unlockedAt: null,
    author: null,
    scriptId: null,
    stepIndex: null,
    nonce: null,
    deletedAt: null,
    ...input,
  };
}

const TEAM_MEMBER = 'Chatteur bot';
const SESSION_TOKEN = 'fake-reveal-session-token';
const PRICES = [500, 1500, 3000];
const FOLDERS = ['SCRIPT 1 | ☀️', 'SCRIPT 2 | 🌙', 'Divers'];

export function defaultFixture(): FakeFixture {
  const fans = Array.from({ length: 12 }, (_, i) => ({
    id: `fan_${pad(i + 1)}`,
    username: `fan_test_${pad(i + 1)}`,
    firstName: i % 4 === 3 ? null : `Prénom${pad(i + 1)}`,
    subscribedAt: at(-60 * 24 * (30 - i)),
    ageVerified: true,
  }));
  const conversations = fans.map((fan) => ({
    id: `conv_${fan.id.slice(4)}`,
    fanId: fan.id,
    unreadCount: 0,
    gone: false,
  }));
  const media = Array.from({ length: 15 }, (_, i) => ({
    id: `media_${pad(i + 1)}`,
    kind: i % 3 === 2 ? ('video' as const) : ('image' as const),
    folder: FOLDERS[Math.floor(i / 5)] ?? 'Divers',
  }));
  const scripts = Array.from({ length: 4 }, (_, s) => ({
    id: `script_${String(s + 1)}`,
    name: `Script de test ${String(s + 1)}`,
    folder: FOLDERS[s % 2] ?? 'Divers',
    steps: PRICES.map((priceCents, step) => ({
      name: `Étape ${String(step + 1)}`,
      text: `Coucou %NAME%, étape ${String(step + 1)} du script ${String(s + 1)}`,
      mediaIds: [`media_${pad(((s * 3 + step) % 15) + 1)}`],
      teaserMediaIds: step === 0 ? [] : [`media_${pad(((s * 3 + step + 7) % 15) + 1)}`],
      priceCents,
    })),
  }));

  const messages: FakeMessage[] = [];
  let n = 0;
  const nextId = (): string => `msg_${String(++n).padStart(4, '0')}`;

  // Fan 01: a long conversation, for history pagination (320 messages, alternating).
  for (let i = 0; i < 320; i++) {
    messages.push(
      message({
        id: nextId(),
        conversationId: 'conv_01',
        direction: i % 2 === 0 ? 'in' : 'out',
        text: `Message de test ${String(i + 1)}`,
        author: i % 2 === 0 ? null : TEAM_MEMBER,
        createdAt: at(i * 5),
      }),
    );
  }
  // Fans 02 to 11: a short exchange each. Fan 12 never wrote.
  for (const conversation of conversations.slice(1, 11)) {
    const base = 2_000 + Number(conversation.id.slice(5)) * 30;
    messages.push(
      message({
        id: nextId(),
        conversationId: conversation.id,
        direction: 'in',
        text: 'Salut',
        createdAt: at(base),
      }),
      message({
        id: nextId(),
        conversationId: conversation.id,
        direction: 'out',
        text: 'Coucou toi',
        author: TEAM_MEMBER,
        createdAt: at(base + 2),
      }),
    );
  }

  // Script 1 sent whole to fan 02 (steps 1 and 2 bought), script 2 sent up to step 2 to fan 03 (nothing bought).
  const scriptUses: FakeFixture['scriptUses'] = [];
  const transactions: FakeFixture['transactions'] = [];
  const sendScript = (
    fanId: string,
    scriptIndex: number,
    steps: number,
    bought: number,
    from: number,
  ): void => {
    const script = scripts[scriptIndex];
    if (script === undefined) return;
    for (let step = 0; step < steps; step++) {
      const def = script.steps[step];
      if (def === undefined) continue;
      const fan = fans.find((f) => f.id === fanId);
      const sentAt = at(from + step * 20);
      const id = nextId();
      const unlockedAt = step < bought ? at(from + step * 20 + 5) : null;
      messages.push(
        message({
          id,
          conversationId: `conv_${fanId.slice(4)}`,
          direction: 'out',
          kind: 'bundle',
          text: def.text.replaceAll('%NAME%', fan?.firstName ?? ''),
          mediaIds: def.mediaIds,
          teaserMediaIds: def.teaserMediaIds,
          priceCents: def.priceCents,
          unlockedAt,
          author: TEAM_MEMBER,
          scriptId: script.id,
          stepIndex: step,
          createdAt: sentAt,
        }),
      );
      scriptUses.push({ fanId, scriptId: script.id, stepIndex: step, messageId: id, sentAt });
      if (unlockedAt !== null) {
        transactions.push({
          id: `tx_${pad(transactions.length + 1)}`,
          fanId,
          kind: 'ppv',
          amountCents: def.priceCents,
          messageId: id,
          createdAt: unlockedAt,
        });
      }
    }
  };
  sendScript('fan_02', 0, 3, 2, 2_200);
  sendScript('fan_03', 1, 2, 0, 2_300);
  // Fan 04, the third payer: a tip.
  transactions.push({
    id: `tx_${pad(transactions.length + 1)}`,
    fanId: 'fan_04',
    kind: 'tip',
    amountCents: 1000,
    messageId: null,
    createdAt: at(2_400),
  });

  return {
    now: at(3_000),
    creator: { id: 'creator_test', username: 'creatrice_test', currency: 'EUR' },
    teamMember: { name: TEAM_MEMBER },
    sessionToken: SESSION_TOKEN,
    fans,
    conversations,
    messages,
    media,
    scripts,
    scriptUses,
    transactions,
    notes: [
      {
        fanId: 'fan_02',
        text: 'Prénom : Prénom02\nLocalisation : Ville de test\nPassions : randonnée',
        updatedAt: at(2_250),
      },
    ],
    creatorNote: { text: 'Note du modèle de test', updatedAt: at(0) },
  };
}

/** A world with one fan and nothing said yet. */
export function emptyFixture(): FakeFixture {
  const base = defaultFixture();
  const fan = base.fans[0];
  return {
    ...base,
    fans: fan === undefined ? [] : [fan],
    conversations: fan === undefined ? [] : [{ id: 'conv_01', fanId: fan.id, unreadCount: 0, gone: false }],
    messages: [],
    scriptUses: [],
    transactions: [],
    notes: [],
  };
}

export const FIXTURES = { default: defaultFixture, empty: emptyFixture } as const;
export type FixtureName = keyof typeof FIXTURES;
