import { randomBytes } from 'node:crypto';

import {
  CaptionProposalsSchema,
  CommentOutcomeSchema,
  err,
  FanCardReadSchema,
  MEDIA_VOCABULARY_VERSION,
  ok,
  ScriptDropSummarySchema,
  ScriptIdentityContentSchema,
  type LlmPurpose,
} from '@impera/contracts';
import { generateText, transcribe as transcribeAudio } from 'ai';

import { budgetStatus, type BudgetStatus } from './budget';
import type { LlmCallLog } from './call-log';
import { classify, createCallRunner } from './call-runner';
import { acceptsInput, costUsd, findModel, MODELS, TRANSCRIPTION_MODEL } from './catalog';
import { LlmRoleSchema, type ProviderId } from './config';
import {
  alertsBlock,
  describeBrief,
  describeLanguage,
  judgeSituationBlock,
  notesBlock,
  customOrderBlock,
  profileBioBlock,
  agencyStyleBlock,
  publicStyleBlock,
  scriptsBlock,
  toMessages,
} from './conversation-messages';
import type {
  CaptionProposalsInput,
  ChannelPostInput,
  FanCardReadInput,
  InstagramCommentInput,
  LlmFailure,
  LlmGateway,
  LlmGatewayDeps,
  ScriptIdentityInput,
  ScriptSummaryInput,
  VideoKeyframes,
} from './gateway-types';
import { computeHealth } from './health';
import { loadPrompt, renderPrompt } from './prompts';
import {
  BriefFromModelSchema,
  ChannelPollOutputSchema,
  ChannelPostOutputSchema,
  JudgeOutputSchema,
  DropSenseOutputSchema,
  SenseOutputSchema,
  TrendCapturesOutputSchema,
  VoiceOutputSchema,
} from './schemas';
import { dropSenseContent, senseContent } from './sense-content';
import { wrapUntrusted } from './untrusted';

export type * from './gateway-types';

/** « Réponds seulement : ok » needs two; Grok's short reasoning shares the budget, and a cut answer still proves the call. */
const PROBE_MAX_OUTPUT_TOKENS = 16;
const PROBE_TIMEOUT_MS = 20_000;

