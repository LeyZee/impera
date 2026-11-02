import { CreatorIdSchema } from '@nirvana/contracts';
import { DEFAULT_LLM_CONFIG, loadPrompt } from '@nirvana/llm';

import type { AppLlm } from '../llm';
import {
  createAgentModule,
  guardContextOf,
  startBubbleGuard,
  startDraftComposer,
  startFollowUpPlan,
  startKycSlots,
  type ActivePersonaSource,
  type AgentModule,
} from '../modules/agent';
import type { AlertsModule } from '../modules/alerts';
import type { BubbleGuard, DraftComposer } from '../modules/conversations';
import type { FansModule } from '../modules/fans';
import type { PersonaModule } from '../modules/persona';
import type { SchedulingModule } from '../modules/scheduling';

import type { Shared } from './shared';

export interface WiredAgent {
  readonly module: AgentModule;
  readonly composer: DraftComposer;
  /** Undefined beside a composer plugged by a test: it would answer his last message again. */
  readonly followUps: ReturnType<typeof startFollowUpPlan> | undefined;
  readonly guard: BubbleGuard;
  /** The canvas lines her active persona collects, for « À apprendre » in the Suivi (P5-01); every line without one. */
  readonly kycSlotsOf: ReturnType<typeof startKycSlots>;
  /** The voice version the server writes with now, the one Automatique is proved on (ADR 0019): defined here only. */
  readonly activeVoice: { readonly voicePrompt: string; readonly voiceModel: string };
}

export function wireAgent(
  shared: Shared,
  deps: {
    readonly llm: AppLlm;
    readonly activePersona: ActivePersonaSource;
    readonly persona: PersonaModule;
    readonly fans: FansModule;
    readonly alerts: AlertsModule;
    readonly scheduling: SchedulingModule;
    /** Tests plug a composer with fixed bubbles here; the agent's composer otherwise, on the app's gateway. */
    readonly composer?: DraftComposer;
  },
): WiredAgent {
  const { logger } = shared;
  const { activePersona, persona, alerts, scheduling } = deps;
  // Each draft is written with her active persona version, read at each message; without one, a human answers
  // (`persona_inactive`). No file is read on this path: the fictional demo never writes to real fans unless an owner
  // activates it as her version (ADR 0010, 0022).
  const composer =
    deps.composer ??
    startDraftComposer({
      gateway: deps.llm.gateway,
      activePersona,
      fans: deps.fans,
      onDroppedNotes: (event) => {
        logger.warn(event, 'fan notes shaped like an order kept out of the prompt');
      },
      // His declared age could not be saved: the next answer stays careful, the miss is counted here (P3-09).
      onLimitsNotSaved: (event) => {
        logger.warn(event, 'fan limit not saved');
      },
      // Her alerts that are on, and the system's on for her (P4-01).
      alertsOf: async (creatorId) => {
        const id = CreatorIdSchema.parse(creatorId);
        const [custom, systemOn] = await Promise.all([alerts.store.activeFor(id), alerts.store.systemOn(id)]);
        return { custom, systemOn };
      },
      // A doubt on who she is goes to a chatter on shift now, without the margin (P4-01).
      chatterOnShift: async (creatorId, at) =>
        (await scheduling.onShift(CreatorIdSchema.parse(creatorId), at)).length > 0,
      // Her clock is the creator's (`creators.timezone`); Paris when the row cannot be read.
      timeZoneOf: async (creatorId) => {
        const [creator] = await persona.creators.list([CreatorIdSchema.parse(creatorId)]);
        return creator?.timezone ?? DEFAULT_LLM_CONFIG.dailyBudget.timeZone;
      },
    });
  // Her follow-up delays only beside the agent's own composer, the one that writes what `conversation.follow_up`
  // asks for (P3-10).
  const followUps = deps.composer !== undefined ? undefined : startFollowUpPlan({ activePersona });
  // Every approval passes the hard guards again (revue 09, G5), her active persona's limits included, read before
  // each approval (recette 28/10, G4). Without an active version nothing is approved: fail closed.
  const agentGuard = startBubbleGuard({ activePersona });
  // Read against what she already sent him (P3-13); an approved draft never carries a media.
  const guard: BubbleGuard = {
    forCreator: async (creatorId) => {
      const hers = await agentGuard.forCreator(creatorId);
      return hers === null
        ? null
        : { check: (bubbles, { history }) => hers.check(bubbles, guardContextOf(history)) };
    },
  };
  return {
    module: createAgentModule(),
    composer,
    followUps,
    guard,
    kycSlotsOf: startKycSlots({ activePersona }),
    activeVoice: {
      voicePrompt: loadPrompt('voice').header.version,
      voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
    },
  };
}
