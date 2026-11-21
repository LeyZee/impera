import {
  err,
  ok,
  type ChannelGestureRefusalKind,
  type ChannelPlannedPost,
  type ChannelPlannedPostId,
  type ChannelPostDraft,
  type ChannelPostGesture,
  type ChannelReview,
  type ChannelTheme,
  type ChannelWeek,
  type CreatorId,
  type Result,
} from '@impera/contracts';

import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../../scheduling/pure';
import { channelChecks, guardedTexts, linkOf, renderChannelPost } from '../domain/channel-post';
import type {
  BotsStore,
  ChannelLinksSource,
  ChannelPersonaSource,
  ChannelsStore,
  ChannelVoice,
  NotificationChannel,
} from '../domain/ports';
import {
  nextWeekOf,
  planWeek,
  PLAN_MINUTE,
  PLAN_WEEKDAY,
  needsRefresh,
  REFRESH_MINUTE,
} from '../domain/week-plan';
import type {
  ChannelFile,
  ChannelOutgoing,
  ChannelVisualsSource,
  ChannelWeekStore,
  NewPlannedPost,
  WeekPostChange,
} from '../domain/week-ports';
import { gestureRefusal, locksPost } from '../domain/week-review';

import { channelConfigOf } from './channel';

/**
 * Her channel's week (ADR 0162): planned on Saturday evening, written by the voice, reviewed by the owner and her,
 * refreshed the day before, sent at its hour by the agency's bot. Every step is replayable: the plan by its keys, the
 * send by the post's state (a post leaves `planned` once, whatever happens after).
 */
export interface ChannelWeekDeps {
  readonly bots: BotsStore;
  readonly channels: ChannelsStore;
  readonly links?: ChannelLinksSource;
  readonly persona: ChannelPersonaSource;
  readonly voice: ChannelVoice;
  readonly week: ChannelWeekStore;
  readonly telegram: NotificationChannel;
  readonly visuals: ChannelVisualsSource;
}

/** What each theme asks of the voice, as the code's own words in the advice block (never an instruction to lift). */
const THEME_HINTS: Readonly<Record<ChannelTheme, string>> = {
  girly: 'Une question de fille qui plaît aux garçons : une tenue, un maquillage, sa prochaine séance.',
  passion: 'Son avis sur une de ses passions ou sur son actualité, avec son humour.',
  chat: 'L’envie de papoter : comment ils vont, ce qu’ils font, qu’elle s’ennuie un peu.',
  news: 'Une petite nouvelle de sa journée, seulement d’après la source donnée.',
  poll: 'Un sondage de fille, léger, sur ce qu’elle porte ou ce qu’elle prépare.',
  evening: 'Elle vient de poster, elle a envie qu’on vienne lui en parler en privé, c’est gratuit.',
};

/** How long ahead the texts are written: the whole planned week, plus its Monday. */
const WRITE_AHEAD_MS = 8 * 24 * 60 * 60 * 1000;
const BATCH = 20;

// ——— Planning ———

/** The week to plan for her now, or null: from Saturday 18 h on her clock, the next one (§ 3.1). */
function weekToPlan(timeZone: string, now: Date): string | null {
  const today = calendarDayIn(now, timeZone);
  const weekday = isoWeekday(today);
  if (weekday === 7) return nextWeekOf(today);
  if (weekday === PLAN_WEEKDAY && now >= wallClockToInstant(today, PLAN_MINUTE, timeZone))
    return nextWeekOf(today);
  return null;
}

/** The Monday of the week `now` is in, on her calendar. */
function currentWeekOf(timeZone: string, now: Date): string {
  const today = calendarDayIn(now, timeZone);
  return addDays(today, 1 - isoWeekday(today));
}

/**
 * Plans the week for every creator whose channel is set: the next one from Saturday 18 h, and the current one when it
 * has nothing yet (a channel switched on mid-week). Posts whose hour has passed are not planned.
 */
export async function planWeeks(deps: ChannelWeekDeps, now: Date): Promise<number> {
  const [records, creators] = await Promise.all([deps.channels.listChannels(), deps.bots.listCreators()]);
  const zones = new Map(creators.map((creator) => [creator.id, creator.timezone]));
  let planned = 0;
  for (const record of records) {
    const timeZone = zones.get(record.creatorId);
    if (record.archived || record.chatId === null || record.config === null || timeZone === undefined)
      continue;
    const { config } = await channelConfigOf(deps, record.creatorId);
    const stock = await deps.visuals.telegramStock(record.creatorId);
    const weeks = [currentWeekOf(timeZone, now), weekToPlan(timeZone, now)].filter(
      (week): week is string => week !== null,
    );
    for (const week of weeks) {
      const slots = planWeek({
        creatorId: record.creatorId,
        week,
        timeZone,
        slots: config.slots,
        photoStock: stock.length,
        hasNewsSource: false,
      }).filter((slot) => slot.at > now);
      const posts: NewPlannedPost[] = slots.map((slot) => ({
        ...slot,
        creatorId: record.creatorId,
        week,
        planKey: `${slot.day}:${String(slot.window.from)}`,
        replacesId: null,
      }));
      planned += (await deps.week.plan(record.creatorId, posts)).length;
    }
  }
  return planned;
}

