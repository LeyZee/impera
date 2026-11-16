import type { ProviderStatus } from '@impera/contracts';
import type { JSX } from 'react';

import type { DashboardProvider } from './guide';
import {
  agoText,
  FREE_PLAN_NOTE,
  healthStats,
  PROBE_CHIP,
  PROBE_COST,
  PROBE_HINT,
  probeDetail,
  quotaShare,
  quotaText,
  quotaTone,
  TROUBLE_TEXT,
  troubleTone,
  inUseTone,
  troubleToShow,
} from './view';

/**
 * The health of a connected service (ADR 0091 § 7): what its last « Essai réel » found, what the agent's own calls of the
 * last 24 hours say, and ElevenLabs' month. Everything is the server's; the only call this block makes is the essai, on
 * a click, and its button says what it costs.
 */
export function ServiceHealth({
  provider,
  status,
  now,
  isProbing,
  onProbe,
}: {
  provider: DashboardProvider;
  status: ProviderStatus;
  now: Date;
  isProbing: boolean;
  onProbe: (() => void) | null;
}): JSX.Element {
  const { probe, activity, quota } = status;
  const chip = probe === null ? null : PROBE_CHIP[probe.outcome];
  const hint = probe === null ? null : PROBE_HINT[probe.outcome];
  const quotaLine = quota === null ? null : quotaText(quota);
  const trouble = troubleToShow(status);
  return (
    <div className="sv-health">
      {activity === null ? null : (
        <dl className="sv-stats">
          {healthStats(provider, activity, now).map((stat, i) => (
            <div
              key={stat.label}
              className="sv-stat"
              data-tone={stat.tone ?? undefined}
              style={{ '--nv-i': i }}
            >
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {trouble === null ? null : (
        <p className="sv-trouble" data-tone={inUseTone(status, troubleTone(trouble.kind))}>
          <TroubleIcon />
          <span>
            Dernière erreur {agoText(trouble.at, now)} : {TROUBLE_TEXT[trouble.kind]}.
          </span>
        </p>
      )}

      {quota === null || quotaLine === null ? null : (
        <div className="sv-quota" data-tone={quotaTone(quota)}>
          <div className="sv-quota__head">
            <span>{quotaLine.used}</span>
            {quotaLine.resets === null ? null : <span className="sv-quota__reset">{quotaLine.resets}</span>}
          </div>
          <div
            className="sv-quota__track"
            role="meter"
            aria-label="Caractères ElevenLabs utilisés ce mois"
            aria-valuemin={0}
            aria-valuemax={quota.limit}
            aria-valuenow={quota.used}
            aria-valuetext={quotaLine.used}
          >
            <span className="sv-quota__fill" style={{ '--_w': `${String(quotaShare(quota))}%` }} />
          </div>
          {quota.plan === 'free' ? <p className="sv-quota__plan">{FREE_PLAN_NOTE}</p> : null}
        </div>
      )}

      {onProbe === null ? null : (
        <div className="sv-probe">
          <button
            type="button"
            className="sv-probe__btn"
            data-busy={isProbing || undefined}
            disabled={isProbing}
            onClick={onProbe}
          >
            <ProbeIcon />
            {isProbing ? 'Essai en cours…' : 'Essai réel'}
          </button>
          {isProbing || probe === null || chip === null ? (
            <span className="sv-probe__cost">{PROBE_COST[provider]}</span>
          ) : (
            <span className="sv-probe__result" key={`result-${probe.at}`}>
              <span className="sv-chip" data-tone={inUseTone(status, chip.tone)}>
                <span className="sv-chip__dot" aria-hidden="true" />
                {chip.text}
              </span>
              <span className="sv-probe__when">{probeDetail(probe, now)}</span>
            </span>
          )}
          {isProbing || hint === null ? null : (
            <p className="sv-probe__hint" key={`hint-${probe?.at ?? ''}`}>
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A bolt in a ring: the spark of a real call. The ring turns while it runs. */
function ProbeIcon(): JSX.Element {
  return (
    <svg className="sv-probe__icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle className="sv-probe__ring" cx="10" cy="10" r="8.25" pathLength="1" />
      <path className="sv-probe__bolt" d="M11 3.8 6.3 11h3.4L9 16.2 13.7 9h-3.4z" />
    </svg>
  );
}

function TroubleIcon(): JSX.Element {
  return (
    <svg className="sv-trouble__icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.8 15 14H1z" />
      <path className="sv-trouble__mark" d="M8 6v3.6M8 11.6v.1" />
    </svg>
  );
}
