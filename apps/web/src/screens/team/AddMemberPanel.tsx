import {
  CreateTeamMemberBodySchema,
  TimezoneSchema,
  type CommissionPreset,
  type CreatorSummary,
  type InvitationLinkCreated,
  type TeamMember,
  type TeamRole,
} from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';

import { ShareLink } from './ShareLink';
import { createInvitationLink, createMember, MEMBERS_KEY } from './api';
import {
  ERROR_MESSAGES,
  FIRST_COUNTRIES,
  OTHER_COUNTRIES,
  formatRate,
  parseRate,
  ROLE_LABELS,
  suggestedZone,
  today,
} from './model';

import { localTime } from '@/creators/persona/model';
import { countryFlag, countryName } from '@/lib/country';
import { cityOf } from '@/scheduling/time';

const ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');
const ROLES: readonly TeamRole[] = ['chatter', 'manager'];
const STEP_TITLES = ['Qui', 'Où', 'Taux'] as const;
const EmailSchema = z.email();

interface Draft {
  firstName: string;
  lastName: string;
  displayName: string;
  /** The team name follows the first name until it is typed by hand. */
  displayTouched: boolean;
  email: string;
  teamRole: TeamRole;
  country: string;
  timeZone: string;
  zoneOpen: boolean;
  joinedOn: string;
  presetId: string | null;
  /** « Autre » picked: the rate is typed by hand. */
  byHand: boolean;
  rate: string;
  teamShare: string;
  creatorIds: string[];
}

const EMPTY = (): Draft => ({
  firstName: '',
  lastName: '',
  displayName: '',
  displayTouched: false,
  email: '',
  teamRole: 'chatter',
  country: 'BJ',
  timeZone: suggestedZone('BJ') ?? 'Africa/Porto-Novo',
  zoneOpen: false,
  joinedOn: today(),
  presetId: null,
  byHand: false,
  rate: '',
  teamShare: '',
  creatorIds: [],
});

type Problems = Partial<
  Record<
    'firstName' | 'lastName' | 'displayName' | 'email' | 'timeZone' | 'joinedOn' | 'rate' | 'teamShare',
    string
  >
>;

/** What stops a step, field by field, in French; empty when the step can go on. */
export function problemsOf(step: number, draft: Draft): Problems {
  const problems: Problems = {};
  if (step === 0) {
    if (draft.firstName.trim() === '') problems.firstName = 'Indique son prénom.';
    if (draft.lastName.trim() === '') problems.lastName = 'Indique son nom.';
    if (draft.displayName.trim() === '') problems.displayName = 'Indique le nom que voit l’équipe.';
    if (!EmailSchema.safeParse(draft.email.trim()).success) problems.email = 'Une adresse e-mail complète.';
  }
  if (step === 1) {
    if (!TimezoneSchema.safeParse(draft.timeZone.trim()).success)
      problems.timeZone = 'Ce fuseau n’existe pas. Choisis-en un dans la liste.';
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.joinedOn)) problems.joinedOn = 'Une date d’arrivée.';
  }
  if (step === 2) {
    if (draft.presetId === null && parseRate(draft.rate) === null)
      problems.rate = 'Un préréglage, ou un taux entre 0 et 100 %, par exemple 12,5.';
    if (draft.teamRole === 'manager' && draft.teamShare.trim() !== '' && parseRate(draft.teamShare) === null)
      problems.teamShare = 'Une part entre 0 et 100 %, ou rien.';
  }
  return problems;
}

/**
 * Adds a member in one panel and three short steps (EQ-01: « jamais un mur de champs »): who he is, where he lives
 * (the zone follows the country), his rate and his creators. Then the link to send him (EQ-10).
 */