// ——— Writing ———

interface Written {
  readonly draft: ChannelPostDraft;
  readonly mediaId: string | null;
  readonly why: string | null;
}

/** Writes one post: its visual from what the code allows, its text by the voice, then the guards. */
async function writePost(
  deps: ChannelWeekDeps,
  post: ChannelPlannedPost,
  advice: string | null,
): Promise<Result<Written, 'no_visual' | 'no_persona' | 'llm_unavailable' | 'guarded'>> {
  const { config } = await channelConfigOf(deps, post.creatorId);
  let visual = null;
  if (post.kind === 'main') {
    const candidates = await deps.visuals.eveningCandidates(post.creatorId, post.day);
    visual = candidates.find((one) => one.mediaId === post.mediaId) ?? candidates[0] ?? null;
    if (visual === null) return err('no_visual');
  } else if (post.kind === 'photo') {
    const stock = await deps.visuals.telegramStock(post.creatorId);
    visual = stock.find((one) => one.mediaId === post.mediaId) ?? stock[0] ?? null;
  }
  const persona = await deps.persona(post.creatorId);
  if (persona === null) return err('no_persona');
  const link =
    post.kind === 'main' && config.channelLinkId !== null
      ? (config.links.find((one) => one.id === config.channelLinkId) ?? null)
      : null;
  const hint = THEME_HINTS[post.theme];
  const written = await deps.voice({
    creatorId: post.creatorId,
    kind: post.kind === 'main' ? 'main' : post.kind === 'poll' ? 'poll' : 'engagement',
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    examples: config.examples,
    media: visual?.description ?? null,
    destination: link?.destination ?? null,
    advice: advice === null ? hint : `${hint}\n${advice}`,
  });
  if (written === null) return err('llm_unavailable');
  const draft: ChannelPostDraft =
    written.kind === 'post'
      ? renderChannelPost(written.text, link === null ? null : linkOf(config, link))
      : { kind: 'poll', question: written.question, options: [...written.options] };
  const violations = [...persona.check(guardedTexts(draft)), ...channelChecks(draft)];
  if (violations.some((violation) => violation.blocking)) return err('guarded');
  return ok({ draft, mediaId: visual?.mediaId ?? null, why: null });
}

/** Writes once, rewrites once when a guard refuses (ADR 0080 § 2.5). */
async function writeWithRetry(
  deps: ChannelWeekDeps,
  post: ChannelPlannedPost,
  advice: string | null,
): ReturnType<typeof writePost> {
  const first = await writePost(deps, post, advice);
  return !first.ok && first.error === 'guarded' ? writePost(deps, post, advice) : first;
}

/**
 * Writes the posts of the coming days that have no text yet. A main post waits for its visual: it is written once one
 * is there (her deposit of the day), up to its hour.
 */
export async function writeTexts(deps: ChannelWeekDeps, now: Date): Promise<number> {
  let written = 0;
  for (const creatorId of await liveChannelCreators(deps)) {
    const posts = await deps.week.toWrite(creatorId, new Date(now.getTime() + WRITE_AHEAD_MS), BATCH);
    for (const post of posts) {
      const result = await writeWithRetry(deps, post, null);
      if (!result.ok) continue;
      if (await deps.week.update(creatorId, post.id, result.value)) written += 1;
    }
  }
  return written;
}

/** The creators whose channel is plugged in: the week's store is read one creator at a time (`withTenantJob`). */
async function liveChannelCreators(deps: ChannelWeekDeps): Promise<readonly CreatorId[]> {
  const records = await deps.channels.listChannels();
  return records
    .filter((record) => !record.archived && record.chatId !== null)
    .map((record) => record.creatorId);
}

/**
 * The day before at 18 h (§ 3.6): the texts of tomorrow that hang on the moment and nobody locked are emptied, so that
 * the next writing pass writes them again with what is known then. Run every hour; it acts in her 18 h hour only.
 */
