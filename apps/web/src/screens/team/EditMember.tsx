import {
  SetCommissionRateBodySchema,
  TEAM_MEMBER_STATUSES,
  UpdateTeamMemberBodySchema,
  type CommissionPreset,
  type CreatorSummary,
  type TeamMember,
  type TeamMemberStatus,
} from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX } from 'react';

import { Dialog } from './Dialog';
import { changeStatus, MEMBERS_KEY, setCommission, updateMember, useRates, type Outcome } from './api';
import {
  ERROR_MESSAGES,
  formatRate,
  lastRate,
  longDay,
  parseRate,
  periodStartsFrom,
  rateAhead,
  STATUS_LABELS,
} from './model';

import { usePlanning } from '@/scheduling/api';
import { useAgencyToday } from '@/screens/pay/data';

/**
 * Changing a member once added (EQ-10, owner only): their team name, colour and creators; their rate from a 1st or a
 * 16th; their status, « Parti » after a confirmation. Each panel writes one thing and the server checks it.
 */

/** A write that reads the team again when it lands, and words a refusal. */
function useWrite(): {
  busy: boolean;
  problem: string | null;
  run: <T>(write: () => Promise<Outcome<T>>) => Promise<boolean>;
} {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async <T,>(write: () => Promise<Outcome<T>>): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    const outcome = await write();
    setBusy(false);
    if (outcome.kind === 'ok') {
      await client.invalidateQueries({ queryKey: MEMBERS_KEY });
      return true;
    }
    setProblem(
      outcome.kind === 'refused'
        ? ERROR_MESSAGES[outcome.code]
        : 'Rien n’a changé : le serveur ne répond pas. Réessaie dans un instant.',
    );
    return false;
  };
  return { busy, problem, run };
}

function Foot({
  busy,
  problem,
  ready,
  label,
  destructive = false,
  onClose,
}: {
  busy: boolean;
  problem: string | null;
  ready: boolean;
  label: string;
  destructive?: boolean;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      {problem === null ? null : (
        <p className="tm-warn nv-swap" role="alert">
          {problem}
        </p>
      )}
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
          Annuler
        </button>
        <button
          type="submit"
          className={`nv-btn ${destructive ? 'nv-btn--destructive' : 'nv-btn--neon'}`}
          disabled={!ready || busy}
          aria-busy={busy}
        >
          {busy ? 'Enregistrement…' : label}
        </button>
      </div>
    </>
  );
}

