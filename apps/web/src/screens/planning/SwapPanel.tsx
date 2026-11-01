import { newId, ShiftSwapRequestIdSchema, type Shift, type SwapCandidates } from '@nirvana/contracts';
import { useId, useState, type JSX } from 'react';

import { proposeSwap, useRefreshPlanning, useSwapCandidates, type Refusal } from '@/scheduling/api';
import { READ_AGAIN, swapRefusalText, swapShiftLine } from '@/scheduling/model';
import { Dialog } from '@/screens/team/Dialog';

type Candidate = SwapCandidates['candidates'][number];

const overlaps = (a: Pick<Shift, 'startsAt' | 'endsAt'>, b: Pick<Shift, 'startsAt' | 'endsAt'>): boolean =>
  new Date(a.startsAt).getTime() < new Date(b.endsAt).getTime() &&
  new Date(b.startsAt).getTime() < new Date(a.endsAt).getTime();

/**
 * What a colleague could give back for `shift`: any shift of theirs when they are free then. When they are not, only
 * the one shift of theirs that overlaps it, since an exchange against another would leave them on two shifts at once
 * (ADR 0031); with two or more overlapping, no exchange can hold, and nothing is offered. A shift of theirs on a
 * creator the reader does not work on is not listed: the server's refusal says it.
 */