export async function refreshEve(deps: ChannelWeekDeps, now: Date): Promise<number> {
  const creators = await deps.bots.listCreators();
  let emptied = 0;
  for (const creator of creators) {
    const today = calendarDayIn(now, creator.timezone);
    const from = wallClockToInstant(today, REFRESH_MINUTE, creator.timezone);
    if (now < from || now.getTime() - from.getTime() >= 60 * 60 * 1000) continue;
    const tomorrow = addDays(today, 1);
    const week = await deps.week.week(creator.id, addDays(tomorrow, 1 - isoWeekday(tomorrow)));
    for (const post of week) {
      if (post.day !== tomorrow || post.state !== 'planned' || post.draft === null) continue;
      if (!needsRefresh(post.theme, post.locked)) continue;
      if (await deps.week.update(creator.id, post.id, { draft: null })) emptied += 1;
    }
  }
  return emptied;
}

// ——— Sending ———

function outgoingOf(
  draft: ChannelPostDraft,
  visual: { kind: 'photo' | 'video'; file: ChannelFile } | null,
): ChannelOutgoing {
  if (draft.kind === 'poll') return { kind: 'poll', question: draft.question, options: draft.options };
  return visual === null
    ? { kind: 'text', html: draft.html }
    : { kind: visual.kind, file: visual.file, html: draft.html };
}

/** Sends one due post, or says in amber why it did not go out. Never sends a post twice. */
async function sendOne(deps: ChannelWeekDeps, post: ChannelPlannedPost, now: Date): Promise<void> {
  const skip = (reason: string): Promise<boolean> =>
    deps.week.update(post.creatorId, post.id, { state: 'skipped', reason });
  const { record, config } = await channelConfigOf(deps, post.creatorId);
  if (record === null || record.archived || record.chatId === null) {
    await skip('Le canal n’est plus branché.');
    return;
  }
  if (!config.publishWithoutValidation && !post.locked) {
    await skip('Personne ne l’a validé, et « Publier sans validation » est éteint.');
    return;
  }
  let current = post;
  if (current.draft === null) {
    const written = await writeWithRetry(deps, current, null);
    if (!written.ok) {
      await skip(
        written.error === 'no_visual'
          ? 'Pas de visuel pour le post du soir.'
          : written.error === 'guarded'
            ? 'Le texte a été refusé deux fois par les gardes.'
            : 'Le texte n’a pas pu être écrit.',
      );
      return;
    }
    current = { ...current, ...written.value };
  }
  const draft = current.draft;
  if (draft === null) return;
  const chat = await deps.bots.findChat(record.chatId);
  const bot = chat === null ? null : await deps.bots.findBot(chat.botId);
  if (chat === null || bot?.token === null || bot === null || !chat.canPost) {
    await skip('Le bot ne peut pas publier sur le canal.');
    return;
  }
  let visual: { kind: 'photo' | 'video'; file: ChannelFile } | null = null;
  if (current.mediaId !== null && draft.kind === 'post') {
    const mediaId = current.mediaId;
    const known = [
      ...(await deps.visuals.eveningCandidates(current.creatorId, current.day)),
      ...(await deps.visuals.telegramStock(current.creatorId)),
    ].find((one) => one.mediaId === mediaId);
    const file = known === undefined ? 'gone' : await deps.visuals.file(current.creatorId, mediaId);
    if (known === undefined || file === 'gone') {
      await skip('Le visuel n’est plus là.');
      return;
    }
    if (file === 'too_big') {
      await skip('Le visuel est trop lourd pour Telegram (50 Mo au plus).');
      return;
    }
    visual = { kind: known.kind, file };
  }
  // The post leaves `planned` before the call (claimed as `failed`, « Envoi en cours »): a crash after it never sends it a second time.
  if (!(await deps.week.claim(current.creatorId, current.id, draft, current.mediaId))) return;
  const result = await deps.telegram.publish(bot.token, chat.telegramChatId, outgoingOf(draft, visual));
  if (result.ok) {
    await deps.week.markSent(current.creatorId, current.id, result.value.messageId, now);
    return;
  }
  await deps.week.markFailed(
    current.creatorId,
    current.id,
    result.failure.kind === 'unreachable'
      ? 'Telegram n’a pas répondu : il est peut-être parti, il n’est pas renvoyé.'
      : 'Telegram a refusé le post.',
  );
}

export async function sendDue(deps: ChannelWeekDeps, now: Date): Promise<number> {
  let sent = 0;
  for (const creatorId of await liveChannelCreators(deps)) {
    const due = await deps.week.due(creatorId, now, BATCH);
    for (const post of due) await sendOne(deps, post, now);
    sent += due.length;
  }
  return sent;
}

// ——— The review ———