/** « Modifier »: the team name, the planning colour and the creators. Only what changed is sent. */
export function EditMemberPanel({
  member,
  creators,
  onClose,
}: {
  member: TeamMember;
  creators: readonly CreatorSummary[];
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, problem, run } = useWrite();
  const [displayName, setDisplayName] = useState(member.displayName);
  const [color, setColor] = useState(member.color);
  const [creatorIds, setCreatorIds] = useState<readonly string[]>(member.creatorIds);
  const name = displayName.trim();
  const sameCreators =
    creatorIds.length === member.creatorIds.length &&
    creatorIds.every((one) => member.creatorIds.some((theirs) => theirs === one));
  // Only what changed, read by the contract: an empty change sends nothing.
  const body = UpdateTeamMemberBodySchema.safeParse({
    ...(name === member.displayName ? {} : { displayName: name }),
    ...(color === member.color ? {} : { color }),
    ...(sameCreators ? {} : { creatorIds }),
  });
  const ready = name !== '' && body.success;

  return (
    <Dialog title={`Modifier ${member.displayName}`} busy={busy} onClose={onClose}>
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const change = body.data;
          void run(() => updateMember(member.id, change)).then((done) => {
            if (done) onClose();
          });
        }}
      >
        <div className="nv-field tm-field" data-invalid={name === '' ? 'true' : undefined}>
          <label className="nv-field__label" htmlFor={`${id}-name`}>
            Nom dans l’équipe
          </label>
          <input
            id={`${id}-name`}
            className="nv-field__control nv-glass"
            value={displayName}
            maxLength={80}
            autoComplete="off"
            data-autofocus
            aria-invalid={name === ''}
            onChange={(event) => {
              setDisplayName(event.target.value);
            }}
          />
          <span className={name === '' ? 'tm-hint tm-hint--error' : 'tm-hint'}>
            {name === '' ? 'Indique le nom que voit l’équipe.' : 'Celui du planning et des passations.'}
          </span>
        </div>
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-color`}>
            Couleur du planning
          </label>
          <span className="tm-color">
            <input
              id={`${id}-color`}
              type="color"
              className="tm-color__well"
              value={color ?? '#8a8a8a'}
              onChange={(event) => {
                setColor(event.target.value.toLowerCase());
              }}
            />
            <span className="tm-hint">{color ?? 'Aucune pour l’instant.'}</span>
          </span>
        </div>
        <div className="nv-field tm-field">
          <span className="nv-field__label">Créatrices</span>
          {creators.length === 0 ? (
            <span className="tm-hint">Aucune créatrice pour l’instant.</span>
          ) : (
            <div className="tm-choices" role="group" aria-label="Créatrices">
              {creators.map((creator) => {
                const on = creatorIds.includes(creator.id);
                return (
                  <button
                    key={creator.id}
                    type="button"
                    className="nv-chip"
                    aria-pressed={on}
                    onClick={() => {
                      setCreatorIds(
                        on ? creatorIds.filter((one) => one !== creator.id) : [...creatorIds, creator.id],
                      );
                    }}
                  >
                    {creator.displayName}
                  </button>
                );
              })}
            </div>
          )}
          <span className="tm-hint">Celles de son travail, à partir de maintenant.</span>
        </div>
        <Foot busy={busy} problem={problem} ready={ready} label="Enregistrer" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/**
 * « Changer le taux »: a preset or a rate by hand, and the first day of a period ahead it starts on (Charles, 28/10:
 * a period is paid at one rate, nothing is recomputed backwards). A manager keeps or changes his share of the team.
 * The days offered start from today in the agency's zone, the day the server checks the date against (#290).
 */
export function RatePanel({
  member,
  presets,
  onClose,
}: {
  member: TeamMember;
  presets: readonly CommissionPreset[];
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, problem, run } = useWrite();
  const today = useAgencyToday();
  const starts = today === null ? [] : periodStartsFrom(today, 4);
  const rates = useRates(member.id);
  const ahead = today === null ? null : rateAhead(rates.data ?? [], today);
  // Nothing chosen at first, neither the rate nor its day: a rate is never changed by a stray tap.
  const [from, setFrom] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [byHand, setByHand] = useState(presets.length === 0);
  const [rate, setRate] = useState('');
  const manager = member.teamRole === 'manager';
  // The share offered is the one set last, an ahead rate's if there is one, once the rates are read.
  const [share, setShare] = useState<string | null>(null);
  const kept = manager ? ((lastRate(rates.data ?? []) ?? member.commission)?.teamShareBps ?? null) : null;
  const shareText = share ?? (kept === null ? '' : String(kept / 100).replace('.', ','));
  const typed = parseRate(rate);
  const shareBps = shareText.trim() === '' ? null : parseRate(shareText);
  const rateOk = byHand ? typed !== null : presetId !== null;
  const shareOk = !manager || shareText.trim() === '' || shareBps !== null;
  const newRate = byHand ? typed : (presets.find((preset) => preset.id === presetId)?.rateBps ?? null);
  const body = SetCommissionRateBodySchema.safeParse({
    commission: byHand ? { rateBps: typed } : { presetId },
    teamShareBps: manager ? shareBps : null,
    effectiveFrom: from,
  });
  const ready = rateOk && shareOk && from !== null && body.success;

  return (
    <Dialog
      title="Changer le taux"
      lead={`${
        member.commission === null
          ? `${member.displayName} n’a pas encore de taux.`
          : `Aujourd’hui ${formatRate(member.commission.rateBps)}, depuis le ${longDay(member.commission.effectiveFrom)}.`
      }${ahead === null ? '' : ` ${formatRate(ahead.rateBps)} prévu à partir du ${longDay(ahead.effectiveFrom)}.`}`}
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const rateFrom = body.data;
          void run(() => setCommission(member.id, rateFrom)).then((done) => {
            if (done) onClose();
          });
        }}
      >
        <div className="nv-field tm-field">
          <span className="nv-field__label">Nouveau taux</span>
          <div className="tm-presets" role="radiogroup" aria-label="Préréglage de commission">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                className="tm-preset"
                aria-checked={!byHand && presetId === preset.id}
                onClick={() => {
                  setPresetId(preset.id);
                  setByHand(false);
                }}
              >
                <span className="tm-preset__name">{preset.name}</span>
                <span className="tm-preset__rate">{formatRate(preset.rateBps)}</span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              className="tm-preset"
              aria-checked={byHand}
              onClick={() => {
                setByHand(true);
              }}
            >
              <span className="tm-preset__name">Autre</span>
              <span className="tm-preset__rate tm-preset__rate--word">À la main</span>
            </button>
          </div>
          {byHand ? (
            <span className="tm-percent nv-swap">
              <input
                className="nv-field__control nv-glass"
                inputMode="decimal"
                placeholder="12,5"
                aria-label="Taux à la main"
                aria-invalid={rate.trim() !== '' && typed === null}
                value={rate}
                onChange={(event) => {
                  setRate(event.target.value);
                }}
              />
              <span aria-hidden="true">%</span>
            </span>
          ) : null}
          {byHand && rate.trim() !== '' && typed === null ? (
            <span className="tm-hint tm-hint--error">Un taux entre 0 et 100 %, par exemple 12,5.</span>
          ) : null}
        </div>
        {manager ? (
          <div className="nv-field tm-field" data-invalid={shareOk ? undefined : 'true'}>
            <label className="nv-field__label" htmlFor={`${id}-share`}>
              Part du net de l’équipe
            </label>
            <span className="tm-percent">
              <input
                id={`${id}-share`}
                className="nv-field__control nv-glass"
                inputMode="decimal"
                placeholder="5"
                aria-invalid={!shareOk}
                value={shareText}
                onChange={(event) => {
                  setShare(event.target.value);
                }}
              />
              <span aria-hidden="true">%</span>
            </span>
            <span className={shareOk ? 'tm-hint' : 'tm-hint tm-hint--error'}>
              {shareOk ? 'Vide : pas de part.' : 'Une part entre 0 et 100 %, ou rien.'}
            </span>
          </div>
        ) : null}
        <div className="nv-field tm-field">
          <span className="nv-field__label">À partir du</span>
          <div className="tm-choices" role="radiogroup" aria-label="À partir du" aria-busy={today === null}>
            {starts.map((day) => {
              // A day that already has a rate is said and closed: the server would refuse a second one.
              const set = rates.data?.find((one) => one.effectiveFrom === day);
              return (
                <button
                  key={day}
                  type="button"
                  role="radio"
                  className="nv-chip"
                  aria-checked={from === day}
                  disabled={set !== undefined}
                  onClick={() => {
                    setFrom(day);
                  }}
                >
                  {longDay(day)}
                  {set === undefined ? null : ` · ${formatRate(set.rateBps)} prévu`}
                </button>
              );
            })}
          </div>
          <span className="tm-hint">
            Une quinzaine se paie à un seul taux : le nouveau part d’un 1er ou d’un 16, rien n’est recalculé
            avant.
          </span>
        </div>
        {/* Said before it is sent: a rate saved is never changed, a slip would pay a whole period (Équipe, #318). */}
        {ready && newRate !== null ? (
          <p className="tm-recap nv-swap" role="status">
            À partir du {longDay(from)} : <b>{formatRate(newRate)}</b>
            {manager && shareBps !== null
              ? `, part de l’équipe ${formatRate(shareBps)}`
              : ''} (aujourd’hui{' '}
            {member.commission === null ? 'pas de taux' : formatRate(member.commission.rateBps)}). Un taux
            enregistré ne se modifie plus.
          </p>
        ) : null}
        <Foot busy={busy} problem={problem} ready={ready} label="Enregistrer le taux" onClose={onClose} />
      </form>
    </Dialog>
  );
}

/** What « Parti » does, said before it is done: it cannot be undone from Nirvana. */
const LEAVING = (name: string): string =>
  `${name} n’aura plus accès à Nirvana : ses créatrices lui sont retirées et ses sessions fermées. Sa fiche, ses rapports et ses relevés restent. Ce changement est définitif.`;

/** What a departure leaves to do by hand until the departure itself is built (EQ-14): nothing reads as settled. */
const LEFT_TO_DO: readonly string[] = [
  'Un report sous le minimum de versement lui reste dû : il n’est pas versé tant qu’aucun relevé final n’existe.',
  'Son compte membre sur Reveal est à retirer à la main.',
];

/** Away or suspended, the same effect: a narrow access, no new shift, the creators kept for the return. */
const AWAY = (name: string): string =>
  `${name} garde sa connexion et ne voit plus que ses propres shifts, rapports et relevés. Aucun shift ne peut lui être posé. Ses créatrices restent attachées pour son retour.`;

/** The planning read ahead for a member's shifts still set: what make-shifts lays, four weeks, inside the read's six. */
const AHEAD_DAYS = 42;

/** His shifts still to come: nobody holds them once he is away or gone, and the planning counts them as filled. */
function ShiftsLeft({ member }: { member: TeamMember }): JSX.Element | null {
  const [range] = useState(() => {
    const from = new Date();
    return {
      from: from.toISOString(),
      to: new Date(from.getTime() + AHEAD_DAYS * 86_400_000).toISOString(),
      creatorId: null,
    };
  });
  const planning = usePlanning(range);
  // Unread is not « none »: the owner is sent to the planning rather than told nothing is left.
  if (planning.isError) {
    return (
      <p className="tm-warn nv-swap">
        Ses shifts à venir n’ont pas pu être lus.{' '}
        <Link to="/equipe/planning" search={{ membre: member.id }}>
          Vérifier au planning
        </Link>
      </p>
    );
  }
  const count = (planning.data?.shifts ?? []).filter(
    (shift) => shift.memberId === member.id && shift.stoppedAt === null && shift.startsAt > range.from,
  ).length;
  if (count === 0) return null;
  return (
    <p className="tm-warn nv-swap">
      {count} shift{count > 1 ? 's' : ''} à venir {count > 1 ? 'restent' : 'reste'} au planning : personne ne{' '}
      {count > 1 ? 'les' : 'le'} tiendra et {count > 1 ? 'ils comptent' : 'il compte'} comme pourvu
      {count > 1 ? 's' : ''}.{' '}
      <Link to="/equipe/planning" search={{ membre: member.id }}>
        Voir ses shifts
      </Link>
    </p>
  );
}

/** « Changer le statut »: at work, away (leave, sick, travelling), suspended, or gone for good after a confirmation. */
export function StatusPanel({ member, onClose }: { member: TeamMember; onClose: () => void }): JSX.Element {
  const id = useId();
  const { busy, problem, run } = useWrite();
  const [status, setStatus] = useState<TeamMemberStatus>(member.status);
  const [sure, setSure] = useState(false);
  const leaving = status === 'left';
  const ready = status !== member.status && (!leaving || sure);

  return (
    <Dialog title={`Statut de ${member.displayName}`} busy={busy} onClose={onClose}>
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          void run(() => changeStatus(member.id, status)).then((done) => {
            if (done) onClose();
          });
        }}
      >
        <div className="tm-choices" role="radiogroup" aria-label="Statut">
          {TEAM_MEMBER_STATUSES.map((one) => (
            <button
              key={one}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={status === one}
              onClick={() => {
                setStatus(one);
                setSure(false);
              }}
            >
              {STATUS_LABELS[one]}
            </button>
          ))}
        </div>
        {status !== 'active' && !leaving ? (
          <p className="tm-hint nv-swap">{AWAY(member.displayName)}</p>
        ) : null}
        {status !== 'active' && !leaving ? <ShiftsLeft member={member} /> : null}
        {leaving ? (
          <div className="nv-confirm nv-swap" role="group" aria-label="Confirmer le départ">
            <div id={`${id}-leaving`} className="sc-confirm__text">
              <p>{LEAVING(member.displayName)}</p>
              <p>Nirvana ne le fait pas encore :</p>
              <ul className="tm-todo">
                {LEFT_TO_DO.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <ShiftsLeft member={member} />
            <label className="tm-sure">
              <input
                type="checkbox"
                aria-describedby={`${id}-leaving`}
                checked={sure}
                onChange={(event) => {
                  setSure(event.target.checked);
                }}
              />
              {member.displayName} quitte l’équipe
            </label>
          </div>
        ) : null}
        <Foot
          busy={busy}
          problem={problem}
          ready={ready}
          label={leaving ? 'Confirmer le départ' : 'Enregistrer'}
          destructive={leaving}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}
