import {
  DROP_CATEGORY_LABELS,
  SCRIPT_CADENCE_MAX_DAYS,
  SCRIPT_CADENCE_MIN_DAYS,
  CreateContentRequestBodySchema,
  type CreatorId,
  type DropCategory,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type JSX } from 'react';

import { askContent, cadenceKey, cancelRequest, setCadence, useCadence } from './api';
import {
  ASKABLE_CATEGORIES,
  STANDING_LABELS,
  askProblems,
  askableStructures,
  cadenceNote,
  everyText,
  requestGroups,
  type AskDraft,
  type AskField,
  type RequestRow,
} from './model';
import './requests.css';

import { contentKey, useCreatorContent } from '@/creators/scripts/api';
import { DayField } from '@/scheduling/DayField';
import { addDays, dayOf } from '@/scheduling/time';
import { CATEGORY_EMOJIS, namedDay, shotMomentOf } from '@/screens/content/model';
import { useStructures } from '@/scripts/api';
import { Dialog } from '@/shell/Dialog';
import { Select } from '@/shell/Select';
import '@/creators/agenda/agency-agenda.css';

/**
 * Créatrices › Demandes (recette MED-09, ADR 0055 § 4), the owner's and an active manager's: what the agency asks of
 * her, by hand, and the cadence of her scripts. A request is asked in a dialog (what, for when, why, and the structure
 * of a script: its Jour or Nuit is fixed by the code, « ok alternance »); it is cancelled only while nothing answers it
 * (recette MED-07). The cadence is the owner's to set, read by the managers.
 */
