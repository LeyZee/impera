import type { Currency, MyShift, ReviewCard, ReviewExcerptLine, FaultTone } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { contestRemark, markReviewSeen, REVIEW_KEY, useMyShiftReview } from './api';
import './review.css';

import { amountText } from '@/reports/model';
import { Panel, PanelSection } from '@/shell/layout';

/** What a level says on a card (ADR 0170 § 30): grey, amber, red. */
const TONE: Record<FaultTone, { readonly label: string; readonly colour: string }> = {
  advice: { label: 'Conseil', colour: 'var(--nv-ink-muted)' },
  explain: { label: 'À revoir', colour: 'var(--nv-ink-muted)' },
  firm: { label: 'Rappel ferme', colour: 'var(--nv-warning)' },
  grave: { label: 'Faute grave', colour: 'var(--nv-danger)' },
};

const REPEAT: Record<FaultTone, (counted: number) => string> = {
  advice: () => 'Un conseil, jamais compté',
  explain: () => '1re fois : on t’explique',
  firm: (n) => (n < 2 ? 'Déjà expliquée' : `${String(n)}e fois en deux semaines`),
  grave: () => 'Ferme dès la première fois',
};

const timeOf = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(':', ' h ');

/** The sentence at the top (ADR 0170 § 12): what matters first, no compliment forced. */
export function verdict(faults: readonly ReviewCard[], missed: string | null): string {
  if (faults.length === 0) return 'Rien à reprendre sur ce shift.';
  const grave = faults.some((f) => f.tone === 'grave');
  const parts = [
    missed === null ? null : `environ ${missed} laissés sur la table`,
    grave
      ? 'une faute grave à ne pas refaire'
      : `${String(faults.length)} point${faults.length < 2 ? '' : 's'} à travailler`,
  ].filter((p): p is string => p !== null);
  const sentence = parts.join(', et ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function Excerpt({
  lines,
  zone,
  us,
}: {
  lines: readonly ReviewExcerptLine[];
  zone: string;
  us: string;
}): JSX.Element {
  return (
    <div className="nv-thread rv-thread" aria-label="Extrait redessiné">
      {lines.map((line) => (
        <div key={line.messageId} className="rv-said" data-from={line.from}>
          <small>
            {line.from === 'fan' ? 'Fan ••••' : us} · {timeOf(line.at, zone)}
          </small>
          <div className={`nv-bubble nv-bubble--${line.from === 'fan' ? 'fan' : 'creator'}`}>{line.text}</div>
        </div>
      ))}
    </div>
  );
}

function Contest({ card, creatorId }: { card: ReviewCard; creatorId: MyShift['creatorId'] }): JSX.Element {
  const id = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [failed, setFailed] = useState(false);
  if (card.contest !== null) {
    return (
      <div className="nv-note nv-note--warn">
        <p className="nv-note__title">
          {card.contest.ruling === null
            ? 'Contesté, en attente de ton manager'
            : card.contest.ruling === 'dropped'
              ? 'Contesté : le point est tombé'
              : 'Contesté : le point tient'}
        </p>
        <span>« {card.contest.reason} »</span>
      </div>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Je conteste
      </button>
    );
  }
  return (
    <form
      className="nv-field rv-contest nv-enter"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() === '') return;
        void contestRemark(card.remarkId, { creatorId, reason: reason.trim() })
          .then(() => queryClient.invalidateQueries({ queryKey: REVIEW_KEY }))
          .catch(() => {
            setFailed(true);
          });
      }}
    >
      <label className="nv-field__label" htmlFor={`${id}-reason`}>
        Pourquoi, en une ligne
      </label>
      <input
        id={`${id}-reason`}
        className="nv-field__control nv-glass"
        maxLength={300}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {failed ? <p className="rv-faint">Pas envoyé : réessaie dans un instant.</p> : null}
      <div className="rv-row rv-row--end">
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          onClick={() => {
            setOpen(false);
            setReason('');
            setFailed(false);
          }}
        >
          Annuler
        </button>
        <button type="submit" className="nv-btn nv-btn--neon nv-btn--sm" disabled={reason.trim() === ''}>
          Envoyer
        </button>
      </div>
    </form>
  );
}