export function createLlmGateway(deps: LlmGatewayDeps): LlmGateway {
  const now = deps.now ?? (() => new Date());
  const prompts = deps.prompts ?? {
    voice: loadPrompt('voice'),
    brain: loadPrompt('brain'),
    sense: loadPrompt('sense'),
  };
  const judgePrompt = prompts.judge ?? loadPrompt('judge');
  const trendCapturesPrompt = prompts.trendCaptures ?? loadPrompt('sense', 'trend-captures');
  const creatorDropPrompt = prompts.creatorDrop ?? loadPrompt('sense', 'creator-drop');
  const channelPostPrompt = prompts.channelPost ?? loadPrompt('voice', 'telegram-channel');
  const instagramCommentPrompt = prompts.instagramComment ?? loadPrompt('voice', 'instagram-comment');
  const instagramCaptionPrompt = prompts.instagramCaption ?? loadPrompt('voice', 'instagram-caption');
  const scriptSummaryPrompt = prompts.scriptSummary ?? loadPrompt('brain', 'script-summary');
  const scriptIdentityPrompt = prompts.scriptIdentity ?? loadPrompt('brain', 'script-identity');
  const fanCardPrompt = prompts.fanCard ?? loadPrompt('brain', 'fan-card');
  const canary = deps.canary ?? `nv-${randomBytes(6).toString('hex')}`;

  const reportRefusal = (provider: ProviderId, status: 401 | 403): void => {
    try {
      deps.onKeyRefused?.({ provider, status });
    } catch {
      // Reporting is best effort: the call goes on to its fallback either way.
    }
  };
  const capEur = (): number => deps.dailyCapEur?.() ?? deps.config.dailyBudget.capEur;
  const status = (): BudgetStatus => budgetStatus(deps.config.dailyBudget, capEur(), deps.log, now());
  const trendWatchCapEur = (): number =>
    deps.trendWatchCapEur?.() ?? deps.config.dailyBudget.trendWatchCapEur;
  /** The trend watch's own spend, under its own cap; never announced (the agency reads it in amber, ADR 0060 § 7). */
  const trendWatchStatus = (): BudgetStatus =>
    budgetStatus(deps.config.dailyBudget, trendWatchCapEur(), deps.log, now(), 'trend_watch');
  const announced = new Set<string>();
  const announce = (current: BudgetStatus): void => {
    const kinds =
      current.state === 'reached'
        ? (['alert', 'reached'] as const)
        : current.state === 'alert'
          ? (['alert'] as const)
          : [];
    for (const kind of kinds) {
      const key = `${current.day}:${kind}`;
      if (announced.has(key)) continue;
      announced.add(key);
      try {
        deps.onBudget?.({ kind, status: current });
      } catch {
        // Best effort, like the key refusals: the cap itself is enforced here, not by the listener.
      }
    }
  };
  // Every journaled call may cross a threshold: checked right after it is written.
  const log: LlmCallLog = {
    append(record) {
      deps.log.append(record);
      if (record.costUsd !== undefined && record.costUsd > 0) announce(status());
    },
    since: (from) => deps.log.since(from),
  };
  /** The daily cap stops every call; the watch's cap, only the watch's (a fan's answer never waits on it). */
  const overBudget = (purpose: LlmPurpose | undefined): LlmFailure['code'] | undefined => {
    const current = status();
    announce(current);
    if (current.state === 'reached') return 'budget_reached';
    if (purpose === 'trend_watch' && trendWatchStatus().state === 'reached')
      return 'trend_watch_budget_reached';
    return undefined;
  };
  const run = createCallRunner({
    config: deps.config,
    log,
    resolveModel: deps.resolveModel,
    now,
    canary,
    reportRefusal,
    overBudget,
    ...(deps.sleep !== undefined && { sleep: deps.sleep }),
    ...(deps.hedgeTimer !== undefined && { hedgeTimer: deps.hedgeTimer }),
  });

  return {
    async sense(input) {
      const system = renderPrompt(prompts.sense, { canary });
      let pending: Promise<VideoKeyframes> | undefined;
      const keyframes = (): Promise<VideoKeyframes> => {
        if (input.media.kind !== 'video') return Promise.resolve({ frames: [] });
        pending ??= input.media.keyframes();
        return pending;
      };
      const result = await run(
        'sense',
        prompts.sense,
        system,
        async (ref) => {
          const content = await senseContent(input, ref, keyframes);
          return content === undefined ? undefined : [{ role: 'user', content }];
        },
        SenseOutputSchema,
        input.trace,
      );
      if (!result.ok) return result;
      const { media } = input;
      return ok({
        ...result.value,
        output: {
          ...result.value.output,
          vocabularyVersion: MEDIA_VOCABULARY_VERSION,
          kind: media.kind,
          durationS: media.kind === 'image' ? null : media.durationS,
        },
      });
    },

    async describeDrop(input) {
      const system = renderPrompt(creatorDropPrompt, { canary });
      let pending: Promise<VideoKeyframes> | undefined;
      const keyframes = (): Promise<VideoKeyframes> => {
        if (input.media.kind !== 'video') return Promise.resolve({ frames: [] });
        pending ??= input.media.keyframes();
        return pending;
      };
      const result = await run(
        'sense',
        creatorDropPrompt,
        system,
        async (ref) => {
          const content = await dropSenseContent(input, ref, keyframes);
          return content === undefined ? undefined : [{ role: 'user', content }];
        },
        DropSenseOutputSchema,
        { ...input.trace, purpose: 'media' },
      );
      if (!result.ok) return result;
      const { media } = input;
      return ok({
        ...result.value,
        output: {
          ...result.value.output,
          vocabularyVersion: MEDIA_VOCABULARY_VERSION,
          kind: media.kind,
          durationS: media.kind === 'image' ? null : media.durationS,
        },
      });
    },

    brain(input) {
      const system = renderPrompt(prompts.brain, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        profile_bio: profileBioBlock(input.profileBio),
        alerts: alertsBlock(input.alerts ?? []),
        scripts: scriptsBlock(input.scripts ?? [], input.scriptStepWaiting === true),
        custom_order: customOrderBlock(input.customOrder),
        fan_notes: notesBlock(input.fanNotes),
        situation: input.situation ?? 'Pas d’information sur le moment.',
        canary,
      });
      return run(
        'brain',
        prompts.brain,
        system,
        () => Promise.resolve(toMessages(input.history)),
        BriefFromModelSchema,
        input.trace,
      );
    },

    voice(input) {
      const system = renderPrompt(prompts.voice, {
        creator_name: input.creatorName,
        agency_style: agencyStyleBlock(input.agencyStyle),
        persona_sheet: input.personaSheet,
        profile_bio: profileBioBlock(input.profileBio),
        fan_notes: notesBlock(input.fanNotes),
        situation: input.situation ?? 'Pas d’information sur le moment.',
        language: describeLanguage(input.language),
        brief: describeBrief(
          input.brief,
          input.objectionReply,
          input.scriptStep,
          input.maxBubbles,
          input.waitingStep,
        ),
        canary,
      });
      return run(
        'voice',
        prompts.voice,
        system,
        () => Promise.resolve(toMessages(input.history)),
        VoiceOutputSchema,
        input.trace,
      );
    },

    judge(input) {
      const system = renderPrompt(judgePrompt, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        profile_bio: profileBioBlock(input.profileBio),
        fan_notes: notesBlock(input.fanNotes),
        // What the agent saw (his age, his flags, the last offer): safety is read against it, not guessed.
        situation: judgeSituationBlock(input.situation),
        criteria: input.criteria.join(', '),
        canary,
      });
      // The reply may quote him: it is read as data, like his messages.
      const reply = wrapUntrusted('candidate_reply', input.reply.join('\n'));
      return run(
        'judge',
        judgePrompt,
        system,
        () => Promise.resolve([...toMessages(input.history), { role: 'user', content: reply }]),
        JudgeOutputSchema,
        input.trace,
      );
    },

    async transcribe(audio) {
      const ref = { provider: TRANSCRIPTION_MODEL.provider, model: TRANSCRIPTION_MODEL.model };
      const model = deps.resolveTranscriber?.();
      if (model === undefined)
        return err({ code: 'all_models_failed', attempts: [{ ...ref, outcome: 'missing_key' }] });
      const refusedBy = overBudget(audio.trace?.purpose);
      if (refusedBy !== undefined) return err({ code: refusedBy, attempts: [] });
      const startedAt = now().getTime();
      const base = {
        role: 'sense',
        ...ref,
        promptHash: 'transcription',
        isFallback: false,
        ...audio.trace,
      } as const;
      try {
        const result = await transcribeAudio({
          model,
          audio: audio.data,
          maxRetries: deps.config.maxTransientRetries,
          abortSignal: AbortSignal.timeout(deps.config.roles.sense.timeoutMs),
        });
        const durationS = result.durationInSeconds ?? audio.durationS;
        log.append({
          ...base,
          at: now(),
          outcome: 'ok',
          latencyMs: now().getTime() - startedAt,
          ...(durationS !== undefined && {
            costUsd: (durationS / 3_600) * TRANSCRIPTION_MODEL.usdPerAudioHour,
          }),
        });
        return ok({ text: result.text, ...(durationS !== undefined && { durationS }) });
      } catch (error) {
        const { outcome, message, refusedStatus } = classify(error);
        if (refusedStatus !== undefined) reportRefusal(ref.provider, refusedStatus);
        log.append({
          ...base,
          at: now(),
          outcome,
          latencyMs: now().getTime() - startedAt,
          errorMessage: message.slice(0, 200),
        });
        return err({ code: 'all_models_failed', attempts: [{ ...ref, outcome }] });
      }
    },

    describeTrendCaptures(input) {
      const system = renderPrompt(trendCapturesPrompt, { canary });
      const intro =
        input.durationS === null
          ? `${String(input.captures.length)} capture(s) d'un post, photo ou carrousel.`
          : `${String(input.captures.length)} capture(s) d'une vidéo de ${String(Math.round(input.durationS))} s.`;
      return run(
        'sense',
        trendCapturesPrompt,
        system,
        (ref) =>
          Promise.resolve(
            // A model that reads no image is skipped for the fallback.
            acceptsInput(ref, 'image')
              ? [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: intro },
                      ...input.captures.map((capture) => ({
                        type: 'file' as const,
                        data: capture.data,
                        mediaType: capture.mediaType,
                      })),
                    ],
                  },
                ]
              : undefined,
          ),
        TrendCapturesOutputSchema,
        { ...input.trace, purpose: 'trend_watch' },
      );
    },

    async channelPost(input) {
      const system = renderPrompt(channelPostPrompt, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        examples:
          input.examples.length === 0
            ? 'Aucun exemple pour l’instant.'
            : wrapUntrusted('channel_examples', input.examples.join('\n\n---\n\n')),
        canary,
      });
      const content = channelPostRequest(input);
      const messages = (): Promise<{ role: 'user'; content: string }[]> =>
        Promise.resolve([{ role: 'user', content }]);
      if (input.kind === 'poll') {
        const result = await run('voice', channelPostPrompt, system, messages, ChannelPollOutputSchema, {
          ...input.trace,
          purpose: 'telegram',
        });
        return result.ok ? ok({ ...result.value, output: { kind: 'poll', ...result.value.output } }) : result;
      }
      const result = await run('voice', channelPostPrompt, system, messages, ChannelPostOutputSchema, {
        ...input.trace,
        purpose: 'telegram',
      });
      return result.ok ? ok({ ...result.value, output: { kind: 'post', ...result.value.output } }) : result;
    },

    async instagramComment(input) {
      const system = renderPrompt(instagramCommentPrompt, {
        creator_name: input.creatorName,
        agency_public_style: publicStyleBlock(input.publicStyle),
        persona_sheet: input.personaSheet,
        examples:
          input.examples.length === 0
            ? 'Aucun exemple pour l’instant.'
            : wrapUntrusted('comment_examples', input.examples.join('\n\n---\n\n')),
        canary,
      });
      const content = instagramCommentRequest(input);
      return run(
        'voice',
        instagramCommentPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        CommentOutcomeSchema,
        { ...input.trace, purpose: 'instagram_comment' },
      );
    },

    async proposeCaptions(input) {
      const system = renderPrompt(instagramCaptionPrompt, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        examples:
          input.examples.length === 0
            ? 'Aucune légende d’exemple pour l’instant.'
            : wrapUntrusted('caption_examples', input.examples.join('\n\n---\n\n')),
        canary,
      });
      const content = captionProposalsRequest(input);
      return run(
        'voice',
        instagramCaptionPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        CaptionProposalsSchema,
        { ...input.trace, purpose: 'instagram_caption' },
      );
    },

    async summarizeScript(input) {
      const system = renderPrompt(scriptSummaryPrompt, { canary });
      const content = scriptSummaryRequest(input);
      return run(
        'brain',
        scriptSummaryPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        ScriptDropSummarySchema,
        { ...input.trace, purpose: 'media' },
      );
    },

    async identifyScript(input) {
      const system = renderPrompt(scriptIdentityPrompt, { canary });
      const content = scriptIdentityRequest(input);
      return run(
        'brain',
        scriptIdentityPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        ScriptIdentityContentSchema,
        { ...input.trace, purpose: 'media' },
      );
    },

    async readCard(input) {
      // § 7: the card stops before a fan's answer would, from the day's alert on.
      const current = status();
      announce(current);
      if (current.state !== 'ok') return err({ code: 'budget_reached', attempts: [] });
      const system = renderPrompt(fanCardPrompt, { canary });
      const content = fanCardRequest(input);
      return run(
        'brain',
        fanCardPrompt,
        system,
        () => Promise.resolve([{ role: 'user', content }]),
        FanCardReadSchema,
        input.trace,
      );
    },

    promptHashes: {
      creatorDrop: creatorDropPrompt.hash,
      scriptSummary: scriptSummaryPrompt.hash,
      scriptIdentity: scriptIdentityPrompt.hash,
    },

    health() {
      return computeHealth(deps.config, deps.credentials, deps.log, now(), status(), trendWatchStatus());
    },

    async testConnection(provider) {
      // The owner's « Essai réel » (ADR 0091 § 7): the model the config actually uses for this provider (its first role
      // or fallback), else the first one the catalog knows. One tiny call, journaled under `probe` so its cost counts,
      // stopped by the day's cap like any other, and kept out of the agent's health (health.ts).
      const configured = LlmRoleSchema.options
        .flatMap((role) => {
          const config = deps.config.roles[role];
          return [
            { role, ref: { provider: config.provider, model: config.model } },
            ...(config.fallback ? [{ role, ref: config.fallback }] : []),
          ];
        })
        .find(({ ref }) => ref.provider === provider);
      const known = MODELS.find((m) => m.provider === provider);
      const target = configured ?? (known === undefined ? undefined : { role: 'brain' as const, ref: known });
      if (target === undefined) return { provider, isOk: false, outcome: 'unknown_model' };
      const { role, ref } = target;
      const named = { model: ref.model, modelLabel: findModel(ref)?.label ?? ref.model };
      const model = deps.resolveModel(ref);
      if (model === undefined) return { provider, isOk: false, ...named, outcome: 'missing_key' };
      if (overBudget('probe') !== undefined)
        return { provider, isOk: false, ...named, outcome: 'budget_reached' };
      const startedAt = now().getTime();
      const base = {
        role,
        provider: ref.provider,
        model: ref.model,
        promptHash: 'probe',
        isFallback: false,
        purpose: 'probe',
      } as const;
      try {
        const answer = await generateText({
          model,
          prompt: 'Réponds seulement : ok',
          maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          ...(ref.provider === 'xai' && { providerOptions: { xai: { reasoningEffort: 'low' } } }),
        });
        const latencyMs = now().getTime() - startedAt;
        const cost = costUsd(ref, answer.usage);
        log.append({
          ...base,
          at: now(),
          outcome: 'ok',
          latencyMs,
          ...(answer.usage.inputTokens !== undefined && { inputTokens: answer.usage.inputTokens }),
          ...(answer.usage.outputTokens !== undefined && { outputTokens: answer.usage.outputTokens }),
          ...(cost !== undefined && { costUsd: cost }),
        });
        return { provider, isOk: true, ...named, latencyMs, outcome: 'ok' };
      } catch (error) {
        const latencyMs = now().getTime() - startedAt;
        const { outcome, message, usage, refusedStatus } = classify(error);
        if (refusedStatus !== undefined) reportRefusal(ref.provider, refusedStatus);
        const cost = usage === undefined ? undefined : costUsd(ref, usage);
        log.append({
          ...base,
          at: now(),
          outcome,
          latencyMs,
          errorMessage: message.slice(0, 200),
          ...(cost !== undefined && { costUsd: cost }),
        });
        return { provider, isOk: false, ...named, latencyMs, outcome };
      }
    },
  };
}

