import { desireBandOf } from '@impera/contracts';

import { abandonTease, type AbandonTease } from './abandon';
import { fantasyMatchOf, mentions, type DesireMap } from './fantasy-match';
import { gaugeDue, holdsBackNow, projectionDue } from './gauge';
import { touchesTerm } from './guards';
import { keepsWarm, offerSignals, saysNoMoneyNow } from './policy';
import { registerOf, type Register } from './register';
import { scriptStepsHeld, type PlatformScriptView, type ScriptRun } from './script-run';
import type { ScriptTurn } from './script-turn';
import {
  cameBeforeFinale,
  haggles,
  isBareMurmur,
  peakSeen,
  wantsMadeForHim,
  wantsOtherMan,
} from './sexting-moves';
import type { SexualizationDecision } from './sexualization';
import type { Situation } from './situation';
import { paysNow, type StandingFacts, type StandingLimits } from './standing';
import type { TurnReading } from './turn-briefs';
import { herAnswersSince, hisMessagesAt, type HistoryTurn } from './turn-history';
import {
  intensitiesSeen,
  seenRun,
  visibleStepSheet,
  type OfferInput,
  type ScriptsInput,
} from './turn-scripts';

/** The intents that read as heated: her register applies only to them. */
const HEATED_INTENTS: readonly string[] = ['flirt', 'sexting', 'media_reaction'];

/** His run as stored, and what this message says of it before her scripts decide anything. */
export interface RunFacts {
  readonly storedRun: ScriptRun | null;
  /** She holds him back when he is about to come, until he has seen the frankest step of her script (Charles 26/11). */
  readonly storedPeakSeen: boolean;
  readonly heCame: boolean;
  /** He left in the middle of a script and comes back hot: she teases him first, and no step goes on this message. */
  readonly tease: AbandonTease | null;
  /** Broke until his pay, a fan who already paid: kept warm with words, no step and no media this time (passe 11a). */
  readonly warm: boolean;
  /**
   * When he wrote: his messages since he bought the last paid step, the next one waits in the tension (passe 04,
   * guide 26/11), counted by the script turn on the run Reveal's history leaves (passe 2 du 26/11).
   */
  readonly hisMessagesAt: readonly Date[];
  /**
   * His messages since he bought the last paid step of his stored run: the first one after a purchase, she asks
   * whether he liked it (`justBought`).
   */
  readonly hisMessagesSinceBought: number | undefined;
}

export function runFactsOf(facts: {
  readonly brief: TurnReading | undefined;
  readonly scripts: ScriptsInput | undefined;
  readonly offer: OfferInput | undefined;
  readonly situation: Situation;
  readonly heat: number;
  readonly care: boolean;
  readonly standingFacts: StandingFacts;
  readonly standingLimits: StandingLimits | undefined;
  readonly history: readonly HistoryTurn[];
}): RunFacts {
  const { brief, scripts, offer } = facts;
  const storedRun = scripts?.latest ?? null;
  const storedPeakSeen =
    storedRun?.status === 'open' &&
    peakSeen(
      storedRun,
      scripts?.catalogue.find((one) => one.scriptRef === storedRun.scriptRef),
    );
  const heCame = brief?.desireSignals?.includes('just_came') === true;
  const tease =
    scripts === undefined || offer === undefined || brief === undefined || heCame
      ? null
      : abandonTease({
          now: facts.situation.now,
          latest: scripts.latest,
          earlier: scripts.earlier ?? [],
          teased: scripts.teased ?? 0,
          hot: facts.heat >= offer.limits.minDesire,
          held: scriptStepsHeld(offer.flags, facts.care) || offer.flags.ageDisputed !== undefined,
        });
  const warm =
    brief !== undefined &&
    keepsWarm({ risks: brief.risks, hasBought: paysNow(facts.standingFacts, facts.standingLimits) });
  const hisAt = hisMessagesAt(facts.history);
  const boughtAt = scripts?.latest?.steps.findLast((step) => step.outcome === 'bought')?.at;
  const hisMessagesSinceBought =
    boughtAt === undefined ? undefined : hisAt.filter((sent) => sent >= boughtAt).length;
  return { storedRun, storedPeakSeen, heCame, tease, warm, hisMessagesAt: hisAt, hisMessagesSinceBought };
}

