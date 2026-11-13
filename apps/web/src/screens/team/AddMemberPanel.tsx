import {
  CreateTeamMemberBodySchema,
  TimezoneSchema,
  type CommissionPreset,
  type CreatorSummary,
  type InvitationLinkCreated,
  type Platform,
  type TeamImportRow,
  type TeamMember,
  type TeamRole,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { z } from 'zod';

import { ShareLink } from './ShareLink';
import { createInvitationLink, createMember, MEMBERS_KEY, type Outcome } from './api';
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
import { chatterName, invitePrefill } from './reveal';

import { localTime } from '@/creators/persona/model';
import { countryFlag, countryName } from '@/lib/country';
import { DayField } from '@/scheduling/DayField';
import { cityOf } from '@/scheduling/time';
import { inviteFromPlatform, teamImportKey, type InviteOutcome } from '@/settings/sales-feed/api';
import { platformName } from '@/settings/sales-feed/shown';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import '@/shell/dialog.css';
import { Select } from '@/shell/Select';
import { useRevealAlerts } from '@/shell/reveal';

const ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');
const ROLES: readonly TeamRole[] = ['chatter', 'manager'];
const STEP_TITLES = ['Qui', 'Où', 'Taux'] as const;
/** The invitation's re-authentication, said under the dialog's title in place of the steps (ADR 0076 § 3). */
const REAUTH_LEAD =
  'Inviter ouvre un compte qui lira des conversations de fans : confirme ton mot de passe et ton code.';
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
  /** The arrival typed is not a day (« 31/02 »): the step does not go on. */
  joinedUnreadable: boolean;
  presetId: string | null;
  /** « Autre » picked: the rate is typed by hand. */
  byHand: boolean;
  rate: string;
  teamShare: string;
  creatorIds: string[];
}

const EMPTY = (prefill?: Partial<Draft>): Draft => ({
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
  joinedUnreadable: false,
  presetId: null,
  byHand: false,
  rate: '',
  teamShare: '',
  creatorIds: [],
  ...prefill,
});

/** A member added or invited, or why not: an invitation may also end on the server's own sentence. */
type Added = Outcome<TeamMember> | { readonly kind: 'said'; readonly message: string };

/** The e-mail is another member's, or the account was linked to someone meanwhile (ADR 0076 § 3). */
const CONFLICT_FROM_PLATFORM =
  'Un membre utilise déjà cet e-mail, ou ce compte vient d’être relié à quelqu’un. Recharge la liste.';

/** An invitation's answer in the words of the panel. */
function asOutcome(outcome: InviteOutcome): Added {
  switch (outcome.kind) {
    case 'ok':
      return { kind: 'ok', value: outcome.member };
    case 'reauth':
      return { kind: 'reauth' };
    case 'conflict':
      return { kind: 'refused', code: 'member_conflict' };
    case 'bounds':
      return {
        kind: 'said',
        message:
          'Ce choix sort de ce qu’un manager peut donner : un chatteur, un préréglage du propriétaire et tes créatrices. Reprends les étapes.',
      };
    case 'team':
      return { kind: 'refused', code: outcome.code };
    case 'refused':
      return { kind: 'said', message: outcome.message };
    case 'session':
      return { kind: 'said', message: 'Ta session a expiré : reconnecte-toi, puis invite-le à nouveau.' };
    case 'failed':
      return { kind: 'failed' };
  }
}

type Problems = Partial<
  Record<
    'firstName' | 'lastName' | 'displayName' | 'email' | 'timeZone' | 'joinedOn' | 'rate' | 'teamShare',
    string
  >
>;