/** What this one post is: written by the code, the agency's words in their blocks (CLAUDE.md rule 4). */
function channelPostRequest(input: ChannelPostInput): string {
  const media = input.kind === 'poll' ? null : input.media;
  const lines = [
    input.kind === 'poll'
      ? 'Écris un sondage pour son canal : une question et deux à quatre réponses.'
      : input.kind === 'main'
        ? media === null
          ? 'Écris le post principal du jour pour son canal, un texte seul, sans média : il mène au lien ajouté à la fin.'
          : 'Écris le post principal du jour pour son canal : il réagit à ce média et mène au lien ajouté à la fin.'
        : media === null
          ? 'Écris un post d’engagement pour son canal, un texte seul, sans média et sans lien.'
          : 'Écris un post d’engagement pour son canal qui accompagne ce média, sans lien.',
  ];
  if (media !== null) lines.push('', wrapUntrusted('creator_media_description', media));
  if (input.kind === 'main') {
    const destination = input.destination?.trim() ?? '';
    lines.push(
      '',
      destination === ''
        ? 'Le lien ajouté à la fin ne dit pas où il mène : ne nomme aucun endroit.'
        : `Le lien ajouté à la fin mène ici :\n${wrapUntrusted('link_destination', destination)}`,
    );
  }
  if (input.advice !== null) lines.push('', wrapUntrusted('agency_advice', input.advice));
  return lines.join('\n');
}