/** The sexting at this message, once her scripts decided: how frank she may be, and what she does in the action. */
export interface SextingMoment {
  /** He came and bought nothing of the evening's run: no step, a little vexed (ADR 0156 § 6, guide 26/11). */
  readonly heCameUnpaid: boolean;
  readonly inTension: boolean;
  readonly opensItHerself: boolean;
  /** How frank her words may be: suggestive until the action is engaged, then her own crude words (Charles 21/11). */
  readonly register: Register | null;
  /** The script running with him this evening, its run open. */
  readonly running: ScriptRun | null;
  /** His fantasies she plays on with the script running, and those no script of hers meets. */
  readonly playOn: readonly string[];
  readonly noScript: readonly string[];
  readonly holdsBack: boolean;
  readonly gauge: boolean;
  /** The last step he can see while her script runs, offered or bought: what the sexting feeds on. */
  readonly currentStepSheet: string | undefined;
  readonly sexualTurn: boolean;
  readonly projection: boolean;
  readonly inAction: boolean;
  readonly justBought: boolean;
  readonly compliment: boolean;
  readonly suggestsCustom: boolean;
  /**
   * In the middle of her script, once he bought a paid step of it, he wants what the script does not send (a fantasy
   * no script serves, a cam, a video made for him, further): she may steer him to something made for him, her script
   * still running (Charles 27/11).
   */
  readonly customMidScript: boolean;
  readonly cameEarly: boolean;
  readonly inPlay: boolean;
  readonly haggling: boolean;
  readonly murmur: boolean;
  readonly otherManWanted: boolean;
  readonly degradedByHim: boolean;
  /** The media sheet of the last step he bought: what his disappointment is compared with. */
  readonly boughtMediaSheet: string | undefined;
}

