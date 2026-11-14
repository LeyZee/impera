import type { FakeFixture, FakeMessage, FakeScript } from './model';

/**
 * FakeReveal's starting worlds. Everything is invented (CLAUDE.md: no real fan or creator data): pseudonyms
 * `fan_test_NN`, texts « Message de test N ». The default world follows docs/reference/fake-reveal.md: 12 fans
 * (3 payers, 1 who never wrote), one conversation over 300 messages, 15 media in 3 vault folders, 4 sequences of
 * 3 steps (Reveal « scripts ») at 5, 15 and 30 €, one sent whole to a fan and one sent up to step 2 to another.
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
    content: '',
    mediaIds: [],
    bundle: null,
    author: null,
    scriptId: null,
    isUnread: false,
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
    userName: `fan_test_${pad(i + 1)}`,
    firstName: i % 4 === 3 ? null : `Prénom${pad(i + 1)}`,
    createdAt: at(-60 * 24 * (30 - i)),
    cardVerifiedAt: i % 3 === 0 ? at(-60 * 24 * (29 - i)) : null,
  }));
  const conversations = fans.map((fan) => ({
    id: `conv_${fan.id.slice(4)}`,
    fanId: fan.id,
    modelIsUnread: false,
    memberLastReadAt: null,
    note: null,
    isPinned: false,
    createdAt: fan.createdAt,
    gone: false,
  }));
  const folders = FOLDERS.map((name, i) => ({ id: `folder_${String(i + 1)}`, name, createdAt: at(0) }));
  const media = Array.from({ length: 15 }, (_, i) => ({
    id: `media_${pad(i + 1)}`,
    type: i % 3 === 2 ? ('video' as const) : ('photo' as const),
    folderId: `folder_${String(Math.floor(i / 5) + 1)}`,
    fromFanId: null,
    durationSeconds: i % 3 === 2 ? 30 : null,
    createdAt: at(i),
  }));
  const scripts: FakeScript[] = [];
  const sequences = Array.from({ length: 4 }, (_, s) => {
    const ids = PRICES.map((priceCents, step) => {
      const scriptId = `script_${String(s + 1)}_${String(step + 1)}`;
      scripts.push({
        id: scriptId,
        name: `Script de test ${String(s + 1)} · étape ${String(step + 1)}`,
        content: `Coucou %NAME%, étape ${String(step + 1)} du script ${String(s + 1)}`,
        mediaIds: [`media_${pad(((s * 3 + step) % 15) + 1)}`],
        teasingMediaIds: step === 0 ? [] : [`media_${pad(((s * 3 + step + 7) % 15) + 1)}`],
        priceCents,
        createdAt: at(10 + s * 3 + step),
      });
      return scriptId;
    });
    return {
      id: `sequence_${String(s + 1)}`,
      name: `Script de test ${String(s + 1)}`,
      scriptIds: ids,
      createdAt: at(10),
    };
  });

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
        content: `Message de test ${String(i + 1)}`,
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
        content: 'Salut',
        createdAt: at(base),
      }),
      message({
        id: nextId(),
        conversationId: conversation.id,
        direction: 'out',
        content: 'Coucou toi',
        author: TEAM_MEMBER,
        createdAt: at(base + 2),
      }),
    );
  }

  // Sequence 1 sent whole to fan 02 (steps 1 and 2 bought), sequence 2 up to step 2 to fan 03 (nothing bought).
  const transactions: FakeFixture['transactions'] = [];
  const sendSequence = (
    fanId: string,
    sequenceIndex: number,
    steps: number,
    bought: number,
    from: number,
  ): void => {
    const sequence = sequences[sequenceIndex];
    const fan = fans.find((f) => f.id === fanId);
    if (sequence === undefined || fan === undefined) return;
    for (let step = 0; step < steps; step++) {
      const script = scripts.find((s) => s.id === sequence.scriptIds[step]);
      if (script === undefined) continue;
      const id = nextId();
      const paidAt = step < bought ? at(from + step * 20 + 5) : null;
      const transactionId = paidAt === null ? null : `tx_${pad(transactions.length + 1)}`;
      messages.push(
        message({
          id,
          conversationId: `conv_${fanId.slice(4)}`,
          direction: 'out',
          content: script.content.replaceAll('%NAME%', fan.firstName ?? ''),
          bundle: {
            id: `bundle_${id}`,
            priceCents: script.priceCents ?? 0,
            mediaIds: script.mediaIds,
            teasingMediaIds: script.teasingMediaIds,
            paidAt,
            transactionId,
          },
          author: TEAM_MEMBER,
          scriptId: script.id,
          createdAt: at(from + step * 20),
        }),
      );
      if (paidAt !== null && transactionId !== null) {
        transactions.push({
          id: transactionId,
          fanId,
          type: 'bundle',
          amountCents: script.priceCents ?? 0,
          messageId: id,
          createdAt: paidAt,
        });
      }
    }
  };
  sendSequence('fan_02', 0, 3, 2, 2_200);
  sendSequence('fan_03', 1, 2, 0, 2_300);
  // Fan 04, the third payer: a tip.
  transactions.push({
    id: `tx_${pad(transactions.length + 1)}`,
    fanId: 'fan_04',
    type: 'tip',
    amountCents: 1000,
    messageId: null,
    createdAt: at(2_400),
  });

  return {
    now: at(3_000),
    model: {
      id: 'model_test',
      userName: 'creatrice_test',
      displayName: 'Créatrice de test',
      creatorNote: 'Note du modèle de test',
    },
    teamMember: { userId: 'user_bot', name: TEAM_MEMBER },
    sessionToken: SESSION_TOKEN,
    fans,
    conversations: conversations.map((c) =>
      c.fanId === 'fan_02'
        ? { ...c, note: 'Prénom : Prénom02\nLocalisation : Ville de test\nPassions : randonnée' }
        : c,
    ),
    messages,
    folders,
    media,
    scripts,
    sequences,
    transactions,
    notifications: [],
  };
}

/** A world with one fan and nothing said yet. */
export function emptyFixture(): FakeFixture {
  const base = defaultFixture();
  const fan = base.fans[0];
  const conversation = base.conversations[0];
  return {
    ...base,
    fans: fan === undefined ? [] : [fan],
    conversations: conversation === undefined ? [] : [{ ...conversation, note: null }],
    messages: [],
    transactions: [],
    notifications: [],
  };
}

/** Two fans, each with his conversation, and nothing said yet: the connector's contract writes the rest. */
export function quietFixture(): FakeFixture {
  const base = defaultFixture();
  return {
    ...base,
    fans: base.fans.slice(0, 2),
    conversations: base.conversations.slice(0, 2).map((conversation) => ({ ...conversation, note: null })),
    messages: [],
    transactions: [],
    notifications: [],
  };
}

export const FIXTURES = { default: defaultFixture, empty: emptyFixture, quiet: quietFixture } as const;
export type FixtureName = keyof typeof FIXTURES;