const MEDIA_KIND_WORDS = { reel: 'un Reel', photo: 'une photo', carousel: 'un carrousel' } as const;

const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** What this one Reel is: the facts written by the code, every text of hers or of the media in its block. */
function captionProposalsRequest(input: CaptionProposalsInput): string {
  const lines = [
    input.durationS === null
      ? 'Un Reel qu’elle vient de déposer.'
      : `Un Reel de ${String(Math.round(input.durationS))} secondes qu’elle vient de déposer.`,
    '',
    `Ce qu’on voit dans la vidéo :\n${wrapUntrusted('creator_media_description', input.mediaDescription)}`,
  ];
  if (input.sentence !== null && input.sentence.trim() !== '')
    lines.push(
      '',
      `Ce qu’elle a écrit en la déposant :\n${wrapUntrusted('creator_sentence', input.sentence)}`,
    );
  if (input.otherIdeas !== undefined) {
    const { hints, note, seen } = input.otherIdeas;
    const wishes = [
      ...hints.map((hint) => `- ${hint}`),
      ...(note.trim() === '' ? [] : [`- ${oneLine(note)}`]),
    ];
    lines.push(
      '',
      'Elle a lu des légendes et en veut d’autres. Ce qu’elle demande :',
      wrapUntrusted('caption_hints', wishes.join('\n')),
    );
    if (seen.length > 0)
      lines.push(
        '',
        'Les légendes qu’elle a déjà lues, à ne pas réécrire :',
        wrapUntrusted('instagram_caption', seen.map((caption) => `- ${oneLine(caption)}`).join('\n')),
      );
  }
  if (input.refusedBy !== undefined && input.refusedBy.length > 0)
    lines.push(
      '',
      `Des légendes de ta première réponse ont été refusées (${input.refusedBy.join(', ')}). Écris-en trois autres, plus simples.`,
    );
  return lines.join('\n');
}

