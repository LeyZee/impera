import type { ConversationDesire } from '@impera/contracts';
import type { JSX } from 'react';

import { DesireSheet } from './Desire';
import { FanLimits, useFanFlags } from './FanLimits';
import { FanToLearn, useFanKyc } from './FanToLearn';
import { FragileProposal, useFragileTodo } from './FragileProposal';
import { FanFlagsRefused } from './api';
import { FanCard } from './card/FanCard';
import { useFanCard } from './card/api';
import { toCheckCount } from './card/model';
import { alertsOf, sheetSummary, type SheetFacts } from './flags-model';
import { DESIRE_BAND_EMOJIS } from './view';

import { DESIRE_BAND_LABELS } from '@/agent/desire';

/**
 * The fan's sheet in the reader. What a person must know before writing to him stands above it, unfolded: what forbids
 * in red, what changes how one writes in amber (CHAT-23). The rest (his limits in detail, what is left to learn, his
 * desire) is folded to one quiet band so the thread comes first. Limits that could not be read are said, never hidden
 * behind « Rien à signaler » (CHAT-03).
 */
export function FanSheet({
  creatorId,
  fanId,
  conversationId,
  desire,
  canDecide,
  canSetLimits = canDecide,
  layout = 'band',
}: {
  creatorId: string;
  fanId: string;
  conversationId: string;
  desire: ConversationDesire | null;
  /** A creator reads his limits, never what is known of him (ADR 0023). */
  canDecide: boolean;
  /** A chatter reads his limits without changing them (ADR 0025, the server refuses it). */
  canSetLimits?: boolean;
  /**
   * `band`: one folded band above the thread. `aside`: its own column beside the conversation on a wide screen, always
   * in view (Charles, 08/11): what forbids, what he is like at a glance, then the rest folded.
   */
  layout?: 'band' | 'aside';
}): JSX.Element {
  const flags = useFanFlags(creatorId, fanId);
  const kyc = useFanKyc(creatorId, fanId, canDecide);
  const card = useFanCard(creatorId, fanId, canDecide);
  // The AI's proposal to mark him « fragile » (ADR 0085 § 9, lot b2): never to a creator, who sees nothing of him.
  const fragile = useFragileTodo(creatorId, fanId);
  const proposal = canDecide ? fragile : undefined;
  const facts: SheetFacts = {
    flags:
      flags.data?.flags ??
      (flags.error instanceof FanFlagsRefused ? 'refused' : flags.isError ? 'down' : 'loading'),
    toLearn: canDecide ? (kyc.data?.length ?? null) : null,
    ...(canDecide && card.data !== undefined ? { toCheck: toCheckCount(card.data.fields) } : {}),
    band:
      desire === null
        ? null
        : desire.band === 'neutral'
          ? DESIRE_BAND_LABELS[desire.band]
          : `${DESIRE_BAND_LABELS[desire.band]} ${DESIRE_BAND_EMOJIS[desire.band]}`,
  };
  const read = sheetSummary(facts);
  // The proposal stands right above the summary in both layouts, so the summary never repeats it, nor says
  // « Rien à signaler » under it.
  const summary = proposal !== undefined && read.rest === 'Rien à signaler' ? { ...read, rest: '' } : read;
  const alerts = flags.data === undefined ? [] : alertsOf(flags.data.flags);
  const alertList =
    alerts.length === 0 && facts.flags !== 'refused' && proposal === undefined ? null : (
      <ul className="tr-alerts" aria-label="Avant de lui écrire">
        {facts.flags === 'refused' ? (
          <li className="tr-alert tr-alert--care">
            <strong>Limites non lisibles</strong>
            <span>Demande à ton responsable avant de lui écrire dans Reveal.</span>
          </li>
        ) : null}
        {alerts.map((alert) => (
          <li key={alert.label} className={`tr-alert tr-alert--${alert.level}`}>
            <strong>{alert.label}</strong>
            <span>{alert.text}</span>
          </li>
        ))}
        {proposal === undefined ? null : (
          <FragileProposal creatorId={creatorId} fanId={fanId} todo={proposal} canDecide={canSetLimits} />
        )}
      </ul>
    );
  const line = (
    <>
      {summary.urgent === null ? null : <span className="tr-warn">{summary.urgent}</span>}
      {summary.urgent !== null && summary.rest !== '' ? ' · ' : null}
      {summary.rest}
    </>
  );
  if (layout === 'aside')
    return (
      <>
        <header className="tr-aside__head">
          <h3 className="tr-aside__title">Le fan</h3>
          <span className="tr-aside__sum">{line}</span>
        </header>
        {alertList}
        {/* Only what is below the alerts scrolls: his name, the summary and what forbids stay in view. */}
        <div className="tr-aside__body">
          {canDecide ? <FanCard creatorId={creatorId} fanId={fanId} /> : null}
          <div className="tr-aside__more">
            <FanLimits creatorId={creatorId} fanId={fanId} canDecide={canSetLimits} />
            {canDecide ? <FanToLearn creatorId={creatorId} fanId={fanId} /> : null}
            <DesireSheet creatorId={creatorId} conversationId={conversationId} desire={desire} />
          </div>
        </div>
      </>
    );
  return (
    <>
      {alertList}
      <details className="nv-disclosure tr-sheet">
        <summary>
          <span className="tr-limits__title">Fiche du fan</span>
          <span className="tr-sheet__sum">{line}</span>
        </summary>
        <div className="tr-sheet__body">
          <FanLimits creatorId={creatorId} fanId={fanId} canDecide={canSetLimits} />
          {canDecide ? <FanToLearn creatorId={creatorId} fanId={fanId} /> : null}
          {canDecide ? <FanCard creatorId={creatorId} fanId={fanId} /> : null}
          <DesireSheet creatorId={creatorId} conversationId={conversationId} desire={desire} />
        </div>
      </details>
    </>
  );
}
