import { CreatorIdSchema } from '@impera/contracts';
import { DEFAULT_LLM_CONFIG, loadPrompt } from '@impera/llm';

import type { AppLlm } from '../llm';
import {
  createAgentModule,
  guardContextOf,
  startBubbleGuard,
  startCardReader,
  startDraftComposer,
  startFollowUpPlan,
  startKycSlots,
  type ActivePersonaSource,
  type AgentModule,
} from '../modules/agent';
import type { AlertsModule } from '../modules/alerts';
import type { ConnectorsModule } from '../modules/connectors';
import type { BubbleGuard, CardReader, DraftComposer } from '../modules/conversations';
import type { FansModule } from '../modules/fans';
import type { PersonaModule } from '../modules/persona';
import { createDbVoiceExampleBank } from '../modules/playground';
import type { SchedulingModule } from '../modules/scheduling';
import type { ScriptsModule } from '../modules/scripts';

import { createAgentScriptSource, createLastOfferAt } from './agent-scripts';
import type { Shared } from './shared';

export interface WiredAgent {
  readonly module: AgentModule;
  readonly composer: DraftComposer;
  /** Undefined beside a composer plugged by a test: it would answer his last message again. */
  readonly followUps: ReturnType<typeof startFollowUpPlan> | undefined;
  readonly guard: BubbleGuard;
  /** His card read in his messages (ADR 0085 § 7), on the app's gateway, whoever answers him. */
  readonly cardReader: CardReader;
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
    /** Her native scripts as the agency mirrored and validated them (ADR 0098, ADR 0099). */
    readonly scripts: ScriptsModule;
    /** His script history and last priced offer, read on the platform at each message (ADR 0018 § 5). */
    readonly connectors: ConnectorsModule;
    /** Tests plug a composer with fixed bubbles here; the agent's composer otherwise, on the app's gateway. */
    readonly composer?: DraftComposer;
  },
): WiredAgent {
  const { logger } = shared;
  const { activePersona, persona, alerts, scheduling } = deps;
  // Her scripts on the platform and his history there (ADR 0098): without them she sells nothing.
  const scriptReads = {
    scripts: deps.scripts.forJobs,
    reads: deps.connectors.platformReads,
    fans: deps.fans,
  };
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
      scripts: createAgentScriptSource(scriptReads),
      lastOfferAt: createLastOfferAt(scriptReads),
      // Her bio on her platform profile, as the poll last read it (ADR 0154): beside her persona, it wins where they differ.
      profileBioOf: (creatorId) => deps.connectors.profileBioOf(CreatorIdSchema.parse(creatorId)),
      timeZoneOf: async (creatorId) => {
        const [creator] = await persona.creators.list([CreatorIdSchema.parse(creatorId)]);
        return creator?.timezone ?? DEFAULT_LLM_CONFIG.dailyBudget.timeZone;
      },
      // Her bank of examples, the playground's corrections, read as the playground reads them (ADR 0102 § 2).
      voiceExamplesOf: createDbVoiceExampleBank(shared.db),
      onExamplesUnread: (event) => {
        logger.warn(event, 'voice examples unread: she wrote from her sheet alone');
      },
    });
  // Her follow-up delays only beside the agent's own composer, the one that writes what `conversation.follow_up`
  // asks for (P3-10).
  const followUps = deps.composer !== undefined ? undefined : startFollowUpPlan({ activePersona });
  // Every approval passes the hard guards again (revue 09, G5), her active persona's limits included, read before
  // each approval (recette 28/10, G4). Without an active version nothing is approved: fail closed.
  const agentGuard = startBubbleGuard({ activePersona });
  // Read against what she already sent him (P3-13); a draft carries a media only through the step of her script.
  const guard: BubbleGuard = {
    forCreator: async (creatorId) => {
      const hers = await agentGuard.forCreator(creatorId);
      return hers === null
        ? null
        : {
            check: (bubbles, { history, care, hasMedia }) =>
              hers.check(bubbles, guardContextOf(history, hasMedia === true), care === true),
          };
    },
  };
  return {
    module: createAgentModule(),
    composer,
    followUps,
    guard,
    cardReader: startCardReader({
      gateway: deps.llm.gateway,
      onDroppedNotes: (event) => {
        logger.warn(event, 'fan card lines shaped like an order kept out of the read');
      },
    }),
    kycSlotsOf: startKycSlots({ activePersona }),
    activeVoice: {
      voicePrompt: loadPrompt('voice').header.version,
      voiceModel: DEFAULT_LLM_CONFIG.roles.voice.model,
    },
  };
}