const EMOJI_SHAPE_WORDS = {
  0: 'aucun emoji',
  1: 'un seul emoji',
  2: 'deux emojis',
} as const;

/** What this one comment is: the facts written by the code, the two texts in their blocks (CLAUDE.md rule 4). */
function instagramCommentRequest(input: InstagramCommentInput): string {
  const { comment } = input;
  const lines = [
    `Un commentaire sous ${MEDIA_KIND_WORDS[comment.mediaKind]} qu’elle a publié il y a ${String(comment.postAgeHours)} h.`,
    comment.repliesToHer
      ? 'Il répond à une de ses réponses.'
      : 'Il est posé directement sous la publication.',
    comment.authorCommentedBefore
      ? 'Son auteur a déjà commenté ses publications.'
      : 'C’est le premier commentaire de son auteur.',
    '',
    comment.caption.trim() === ''
      ? 'La publication n’a pas de légende.'
      : `La légende de la publication :\n${wrapUntrusted('instagram_caption', comment.caption)}`,
    '',
    `Le commentaire :\n${wrapUntrusted('instagram_comment', comment.comment)}`,
    '',
    comment.emojiOnly
      ? 'Il lui dit qu’il l’aime : si tu réponds, seulement un ou deux emojis, sans aucun mot ni question.'
      : comment.mayAsk
        ? 'Tu peux finir ta réponse par une question, seulement si le commentaire ouvre vraiment une discussion.'
        : 'Pas de question dans ta réponse cette fois.',
  ];
  const shape = input.replyShape;
  if (shape !== undefined && !comment.emojiOnly)
    lines.push(
      `Cette fois, comme dans sa réponse la plus proche : ${shape.words <= 3 ? 'quelques mots' : `environ ${String(shape.words)} mots`}, ${EMOJI_SHAPE_WORDS[shape.emojis]}${shape.exclaims ? ', et un point d’exclamation' : ''}.`,
    );
  const near = input.nearExamples ?? [];
  if (near.length > 0)
    lines.push(
      '',
      'Ce qu’elle a répondu à des commentaires proches, pour le ton (jamais à recopier) :',
      wrapUntrusted(
        'her_replies',
        near
          .map(
            (pair) =>
              `Commentaire : ${pair.comment.replace(/\s+/gu, ' ').trim()}\nSa réponse : ${pair.reply.replace(/\s+/gu, ' ').trim()}`,
          )
          .join('\n---\n'),
      ),
    );
  if (input.recentReplies.length > 0)
    lines.push(
      '',
      'Ses réponses récentes, à ne pas répéter :',
      wrapUntrusted(
        'recent_replies',
        input.recentReplies.map((reply) => `- ${reply.replace(/\s+/gu, ' ').trim()}`).join('\n'),
      ),
    );
  if (input.refusedBy !== undefined && input.refusedBy.length > 0)
    lines.push(
      '',
      `Ta première réponse a été refusée (${input.refusedBy.join(', ')}). Écris-en une autre, plus simple, ou choisis une autre issue.`,
    );
  return lines.join('\n');
}