export async function channelWeek(
  deps: ChannelWeekDeps,
  creatorId: CreatorId,
  week: string,
): Promise<ChannelWeek | null> {
  if (!(await deps.channels.creatorActive(creatorId))) return null;
  const posts = await deps.week.week(creatorId, week);
  const counted = posts.filter((post) => post.state !== 'removed');
  return {
    week,
    posts: [...posts],
    reviewed: counted.filter((post) => post.locked).length,
    total: counted.length,
  };
}

export interface Reviewer {
  readonly userId: string;
  readonly name: string;
}

const ACTIONS: Readonly<Record<ChannelPostGesture['gesture'], ChannelReview['action']>> = {
  validate: 'validated',
  edit: 'edited',
  rewrite: 'rewritten',
  change_visual: 'visual_changed',
  remove: 'removed',
};

/** Plans the replacement of a removed post in its window, at once, to be written like the others (§ 3.4). */
async function replace(deps: ChannelWeekDeps, post: ChannelPlannedPost): Promise<void> {
  const siblings = await deps.week.week(post.creatorId, addDays(post.day, 1 - isoWeekday(post.day)));
  const rank = siblings.filter((one) => one.day === post.day && one.window.from === post.window.from).length;
  await deps.week.plan(post.creatorId, [
    {
      creatorId: post.creatorId,
      week: addDays(post.day, 1 - isoWeekday(post.day)),
      planKey: `${post.day}:${String(post.window.from)}:r${String(rank)}`,
      replacesId: post.id,
      day: post.day,
      window: post.window,
      minute: 0,
      at: new Date(post.at),
      role: post.role,
      // A removed poll comes back as a text: the day's poll was not wanted.
      kind: post.kind === 'poll' ? 'text' : post.kind,
      theme: post.kind === 'poll' ? 'chat' : post.theme,
    },
  ]);
}

/** One gesture of the review (§ 3.3), by the owner, a manager or her, up to the post's hour. */
export async function applyGesture(
  deps: ChannelWeekDeps,
  creatorId: CreatorId,
  postId: ChannelPlannedPostId,
  gesture: ChannelPostGesture,
  reviewer: Reviewer,
  now: Date,
): Promise<Result<ChannelPlannedPost, ChannelGestureRefusalKind> | null> {
  const post = await deps.week.find(creatorId, postId);
  if (post === null) return null;
  const refusal = gestureRefusal({ state: post.state, at: new Date(post.at), kind: post.kind }, gesture, now);
  if (refusal !== null) return err(refusal);
  const review: ChannelReview = {
    action: ACTIONS[gesture.gesture],
    byName: reviewer.name,
    at: now.toISOString(),
  };
  const signed = { review, reviewedBy: reviewer.userId, locked: locksPost(gesture) };

  let change: WeekPostChange;
  switch (gesture.gesture) {
    case 'validate':
      change = signed;
      break;
    case 'edit': {
      const { config } = await channelConfigOf(deps, creatorId);
      const link =
        post.kind === 'main' && config.channelLinkId !== null
          ? (config.links.find((one) => one.id === config.channelLinkId) ?? null)
          : null;
      change = {
        ...signed,
        draft: renderChannelPost(gesture.text, link === null ? null : linkOf(config, link)),
      };
      break;
    }
    case 'rewrite': {
      const written = await writeWithRetry(deps, post, gesture.advice);
      if (!written.ok) return err('llm_unavailable');
      change = { ...signed, ...written.value };
      break;
    }
    case 'change_visual': {
      const pool =
        post.kind === 'main'
          ? await deps.visuals.eveningCandidates(creatorId, post.day)
          : await deps.visuals.telegramStock(creatorId);
      const other = pool.find((one) => one.mediaId !== post.mediaId);
      if (other === undefined) return err('no_other_visual');
      change = { ...signed, mediaId: other.mediaId, draft: null, locked: false };
      break;
    }
    case 'remove':
      change = { ...signed, state: 'removed' };
      break;
  }
  if (!(await deps.week.update(creatorId, post.id, change))) return err('not_planned');
  if (gesture.gesture === 'remove') await replace(deps, post);
  const after = await deps.week.find(creatorId, post.id);
  return after === null ? null : ok(after);
}

/** « Tout valider » (§ 3.3): every waiting post of the week not yet locked, in one gesture. */
export async function validateWeek(
  deps: ChannelWeekDeps,
  creatorId: CreatorId,
  week: string,
  reviewer: Reviewer,
  now: Date,
): Promise<number> {
  const posts = await deps.week.week(creatorId, week);
  let validated = 0;
  for (const post of posts) {
    if (post.state !== 'planned' || post.locked || new Date(post.at) <= now) continue;
    const result = await applyGesture(deps, creatorId, post.id, { gesture: 'validate' }, reviewer, now);
    if (result?.ok === true) validated += 1;
  }
  return validated;
}
