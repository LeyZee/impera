import type { FanFlags, FanFlagsView, SetFanFlagBody } from '@nirvana/contracts';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { FanFlagsRefused, fetchFanFlags, setFanFlag } from './api';
import {
  ageLine,
  ageQuestion,
  ceilingProblem,
  centsOf,
  euros,
  flagsSummary,
  isAgeDisputed,
  isOn,
  needsAttention,
  SWITCHES,
  switchDetail,
  type SwitchFlag,
} from './flags-model';

const flagsKey = (creatorId: string, fanId: string): string[] => ['fan-flags', creatorId, fanId];

/** His limits as the server reads them: one read, shared by the fan's sheet and its summary line. */
export function useFanFlags(creatorId: string, fanId: string): UseQueryResult<FanFlagsView> {
  return useQuery({
    queryKey: flagsKey(creatorId, fanId),
    queryFn: () => fetchFanFlags(creatorId, fanId),
    retry: (count, failure) => !(failure instanceof FanFlagsRefused) && count < 3,
  });
}

/**
 * The fan's limits (P3-02), read by the policy before any offer: folded to one line, amber when one stops the agent
 * from writing or selling, or when his age is disputed. Folded even then: the amber line says enough, and the thread
 * comes first. Owners and chatters set or lift them; a creator reads them. Confirming his age takes two clicks, since
 * it opens explicit content; once disputed (a sign of a minor), only the owner or a manager confirms it, with a
 * written reason the server keeps (SUIVI-04).
 */