const MOMENT_WORDS = { day: 'de jour', night: 'de nuit' } as const;

function mediaLine(media: ScriptSummaryInput['steps'][number]['media'][number], index: number): string {
  const length = media.durationS === null ? '' : `, ${String(Math.round(media.durationS))} s`;
  const head = `Média ${String(index + 1)} (${{ image: 'photo', video: 'vidéo', audio: 'note vocale' }[media.kind]}${length})`;
  return media.description === null ? `${head} : non décrit.` : `${head} :\n${media.description}`;
}

/** The script, step by step: each card and its media's descriptions, in one data block. */
function scriptSummaryRequest(input: ScriptSummaryInput): string {
  const steps = input.steps.map((step) =>
    [
      `## Étape ${step.code} « ${step.name} » (clé ${step.step})`,
      step.card === null ? 'Carton : rien de plus que son nom.' : `Carton : ${step.card}`,
      ...step.media.map(mediaLine),
    ].join('\n'),
  );
  const moment = input.moment === null ? '' : `, tourné ${MOMENT_WORDS[input.moment]}`;
  return [
    `Écris la fiche de ce script${moment} : chacune de ses ${String(input.steps.length)} étapes, dans cet ordre, puis le contexte du tournage.`,
    '',
    wrapUntrusted('script_steps', [`# Script « ${input.scriptName} »`, ...steps].join('\n\n')),
  ].join('\n');
}