/** What stops a step, field by field, in French; empty when the step can go on. */
export function problemsOf(step: number, draft: Draft, presetsOnly = false): Problems {
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
    if (draft.joinedUnreadable) problems.joinedOn = 'Un jour comme 03/11/2026, ou 3/11.';
    else if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.joinedOn)) problems.joinedOn = 'Une date d’arrivée.';
  }
  if (step === 2) {
    if (presetsOnly && draft.presetId === null) problems.rate = 'Choisis un préréglage du propriétaire.';
    else if (draft.presetId === null && parseRate(draft.rate) === null)
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
  invite,
  onClose,
}: {
  presets: readonly CommissionPreset[];
  /** The creators the adder may give: all for the owner, his own list for a manager inviting (ADR 0076 § 3). */
  creators: readonly CreatorSummary[];
  /**
   * An account of a platform's team to invite (ADR 0076 § 3): its names and e-mail filled in, the member and the
   * link made in one call, the password asked again. A manager invites a chatter at a preset of the owner's only.
   */
  invite?:
    { readonly platform: Platform; readonly row: TeamImportRow; readonly bounded: boolean } | undefined;
  /** With the new member once he exists, so the list opens him; null when nothing was added. */
  onClose: (created: TeamMember | null) => void;
}): JSX.Element {
  const id = useId();
  const client = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useRevealAlerts(scroller);
  const bounded = invite?.bounded === true;
  const [draft, setDraft] = useState<Draft>(() =>
    EMPTY(
      invite === undefined
        ? undefined
        : invitePrefill(
            invite.row,
            creators.map((creator) => creator.id),
          ),
    ),
  );
  /** The invitation waits for the password and the code (ADR 0076 § 3), then goes again. */
  const [asking, setAsking] = useState(false);
  // The link's password asked again: « Voir sa fiche » waits, one way out at a time (GES-13).
  const [linkAsking, setLinkAsking] = useState(false);
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

  // Each step on its first field; once added, on « Copier le message », the gesture expected next (EQ-12). Set in
  // the commit that shows the step, before it is painted: never a frame with the focus elsewhere, and never late.
  useLayoutEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>(created === null ? 'input, select' : 'button.tm-primary')
      ?.focus();
  }, [step, created]);

  // A step that cannot go on puts the focus on its first problem, in the same commit.
  useLayoutEffect(() => {
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
    const problems = problemsOf(step, draft, bounded);
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
    const outcome: Added =
      invite === undefined
        ? await createMember(body.data)
        : asOutcome(
            await inviteFromPlatform(invite.platform, invite.row.chatter.platformChatterId, body.data),
          );
    if (outcome.kind !== 'ok') {
      setBusy(false);
      if (outcome.kind === 'reauth') {
        setAsking(true);
      } else if (outcome.kind === 'refused' && outcome.code === 'member_conflict') {
        setStep(0);
        setShown({ email: invite === undefined ? ERROR_MESSAGES.member_conflict : CONFLICT_FROM_PLATFORM });
      } else {
        setFailure(
          outcome.kind === 'refused'
            ? ERROR_MESSAGES[outcome.code]
            : outcome.kind === 'said'
              ? outcome.message
              : 'Personne n’a été ajouté : le serveur ne répond pas. Réessaie dans un instant.',
        );
      }
      return;
    }
    await client.invalidateQueries({ queryKey: MEMBERS_KEY });
    if (invite !== undefined) await client.invalidateQueries({ queryKey: teamImportKey(invite.platform) });
    // The link next; asking for the password, or a server that fails here, leaves the button to try again.
    const link = await createInvitationLink(outcome.value.id, 'invitation');
    setBusy(false);
    setCreated({ member: outcome.value, link: link.kind === 'ok' ? link.value : null });
    if (link.kind === 'ok') await client.invalidateQueries({ queryKey: MEMBERS_KEY });
  };

  return createPortal(
    <div
      className="tm-scrim tm-scrim--top"
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
        <div ref={scroller} className="tm-dialog__scroll">
          <header className="tm-dialog__head">
            <div className="tm-dialog__title">
              <h2 id={`${id}-title`}>
                {created !== null
                  ? `${created.member.displayName} est dans l’équipe`
                  : invite === undefined
                    ? 'Nouveau membre'
                    : `Inviter ${chatterName(invite.row.chatter)}`}
              </h2>
              {created === null && asking ? (
                <p>{REAUTH_LEAD}</p>
              ) : created === null ? (
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

          {created === null && asking ? (
            <div className="tm-dialog__body nv-swap" key="password">
              <PasswordPrompt
                lead={null}
                layout="dialog"
                onConfirmed={() => {
                  setAsking(false);
                  void submit();
                }}
                onCancel={() => {
                  setAsking(false);
                }}
              />
            </div>
          ) : created !== null ? (
            <div className="tm-dialog__body nv-swap" key="done">
              <ShareLink
                memberId={created.member.id}
                name={created.member.displayName}
                purpose="invitation"
                label="Créer son lien"
                initial={created.link}
                primary
                onAsking={setLinkAsking}
              />
              {linkAsking ? null : (
                <div className="tm-dialog__foot">
                  <button type="button" className="nv-btn nv-btn--plain" onClick={close}>
                    Voir sa fiche
                  </button>
                </div>
              )}
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
              {step === 0 && invite !== undefined ? (
                <p className="tm-hint">
                  Le prénom, le nom et l’e-mail viennent de son compte {platformName(invite.platform)}.
                </p>
              ) : null}
              {step === 0 ? (
                <Who
                  id={id}
                  draft={draft}
                  problems={shown}
                  onChange={change}
                  fromPlatform={invite === undefined ? null : platformName(invite.platform)}
                  roles={bounded ? ['chatter'] : ROLES}
                />
              ) : null}
              {step === 1 ? <Where id={id} draft={draft} problems={shown} onChange={change} /> : null}
              {step === 2 ? (
                <Rate
                  id={id}
                  draft={draft}
                  problems={shown}
                  presets={presets}
                  creators={creators}
                  presetsOnly={bounded}
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
                      ? invite === undefined
                        ? 'Ajout…'
                        : 'Invitation…'
                      : `${invite === undefined ? 'Ajouter' : 'Inviter'} ${draft.displayName.trim() === '' ? 'le membre' : draft.displayName.trim()}`}
                </button>
              </div>
            </form>
          )}
        </div>
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

function Who({
  id,
  draft,
  problems,
  onChange,
  fromPlatform,
  roles,
}: StepProps & {
  /** The platform the e-mail comes from: it is the account's, and stays as it is. */
  fromPlatform: string | null;
  roles: readonly TeamRole[];
}): JSX.Element {
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
        hint={
          fromPlatform === null
            ? 'Son identifiant pour se connecter. Impera ne lui écrit pas.'
            : `Celui de son compte ${fromPlatform}, et son identifiant pour se connecter. Impera ne lui écrit pas.`
        }
        problem={problems.email}
      >
        <input
          id={`${id}-email`}
          className="nv-field__control nv-glass"
          type="email"
          inputMode="email"
          autoComplete="off"
          readOnly={fromPlatform !== null}
          value={draft.email}
          aria-invalid={problems.email !== undefined}
          onChange={(event) => {
            onChange({ email: event.target.value });
          }}
        />
      </Field>
      {roles.length < 2 ? null : (
        <Field label="Rôle">
          <div className="tm-choices" role="radiogroup" aria-label="Rôle">
            {roles.map((role) => (
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
      )}
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
        <Select
          id={`${id}-country`}
          value={draft.country}
          searchLabel="Chercher un pays"
          empty="Aucun pays ne correspond."
          options={[
            ...FIRST_COUNTRIES.map((code) => ({
              value: code,
              label: `${countryFlag(code)}  ${countryName(code)}`,
              group: 'Les plus fréquents',
            })),
            ...OTHER_COUNTRIES.map((country) => ({
              value: country.code,
              label: `${countryFlag(country.code)}  ${country.name}`,
              group: 'Tous les pays',
            })),
          ]}
          onChange={(country) => {
            onChange({ country });
          }}
        />
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
        <DayField
          id={`${id}-joined`}
          value={draft.joinedOn}
          toward="year"
          invalid={problems.joinedOn !== undefined}
          onChange={(next) => {
            onChange({ joinedOn: next });
          }}
          onUnreadable={(bad) => {
            onChange({ joinedUnreadable: bad });
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
  presetsOnly,
  onChange,
}: StepProps & {
  presets: readonly CommissionPreset[];
  creators: readonly CreatorSummary[];
  /** A manager inviting: a preset of the owner's only, never a rate by hand (ADR 0076 § 3). */
  presetsOnly: boolean;
}): JSX.Element {
  const byHand = !presetsOnly && (presets.length === 0 || draft.byHand);
  return (
    <>
      <Field
        id={byHand && presets.length === 0 ? `${id}-rate` : undefined}
        label="Commission"
        hint={
          presetsOnly
            ? presets.length === 0
              ? 'Aucun préréglage pour l’instant : le propriétaire en crée un, puis tu l’invites.'
              : 'Un préréglage du propriétaire. Il part de son arrivée.'
            : `${presets.length === 0 ? 'Aucun préréglage pour l’instant : saisis son taux. ' : ''}Il part de son arrivée ; un taux suivant partira d’un 1er ou d’un 16.`
        }
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
            {presetsOnly ? null : (
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
            )}
          </div>
        )}
        {byHand ? (
          <span className="tm-percent nv-swap">
            <input
              id={`${id}-rate`}
              className="nv-field__control nv-glass"
              inputMode="decimal"
              placeholder="12,5"
              aria-label={presets.length === 0 ? undefined : 'Taux à la main, en %'}
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
          creators.length === 0
            ? presetsOnly
              ? 'Aucune créatrice dans ta liste.'
              : 'Aucune créatrice pour l’instant.'
            : presetsOnly
              ? 'Parmi les tiennes : celles sur lesquelles il travaille.'
              : 'Celles sur lesquelles il travaille.'
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
