import { randomBytes } from 'node:crypto';

import {
  ConversationIdSchema,
  CreatorIdSchema,
  CustomAlertIdSchema,
  DraftIdSchema,
  EventIdSchema,
  newId,
  type CreatorId,
  type TelegramBot,
  type TelegramChatId,
} from '@nirvana/contracts';
import { eq, parseEncryptionKeys, schema, sql, withTenant } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createTelegramModule, SCANNED_EVENT_TYPES, type TelegramModule } from '..';
import { testConfig } from '../../../__tests__/support/config';
import { createJobQueue, type JobQueue } from '../../../jobs';
import { createLogger } from '../../../logger';
import { buildServer } from '../../../server';
import { nightOf } from '../domain/schedule';
import { createPostgresTelegramStore, type ResealReport } from '../infra/postgres.store';

import { FAKE_TOKEN, FakeTelegram, OTHER_TOKEN, SAME_BOT_NEW_TOKEN, joined } from './support/fake-telegram';

const keyOf = (version: string) => `${version}:${randomBytes(32).toString('base64')}`;
const WEB_ORIGIN = 'https://crm.example.test';

/** The module on the real migrations, with Telegram played by FakeTelegram (ADR 0020, task P3-07). */
describe('telegram module on Postgres', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let offsetMs = 0;
  let sliceStart = Date.now();
  let eventSeq = 0;
  const clock = { now: () => new Date(Date.now() + offsetMs) };
  const keys = keyOf('v1');
  let telegram: FakeTelegram;
  let module: TelegramModule;
  let uncovered: string[];
  /** Her alerts' names, as the `alerts` module gives them. */
  const names = new Map<string, ReadonlyMap<string, string>>();

  function build(encryptionKeys = keys): {
    module: TelegramModule;
    resealTokens: () => Promise<ResealReport>;
  } {
    const store = createPostgresTelegramStore({
      adminDb: test.admin.db,
      keys: parseEncryptionKeys(encryptionKeys),
    });
    return {
      module: createTelegramModule({
        bots: store.bots,
        deliveries: store.deliveries,
        channel: telegram,
        clock,
        webOrigin: WEB_ORIGIN,
        onUncovered: (event) => uncovered.push(event.id),
        resealTokens: store.resealTokens,
        alertNames: { ofCreator: (creatorId) => Promise.resolve(names.get(creatorId) ?? new Map()) },
      }),
      resealTokens: store.resealTokens,
    };
  }

  async function jobs(task: string) {
    const result = await test.admin.db.execute(
      sql`select queue_name, key, run_at from graphile_worker.jobs where task_identifier = ${task}`,
    );
    return z
      .array(
        z.object({ queue_name: z.string().nullable(), key: z.string().nullable(), run_at: z.coerce.date() }),
      )
      .parse(result.rows);
  }

  /** Writes an outbox row as the application does: as `nirvana_app`, inside the creator's tenant. */
  async function publish(
    type: string,
    payload: unknown,
    creator: CreatorId | null = creatorId,
  ): Promise<string> {
    const id = newId(EventIdSchema);
    const row = {
      id,
      creatorId: creator,
      type,
      payload,
      actor: 'system',
      correlationId: 'test',
      createdAt: new Date(sliceStart + (eventSeq += 1) * 1000),
    };
    if (creator === null) await test.admin.db.insert(schema.domainEvents).values(row);
    else await withTenant(test.app.db, creator, (tx) => tx.insert(schema.domainEvents).values(row));
    return id;
  }

  async function deliveryRows(chatId?: TelegramChatId) {
    const rows = await test.admin.db
      .select()
      .from(schema.telegramDeliveries)
      .orderBy(schema.telegramDeliveries.createdAt);
    return chatId === undefined ? rows : rows.filter((row) => row.chatId === chatId);
  }

  /** A bot in one group that receives every alert of every creator. */
  async function botInGroup(
    token: string,
    username: string,
    telegramChatId: string,
  ): Promise<{ bot: TelegramBot; chatId: TelegramChatId }> {
    telegram.addBot(token, username);
    const added = await module.addBot(token);
    if (!added.ok) throw new Error(added.error.message);
    telegram.updates.push(joined(telegram.updates.length + 1, telegramChatId, `Groupe ${username}`));
    await module.jobs.pollUpdates(added.value.id, 0);
    const view = (await module.overview()).bots.find((bot) => bot.id === added.value.id);
    const chat = view?.chats.find((row) => row.title === `Groupe ${username}`);
    if (view === undefined || chat === undefined) throw new Error('group not found');
    const { routes, version } = await module.overview();
    const saved = await module.saveRoutes(version, [
      ...routes,
      ...(['urgent', 'important', 'info'] as const).map((topic) => ({
        creatorId: null,
        topic,
        chatId: chat.id,
      })),
    ]);
    if (!saved.ok) throw new Error('routes not saved');
    return { bot: view, chatId: chat.id };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Creates Graphile's schema, which the trigger and `public.enqueue_job` write to.
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Démo', timezone: 'Europe/Paris' });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(async () => {
    offsetMs = 0;
    uncovered = [];
    telegram = new FakeTelegram();
    module = build().module;
    await test.admin.db.delete(schema.telegramBots);
    // A removed group leaves its deliveries behind (REG-28): each test starts from an empty log.
    await test.admin.db.delete(schema.telegramDeliveries);
    await test.admin.db.execute(sql`delete from graphile_worker._private_jobs`);
    // The outbox is append-only: each test writes its events in a time slice of its own, past the previous one's
    // scan window.
    sliceStart += 10 * 60_000;
    await test.admin.db.update(schema.telegramState).set({ scanCursor: new Date(sliceStart) });
  });

  it('mirrors the event list of the trigger in the code', async () => {
    const result = await test.admin.db.execute(
      sql`select pg_get_triggerdef(oid) as def from pg_trigger where tgname = 'domain_events_telegram_scan'`,
    );
    const def = z.object({ def: z.string() }).parse(result.rows[0]).def;
    const listed = [...def.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...SCANNED_EVENT_TYPES].sort());
  });

  it('enqueues one scan when a consumed event commits, and never fails the outbox write', async () => {
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'minor' });
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'other' });
    await publish('mode_changed', {});
    expect(await jobs('telegram.scan')).toMatchObject([{ queue_name: 'telegram', key: 'telegram.scan' }]);

    await test.admin.db.execute(sql`revoke execute on function public.enqueue_job from nirvana_app`);
    try {
      const id = await publish('handoff_requested', {
        conversationId: newId(ConversationIdSchema),
        cause: 'distress',
      });
      const [row] = await test.admin.db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.id, id));
      expect(row?.type).toBe('handoff_requested');
    } finally {
      await test.admin.db.execute(sql`grant execute on function public.enqueue_job to nirvana_app`);
    }
  });

  it('adds a bot from its token, sealed at rest, and never shows the token', async () => {
    expect(await module.addBot('pas un jeton')).toMatchObject({ ok: false, error: { kind: 'token_shape' } });
    expect(await module.addBot(FAKE_TOKEN)).toMatchObject({ ok: false, error: { kind: 'token_refused' } });

    telegram.addBot(FAKE_TOKEN, 'demo_alertes_bot');
    const added = await module.addBot(FAKE_TOKEN);
    expect(added).toMatchObject({
      ok: true,
      value: { username: 'demo_alertes_bot', state: 'active', chats: [] },
    });
    expect(await module.addBot(FAKE_TOKEN)).toMatchObject({ ok: false, error: { kind: 'bot_exists' } });

    const [row] = await test.admin.db.select().from(schema.telegramBots);
    expect(row?.tokenCiphertext.toString('latin1')).not.toContain(FAKE_TOKEN.split(':')[1]);
    expect(JSON.stringify(await module.overview())).not.toContain(FAKE_TOKEN.split(':')[1]);
    expect(await jobs('telegram.poll_updates')).toMatchObject([
      { queue_name: `telegram-bot:${row?.id ?? ''}` },
    ]);

    // The bot's own token only, after a /revoke.
    if (!added.ok) return;
    expect(await module.replaceToken(added.value.id, OTHER_TOKEN)).toMatchObject({
      ok: false,
      error: { kind: 'bot_mismatch' },
    });
    telegram.addBot(SAME_BOT_NEW_TOKEN, 'demo_alertes_bot');
    expect(await module.replaceToken(added.value.id, SAME_BOT_NEW_TOKEN)).toMatchObject({ ok: true });
  });

  it('discovers the groups a bot enters, follows a supergroup migration and a 409 or 401', async () => {
    const { bot, chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    expect(bot.chats).toMatchObject([{ title: 'Groupe demo_bot', membership: 'member', canPost: true }]);

    telegram.updates.push({ kind: 'migration', updateId: 10, fromChatId: '-100', toChatId: '-1001' });
    await module.jobs.pollUpdates(bot.id, 0);
    const [chat] = await test.admin.db
      .select()
      .from(schema.telegramChats)
      .where(eq(schema.telegramChats.id, chatId));
    expect(chat).toMatchObject({ telegramChatId: '-1001', kind: 'supergroup' });

    telegram.failNext('getUpdates', { kind: 'conflict' });
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('conflict');
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('active');

    telegram.revoke(FAKE_TOKEN);
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('refused');
  });

  it('saves the routing with its version and refuses a stale one', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    const { routes, version } = await module.overview();
    expect(routes).toHaveLength(3);
    expect(await module.saveRoutes(version - 1, [])).toMatchObject({
      ok: false,
      error: { kind: 'routes_version_conflict' },
    });
    expect(
      await module.saveRoutes(version, [
        { creatorId, topic: 'sale', chatId: newId(z.uuid().brand<'TelegramChatId'>()) },
      ]),
    ).toEqual({
      ok: false,
      error: 'unknown_chat',
    });
    const saved = await module.saveRoutes(version, [{ creatorId, topic: 'urgent', chatId }]);
    expect(saved).toMatchObject({
      ok: true,
      value: { version: version + 1, routes: [{ creatorId, topic: 'urgent', chatId }] },
    });
    expect((await module.overview()).coverage).toMatchObject([{ creatorId, urgentReachable: true }]);
  });

  it('turns an urgent handoff into one delivery per group, once, and sends it', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    const conversationId = newId(ConversationIdSchema);
    await publish('handoff_requested', {
      conversationId,
      cause: 'minor',
      reason: 'texte que personne ne doit lire',
    });

    expect(await module.jobs.scan()).toBe(1);
    expect(await module.jobs.scan()).toBe(1); // the window re-reads it: nothing new
    const rows = await deliveryRows(chatId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      topic: 'urgent',
      status: 'pending',
      isSilent: false,
      threadKey: `conversation:${conversationId}`,
    });
    expect(rows[0]?.text).not.toContain('personne ne doit lire');
    expect(await jobs('telegram.flush_chat')).toMatchObject([{ queue_name: `telegram-chat:${chatId}` }]);

    await module.jobs.flushChat(chatId);
    expect(telegram.sent).toMatchObject([{ chatId: '-100', isSilent: false }]);
    expect(telegram.sent[0]?.text).toContain('🔴 <b>URGENT · Démo</b>');
    expect(telegram.sent[0]?.text).toContain(`${WEB_ORIGIN}/suivi?conversation=${conversationId}`);
    expect((await deliveryRows(chatId))[0]).toMatchObject({
      status: 'sent',
      telegramMessageId: telegram.sent[0]?.messageId,
    });

    expect(Object.keys(await module.nightCounts(creatorId)).sort()).toEqual(['important', 'info', 'urgent']);
  });

  it('tells the groups once that Automatique closed, as important, without the voice', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    await publish('automatic_closed', {
      voicePrompt: 'sha256:voix-qui-ne-sort-pas',
      voiceModel: 'modele-qui-ne-sort-pas',
      missing: [{ kind: 'live_rate', value: 74.5, target: 80 }],
      conversations: 3,
    });
    // The trigger knows the new type (0009).
    expect(await jobs('telegram.scan')).toMatchObject([{ key: 'telegram.scan' }]);

    expect(await module.jobs.scan()).toBe(1);
    expect(await module.jobs.scan()).toBe(1); // the window re-reads it: nothing new
    const rows = await deliveryRows(chatId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: 'important', isSilent: false, threadKey: null });

    await module.jobs.flushChat(chatId);
    const text = telegram.sent[0]?.text ?? '';
    expect(text).toContain('🟠 <b>Important · Démo</b>');
    expect(text).toContain('repassé en copilote sur 3 conversations');
    expect(text).toContain('74,5 %');
    expect(text).not.toContain('qui-ne-sort-pas');
  });

  it('tells the groups once that a message of the agent could not leave, and closes it on a takeover', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    const conversationId = newId(ConversationIdSchema);
    const attempt = {
      draftId: newId(DraftIdSchema),
      idempotencyKey: 'k',
      error: 'send_error',
      conversationId,
    };
    await publish('send_failed', { ...attempt, attempt: 1, isFinal: false });
    await publish('send_failed', { ...attempt, attempt: 3, isFinal: true });
    // The trigger knows the new type.
    expect(await jobs('telegram.scan')).toMatchObject([{ key: 'telegram.scan' }]);
    await module.jobs.scan();
    const rows = await deliveryRows(chatId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: 'important', threadKey: `conversation:${conversationId}` });
    await module.jobs.flushChat(chatId);
    expect(telegram.sent[0]?.text).toContain('n’a pas pu partir');
    expect(telegram.sent[0]?.text).not.toContain('send_error');

    await publish('takeover_started', { conversationId });
    await module.jobs.scan();
    offsetMs = 4000;
    await module.jobs.flushChat(chatId);
    expect(telegram.edits[0]?.text).toMatch(/✓ Pris en main$/);
  });

  it('sends her alerts to their topic, a paused fan to the important groups when none has it (P4-01)', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    // A second creator whose own alerts have a group; « Démo »'s have none.
    const other = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: other, nameKey: other, displayName: 'Autre', timezone: 'Europe/Paris' });
    const { routes, version } = await module.overview();
    const saved = await module.saveRoutes(version, [
      ...routes,
      { creatorId: other, topic: 'custom', chatId },
    ]);
    if (!saved.ok) throw new Error('routes not saved');

    const custom = { kind: 'custom', id: newId(CustomAlertIdSchema) } as const;
    names.set(other, new Map([[custom.id, 'Appel vidéo']]));
    const trigger = { alert: custom, matchedBy: 'keyword', keyword: 'mot-déclaré' } as const;
    const paused = newId(ConversationIdSchema);
    const told = newId(ConversationIdSchema);
    const pausedOther = newId(ConversationIdSchema);
    await publish('handoff_requested', { conversationId: paused, cause: 'custom_alert', trigger });
    await publish('alert_triggered', { conversationId: newId(ConversationIdSchema), trigger, notify: true });
    await publish('alert_triggered', { conversationId: told, trigger, notify: true }, other);
    await publish('alert_triggered', { conversationId: told, trigger, notify: false }, other);
    await publish(
      'handoff_requested',
      { conversationId: pausedOther, cause: 'custom_alert', trigger },
      other,
    );
    // The trigger knows the new type (0027).
    expect(await jobs('telegram.scan')).toMatchObject([{ key: 'telegram.scan' }]);
    await module.jobs.scan();

    const rows = await deliveryRows(chatId);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        // « Démo »: no group for her alerts, the paused fan goes to important; the alert that only tells, nowhere.
        expect.objectContaining({ creatorId, topic: 'important', threadKey: `conversation:${paused}` }),
        // « Autre »: in her alerts' group, the paused fan in its thread; once, `notify: false` is not sent.
        expect.objectContaining({ creatorId: other, topic: 'custom', threadKey: null }),
        expect.objectContaining({
          creatorId: other,
          topic: 'custom',
          threadKey: `conversation:${pausedOther}`,
        }),
      ]),
    );
    expect(rows.map((row) => row.text).join()).not.toContain('mot-déclaré');
    await module.jobs.flushChat(chatId);
    const sent = telegram.sent.map((m) => m.text).join();
    // Named as the history names it: her alert's name, written by the agency, never the word.
    expect(sent).toContain('🔔 <b>Appel vidéo · Autre</b>');
    expect(sent).toContain('Le message du fan correspond à l’alerte « Appel vidéo ». Il n’écrit plus');
    expect(sent).not.toContain('mot-déclaré');
  });

  it('logs an urgent alert that no group can receive', async () => {
    const id = await publish('handoff_requested', {
      conversationId: newId(ConversationIdSchema),
      cause: 'meeting',
    });
    await module.jobs.scan();
    expect(uncovered).toEqual([id]);
  });

  it('waits on a 429, marks a group left on a 403, follows a migration, and stops on a 401', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'guard' });
    await module.jobs.scan();

    telegram.failNext('send', { kind: 'rate_limited', retryAfterSeconds: 30 });
    await module.jobs.flushChat(chatId);
    const [waiting] = await deliveryRows(chatId);
    expect(waiting).toMatchObject({ status: 'pending', errorKind: 'rate_limited', attempts: 1 });
    expect(waiting?.runAfter.getTime()).toBeGreaterThan(Date.now() + 25_000);

    offsetMs = 31_000;
    telegram.failNext('send', { kind: 'migrated', toChatId: '-1009' });
    await module.jobs.flushChat(chatId);
    await module.jobs.flushChat(chatId);
    expect(telegram.sent).toMatchObject([{ chatId: '-1009' }]);

    offsetMs = 40_000;
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'other' });
    await module.jobs.scan();
    telegram.failNext('send', { kind: 'forbidden' });
    await module.jobs.flushChat(chatId);
    const [chat] = await test.admin.db
      .select()
      .from(schema.telegramChats)
      .where(eq(schema.telegramChats.id, chatId));
    expect(chat).toMatchObject({ membership: 'left', canPost: false, lastErrorKind: 'chat_unreachable' });
    expect((await deliveryRows(chatId)).at(-1)).toMatchObject({
      status: 'failed',
      errorKind: 'chat_unreachable',
    });
    expect((await module.overview()).coverage[0]).toMatchObject({ urgentReachable: false });
  });

  it('keeps a group the bot was banned from in the list, and removes it with its routes on request (REG-28)', async () => {
    const { bot, chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('refused');
    // Last night, one alert went out to the group, one was cut off mid-call and one still waits when it is
    // removed in the morning.
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'minor' });
    await module.jobs.scan();
    await module.jobs.flushChat(chatId);
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'distress' });
    await module.jobs.scan();
    await test.admin.db
      .update(schema.telegramDeliveries)
      .set({ status: 'sending' })
      .where(eq(schema.telegramDeliveries.status, 'pending'));
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'non_consent' });
    await module.jobs.scan();
    const { from, to } = nightOf('Europe/Paris', new Date());
    await test.admin.db
      .update(schema.telegramDeliveries)
      .set({ createdAt: new Date((from.getTime() + to.getTime()) / 2) })
      .where(eq(schema.telegramDeliveries.chatId, chatId));
    const night = await module.nightCounts(creatorId);
    expect(night.urgent).toBe(3);

    telegram.updates.push({
      kind: 'membership',
      updateId: telegram.updates.length + 1,
      telegramChatId: '-100',
      title: 'Groupe demo_bot',
      chatKind: 'group',
      membership: 'kicked',
      canPost: false,
    });
    await module.jobs.pollUpdates(bot.id, 0);
    const before = await module.overview();
    expect(before.bots[0]?.chats).toMatchObject([{ id: chatId, membership: 'kicked', canPost: false }]);
    expect(before.routes.filter((route) => route.chatId === chatId)).toHaveLength(3);

    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('removed');
    const after = await module.overview();
    expect(after.bots[0]?.chats).toEqual([]);
    expect(after.routes).toEqual([]);
    expect(after.version).toBeGreaterThan(before.version);
    // Its alerts stay, without a group and with its name: the night still counts them, the log still names it.
    expect(await module.nightCounts(creatorId)).toEqual(night);
    // All were moved to the same instant of the night: read by status, not by date.
    const kept = (await deliveryRows())
      .map(({ chatId: chat, chatTitle, status, errorKind }) => ({ chat, chatTitle, status, errorKind }))
      .sort((a, b) => a.status.localeCompare(b.status));
    expect(kept).toEqual([
      { chat: null, chatTitle: 'Groupe demo_bot', status: 'failed', errorKind: 'chat_removed' },
      { chat: null, chatTitle: 'Groupe demo_bot', status: 'sent', errorKind: null },
      { chat: null, chatTitle: 'Groupe demo_bot', status: 'unknown', errorKind: 'chat_removed' },
    ]);
    expect((await module.listDeliveries('urgent', 10)).map((row) => row.chatTitle)).toEqual([
      'Groupe demo_bot',
      'Groupe demo_bot',
      'Groupe demo_bot',
    ]);
    const audit = await test.admin.db
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'telegram_chat.remove'));
    expect(audit).toEqual([{ userId: 'owner-telegram', details: { membership: 'kicked' } }]);
    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('missing');
  });

  it('marks the bot to reconnect on a 401 and keeps its messages for the retry window', async () => {
    const { bot, chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    await publish(
      'kill_switch_toggled',
      { scope: 'global', scopeId: null, active: true, reason: 'test' },
      null,
    );
    await module.jobs.scan();
    telegram.revoke(FAKE_TOKEN);
    await module.jobs.flushChat(chatId);
    expect((await module.overview()).bots.find((row) => row.id === bot.id)?.state).toBe('refused');
    expect((await deliveryRows(chatId))[0]).toMatchObject({ status: 'pending', errorKind: 'token_refused' });
  });

  it('sends again an urgent message cut off mid-call, marked, and not an info one', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    await publish('handoff_requested', { conversationId: newId(ConversationIdSchema), cause: 'minor' });
    await publish('session_state_changed', { platformAccountId: 'acc', from: 'expired', to: 'valid' });
    await module.jobs.scan();
    const [urgent] = await deliveryRows(chatId);
    // A worker died between the call and the write: the delivery is left `sending`.
    await test.admin.db
      .update(schema.telegramDeliveries)
      .set({ status: 'sending', runAfter: new Date(Date.now() - 120_000) })
      .where(eq(schema.telegramDeliveries.chatId, chatId));
    await test.admin.db.insert(schema.telegramDeliveries).values({
      id: newId(z.uuid()),
      sourceKey: 'digest:test',
      chatId,
      chatTitle: 'Groupe demo_bot',
      creatorId,
      topic: 'info',
      action: 'send',
      text: 'bilan',
      summary: 'bilan',
      isSilent: true,
      status: 'sending',
      runAfter: new Date(Date.now() - 120_000),
    });
    await module.jobs.flushChat(chatId);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0]?.text).toContain('<i>(renvoi)</i>');
    const rows = await deliveryRows(chatId);
    expect(rows.find((row) => row.id === urgent?.id)).toMatchObject({ status: 'sent' });
    expect(rows.find((row) => row.sourceKey === 'digest:test')).toMatchObject({ status: 'unknown' });
  });

  it('rewrites the alert « Pris en main par … » when someone takes the conversation', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    const userId = 'user-takeover-test';
    await test.admin.db
      .insert(schema.user)
      .values({ id: userId, name: 'Théo Brun', email: 'theo@example.test' })
      .onConflictDoNothing();
    const conversationId = newId(ConversationIdSchema);
    await publish('handoff_requested', { conversationId, cause: 'distress' });
    await module.jobs.scan();
    await module.jobs.flushChat(chatId);
    await publish('takeover_started', { conversationId, userId });
    await module.jobs.scan();
    offsetMs = 4000;
    await module.jobs.flushChat(chatId);
    expect(telegram.edits).toMatchObject([{ chatId: '-100', messageId: telegram.sent[0]?.messageId }]);
    expect(telegram.edits[0]?.text).toMatch(/✓ Pris en main par Théo$/);
    expect(await module.listDeliveries('urgent', 10)).toMatchObject([{ closedBy: 'Théo', status: 'sent' }]);
  });

  it('closes a handoff alert when the conversation goes back to the agent, and only once', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    const userId = 'user-release-test';
    await test.admin.db
      .insert(schema.user)
      .values({ id: userId, name: 'Nora Vidal', email: 'nora@example.test' })
      .onConflictDoNothing();
    const conversationId = newId(ConversationIdSchema);
    await publish('handoff_requested', { conversationId, cause: 'llm_unavailable' });
    await module.jobs.scan();
    await module.jobs.flushChat(chatId);
    await publish('takeover_ended', { conversationId, userId });
    await module.jobs.scan();
    offsetMs = 4000;
    await module.jobs.flushChat(chatId);
    expect(telegram.edits).toMatchObject([{ chatId: '-100', messageId: telegram.sent[0]?.messageId }]);
    expect(telegram.edits[0]?.text).toMatch(/✓ Rendu à l’agent par Nora$/);
    // A second hand-back (taken, given back again) leaves the closed alert as it is.
    await publish('takeover_ended', { conversationId, userId });
    await module.jobs.scan();
    offsetMs = 8000;
    await module.jobs.flushChat(chatId);
    expect(telegram.edits).toHaveLength(1);
    expect(await module.listDeliveries('important', 10)).toMatchObject([
      { closedBy: 'Nora', status: 'sent' },
    ]);
  });

  it('answers the original message when the trouble ends', async () => {
    const { chatId } = await botInGroup(FAKE_TOKEN, 'demo_bot', '-100');
    await publish('session_state_changed', { platformAccountId: 'acc-1', from: 'valid', to: 'expired' });
    await module.jobs.scan();
    await module.jobs.flushChat(chatId);
    await publish('session_state_changed', { platformAccountId: 'acc-1', from: 'expired', to: 'valid' });
    await module.jobs.scan();
    offsetMs = 4000;
    await module.jobs.flushChat(chatId);
    expect(telegram.sent).toHaveLength(2);
    expect(telegram.sent[1]).toMatchObject({ isSilent: true, replyToMessageId: telegram.sent[0]?.messageId });
    expect(telegram.sent[1]?.text).toBe('✓ Résolu : la session est revenue.');
  });

  it('re-seals the tokens with the newest key, so the old key can be dropped', async () => {
    telegram.addBot(FAKE_TOKEN, 'demo_bot');
    await module.addBot(FAKE_TOKEN);
    const next = keyOf('v2');
    const rotated = build(`${next},${keys}`);
    expect(await rotated.resealTokens()).toEqual({ rewritten: 1, unreadable: [] });
    expect(await rotated.resealTokens()).toEqual({ rewritten: 0, unreadable: [] });
    const [row] = await test.admin.db.select().from(schema.telegramBots);
    expect(row?.keyVersion).toBe('v2');
    // Only the new key now: the bot still reads.
    expect((await build(next).module.overview()).bots[0]?.state).toBe('active');
    // A key that never sealed it: the bot reads as to reconnect, nothing thrown.
    expect((await build(keyOf('v3')).module.overview()).bots[0]?.state).toBe('refused');
    // And the rotation names it instead of passing over it, so the old key is not dropped too early.
    expect(await build(keyOf('v3')).resealTokens()).toEqual({ rewritten: 0, unreadable: ['@demo_bot'] });
  });

  it('serves the settings to the owner only, a bot change after a fresh sign-in only', async () => {
    const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
      if (request.headers['x-test-role'] !== 'owner') {
        await reply.code(403).send({ error: 'forbidden' });
        return;
      }
      request.user = {
        id: 'owner-telegram',
        email: 'owner@example.test',
        name: 'Owner',
        role: 'owner',
        creatorIds: [],
        routedCreatorIds: [],
      };
    };
    const freshOnly: preValidationAsyncHookHandler = async (request, reply) => {
      if (request.headers['x-test-stale'] === '1')
        await reply.code(403).send({ error: { code: 'reauthentication_forbidden' } });
    };
    const config = testConfig();
    const server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [module.routes({ guard: ownerOnly, recentLogin: freshOnly })],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
    });
    const headers = { 'x-test-role': 'owner', origin: config.WEB_ORIGIN };
    try {
      expect((await server.inject({ method: 'GET', url: '/v1/settings/telegram' })).statusCode).toBe(403);
      telegram.addBot(FAKE_TOKEN, 'demo_bot');
      const stale = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers: { ...headers, 'x-test-stale': '1' },
        payload: { token: FAKE_TOKEN },
      });
      expect(stale.statusCode).toBe(403);
      const created = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers,
        payload: { token: FAKE_TOKEN },
      });
      expect(created.statusCode).toBe(201);
      expect(created.body).not.toContain(FAKE_TOKEN.split(':')[1]);
      const refused = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers,
        payload: { token: 'nope' },
      });
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ kind: 'token_shape' });
      const overview = await server.inject({ method: 'GET', url: '/v1/settings/telegram', headers });
      expect(overview.json()).toMatchObject({ bots: [{ username: 'demo_bot' }], routes: [] });
      const conflict = await server.inject({
        method: 'PUT',
        url: '/v1/settings/telegram/routes',
        headers,
        payload: { version: 999, routes: [] },
      });
      expect(conflict.statusCode).toBe(409);
      // Refusals in the common error body (recette 28/10): an invalid body was a 500 against the route's own schema.
      const invalid = await server.inject({
        method: 'PUT',
        url: '/v1/settings/telegram/routes',
        headers,
        payload: { version: 1, routes: [{ creatorId: null, topic: 'x', chatId: 'y' }] },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: { code: 'request_invalid' } });
      const missing = await server.inject({
        method: 'POST',
        url: `/v1/settings/telegram/bots/${newId(z.uuid().brand<'TelegramBotId'>())}/listen`,
        headers,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: 'telegram_bot_not_found' } });
      const gone = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/bots/${newId(z.uuid().brand<'TelegramBotId'>())}`,
        headers,
      });
      expect(gone.statusCode).toBe(404);
      expect(gone.json()).toMatchObject({ error: { code: 'telegram_bot_not_found' } });
      const noChat = await server.inject({
        method: 'POST',
        url: `/v1/settings/telegram/chats/${newId(z.uuid().brand<'TelegramChatId'>())}/test`,
        headers,
      });
      expect(noChat.statusCode).toBe(404);
      expect(noChat.json()).toMatchObject({ error: { code: 'telegram_chat_not_found' } });
      const noGroup = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/chats/${newId(z.uuid().brand<'TelegramChatId'>())}`,
        headers,
      });
      expect([noGroup.statusCode, noGroup.json()]).toMatchObject([
        404,
        { error: { code: 'telegram_chat_not_found' } },
      ]);
      const { id: botId } = created.json<{ id: string }>();
      telegram.updates.push(joined(telegram.updates.length + 1, '-300', 'Groupe vivant'));
      await module.jobs.pollUpdates(z.uuid().brand<'TelegramBotId'>().parse(botId), 0);
      const living = (await module.overview()).bots[0]?.chats[0];
      if (living === undefined) throw new Error('group not found');
      const stillIn = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/chats/${living.id}`,
        headers,
      });
      expect([stillIn.statusCode, stillIn.json()]).toMatchObject([
        409,
        { error: { code: 'telegram_chat_member_conflict' } },
      ]);
      const { version } = (
        await server.inject({ method: 'GET', url: '/v1/settings/telegram', headers })
      ).json<{
        version: number;
      }>();
      const unknownChat = await server.inject({
        method: 'PUT',
        url: '/v1/settings/telegram/routes',
        headers,
        payload: {
          version,
          routes: [
            {
              creatorId: newId(CreatorIdSchema),
              topic: 'urgent',
              chatId: newId(z.uuid().brand<'TelegramChatId'>()),
            },
          ],
        },
      });
      expect(unknownChat.statusCode).toBe(400);
      expect(unknownChat.json()).toMatchObject({ error: { code: 'telegram_chat_invalid' } });
      const journal = await server.inject({
        method: 'GET',
        url: '/v1/settings/telegram/deliveries?topic=urgent',
        headers,
      });
      expect(journal.json()).toEqual({ deliveries: [] });
    } finally {
      await server.close();
    }
  });
});