export function sextingMomentOf(facts: {
  readonly brief: TurnReading | undefined;
  readonly fanText: string;
  readonly history: readonly HistoryTurn[];
  readonly situation: Situation;
  readonly scriptsIn: ScriptsInput | undefined;
  readonly scripts: ScriptTurn | undefined;
  readonly run: RunFacts;
  readonly heat: number;
  readonly care: boolean;
  readonly trapped: boolean;
  readonly ageConfirmed: boolean;
  readonly noExplicit: boolean;
  readonly sexualization: SexualizationDecision | undefined;
  readonly boughtOut: boolean;
  readonly hasScriptStep: boolean;
  readonly customOrder: boolean;
  /** Something made for him may be suggested to him now (`maySuggestCustom`): never to a fan nobody may sell to. */
  readonly customAllowed: boolean;
  readonly desireMap: DesireMap;
  readonly uncovered: readonly string[];
  readonly degradingWords: readonly string[];
}): SextingMoment {
  const { brief, scripts, scriptsIn, care, run } = facts;
  const { heCame, storedRun } = run;
  const { ageConfirmed, noExplicit } = facts;
  const eveningRun =
    (scripts?.opened ?? scripts?.moved ?? scripts?.followed)?.run ?? scriptsIn?.latest ?? null;
  const heCameUnpaid =
    heCame &&
    eveningRun !== null &&
    !eveningRun.steps.some((step) => step.kind === 'paid' && step.outcome === 'bought');
  const inTension = scripts?.decision.kind === 'none' && scripts.decision.reason === 'in_tension';
  const opensItHerself =
    brief !== undefined &&
    facts.sexualization?.kind === 'free' &&
    !offerSignals(brief, facts.fanText).fanSexualizes;
  const seenOfEvening = seenRun(eveningRun, facts.situation.now);
  const register: Register | null =
    brief === undefined || care || !HEATED_INTENTS.includes(brief.intent)
      ? null
      : run.warm && ageConfirmed && !noExplicit
        ? 'explicit'
        : registerOf({
            // What he has seen: a step going with this very answer is not seen yet.
            run: seenOfEvening,
            seenIntensities: intensitiesSeen(seenOfEvening, scriptsIn?.catalogue ?? []),
            hot: desireBandOf(facts.heat) === 'hot',
            afterFinale: facts.boughtOut || (heCame && eveningRun?.status === 'bought_out'),
            heIsCrude: brief.desireSignals?.includes('explicit_language') === true,
            ageConfirmed,
            noExplicit,
            boughtBefore: facts.situation.spentCents > 0,
          });
  // His fantasy (Charles 26/11), only once his adult age is confirmed and unless he asked for nothing explicit, never in
  // care: the one the script running with him meets, to play on; on a heated turn, those no script meets, never promised.
  const fantasyAllowed = ageConfirmed && !noExplicit && !care && !facts.trapped;
  const running = eveningRun?.status === 'open' ? eveningRun : null;
  const runningScript: PlatformScriptView | undefined =
    running === null ? undefined : scriptsIn?.catalogue.find((one) => one.scriptRef === running.scriptRef);
  const playOn =
    !fantasyAllowed || heCame || runningScript === undefined
      ? []
      : (fantasyMatchOf(runningScript, facts.desireMap)?.matches ?? []);
  const noScript = fantasyAllowed && register !== null ? facts.uncovered : [];
  // He is about to come while her script runs: she asks him to hold back, and the run goes on (Charles 26/11).
  const holdsBack =
    !care &&
    !heCame &&
    running !== null &&
    holdsBackNow(brief?.desireSignals, peakSeen(running, runningScript));
  // Every few of her messages while her script runs, she checks where he is (Charles 26/11); not when she brings a step
  // or holds him back.
  const herMessagesInRun = running === null ? 0 : herAnswersSince(facts.history, running.startedAt);
  const gauge =
    fantasyAllowed &&
    running !== null &&
    !holdsBack &&
    !heCame &&
    !facts.hasScriptStep &&
    gaugeDue(herMessagesInRun);
  // Between two steps, the sexting feeds on what he has in front of him (Charles 26/11 at 22:47): the last step he can
  // see, offered or bought, never a paid step still locked.
  const currentStepSheet =
    running === null || facts.hasScriptStep || !fantasyAllowed
      ? undefined
      : visibleStepSheet(running, runningScript);
  const sexualTurn = register !== null || running !== null;
  // On a step he sees, every few of her messages: back to the media in front of him, and he projects himself (0:03).
  const projection =
    currentStepSheet !== undefined && !holdsBack && !heCame && projectionDue(herMessagesInRun);
  // In the middle of the action: her script runs and her words are frank; longer bubbles pass (Charles 23:09).
  const inAction = running !== null && (register === 'explicit' || register === 'very_explicit');
  // The first message of his after he bought her step: she asks whether he liked it, unless the tension already does.
  const justBought = running !== null && !inTension && run.hisMessagesSinceBought === 1 && !holdsBack;
  // A compliment is no advance (Charles 23:09): she draws him out without opening the sexting for him.
  const compliment =
    brief !== undefined &&
    brief.desireSignals?.includes('body_compliment') === true &&
    !offerSignals(brief, facts.fanText).fanSexualizes &&
    running === null &&
    !care;
  // He asks himself for a media of a fantasy no script serves: the custom path, where no step and no custom answer lead.
  const suggestsCustom =
    fantasyAllowed &&
    brief?.intent === 'asks_for_media' &&
    facts.uncovered.some((item) => mentions(item, facts.fanText)) &&
    !facts.hasScriptStep &&
    !facts.customOrder &&
    // No money now: nothing made for him is suggested either.
    !saysNoMoneyNow({ risks: brief.risks });
  // In the middle of her script, after he bought a paid step of it (Charles 27/11): he wants what it does not send, and
  // she may steer him to something made for him. Before any purchase in the run, nothing changes; his own asking for a
  // service is the custom order's (`customOrder`).
  const boughtInRun =
    running?.steps.some((step) => step.kind === 'paid' && step.outcome === 'bought') === true;
  const customMidScript =
    fantasyAllowed &&
    boughtInRun &&
    brief !== undefined &&
    (HEATED_INTENTS.includes(brief.intent) || brief.intent === 'asks_for_media') &&
    // A fantasy the running script meets is no wish beyond it, even when no other script of hers is left to rank.
    (facts.uncovered.some((item) => !playOn.includes(item) && mentions(item, facts.fanText)) ||
      wantsMadeForHim(facts.fanText)) &&
    !facts.customOrder &&
    facts.customAllowed;
  // The creator's calibration of the sexting (Charles 26/11), each an intention for the voice.
  const cameEarly = heCame && cameBeforeFinale(storedRun);
  const inPlay = running !== null && !care;
  const haggling = inPlay && brief !== undefined && haggles(brief.intent, facts.fanText);
  const murmur = inPlay && isBareMurmur(facts.fanText);
  const otherManWanted = wantsOtherMan(facts.desireMap);
  const degradedByHim =
    brief !== undefined && !care && facts.degradingWords.some((term) => touchesTerm(facts.fanText, term));
  // His disappointment with what he bought: the media's description beside it, and his insisting for more.
  const boughtStep = storedRun?.steps.findLast((step) => step.outcome === 'bought');
  const boughtMediaSheet =
    boughtStep === undefined
      ? undefined
      : scriptsIn?.catalogue.find((one) => one.scriptRef === storedRun?.scriptRef)?.steps[
          boughtStep.stepIndex
        ]?.mediaSheet;
  return {
    heCameUnpaid,
    inTension,
    opensItHerself,
    register,
    running,
    playOn,
    noScript,
    holdsBack,
    gauge,
    currentStepSheet,
    sexualTurn,
    projection,
    inAction,
    justBought,
    compliment,
    suggestsCustom,
    customMidScript,
    cameEarly,
    inPlay,
    haggling,
    murmur,
    otherManWanted,
    degradedByHim,
    boughtMediaSheet,
  };
}