export function AddMemberPanel({
  presets,
  creators,
  onClose,
}: {
  presets: readonly CommissionPreset[];
  creators: readonly CreatorSummary[];
  /** With the new member once he exists, so the list opens him; null when nothing was added. */
  onClose: (created: TeamMember | null) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<Problems>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<{ member: TeamMember; link: InvitationLinkCreated | null } | null>(
    null,
  );

  const change = (patch: Partial<Draft>): void => {
    setDraft((before) => {
      const next = { ...before, ...patch };
      if (patch.firstName !== undefined && !before.displayTouched) next.displayName = patch.firstName;
      if (patch.country !== undefined) {
        const zone = suggestedZone(patch.country);
        if (zone !== null) next.timeZone = zone;
        next.zoneOpen = zone === null;
      }
      return next;
    });
  };

  const close = (): void => {
    if (!busy) onClose(created?.member ?? null);
  };

  // Each step on its first field; once added, on « Copier le message », the gesture expected next (EQ-12).
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(created === null ? 'input, select' : 'button.tm-primary')
      ?.focus();
  }, [step, created]);

  // A step that cannot go on puts the focus on its first problem.
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [shown]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || dialog.current === null) return;
    const focusable = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input, select, textarea',
      ),
    ];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const next = (): void => {
    const problems = problemsOf(step, draft);
    setShown(problems);
    if (Object.keys(problems).length > 0) return;
    if (step < 2) setStep(step + 1);
    else void submit();
  };

  const submit = async (): Promise<void> => {
    const rate = parseRate(draft.rate);
    const share = draft.teamRole === 'manager' ? parseRate(draft.teamShare) : null;
    const body = CreateTeamMemberBodySchema.safeParse({
      email: draft.email.trim(),
      firstName: draft.firstName,
      lastName: draft.lastName,
      displayName: draft.displayName,
      teamRole: draft.teamRole,
      country: draft.country,
      timeZone: draft.timeZone.trim(),
      joinedOn: draft.joinedOn,
      creatorIds: draft.creatorIds,
      commission: draft.presetId === null ? { rateBps: rate } : { presetId: draft.presetId },
      teamShareBps: share,
    });
    if (!body.success) {
      setFailure('Une information ne va pas. Reprends les étapes.');
      return;
    }
    setBusy(true);
    setFailure(null);
    const outcome = await createMember(body.data);
    if (outcome.kind !== 'ok') {
      setBusy(false);
      if (outcome.kind === 'refused' && outcome.code === 'member_conflict') {
        setStep(0);
        setShown({ email: ERROR_MESSAGES.member_conflict });
      } else {
        setFailure(
          outcome.kind === 'refused'
            ? ERROR_MESSAGES[outcome.code]
            : 'Personne n’a été ajouté : le serveur ne répond pas. Réessaie dans un instant.',
        );
      }
      return;
    }
    await client.invalidateQueries({ queryKey: MEMBERS_KEY });
    // The link next; asking for the password, or a server that fails here, leaves the button to try again.
    const link = await createInvitationLink(outcome.value.id, 'invitation');
    setBusy(false);
    setCreated({ member: outcome.value, link: link.kind === 'ok' ? link.value : null });
    if (link.kind === 'ok') await client.invalidateQueries({ queryKey: MEMBERS_KEY });
  };

  return createPortal(
    <div
      className="tm-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        className="nv-glass nv-glass--float tm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
      >
        <header className="tm-dialog__head">
          <div className="tm-dialog__title">
            <h2 id={`${id}-title`}>
              {created === null ? 'Nouveau membre' : `${created.member.displayName} est dans l’équipe`}
            </h2>
            {created === null ? (
              <ol className="tm-steps" aria-label="Étapes">
                {STEP_TITLES.map((title, index) => (
                  <li
                    key={title}
                    data-state={index < step ? 'done' : index === step ? 'now' : 'later'}
                    aria-current={index === step ? 'step' : undefined}
                  >
                    <span className="tm-steps__num">{String(index + 1)}</span>
                    {title}
                  </li>
                ))}
              </ol>
            ) : (
              <p>Envoie-lui son lien : il y choisira son mot de passe.</p>
            )}
          </div>
          <button type="button" className="tm-close" aria-label="Fermer" disabled={busy} onClick={close}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {created !== null ? (
          <div className="tm-dialog__body nv-swap" key="done">
            <ShareLink
              memberId={created.member.id}
              name={created.member.displayName}
              purpose="invitation"
              label="Créer son lien"
              initial={created.link}
              primary
            />
            <div className="tm-dialog__foot">
              <button type="button" className="nv-btn nv-btn--plain" onClick={close}>
                Voir sa fiche
              </button>
            </div>
          </div>
        ) : (
          <form
            className="tm-dialog__body nv-swap"
            key={step}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
          >
            {step === 0 ? <Who id={id} draft={draft} problems={shown} onChange={change} /> : null}
            {step === 1 ? <Where id={id} draft={draft} problems={shown} onChange={change} /> : null}
            {step === 2 ? (
              <Rate
                id={id}
                draft={draft}
                problems={shown}
                presets={presets}
                creators={creators}
                onChange={change}
              />
            ) : null}
            {failure === null ? null : (
              <p className="tm-warn nv-swap" role="alert">
                {failure}
              </p>
            )}
            <div className="tm-dialog__foot">
              {step === 0 ? (
                <button type="button" className="nv-btn nv-btn--plain" onClick={close}>
                  Annuler
                </button>
              ) : (
                <button
                  type="button"
                  className="nv-btn nv-btn--plain"
                  disabled={busy}
                  onClick={() => {
                    setShown({});
                    setStep(step - 1);
                  }}
                >
                  Retour
                </button>
              )}
              <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
                {step < 2
                  ? 'Continuer'
                  : busy
                    ? 'Ajout…'
                    : `Ajouter ${draft.displayName.trim() === '' ? 'le membre' : draft.displayName.trim()}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface StepProps {
  id: string;
  draft: Draft;
  problems: Problems;
  onChange: (patch: Partial<Draft>) => void;
}

function Field({
  id,
  label,
  hint,
  problem,
  children,
}: {
  id?: string | undefined;
  label: string;
  hint?: ReactNode;
  problem?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="nv-field tm-field" data-invalid={problem === undefined ? undefined : 'true'}>
      {id === undefined ? (
        <span className="nv-field__label">{label}</span>
      ) : (
        <label className="nv-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {problem === undefined ? (
        hint === undefined ? null : (
          <span className="tm-hint">{hint}</span>
        )
      ) : (
        <span className="tm-hint tm-hint--error" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}

function Who({ id, draft, problems, onChange }: StepProps): JSX.Element {
  return (
    <>
      <div className="tm-pair">
        <Field id={`${id}-first`} label="Prénom" problem={problems.firstName}>
          <input
            id={`${id}-first`}
            className="nv-field__control nv-glass"
            value={draft.firstName}
            maxLength={80}
            autoComplete="off"
            aria-invalid={problems.firstName !== undefined}
            onChange={(event) => {
              onChange({ firstName: event.target.value });
            }}
          />
        </Field>
        <Field id={`${id}-last`} label="Nom" problem={problems.lastName}>
          <input
            id={`${id}-last`}
            className="nv-field__control nv-glass"
            value={draft.lastName}
            maxLength={80}
            autoComplete="off"
            aria-invalid={problems.lastName !== undefined}
            onChange={(event) => {
              onChange({ lastName: event.target.value });
            }}
          />
        </Field>
      </div>
      <Field
        id={`${id}-display`}
        label="Nom dans l’équipe"
        hint="Celui du planning et des passations."
        problem={problems.displayName}
      >
        <input
          id={`${id}-display`}
          className="nv-field__control nv-glass"
          value={draft.displayName}
          maxLength={80}
          autoComplete="off"
          aria-invalid={problems.displayName !== undefined}
          onChange={(event) => {
            onChange({ displayName: event.target.value, displayTouched: true });
          }}
        />
      </Field>
      <Field
        id={`${id}-email`}
        label="E-mail"
        hint="Son identifiant pour se connecter. Nirvana ne lui écrit pas."
        problem={problems.email}
      >
        <input
          id={`${id}-email`}
          className="nv-field__control nv-glass"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft.email}
          aria-invalid={problems.email !== undefined}
          onChange={(event) => {
            onChange({ email: event.target.value });
          }}
        />
      </Field>
      <Field label="Rôle">
        <div className="tm-choices" role="radiogroup" aria-label="Rôle">
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="radio"
              className="nv-chip"
              aria-checked={draft.teamRole === role}
              onClick={() => {
                onChange({ teamRole: role });
              }}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function Where({ id, draft, problems, onChange }: StepProps): JSX.Element {
  const zoneValid = TimezoneSchema.safeParse(draft.timeZone.trim()).success;
  return (
    <>
      <Field
        id={`${id}-country`}
        label="Pays"
        hint="Il propose le fuseau et, plus tard, le régime de ses factures."
      >
        <select
          id={`${id}-country`}
          className="nv-field__control nv-glass tm-select"
          value={draft.country}
          onChange={(event) => {
            onChange({ country: event.target.value });
          }}
        >
          <optgroup label="Les plus fréquents">
            {FIRST_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {`${countryFlag(code)}  ${countryName(code)}`}
              </option>
            ))}
          </optgroup>
          <optgroup label="Tous les pays">
            {OTHER_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {`${countryFlag(country.code)}  ${country.name}`}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      <Field
        id={draft.zoneOpen ? `${id}-zone` : undefined}
        label="Fuseau horaire"
        problem={problems.timeZone}
      >
        {draft.zoneOpen ? (
          <>
            <input
              id={`${id}-zone`}
              className="nv-field__control nv-glass"
              value={draft.timeZone}
              list={`${id}-zones`}
              aria-invalid={problems.timeZone !== undefined}
              onChange={(event) => {
                onChange({ timeZone: event.target.value });
              }}
            />
            <datalist id={`${id}-zones`}>
              {ZONES.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </>
        ) : (
          <div className="tm-zone nv-swap">
            <span className="tm-zone__time">{localTime(draft.timeZone)}</span>
            <span className="tm-zone__name">là-bas en ce moment · {cityOf(draft.timeZone)}</span>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                onChange({ zoneOpen: true });
              }}
            >
              Changer
            </button>
          </div>
        )}
        {draft.zoneOpen && zoneValid ? (
          <span className="tm-hint">Il est {localTime(draft.timeZone.trim())} là-bas.</span>
        ) : null}
      </Field>
      <Field id={`${id}-joined`} label="Dans l’équipe depuis" problem={problems.joinedOn}>
        <input
          id={`${id}-joined`}
          className="nv-field__control nv-glass tm-date"
          type="date"
          value={draft.joinedOn}
          aria-invalid={problems.joinedOn !== undefined}
          onChange={(event) => {
            onChange({ joinedOn: event.target.value });
          }}
        />
      </Field>
    </>
  );
}

function Rate({
  id,
  draft,
  problems,
  presets,
  creators,
  onChange,
}: StepProps & { presets: readonly CommissionPreset[]; creators: readonly CreatorSummary[] }): JSX.Element {
  const byHand = presets.length === 0 || draft.byHand;
  return (
    <>
      <Field
        id={presets.length === 0 ? `${id}-rate` : undefined}
        label="Commission"
        hint={`${presets.length === 0 ? 'Aucun préréglage pour l’instant : saisis son taux. ' : ''}Il part de son arrivée ; un taux suivant partira d’un 1er ou d’un 16.`}
        problem={problems.rate}
      >
        {presets.length === 0 ? null : (
          <div className="tm-presets" role="radiogroup" aria-label="Préréglage de commission">
            {presets.map((preset, i) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                className="tm-preset nv-enter"
                style={{ '--nv-i': i }}
                aria-checked={draft.presetId === preset.id}
                onClick={() => {
                  onChange({ presetId: preset.id, byHand: false });
                }}
              >
                <span className="tm-preset__name">{preset.name}</span>
                <span className="tm-preset__rate">{formatRate(preset.rateBps)}</span>
              </button>
            ))}
            <button
              type="button"
              role="radio"
              className="tm-preset nv-enter"
              style={{ '--nv-i': presets.length }}
              aria-checked={byHand}
              onClick={() => {
                onChange({ presetId: null, byHand: true });
              }}
            >
              <span className="tm-preset__name">Autre</span>
              <span className="tm-preset__rate tm-preset__rate--word">À la main</span>
            </button>
          </div>
        )}
        {byHand ? (
          <span className="tm-percent nv-swap">
            <input
              id={`${id}-rate`}
              className="nv-field__control nv-glass"
              inputMode="decimal"
              placeholder="12,5"
              aria-label={presets.length === 0 ? undefined : 'Taux à la main'}
              aria-invalid={problems.rate !== undefined}
              value={draft.rate}
              onChange={(event) => {
                onChange({ rate: event.target.value });
              }}
            />
            <span aria-hidden="true">%</span>
          </span>
        ) : null}
      </Field>
      {draft.teamRole === 'manager' ? (
        <Field
          id={`${id}-share`}
          label="Part du net de l’équipe"
          hint="Ce qu’il touche sur le net de son équipe, en plus de ses ventes. Laisse vide s’il n’en a pas."
          problem={problems.teamShare}
        >
          <span className="tm-percent">
            <input
              id={`${id}-share`}
              className="nv-field__control nv-glass"
              inputMode="decimal"
              placeholder="5"
              aria-invalid={problems.teamShare !== undefined}
              value={draft.teamShare}
              onChange={(event) => {
                onChange({ teamShare: event.target.value });
              }}
            />
            <span aria-hidden="true">%</span>
          </span>
        </Field>
      ) : null}
      <Field
        label="Créatrices"
        hint={
          creators.length === 0 ? 'Aucune créatrice pour l’instant.' : 'Celles sur lesquelles il travaille.'
        }
      >
        {creators.length === 0 ? null : (
          <div className="tm-choices" role="group" aria-label="Créatrices">
            {creators.map((creator) => {
              const on = draft.creatorIds.includes(creator.id);
              return (
                <button
                  key={creator.id}
                  type="button"
                  className="nv-chip"
                  aria-pressed={on}
                  onClick={() => {
                    onChange({
                      creatorIds: on
                        ? draft.creatorIds.filter((idOf) => idOf !== creator.id)
                        : [...draft.creatorIds, creator.id],
                    });
                  }}
                >
                  {creator.displayName}
                </button>
              );
            })}
          </div>
        )}
      </Field>
    </>
  );
}
