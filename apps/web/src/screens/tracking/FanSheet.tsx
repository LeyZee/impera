import type { ConversationDesire } from '@nirvana/contracts';
import type { JSX } from 'react';

import { DesireSheet } from './Desire';
import { FanLimits, useFanFlags } from './FanLimits';
import { FanToLearn, useFanKyc } from './FanToLearn';
import { FanFlagsRefused } from './api';
import { sheetSummary, type SheetFacts } from './flags-model';

import { DESIRE_BAND_LABELS } from '@/agent/desire';

/**
 * The fan's sheet in the reader: his limits, what is left to learn and his desire, folded to one band so the thread
 * comes first. Its line says what is inside: a disputed age or a limit that stops the agent in amber, then the rest.
 */
export function FanSheet({
  creatorId,
  fanId,
  conversationId,
  desire,
  canDecide,
}: {
  creatorId: string;
  fanId: string;
  conversationId: string;
  desire: ConversationDesire | null;
  /** A creator reads his limits, never what is known of him (ADR 0023). */
  canDecide: boolean;
}): JSX.Element {
  const flags = useFanFlags(creatorId, fanId);
  const kyc = useFanKyc(creatorId, fanId, canDecide);
  const facts: SheetFacts = {
    flags:
      flags.data?.flags ??
      (flags.error instanceof FanFlagsRefused ? 'refused' : flags.isError ? 'down' : 'loading'),
    toLearn: canDecide ? (kyc.data?.length ?? null) : null,
    band: desire === null ? null : DESIRE_BAND_LABELS[desire.band],
  };
  const summary = sheetSummary(facts);
  return (
    <details className="nv-disclosure tr-sheet">
      <summary>
        <span className="tr-limits__title">Fiche du fan</span>
        <span className="tr-sheet__sum">
          {summary.urgent === null ? null : <span className="tr-warn">{summary.urgent}</span>}
          {summary.urgent !== null && summary.rest !== '' ? ' · ' : null}
          {summary.rest}
        </span>
      </summary>
      <div className="tr-sheet__body">
        <FanLimits creatorId={creatorId} fanId={fanId} canDecide={canDecide} />
        {canDecide ? <FanToLearn creatorId={creatorId} fanId={fanId} /> : null}
        <DesireSheet creatorId={creatorId} conversationId={conversationId} desire={desire} />
      </div>
    </details>
  );
}