/** The native script, step by step: each name, its offer's text and its media's descriptions, in one data block. */
function scriptIdentityRequest(input: ScriptIdentityInput): string {
  const steps = input.steps.map((step, index) =>
    [
      `## Étape ${String(index + 1)} « ${step.name} »`,
      step.text.trim() === '' ? 'Texte : aucun.' : `Texte : ${step.text}`,
      ...step.media.map(mediaLine),
    ].join('\n'),
  );
  return [
    `Écris l'identité de ce script de ${String(input.steps.length)} étapes.`,
    '',
    wrapUntrusted('script_steps', [`# Script « ${input.scriptName} »`, ...steps].join('\n\n')),
  ].join('\n');
}

/** The card as it is, then the conversation numbered, his new messages marked: two data blocks. */
function fanCardRequest(input: FanCardReadInput): string {
  const card = input.card.length === 0 ? 'Rien de connu.' : input.card.join('\n');
  const lines = input.messages.map((message) => {
    const who = message.from === 'fan' ? (message.isNew ? 'Lui, nouveau' : 'Lui') : 'Elle';
    return `[${String(message.number)}] ${who} : ${message.text}`;
  });
  return [
    'Lis ses nouveaux messages et propose ce qu’ils apprennent de lui, case par case.',
    '',
    wrapUntrusted('fan_notes', card),
    '',
    wrapUntrusted('fan_message', lines.join('\n')),
  ].join('\n');
}
