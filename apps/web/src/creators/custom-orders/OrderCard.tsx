import { type CreatorId, type CustomOrderView } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { euros, eurosOfMinor, minorOfEuros } from '../custom-prices/model';

import {
  advanceCustomOrder,
  CUSTOM_ORDERS_ERRORS,
  customOrdersErrorKind,
  customOrdersQueryKey,
  decideCustomOrder,
} from './api';
import {
  actionsOf,
  camLine,
  detailLines,
  headlineOf,
  priceLine,
  proposedMinor,
  quoteLine,
  stateLabelOf,
  STATE_TONES,
  stepsOf,
  type OrderTone,
} from './model';

import { dayOf } from '@/scheduling/time';
import { Steps } from '@/shell/figures/figures';

import '../custom-prices/custom-prices.css';
import './custom-orders.css';

/** The colour of each tone, as the meter and the state's pill draw it. Red stays for urgencies. */
export const TONE_COLOURS: Readonly<Record<OrderTone, string>> = {
  warn: 'var(--nv-warning)',
  info: 'var(--nv-series-2)',
  ok: 'var(--nv-success)',
  muted: 'var(--nv-ink-faint)',
};

/**
 * One custom order (ADR 0159 § A): who, where it stands and its steps up to delivery, what he asked, what her grid
 * proposes. The owner answers for her here (« Elle accepte à … € », « Elle refuse ») and moves each step; a manager
 * who follows her reads the same card without a button.
 */
export function OrderCard({
  creatorId,
  order,
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  canAnswer,
  supplementName = () => null,
}: {
  creatorId: CreatorId;
  order: CustomOrderView;
  /** Her zone: a cam's hour is said in her time; the reader's own when unknown (« À traiter »). */
  zone?: string;
  canAnswer: boolean;
  /** A supplement's name from her grid, when the reader may read it; null says « 1 supplément ». */
  supplementName?: (id: string) => string | null;
}): JSX.Element {
  const tone = STATE_TONES[order.state];
  const titleId = useId();
  const steps = stepsOf(order);
  const done = steps.filter((step) => step.done).length;
  const price = priceLine(order);
  const cam = camLine(order, zone, dayOf(new Date(), zone));
  const details = detailLines(order);
  const named = order.supplements.map(supplementName);
  const unnamed = named.filter((name) => name === null).length;
  const supplements = [
    ...named.filter((name): name is string => name !== null),
    ...(unnamed === 0 ? [] : [unnamed === 1 ? '1 supplément' : `${String(unnamed)} suppléments`]),
  ];

  return (
    <article
      className="nv-plate cso-card nv-enter"
      data-tone={tone}
      style={{ '--cso-c': TONE_COLOURS[tone] }}
      aria-labelledby={titleId}
    >
      <header className="cso-card__head">
        <h3 className="nv-h3 cso-card__fan" id={titleId}>
          {order.fanName}
        </h3>
        <span className="nv-tag nv-tag--tint cso-state" style={{ '--_c': TONE_COLOURS[tone] }}>
          {stateLabelOf(order)}
        </span>
      </header>
      <p className="cso-card__what">{headlineOf(order)}</p>
      {cam === null ? null : (
        // When his cam happens, in her time: the slot booked with his payment (ADR 0159 § 5).
        <p className="cso-cam" data-booked={cam.booked ? 'true' : undefined}>
          <span aria-hidden="true">📹</span>
          <span className={cam.booked ? 'nv-num' : undefined}>{cam.text}</span>
        </p>
      )}

      <Steps
        steps={steps}
        reached={done - 1}
        label={`Étapes de la commande : ${String(done)} sur ${String(steps.length)}`}
        colour={TONE_COLOURS[tone]}
      />

      {supplements.length === 0 && details.length === 0 ? null : (
        <dl className="cso-details">
          {supplements.length === 0 ? null : (
            <div className="cso-detail">
              <dt>Suppléments</dt>
              <dd>{supplements.join(' · ')}</dd>
            </div>
          )}
          {details.map((line) => (
            <div key={line.label} className="cso-detail">
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {price === null ? (
        <p className="cso-quote">{quoteLine(order)}</p>
      ) : (
        <p className="cso-price nv-num">{price}</p>
      )}

      {canAnswer ? <Actions creatorId={creatorId} order={order} /> : null}
    </article>
  );
}

/** The owner's buttons: her answer with its price, then each step. One gesture at a time, its error said below. */
function Actions({ creatorId, order }: { creatorId: CreatorId; order: CustomOrderView }): JSX.Element | null {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const proposed = proposedMinor(order);
  const [text, setText] = useState(proposed === null ? '' : eurosOfMinor(proposed));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const actions = actionsOf(order);
  if (actions.length === 0) return null;

  const run = async (gesture: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await gesture();
    } catch (error) {
      setProblem(CUSTOM_ORDERS_ERRORS[customOrdersErrorKind(error)]);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: customOrdersQueryKey(creatorId) });
    }
  };

  const price = minorOfEuros(text);
  const priceOk = typeof price === 'number' && price >= 100;

  return (
    <div className="cso-actions">
      {actions.map((action) =>
        action.kind === 'decide' ? (
          <div key="decide" className="cso-decide">
            <label className="cso-decide__label" htmlFor={fieldId}>
              Son prix
            </label>
            <div className="smp-unit cso-decide__box">
              <div className="smp-unit__box">
                <input
                  id={fieldId}
                  className="nv-glass nv-field__control ps-input smp-unit__input"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="—"
                  value={text}
                  disabled={busy}
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
                <span className="smp-unit__sign" aria-hidden="true">
                  €
                </span>
              </div>
            </div>
            <button
              type="button"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={busy || !priceOk}
              onClick={() => {
                if (typeof price === 'number')
                  void run(() =>
                    decideCustomOrder(creatorId, order.id, { decision: 'yes', priceMinor: price }),
                  );
              }}
            >
              {priceOk ? `Elle accepte à ${euros(price)}` : 'Elle accepte'}
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              disabled={busy}
              onClick={() => {
                void run(() => decideCustomOrder(creatorId, order.id, { decision: 'no' }));
              }}
            >
              Elle refuse
            </button>
          </div>
        ) : (
          <button
            key={action.to}
            type="button"
            className={`nv-btn nv-btn--sm ${action.to === 'cancelled' ? 'nv-btn--plain' : 'nv-btn--soft'}`}
            disabled={busy}
            onClick={() => {
              void run(() => advanceCustomOrder(creatorId, order.id, { to: action.to }));
            }}
          >
            {action.label}
          </button>
        ),
      )}
      {problem === null ? null : (
        <p className="ps-error cso-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