function Fault({
  card,
  zone,
  creatorId,
  creatorName,
}: {
  card: ReviewCard;
  zone: string;
  creatorId: MyShift['creatorId'];
  creatorName: string;
}): JSX.Element {
  const tone = card.tone ?? 'advice';
  const level = TONE[tone];
  return (
    <article
      className="nv-tile rv-tile rv-fault nv-enter"
      data-tone={tone}
      style={{ '--rv-tone': level.colour }}
    >
      <div className="rv-top">
        <div className="rv-head">
          <div className="rv-row">
            <span className="nv-tag nv-tag--tint" style={{ '--_c': level.colour }}>
              {level.label}
            </span>
            <span className="rv-faint">{REPEAT[tone](card.counted)}</span>
          </div>
          <h4 className="rv-title">{card.label ?? 'Un point à revoir'}</h4>
        </div>
        <div className="rv-cost" data-tone={tone}>
          {card.missed === null ? (
            <>
              <b>Sa confiance</b>
              <span>Pas chiffrable en euros.</span>
            </>
          ) : (
            <>
              <b className="nv-num">≈ {amountText(card.missed.minor, card.missed.currency)}</b>
              <span>
                {card.missed.source === 'script_step'
                  ? 'L’étape suivante du script.'
                  : 'L’offre qu’il a laissée.'}
              </span>
            </>
          )}
        </div>
      </div>
      <p className="rv-faint">{timeOf(card.occurredAt, zone)} · ce que tu as écrit</p>
      <Excerpt lines={card.excerpt} zone={zone} us="Toi" />
      <div className="rv-why">
        <p className="rv-why__label">Ce qu’il a ressenti</p>
        <p>{card.fanFeeling}</p>
      </div>
      {card.alternative.length === 0 ? null : (
        <div className="rv-better">
          <p className="rv-better__label">Comment tu aurais pu la mener</p>
          <div className="nv-thread rv-thread">
            {card.alternative.map((text, index) => (
              <div key={`${String(index)}-${text}`} className="rv-said" data-from="chatter">
                <small>{creatorName}</small>
                <div className="nv-bubble nv-bubble--creator">{text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rv-row rv-foot">
        <Contest card={card} creatorId={creatorId} />
      </div>
    </article>
  );
}

const totalText = (totals: readonly { minor: number; currency: Currency }[]): string | null =>
  totals.length === 0 ? null : totals.map((t) => amountText(t.minor, t.currency)).join(' + ');

/**
 * « Mon bilan » in Aujourd'hui (ADR 0170 §§ 12, 26 to 31): the review of his last ended shift. The verdict first, the
 * missed total, at most three fault cards, the gravest first, then what he did well. Nothing at all when the shift
 * has no remark: the card never stands empty. Opening it records that each fault shown was explained.
 */
export function MyReviewCard({ shift, zone }: { shift: MyShift | null; zone: string }): JSX.Element | null {
  const review = useMyShiftReview(shift);
  const seen = useRef<string | null>(null);
  const data = review.data;
  const shown = data !== undefined && (data.faults.length > 0 || data.wellDone.length > 0);
  useEffect(() => {
    if (!shown || shift === null || seen.current === shift.id) return;
    seen.current = shift.id;
    void markReviewSeen(shift.creatorId, shift.id).catch(() => {
      seen.current = null;
    });
  }, [shown, shift]);
  if (shift === null || data === undefined || !shown) return null;
  const missed = totalText(data.missedTotals);
  const earned = totalText(data.wellDone.flatMap((w) => (w.earned === null ? [] : [w.earned])));
  return (
    <Panel
      className="rv-card nv-enter"
      eyebrow={`Mon bilan · ${shift.creatorName}`}
      title={verdict(data.faults, missed)}
    >
      <PanelSection>
        <div className="nv-tiles rv-totals">
          <div className="nv-tile rv-total" data-tone="miss">
            <span className="nv-tile__label">Manqué, à peu près</span>
            <b className="nv-tile__value">{missed === null ? '0 €' : `≈ ${missed}`}</b>
          </div>
          <div className="nv-tile rv-total" data-tone="win">
            <span className="nv-tile__label">Rapporté, bien fait</span>
            <b className="nv-tile__value">{earned ?? '0 €'}</b>
          </div>
        </div>
        <p className="rv-faint">Le manqué est compté au prix de l’étape suivante du script, pas au hasard.</p>
      </PanelSection>
      {data.faults.length === 0 ? null : (
        <PanelSection label="À travailler" className="rv-section">
          {data.faults.map((card) => (
            <Fault
              key={card.remarkId}
              card={card}
              zone={zone}
              creatorId={shift.creatorId}
              creatorName={shift.creatorName}
            />
          ))}
        </PanelSection>
      )}
      {data.wellDone.length === 0 ? null : (
        <PanelSection label="Bien fait" className="rv-section">
          {data.wellDone.map((card) => (
            <article key={card.remarkId} className="nv-tile rv-tile nv-enter">
              <div className="rv-top">
                <p className="rv-text">{card.fanFeeling}</p>
                {card.earned === null ? null : (
                  <div className="rv-cost" data-tone="win">
                    <b className="nv-num">+ {amountText(card.earned.minor, card.earned.currency)}</b>
                  </div>
                )}
              </div>
              <Excerpt lines={card.excerpt} zone={zone} us="Toi" />
            </article>
          ))}
        </PanelSection>
      )}
      <PanelSection>
        <p className="rv-faint">
          Tes conversations avec les fans sont relues pour t’aider. Rien d’autre : ni le temps d’inactivité,
          ni les clics. Tu peux contester chaque point.
        </p>
      </PanelSection>
    </Panel>
  );
}