export function RequestsSection({
  creatorId,
  creatorName,
  timezone,
  isOwner,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
  isOwner: boolean;
}): JSX.Element {
  const today = dayOf(new Date(), timezone);
  const content = useCreatorContent(creatorId);
  const structures = useStructures();
  const [asking, setAsking] = useState(false);
  const [cancelling, setCancelling] = useState<RequestRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = (): JSX.Element => {
    if (content.data === undefined) {
      if (content.isError)
        return (
          <div className="nv-plate aa-empty">
            <p className="aa-empty__title">Ses demandes ne se chargent pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void content.refetch()}
            >
              Réessayer
            </button>
          </div>
        );
      return <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />;
    }
    const groups = requestGroups(content.data, structures.data ?? [], today);
    if (groups.current.length === 0 && groups.closed.length === 0)
      return (
        <div className="nv-plate aa-empty">
          <p className="aa-empty__title">Aucune demande pour l’instant</p>
          <p className="ps-muted">
            Ce que tu demandes à {creatorName} arrive sur son téléphone, dans Contenu, avec le jour et ta
            raison.
          </p>
        </div>
      );
    return (
      <>
        <section className="rq-group" aria-label="En cours">
          <h3 className="rq-group__title">
            En cours <span className="rq-count nv-num">{groups.current.length}</span>
          </h3>
          {groups.current.length === 0 ? (
            <p className="ps-muted rq-none">
              Rien en cours : tout ce que tu lui as demandé est fait ou clos.
            </p>
          ) : (
            <ul className="rq-list">
              {groups.current.map((row, index) => (
                <RequestCard
                  key={row.request.id}
                  row={row}
                  index={index}
                  onCancel={() => {
                    setNotice(null);
                    setCancelling(row);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
        {groups.closed.length === 0 ? null : (
          <section className="rq-group" aria-label="Refusées ou annulées">
            <h3 className="rq-group__title">
              Refusées ou annulées <span className="rq-count nv-num">{groups.closed.length}</span>
            </h3>
            <ul className="rq-list">
              {groups.closed.map((row, index) => (
                <RequestCard key={row.request.id} row={row} index={index} onCancel={null} />
              ))}
            </ul>
          </section>
        )}
      </>
    );
  };

  return (
    <section className="ps-page aa-page rq-page" aria-label={`Demandes de ${creatorName}`}>
      <div className="nv-plate ps-head">
        <div className="ps-head__top">
          <div className="ps-head__who">
            <p className="ps-title">Ses demandes</p>
            <p className="ps-muted">
              Ce que l’agence demande à {creatorName}, et le rythme de ses scripts. Elle reçoit chaque demande
              sur son téléphone et peut la refuser.
            </p>
          </div>
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            onClick={() => {
              setNotice(null);
              setAsking(true);
            }}
          >
            Demander un contenu
          </button>
        </div>
      </div>
      {notice === null ? null : (
        <p className="rq-notice nv-swap" role="status">
          {notice}
        </p>
      )}
      <CadencePlate creatorId={creatorId} isOwner={isOwner} today={today} />
      {list()}
      {asking ? (
        <AskDialog
          creatorId={creatorId}
          creatorName={creatorName}
          today={today}
          onClose={() => {
            setAsking(false);
          }}
          onAsked={(text) => {
            setAsking(false);
            setNotice(text);
          }}
        />
      ) : null}
      {cancelling === null ? null : (
        <CancelDialog
          creatorId={creatorId}
          row={cancelling}
          onClose={() => {
            setCancelling(null);
          }}
          onCancelled={() => {
            setCancelling(null);
            setNotice('Demande annulée : elle ne la voit plus.');
          }}
        />
      )}
    </section>
  );
}

function CadencePlate({
  creatorId,
  isOwner,
  today,
}: {
  creatorId: CreatorId;
  isOwner: boolean;
  today: string;
}): JSX.Element | null {
  const id = useId();
  const client = useQueryClient();
  const cadence = useCadence(creatorId);
  const [typed, setTyped] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (cadence.data === undefined) return null;
  const days = cadence.data.days;
  const shown = typed ?? String(days);
  const value = /^\d{1,2}$/u.test(shown.trim()) ? Number(shown.trim()) : null;
  const valid = value !== null && value >= SCRIPT_CADENCE_MIN_DAYS && value <= SCRIPT_CADENCE_MAX_DAYS;
  const changed = valid && value !== days;
  const note = cadenceNote(cadence.data);

  const save = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const outcome = await setCadence(creatorId, value);
    setBusy(false);
    if (outcome.kind === 'ok') {
      client.setQueryData(cadenceKey(creatorId), outcome.value);
      setTyped(null);
      return;
    }
    setError(outcome.message);
  };

  return (
    <div className="nv-plate rq-cadence">
      <div className="rq-cadence__top">
        <div className="rq-cadence__who">
          <p className="rq-cadence__title">
            <span aria-hidden="true">📜</span> Ses scripts
          </p>
          <p className="rq-cadence__line nv-num">
            {everyText(days)}
            {cadence.data.lastDueOn === null
              ? ' · aucun encore demandé'
              : ` · le dernier pour ${namedDay(cadence.data.lastDueOn, today)}`}
          </p>
        </div>
        {isOwner ? (
          <form
            className="rq-cadence__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="rq-cadence__label" htmlFor={`${id}-days`}>
              Un script tous les
            </label>
            <input
              id={`${id}-days`}
              className="nv-field__control rq-cadence__input nv-num"
              inputMode="numeric"
              autoComplete="off"
              value={shown}
              aria-invalid={!valid}
              disabled={busy}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
            <span className="rq-cadence__unit">jours</span>
            {changed ? (
              <button type="submit" className="nv-btn nv-btn--soft nv-btn--sm" disabled={busy}>
                Enregistrer
              </button>
            ) : null}
          </form>
        ) : null}
      </div>
      {!valid ? (
        <p className="rq-error" role="alert">
          {`De ${String(SCRIPT_CADENCE_MIN_DAYS)} à ${String(SCRIPT_CADENCE_MAX_DAYS)} jours.`}
        </p>
      ) : null}
      {error === null ? null : (
        <p className="rq-error" role="alert">
          {error}
        </p>
      )}
      {note === null ? null : (
        <p className="rq-note" data-tone={note.warn ? 'warn' : undefined}>
          {note.text}
        </p>
      )}
    </div>
  );
}

function RequestCard({
  row,
  index,
  onCancel,
}: {
  row: RequestRow;
  index: number;
  onCancel: (() => void) | null;
}): JSX.Element {
  const id = useId();
  const { request } = row;
  const moment = shotMomentOf(request);
  return (
    <li
      className="nv-plate rq-card nv-enter"
      style={{ '--nv-i': index + 1 }}
      data-standing={row.standing}
      aria-labelledby={`${id}-title`}
    >
      <div className="rq-card__top">
        <span className="rq-cat" id={`${id}-title`}>
          <span aria-hidden="true">{CATEGORY_EMOJIS[request.category]}</span>
          {DROP_CATEGORY_LABELS[request.category]}
        </span>
        <span className={row.due.late ? 'rq-due rq-due--late nv-num' : 'rq-due nv-num'}>
          {moment === null ? row.due.text : `${row.due.text} · ${moment}`}
        </span>
        <span className="aa-pill rq-state" data-tone={row.standing}>
          {STANDING_LABELS[row.standing]}
        </span>
      </div>
      <div className="rq-card__main">
        <div className="rq-card__text">
          <p className="rq-reason">{request.reason}</p>
          {row.structureName === null ? null : <p className="rq-meta">Structure : {row.structureName}</p>}
          {row.standing === 'refused' ? (
            <p className="rq-note">
              {request.refusalReason === null
                ? 'Refusée sans raison donnée.'
                : `Sa raison : ${request.refusalReason}`}
            </p>
          ) : null}
        </div>
        {onCancel !== null && row.cancellable ? (
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm rq-cancel" onClick={onCancel}>
            Annuler la demande
          </button>
        ) : null}
      </div>
    </li>
  );
}

function CancelDialog({
  creatorId,
  row,
  onClose,
  onCancelled,
}: {
  creatorId: CreatorId;
  row: RequestRow;
  onClose: () => void;
  onCancelled: () => void;
}): JSX.Element {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const outcome = await cancelRequest(creatorId, row.request.id);
    await client.invalidateQueries({ queryKey: contentKey(creatorId) });
    setBusy(false);
    if (outcome.kind === 'ok') onCancelled();
    else setError(outcome.message);
  };

  return (
    <Dialog
      title="Annuler cette demande ?"
      lead={`${DROP_CATEGORY_LABELS[row.request.category]} · ${row.due.text}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="tm-dialog__body">
        <p className="rq-dialog__text">
          Elle ne la verra plus dans son Contenu. Une demande annulée ne revient pas : pour la lui redemander,
          fais une nouvelle demande.
        </p>
        {error === null ? null : (
          <p className="rq-error nv-swap" role="alert">
            {error}
          </p>
        )}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Garder
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--destructive"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {busy ? 'Annulation…' : 'Annuler la demande'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const EMPTY = (today: string): AskDraft => ({
  category: '',
  dueOn: addDays(today, 3),
  reason: '',
  structureId: '',
});

function AskDialog({
  creatorId,
  creatorName,
  today,
  onClose,
  onAsked,
}: {
  creatorId: CreatorId;
  creatorName: string;
  today: string;
  onClose: () => void;
  onAsked: (notice: string) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const structures = useStructures();
  // One id for the dialog: a retry after a lost answer asks the same request once.
  const [requestId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<AskDraft>(() => EMPTY(today));
  const [tried, setTried] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [refused, setRefused] = useState<{
    readonly field: AskField | null;
    readonly message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const problems: Partial<Record<AskField, string>> = {
    ...(tried ? askProblems(draft, today) : {}),
    ...(tried && unreadable ? { dueOn: 'Un jour comme 28/11/2026.' } : {}),
    ...(refused === null ? {} : refused.field === null ? {} : { [refused.field]: refused.message }),
  };
  const options = askableStructures(structures.data ?? [], creatorId).map((structure) => ({
    value: structure.id,
    label: structure.current.name,
  }));

  const set = (patch: Partial<AskDraft>): void => {
    setRefused(null);
    setDraft((before) => ({ ...before, ...patch }));
  };

  const ask = async (): Promise<void> => {
    setTried(true);
    if (unreadable || Object.keys(askProblems(draft, today)).length > 0 || draft.category === '') return;
    setBusy(true);
    setRefused(null);
    // Read like the server reads it: what the checks above let through is a request it takes.
    const body = CreateContentRequestBodySchema.safeParse({
      id: requestId,
      category: draft.category,
      dueOn: draft.dueOn,
      reason: draft.reason.trim(),
      structureId: draft.category === 'script' ? draft.structureId : null,
    });
    if (!body.success) {
      setBusy(false);
      setRefused({ field: null, message: 'Cette demande ne se lit pas : vérifie chaque champ.' });
      return;
    }
    const outcome = await askContent(creatorId, body.data);
    setBusy(false);
    if (outcome.kind === 'ok') {
      await client.invalidateQueries({ queryKey: contentKey(creatorId) });
      // The moment the code fixed, read from its value, never from the label shown.
      const moment = outcome.value.category === 'script' ? outcome.value.moment : null;
      onAsked(
        moment === null
          ? `Demandé : ${creatorName} le voit dans son Contenu.`
          : `Demandé : ${creatorName} le voit dans son Contenu, à tourner ${moment === 'night' ? 'de nuit' : 'de jour'}.`,
      );
      return;
    }
    setRefused({ field: outcome.field, message: outcome.message });
  };

  return (
    <Dialog
      title="Demander un contenu"
      lead={`À ${creatorName}, sur son téléphone`}
      busy={busy}
      onClose={onClose}
      className="rq-ask"
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <div className="nv-field">
          <span className="nv-field__label" id={`${id}-cat`}>
            Quoi
          </span>
          <div className="ps-chips rq-chips" role="radiogroup" aria-labelledby={`${id}-cat`}>
            {ASKABLE_CATEGORIES.map((category: DropCategory, index) => (
              <button
                key={category}
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={draft.category === category}
                {...(index === 0 ? { 'data-autofocus': true } : {})}
                onClick={() => {
                  set({ category });
                }}
              >
                <span aria-hidden="true">{CATEGORY_EMOJIS[category]}</span>
                {DROP_CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
          {problems.category === undefined ? null : (
            <p className="rq-error" role="alert">
              {problems.category}
            </p>
          )}
        </div>
        {draft.category === 'script' ? (
          <div className="nv-field">
            <label className="nv-field__label" htmlFor={`${id}-structure`}>
              Structure
            </label>
            <Select<string>
              id={`${id}-structure`}
              value={draft.structureId}
              options={options}
              placeholder={options.length === 0 ? 'Aucune structure dans la bibliothèque' : 'Choisir…'}
              invalid={problems.structureId !== undefined}
              onChange={(structureId) => {
                set({ structureId });
              }}
            />
            <p className={problems.structureId === undefined ? 'rq-hint' : 'rq-error'}>
              {problems.structureId ??
                'Jour ou Nuit se fixe tout seul : l’autre moment que son dernier script.'}
            </p>
          </div>
        ) : null}
        <div className="nv-field">
          <label className="nv-field__label" htmlFor={`${id}-due`}>
            Pour le
          </label>
          <DayField
            id={`${id}-due`}
            value={draft.dueOn}
            today={today}
            invalid={problems.dueOn !== undefined}
            onChange={(dueOn) => {
              set({ dueOn });
            }}
            onUnreadable={(isUnreadable) => {
              setUnreadable(isUnreadable);
            }}
          />
          <p className={problems.dueOn === undefined ? 'rq-hint' : 'rq-error'}>
            {problems.dueOn ?? 'Dans ses jours à elle : aujourd’hui ou plus tard.'}
          </p>
        </div>
        <div className="nv-field">
          <label className="nv-field__label" htmlFor={`${id}-reason`}>
            Pourquoi
          </label>
          <textarea
            id={`${id}-reason`}
            className="nv-field__control rq-reason-field"
            value={draft.reason}
            maxLength={160}
            rows={3}
            aria-invalid={problems.reason !== undefined}
            placeholder="Une séance en lingerie noire pour le feed de la semaine"
            onChange={(event) => {
              set({ reason: event.target.value });
            }}
          />
          <p className={problems.reason === undefined ? 'rq-hint' : 'rq-error'}>
            {problems.reason ?? 'Elle lit cette phrase telle quelle sur sa demande.'}
          </p>
        </div>
        {refused !== null && refused.field === null ? (
          <p className="rq-error nv-swap" role="alert">
            {refused.message}
          </p>
        ) : null}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy}>
            {busy ? 'Envoi…' : 'Demander'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
