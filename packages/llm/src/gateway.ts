import { randomBytes } from 'node:crypto';

import {
  err,
  FanCardReadSchema,
  MEDIA_VOCABULARY_VERSION,
  ok,
  ScriptDropSummarySchema,
  type LlmPurpose,
} from '@impera/contracts';
import { generateText, transcribe as transcribeAudio } from 'ai';

import { budgetStatus, type BudgetStatus } from './budget';
import type { LlmCallLog } from './call-log';
import { classify, createCallRunner } from './call-runner';
import { acceptsInput, MODELS, TRANSCRIPTION_MODEL } from './catalog';
import type { ProviderId } from './config';
import {
  alertsBlock,
  describeBrief,
  judgeSituationBlock,
  notesBlock,
  toMessages,
} from './conversation-messages';
import type {
  ChannelPostInput,
  FanCardReadInput,
  LlmFailure,
  LlmGateway,
  LlmGatewayDeps,
  ScriptSummaryInput,
  VideoKeyframes,
} from './gateway-types';
import { computeHealth } from './health';
import { loadPrompt, renderPrompt } from './prompts';
import {
  BriefSchema,
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
  const scriptSummaryPrompt = prompts.scriptSummary ?? loadPrompt('brain', 'script-summary');
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

    brain(input) {
      const system = renderPrompt(prompts.brain, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        alerts: alertsBlock(input.alerts ?? []),
        fan_notes: notesBlock(input.fanNotes),
        situation: input.situation ?? 'Pas d’information sur le moment.',
        canary,
      });
      return run(
        'brain',
        prompts.brain,
        system,
        () => Promise.resolve(toMessages(input.history)),
        BriefSchema,
        input.trace,
      );
    },

    voice(input) {
      const system = renderPrompt(prompts.voice, {
        creator_name: input.creatorName,
        persona_sheet: input.personaSheet,
        fan_notes: notesBlock(input.fanNotes),
        situation: input.situation ?? 'Pas d’information sur le moment.',
        brief: describeBrief(input.brief, input.objectionReply),
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
        const result = await run(
          'voice',
          channelPostPrompt,
          system,
          messages,
          ChannelPollOutputSchema,
          input.trace,
        );
        return result.ok ? ok({ ...result.value, output: { kind: 'poll', ...result.value.output } }) : result;
      }
      const result = await run(
        'voice',
        channelPostPrompt,
        system,
        messages,
        ChannelPostOutputSchema,
        input.trace,
      );
      return result.ok ? ok({ ...result.value, output: { kind: 'post', ...result.value.output } }) : result;
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
        input.trace,
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

    promptHashes: { creatorDrop: creatorDropPrompt.hash, scriptSummary: scriptSummaryPrompt.hash },

    health() {
      return computeHealth(deps.config, deps.credentials, deps.log, now(), status(), trendWatchStatus());
    },

    async testConnection(provider) {
      // Test the model the config actually uses for this provider, else the first one the catalog knows.
      const configured = Object.values(deps.config.roles)
        .flatMap((role) => [role, ...(role.fallback ? [role.fallback] : [])])
        .find((ref) => ref.provider === provider);
      const ref = configured ?? MODELS.find((m) => m.provider === provider);
      if (ref === undefined) return { provider, isOk: false, outcome: 'unknown_model' };
      const model = deps.resolveModel(ref);
      if (model === undefined) return { provider, isOk: false, model: ref.model, outcome: 'missing_key' };
      const startedAt = now().getTime();
      try {
        await generateText({
          model,
          prompt: 'Réponds seulement : ok',
          maxOutputTokens: 5,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(15_000),
        });
        return {
          provider,
          isOk: true,
          model: ref.model,
          latencyMs: now().getTime() - startedAt,
          outcome: 'ok',
        };
      } catch (error) {
        return { provider, isOk: false, model: ref.model, outcome: classify(error).outcome };
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
