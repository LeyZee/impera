import {
  CreatorAgencyRateIdSchema,
  newId,
  type CreatorAgencyRateList,
  type CreatorId,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { Field } from '../persona/fields';

import {
  addAgencyRate,
  RATE_ERRORS,
  rateErrorKind,
  ratesQueryKey,
  useAgencyRates,
  type RateErrorKind,
} from './api';
import {
  bpsOfPercent,
  confirmSentence,
  dayLabel,
  earliestDay,
  percentOf,
  readAt,
  shareText,
  sheetHead,
  shareWhere,
  standing,
  windowLabel,
} from './model';
import './rate.css';

import { DayField } from '@/scheduling/DayField';
import { SignInAgain } from '@/settings/services/PasswordPrompt';

/**
 * Créatrices › Pourcentage (CR-04, ADR 0042 § 6), the owner's alone: what the agency takes of her net, from a day on,
 * never backwards. No value is made up: without one, « À régler ». A percentage is never changed once saved, so the
 * owner reads the whole sentence before sending it; a mistake is put right by the next one. On Reveal her part is the
 * figure Reveal gives, and the percentage only flags a gap to the owner (ADR 0054 § 2). The agency's share as Reveal
 * reads it comes first, needing no percentage, which is then optional (ADR 0054 § 4 and § 6).
 */
export function AgencyRateSection({
  creatorId,
  creatorName,
  onDirty = ignore,
}: {
  creatorId: CreatorId;
  creatorName: string;
  /** Told whether a percentage is typed and not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const query = useAgencyRates(creatorId);

  if (query.data === undefined) {
    if (query.isError) {
      const kind = rateErrorKind(query.error);
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Son pourcentage ne se charge pas</p>
            <p className="ps-muted">{RATE_ERRORS[kind]}</p>
            {kind === 'session_expired' ? (
              <SignInAgain />
            ) : kind === 'unavailable' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => void query.refetch()}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="ps-page" aria-busy="true" aria-label="Part de l’agence">
        <div className="nv-plate ps-head ps-skeleton" />
        <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
      </section>
    );
  }
  return (
    <RateSheet
      key={creatorId}
      creatorId={creatorId}
      creatorName={creatorName}
      list={query.data}
      onDirty={onDirty}
    />
  );
}

const ignore = (): void => undefined;

function RateSheet({
  creatorId,
  creatorName,
  list,
  onDirty,
}: {
  creatorId: CreatorId;
  creatorName: string;
  list: CreatorAgencyRateList;
  onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const id = useId();
  const queryClient = useQueryClient();
  const [percent, setPercent] = useState('');
  const [fromDay, setFromDay] = useState('');
  /** The id of the percentage this form sends: kept across a retry, so it is recorded once. */
  const [rateId, setRateId] = useState(() => newId(CreatorAgencyRateIdSchema));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const [problem, setProblem] = useState<RateErrorKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const earliest = earliestDay(list);
  const bps = bpsOfPercent(percent);
  const percentWrong = percent.trim() !== '' && bps === null;
  const [dayUnreadable, setDayUnreadable] = useState(false);
  const dayWrong = dayUnreadable || (fromDay !== '' && fromDay < earliest);
  const ready = bps !== null && fromDay !== '' && !dayWrong;
  const dirty = percent.trim() !== '' || fromDay !== '';
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const edit = (): void => {
    setConfirming(false);
    setProblem(null);
    setNotice(null);
  };

  async function save(): Promise<void> {
    if (bps === null || sending.current) return;
    sending.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await addAgencyRate(creatorId, { id: rateId, fromDay, agencyBps: bps });
      await queryClient.invalidateQueries({ queryKey: ratesQueryKey(creatorId) });
      setNotice(`Enregistré : ${confirmSentence(saved.agencyBps, saved.fromDay)}`);
      setPercent('');
      setFromDay('');
      setConfirming(false);
      // The next percentage typed here is another one: a new id.
      setRateId(newId(CreatorAgencyRateIdSchema));
    } catch (error) {
      setProblem(rateErrorKind(error));
      setConfirming(false);
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  const head = sheetHead(list, creatorName);
  return (
    <section className="ps-page">
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <h2 className="ps-title">Part de l’agence</h2>
          </div>
        </div>
        <div className="ps-head__state" aria-live="polite">
          <span className="ps-dot" data-dot={head.dot} />
          <span className="ps-head__text">
            {head.lead}
            {head.then === null ? null : ` ${head.then}`}
          </span>
        </div>
        <p className="ps-muted">
          Sur Reveal, la part de l’agence est celle que donne Reveal, lue ci-dessous et jamais recalculée. Le
          pourcentage est facultatif : s’il est réglé, un écart avec la part lue t’est signalé.
        </p>
        {notice === null ? null : (
          <p className="ps-muted ar-notice" role="status">
            {notice}
          </p>
        )}
      </div>

      <ObservedPanel list={list} />

      <div className="nv-plate ps-panel">
        <form
          className="ps-block"
          aria-labelledby={`${id}-new`}
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) setConfirming(true);
          }}
        >
          <p className="nv-eyebrow" id={`${id}-new`}>
            {list.rates.length === 0 ? 'Son pourcentage, facultatif' : 'Nouveau pourcentage, facultatif'}
          </p>
          <div className="ar-fields">
            <Field
              label="Pourcentage de l’agence"
              id={`${id}-percent`}
              hint="De 0 à 100, deux décimales au plus."
            >
              <div className="ar-percent">
                <input
                  id={`${id}-percent`}
                  className="nv-glass nv-field__control ps-input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={percent}
                  disabled={saving}
                  aria-invalid={percentWrong}
                  aria-describedby={percentWrong ? `${id}-percent-error` : undefined}
                  onChange={(event) => {
                    setPercent(event.target.value);
                    edit();
                  }}
                />
                <span className="ar-percent__sign" aria-hidden="true">
                  %
                </span>
              </div>
              {percentWrong ? (
                <p className="ps-error" id={`${id}-percent-error`}>
                  Un pourcentage de 0 à 100, comme 35 ou 35,5.
                </p>
              ) : null}
            </Field>
            <Field
              label="À partir du"
              id={`${id}-day`}
              hint={
                list.rates.length === 0
                  ? 'Aujourd’hui au plus tôt, jamais en arrière.'
                  : 'Demain au plus tôt : les ventes déjà faites gardent leur pourcentage.'
              }
            >
              <DayField
                id={`${id}-day`}
                className="ps-input"
                value={fromDay}
                disabled={saving}
                invalid={dayWrong}
                describedBy={dayWrong ? `${id}-day-error` : undefined}
                onChange={(next) => {
                  setFromDay(next);
                  edit();
                }}
                today={earliest}
                onUnreadable={setDayUnreadable}
              />
              {dayWrong ? (
                <p className="ps-error" id={`${id}-day-error`}>
                  {dayUnreadable
                    ? 'Un jour comme 28/03/2027, ou 28/3.'
                    : `Le ${dayLabel(earliest)} au plus tôt.`}
                </p>
              ) : null}
            </Field>
          </div>
          {problem === null ? null : (
            <p className="ps-error" role="alert">
              {RATE_ERRORS[problem]}
            </p>
          )}
          {problem === 'session_expired' ? <SignInAgain /> : null}
          {confirming && bps !== null ? (
            <div className="nv-confirm" role="alertdialog" aria-labelledby={`${id}-confirm`}>
              <p id={`${id}-confirm`}>
                <b>{confirmSentence(bps, fromDay)}</b> Il ne pourra plus être modifié, seulement remplacé par
                un suivant.
              </p>
              <div className="nv-confirm__actions">
                <button
                  type="button"
                  className="nv-btn nv-btn--neon"
                  disabled={saving}
                  aria-busy={saving}
                  onClick={() => void save()}
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
                <button
                  type="button"
                  className="nv-btn nv-btn--soft"
                  disabled={saving}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Revenir
                </button>
              </div>
            </div>
          ) : (
            <button type="submit" className="nv-btn nv-btn--soft ps-self-start" disabled={!ready}>
              Vérifier avant d’enregistrer
            </button>
          )}
        </form>

        {list.rates.length === 0 ? null : (
          <section className="ps-block" aria-labelledby={`${id}-history`}>
            <p className="nv-eyebrow" id={`${id}-history`}>
              Historique
            </p>
            <ul className="ar-history">
              {list.rates.map((rate) => {
                const where = standing(rate, list);
                return (
                  <li key={rate.id} className="ar-history__row" data-standing={where}>
                    <span className="ar-history__value">{percentOf(rate.agencyBps)}</span>
                    <span className="ar-history__day">à partir du {dayLabel(rate.fromDay)}</span>
                    <span className="ar-history__tag">
                      {where === 'current' ? 'En vigueur' : where === 'coming' ? 'À venir' : 'Remplacé'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

/**
 * The agency's share as Reveal reads it (ADR 0054 § 4): the 30 days, then each of the last three fortnights, per
 * account and currency, the platform's sums and their ratio. Read only: nothing here is typed nor computed again.
 */
function ObservedPanel({ list }: { list: CreatorAgencyRateList }): JSX.Element {
  const id = useId();
  const { last30Days, fortnights } = list.observed;
  const all = [last30Days, ...fortnights].flatMap((window) => window.shares);
  const windows = [
    { ...last30Days, label: '30 derniers jours' },
    ...fortnights.map((window) => ({ ...window, label: windowLabel(window) })),
  ];
  return (
    <section className="nv-plate ps-panel ar-read-panel" aria-labelledby={`${id}-read`}>
      <div className="ps-block">
        <p className="nv-eyebrow" id={`${id}-read`}>
          Lue chez {readAt(all)}
        </p>
        {all.length === 0 ? (
          <p className="ps-muted">Aucune vente lue ces 30 derniers jours : aucune part à montrer.</p>
        ) : (
          <ul className="ar-read">
            {windows.map((window) => (
              <li key={`${window.from}:${window.to}`} className="ar-read__window">
                <span className="ar-read__label">{window.label}</span>
                {window.shares.length === 0 ? (
                  <span className="ar-read__empty">aucune vente</span>
                ) : (
                  <ul className="ar-read__shares">
                    {window.shares.map((share) => {
                      const text = shareText(share);
                      const where = shareWhere(share, all);
                      return (
                        <li key={`${share.platformAccountId}:${share.currency}`} className="ar-read__share">
                          {where === null ? null : <span className="ar-read__where">{where}</span>}
                          <span className="ar-read__value">{text.value}</span>
                          <span className="ar-read__detail">{text.detail}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