export function FanLimits({
  creatorId,
  fanId,
  canDecide,
}: {
  creatorId: string;
  fanId: string;
  canDecide: boolean;
}): JSX.Element {
  const key = flagsKey(creatorId, fanId);
  const query = useFanFlags(creatorId, fanId);
  const client = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (body: SetFanFlagBody): Promise<boolean> => {
    setPending(true);
    setError(null);
    const result = await setFanFlag(creatorId, fanId, body);
    if (result.ok) client.setQueryData(key, result.view);
    else setError(result.message);
    setPending(false);
    return result.ok;
  };

  const view: FanFlagsView | undefined = query.data;
  const flags = view?.flags;
  const warn = flags !== undefined && needsAttention(flags);
  return (
    <details className="tr-limits">
      <summary>
        <span className="tr-limits__title">Limites du fan</span>
        <span className={`tr-limits__sum${warn ? ' tr-warn' : ''}`}>
          {flags !== undefined
            ? flagsSummary(flags)
            : query.error instanceof FanFlagsRefused
              ? 'Tu ne peux pas voir ses limites'
              : query.isError
                ? 'Le serveur ne répond pas'
                : '…'}
        </span>
      </summary>
      {flags === undefined ? null : (
        <div className="tr-limits__body">
          {SWITCHES.map((s) => (
            <Switch
              key={s.flag}
              flag={s.flag}
              label={s.label}
              meaning={switchDetail(flags, s.flag) ?? s.meaning}
              on={isOn(flags, s.flag)}
              warn={(s.flag === 'doNotContact' || s.flag === 'salesFrozen') && isOn(flags, s.flag)}
              disabled={!canDecide || pending}
              onChange={(set) => void change(switchBody(s.flag, set))}
            />
          ))}
          <Age
            flags={flags}
            mayConfirmDisputed={view?.mayConfirmDisputedAge ?? false}
            canDecide={canDecide}
            pending={pending}
            change={change}
          />
          <Ceiling flags={flags} canDecide={canDecide} pending={pending} change={change} />
          {error === null ? null : (
            <p className="tr-warn tr-line" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

/** A freeze set by hand is a human's call; lifting needs no reason. */
const switchBody = (flag: SwitchFlag, set: boolean): SetFanFlagBody =>
  !set
    ? { flag, set: false }
    : flag === 'salesFrozen'
      ? { flag, set: true, freezeReason: 'operator' }
      : { flag, set: true };

function Switch({
  flag,
  label,
  meaning,
  on,
  warn,
  disabled,
  onChange,
}: {
  flag: SwitchFlag;
  label: string;
  meaning: string;
  on: boolean;
  warn: boolean;
  disabled: boolean;
  onChange: (set: boolean) => void;
}): JSX.Element {
  const id = `tr-flag-${flag}`;
  return (
    <div className="tr-limit">
      <label htmlFor={id} className="tr-limit__text">
        <span className={`tr-limit__label${warn ? ' tr-warn' : ''}`}>{label}</span>
        <span className="tr-limit__hint">{meaning}</span>
      </label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={on}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}

interface RowProps {
  flags: FanFlags;
  canDecide: boolean;
  pending: boolean;
  change: (body: SetFanFlagBody) => Promise<boolean>;
}

/**
 * Confirming opens explicit content: a first click asks, a second one confirms. Withdrawing is one click. A disputed
 * age (a sign of a minor) is confirmed by the owner or a manager only, who write why before the second click.
 */
function Age({
  flags,
  mayConfirmDisputed,
  canDecide,
  pending,
  change,
}: RowProps & { mayConfirmDisputed: boolean }): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const confirmed = flags.ageConfirmedAt !== undefined;
  const disputed = isAgeDisputed(flags);
  const reasonMissing = disputed && reason.trim() === '';
  const stop = (): void => {
    setAsking(false);
    setReason('');
  };
  return (
    <div className="tr-limit">
      <span className="tr-limit__text">
        <span className={`tr-limit__label${disputed ? ' tr-warn' : ''}`}>
          {disputed ? 'Âge contesté' : 'Âge confirmé'}
        </span>
        <span className={`tr-limit__hint${disputed && !asking ? ' tr-warn' : ''}`}>
          {asking ? ageQuestion(flags) : ageLine(flags, mayConfirmDisputed)}
        </span>
        {asking && disputed ? (
          <textarea
            // « Confirmer son âge » is gone once clicked: the keyboard lands where the next step is.
            autoFocus
            className="nv-field__control tr-limit__reason"
            aria-label="Pourquoi tu confirmes son âge"
            placeholder="Pièce d’identité vue, appel vidéo…"
            rows={2}
            maxLength={500}
            value={reason}
            disabled={pending}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        ) : null}
      </span>
      {!canDecide || (disputed && !mayConfirmDisputed) ? null : confirmed ? (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={pending}
          onClick={() => void change({ flag: 'ageConfirmedAt', set: false })}
        >
          Retirer
        </button>
      ) : asking ? (
        <span className="tr-limit__actions">
          <button
            type="button"
            // Without a reason to write, the answer itself takes the keyboard.
            autoFocus={!disputed}
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={pending || reasonMissing}
            onClick={() =>
              void change({
                flag: 'ageConfirmedAt',
                set: true,
                ...(disputed && { reason: reason.trim() }),
              }).then((ok) => {
                if (ok) stop();
              })
            }
          >
            Oui, il est majeur
          </button>
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" disabled={pending} onClick={stop}>
            Annuler
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          disabled={pending}
          onClick={() => {
            setAsking(true);
          }}
        >
          Confirmer son âge
        </button>
      )}
    </div>
  );
}

/** The ceiling he set himself, typed in euros, stored in cents. */
function Ceiling({ flags, canDecide, pending, change }: RowProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const problem = ceilingProblem(text);
  const cents = problem === null ? centsOf(text) : null;
  const limit = flags.spendingLimitMinor;
  return (
    <div className="tr-limit">
      <span className="tr-limit__text">
        <span className="tr-limit__label">Plafond de dépenses</span>
        <span className="tr-limit__hint">
          {limit === undefined
            ? 'Aucun plafond.'
            : `Il a fixé ${euros(limit)} : l’agent ne propose rien au-delà.`}
        </span>
        {editing && problem !== null ? (
          <span className="tr-limit__hint tr-warn" role="status">
            {problem}
          </span>
        ) : null}
      </span>
      {!canDecide ? null : editing ? (
        <span className="tr-limit__actions">
          <input
            className="nv-field__control tr-limit__amount"
            inputMode="decimal"
            aria-label="Plafond en euros"
            placeholder="50 €"
            value={text}
            disabled={pending}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={pending || cents === null}
            onClick={() => {
              if (cents === null) return;
              void change({ flag: 'spendingLimitMinor', set: true, limitMinor: cents }).then((ok) => {
                if (ok) {
                  setEditing(false);
                  setText('');
                }
              });
            }}
          >
            Enregistrer
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setText('');
            }}
          >
            Annuler
          </button>
        </span>
      ) : limit === undefined ? (
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          disabled={pending}
          onClick={() => {
            setEditing(true);
          }}
        >
          Fixer un plafond
        </button>
      ) : (
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={pending}
          onClick={() => void change({ flag: 'spendingLimitMinor', set: false })}
        >
          Lever
        </button>
      )}
    </div>
  );
}