export function backsOf(candidate: Candidate, shift: Pick<Shift, 'startsAt' | 'endsAt'>): Shift[] {
  const ahead = [...candidate.shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (candidate.freeThen) return ahead;
  const inTheWay = ahead.filter((one) => overlaps(one, shift));
  return inTheWay.length === 1 ? inTheWay : [];
}

/**
 * « Proposer un échange » (ADR 0031, without a manager): one of the member's shifts to a colleague who works on its
 * creator, given or in exchange for one of theirs. The colleague answers; the agency hears of it and can undo it. The
 * proposal's id is made when the panel opens, so a retry records one proposal.
 */
export function SwapPanel({
  shift,
  creatorName,
  zone,
  onClose,
}: {
  shift: Shift;
  creatorName: string | undefined;
  zone: string;
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const refresh = useRefreshPlanning();
  const candidates = useSwapCandidates(shift.id);
  const [requestId] = useState(() => newId(ShiftSwapRequestIdSchema));
  const [memberId, setMemberId] = useState<string | null>(null);
  const [backId, setBackId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const list = candidates.data?.candidates ?? [];
  const accounts = new Map((candidates.data?.accounts ?? []).map((account) => [account.id, account]));
  const chosen = list.find((one) => one.member.id === memberId) ?? null;
  const backs = chosen === null ? [] : backsOf(chosen, shift);
  // A busy colleague takes the shift only against the one of theirs in its way, chosen for them.
  const back = backs.find((one) => one.id === backId) ?? (chosen?.freeThen === false ? backs[0] : undefined);
  const ready = chosen !== null && (chosen.freeThen || back !== undefined) && !busy;
  const offered = swapShiftLine(shift.startsAt, shift.endsAt, creatorName, zone);

  const submit = async (): Promise<void> => {
    if (!ready) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await proposeSwap({
      id: requestId,
      shiftId: shift.id,
      targetMemberId: chosen.member.id,
      targetShiftId: back?.id ?? null,
      message,
    });
    setBusy(false);
    if (outcome.kind === 'ok') {
      await refresh();
      onClose();
      return;
    }
    if (outcome.kind === 'refused' && READ_AGAIN.has(outcome.code)) await refresh();
    setRefusal(outcome);
  };

  return (
    <Dialog title="Proposer un échange" lead={`Ton shift du ${offered}.`} busy={busy} onClose={onClose}>
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="sc-fieldset">
          <legend className="nv-field__label">À qui</legend>
          {candidates.isError ? (
            <div className="sc-empty">
              <p className="tm-warn">Le serveur ne répond pas : tes collègues n’ont pas pu être lus.</p>
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                onClick={() => {
                  void candidates.refetch();
                }}
              >
                Réessayer
              </button>
            </div>
          ) : candidates.data === undefined ? (
            <div className="sc-skeleton sc-skeleton--short" aria-hidden="true">
              <i />
              <i />
            </div>
          ) : list.length === 0 ? (
            <p className="tm-hint sc-empty">
              Personne d’autre ne peut prendre ce shift : aucun collègue actif ne travaille sur{' '}
              {creatorName ?? 'cette créatrice'} à ces heures.
            </p>
          ) : (
            <div className="sc-options" role="radiogroup" aria-label="Collègue">
              {list.map((candidate, index) => {
                const possible = candidate.freeThen || backsOf(candidate, shift).length > 0;
                return (
                  <button
                    key={candidate.member.id}
                    type="button"
                    role="radio"
                    className="sc-option nv-enter"
                    style={{ '--nv-i': index }}
                    aria-checked={memberId === candidate.member.id}
                    disabled={!possible || busy}
                    data-autofocus={index === 0 ? true : undefined}
                    onClick={() => {
                      setMemberId(candidate.member.id);
                      setBackId(null);
                      setRefusal(null);
                    }}
                  >
                    <span
                      className="sc-swatch"
                      style={
                        candidate.member.color === null ? undefined : { '--sc-color': candidate.member.color }
                      }
                      aria-hidden="true"
                    />
                    <span className="sc-option__text">
                      <span className="sc-option__title">{candidate.member.displayName}</span>
                      <span className="sc-option__sub">
                        {candidate.freeThen
                          ? 'Libre à ces heures'
                          : possible
                            ? 'Déjà en shift à ces heures : seulement contre celui-là'
                            : 'Déjà en shift à ces heures'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        {chosen === null ? null : (
          <fieldset className="sc-fieldset nv-swap" key={chosen.member.id}>
            <legend className="nv-field__label">Contre quoi</legend>
            <div className="sc-options" role="radiogroup" aria-label="Ce qui te revient">
              {chosen.freeThen ? (
                <button
                  type="button"
                  role="radio"
                  className="sc-option"
                  aria-checked={back === undefined}
                  disabled={busy}
                  onClick={() => {
                    setBackId(null);
                  }}
                >
                  <span className="sc-option__text">
                    <span className="sc-option__title">Rien, je donne mon shift</span>
                    <span className="sc-option__sub">
                      {chosen.member.displayName} le prend en plus des siens.
                    </span>
                  </span>
                </button>
              ) : null}
              {backs.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  role="radio"
                  className="sc-option"
                  aria-checked={back?.id === one.id}
                  disabled={busy}
                  onClick={() => {
                    setBackId(one.id);
                  }}
                >
                  <span className="sc-option__text">
                    <span className="sc-option__title nv-num">
                      {swapShiftLine(one.startsAt, one.endsAt, undefined, zone)}
                    </span>
                    <span className="sc-option__sub">
                      Son shift sur {accounts.get(one.platformAccountId)?.creatorName ?? 'une créatrice'} te
                      revient.
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {chosen === null ? null : (
          <div className="nv-field tm-field nv-swap">
            <label className="nv-field__label" htmlFor={`${id}-message`}>
              Un mot pour {chosen.member.displayName} <span className="sc-optional">facultatif</span>
            </label>
            <textarea
              id={`${id}-message`}
              className="nv-field__control nv-glass sc-note"
              rows={2}
              maxLength={500}
              value={message}
              placeholder="Tu peux me remplacer ?"
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          </div>
        )}

        {refusal === null ? null : (
          <p className="tm-warn sc-refusal nv-swap" role="alert">
            {refusal.kind === 'failed'
              ? 'Le serveur ne répond pas : rien n’a été envoyé. Réessaie dans un instant.'
              : swapRefusalText(
                  refusal.code,
                  'propose',
                  chosen?.member.displayName ?? 'Ce membre',
                  refusal.shiftId,
                )}
          </p>
        )}

        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={!ready} aria-busy={busy}>
            {busy ? 'Envoi…' : chosen === null ? 'Proposer' : `Proposer à ${chosen.member.displayName}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
