import {
  LINK_DESTINATION_MAX,
  LINK_PLACEMENTS,
  LINK_USAGE_NOTE_MAX,
  REDIRECT_LINKS_MAX,
  type AgencyRedirectLink,
  type LinkPlacement,
  type LinkProposal,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { detectLinks, linksQueryKey, saveRedirectLink, useRedirectLinks, type DetectOutcome } from './api';
import { linkProblems, middleCut, PLACEMENT_LABELS } from './model';

import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Dialog } from '@/shell/Dialog';
import { Select } from '@/shell/Select';
import { Failure } from '@/shell/states';

import './links.css';

const PLACEMENT_OPTIONS = LINK_PLACEMENTS.map((value) => ({ value, label: PLACEMENT_LABELS[value] }));

interface Draft {
  readonly name: string;
  readonly url: string;
  readonly destination: string;
  readonly placement: LinkPlacement | '';
  readonly usageNote: string;
  readonly enabled: boolean;
}

const BLANK: Draft = { name: '', url: '', destination: '', placement: '', usageNote: '', enabled: true };

const writeOf = (draft: Draft) => ({
  name: draft.name.trim(),
  url: draft.url.trim(),
  destination: draft.destination.trim(),
  placement: draft.placement === '' ? null : draft.placement,
  usageNote: draft.usageNote.trim(),
  enabled: draft.enabled,
});

/**
 * Créatrices › Liens (INS-03, ADR 0121 § 1): her redirect links, where each is placed and the sentence she reads in
 * « Mes liens ». A link is never removed: it is switched off. One that has no place yet is « à renseigner »: she does
 * not see it and nothing is counted on it.
 */
export function LinksSection({
  creatorId,
  creatorName,
  canEdit,
}: {
  creatorId: string;
  creatorName: string;
  /** The owner alone sets a link: an address decides where her readers land (ADR 0080 § 6). A manager reads. */
  canEdit: boolean;
}): JSX.Element {
  const read = useRedirectLinks(creatorId);
  const client = useQueryClient();
  const [editing, setEditing] = useState<AgencyRedirectLink | LinkProposal | 'new' | null>(null);
  /** What « Détecter ses liens » last answered; null until the owner asks. */
  const [detected, setDetected] = useState<DetectOutcome | 'busy' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The switch waiting for the password and the code: it keeps its state until then, and « Annuler » leaves it. */
  const [pending, setPending] = useState<{ link: AgencyRedirectLink; enabled: boolean } | null>(null);
  const links = read.data;
  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: linksQueryKey(creatorId) });

  async function toggle(link: AgencyRedirectLink, enabled: boolean): Promise<void> {
    setBusyId(link.id);
    setFailed(null);
    const { id, ...write } = link;
    const outcome = await saveRedirectLink(creatorId, id, { ...write, enabled });
    if (outcome.kind === 'refused') setFailed(outcome.message);
    if (outcome.kind === 'reauth') setPending({ link, enabled });
    await refresh();
    setBusyId(null);
  }

  if (links === undefined) {
    return read.isError ? (
      <Failure onRetry={() => void read.refetch()} />
    ) : (
      <div className="nv-plate ps-panel cl-loading" aria-busy="true" aria-label="Lecture de ses liens" />
    );
  }

  return (
    <div className="nv-plate ps-panel">
      <section className="ps-block" aria-labelledby="cl-title">
        <h3 className="nv-h3 ps-block__title" id="cl-title">
          Ses liens
        </h3>
        <p className="ps-lead">
          Chaque lien a un endroit et une phrase d’usage : c’est ce que {creatorName} lit dans{' '}
          {'«\u00a0Mes liens\u00a0»'}, avec un bouton pour le copier. Un lien éteint ou sans endroit ne lui
          est pas montré.
        </p>
        {links.length === 0 ? (
          <p className="ps-hint">
            {canEdit ? 'Aucun lien pour l’instant. Ajoute le premier.' : 'Aucun lien pour l’instant.'}
          </p>
        ) : (
          <ul className="cl-list" aria-label="Liens de redirection">
            {links.map((link) => (
              <li key={link.id} className="cl-row" data-off={link.enabled ? undefined : 'true'}>
                <div className="cl-row__main">
                  <p className="cl-row__name">{link.name}</p>
                  <p className="cl-row__address">{middleCut(link.url, 48)}</p>
                  {link.usageNote === '' ? null : <p className="cl-row__note">{link.usageNote}</p>}
                </div>
                {link.placement === null ? (
                  <span className="cl-row__todo">
                    <span className="cl-row__dot" aria-hidden="true" />
                    Endroit à renseigner
                  </span>
                ) : (
                  <span className="nv-tag nv-tag--declared">{PLACEMENT_LABELS[link.placement]}</span>
                )}
                {canEdit ? (
                  <>
                    <label className="cl-row__switch">
                      <span>{link.enabled ? 'Allumé' : 'Éteint'}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        className="nv-switch"
                        checked={link.enabled}
                        disabled={busyId === link.id}
                        aria-label={`Lien « ${link.name} » : ${link.enabled ? 'allumé' : 'éteint'}`}
                        onChange={(event) => {
                          void toggle(link, event.target.checked);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="nv-btn nv-btn--soft nv-btn--sm"
                      aria-label={`Modifier le lien « ${link.name} »`}
                      onClick={() => {
                        setEditing(link);
                      }}
                    >
                      Modifier
                    </button>
                  </>
                ) : (
                  <span className="cl-row__state">{link.enabled ? 'Allumé' : 'Éteint'}</span>
                )}
                {pending?.link.id === link.id ? (
                  <div className="cl-row__confirm">
                    <PasswordPrompt
                      lead={`Pour ${pending.enabled ? 'allumer' : 'éteindre'} « ${link.name} », confirme ton mot de passe et ton code.`}
                      onConfirmed={() => {
                        const { enabled } = pending;
                        setPending(null);
                        void toggle(link, enabled);
                      }}
                      onCancel={() => {
                        setPending(null);
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {failed === null ? null : (
          <p className="ps-error" role="alert">
            {failed}
          </p>
        )}
        {!canEdit ? (
          <p className="ps-hint">Seul le propriétaire ajoute ou modifie un lien.</p>
        ) : links.length >= REDIRECT_LINKS_MAX ? (
          <p className="ps-hint">{String(REDIRECT_LINKS_MAX)} liens au plus.</p>
        ) : (
          <div className="cl-actions">
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setEditing('new');
              }}
            >
              <span aria-hidden="true">+</span> Ajouter un lien
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={detected === 'busy'}
              aria-busy={detected === 'busy'}
              onClick={() => {
                setDetected('busy');
                void detectLinks(creatorId).then(setDetected);
              }}
            >
              {detected === 'busy' ? 'Lecture du service…' : 'Détecter ses liens'}
            </button>
          </div>
        )}
        {canEdit && detected !== null && detected !== 'busy' ? (
          <Detected
            outcome={detected}
            creatorName={creatorName}
            links={links}
            isFull={links.length >= REDIRECT_LINKS_MAX}
            onAdd={setEditing}
            onClose={() => {
              setDetected(null);
            }}
          />
        ) : null}
      </section>
      {editing === null ? null : (
        <LinkDialog
          creatorId={creatorId}
          link={editing === 'new' || 'ref' in editing ? null : editing}
          proposal={editing !== 'new' && 'ref' in editing ? editing : null}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={async () => {
            await refresh();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * What the redirect service lists that she does not have yet. The account is the agency's and its list crosses
 * creators: nothing is added by itself, the owner picks hers one by one and each goes through the dialog.
 */
function Detected({
  outcome,
  creatorName,
  links,
  isFull,
  onAdd,
  onClose,
}: {
  outcome: DetectOutcome;
  creatorName: string;
  links: readonly AgencyRedirectLink[];
  isFull: boolean;
  onAdd: (proposal: LinkProposal) => void;
  onClose: () => void;
}): JSX.Element {
  if (outcome.kind === 'refused') {
    return (
      <div className="cl-detected" role="alert">
        <p className="cl-detected__refusal">
          <span className="cl-row__dot" aria-hidden="true" />
          {outcome.message}
        </p>
        {outcome.needsKey ? (
          <Link to="/reglages/ventes" className="nv-btn nv-btn--soft nv-btn--sm ps-self-start">
            Ouvrir Réglages › Plateformes
          </Link>
        ) : null}
      </div>
    );
  }
  // A link added since the reading leaves the list at once: her links are read again after each save.
  const kept = new Set(links.map((link) => link.url));
  const fresh = outcome.proposals.filter((one) => one.knownAs === null && !kept.has(one.url));
  const known = outcome.proposals.length - fresh.length;
  return (
    <div className="cl-detected" aria-live="polite">
      <div className="cl-detected__head">
        <h4 className="nv-h3 cl-detected__title">
          {fresh.length === 0
            ? 'Rien de nouveau'
            : `${String(fresh.length)} ${fresh.length === 1 ? 'lien trouvé' : 'liens trouvés'}`}
        </h4>
        <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={onClose}>
          Fermer
        </button>
      </div>
      <p className="ps-hint">
        {fresh.length === 0
          ? outcome.proposals.length === 0
            ? 'Le compte de l’agence n’a aucun lien pour l’instant.'
            : `Les ${String(known)} liens du compte sont déjà dans les siens.`
          : `Lus dans le service de liens, sur tout le compte de l’agence : n’ajoute que ceux de ${creatorName}. Rien n’est ajouté tant que tu n’as pas enregistré.`}
      </p>
      {fresh.length === 0 ? null : (
        <ul className="cl-list" aria-label="Liens trouvés dans le service">
          {fresh.map((proposal) => (
            <li key={proposal.ref} className="cl-row cl-row--found">
              <div className="cl-row__main">
                <p className="cl-row__name">{proposal.name}</p>
                <p className="cl-row__address">{middleCut(proposal.url, 48)}</p>
              </div>
              {proposal.placement === null ? null : (
                <span className="nv-tag nv-tag--declared">{PLACEMENT_LABELS[proposal.placement]}</span>
              )}
              <button
                type="button"
                className="nv-btn nv-btn--soft nv-btn--sm"
                disabled={isFull}
                aria-label={`Ajouter le lien « ${proposal.name} »`}
                onClick={() => {
                  onAdd(proposal);
                }}
              >
                Ajouter
              </button>
            </li>
          ))}
        </ul>
      )}
      {fresh.length > 0 && known > 0 ? (
        <p className="ps-hint">
          {known === 1
            ? '1 autre est déjà dans ses liens.'
            : `${String(known)} autres sont déjà dans ses liens.`}
        </p>
      ) : null}
    </div>
  );
}

function LinkDialog({
  creatorId,
  link,
  proposal = null,
  onClose,
  onSaved,
}: {
  creatorId: string;
  link: AgencyRedirectLink | null;
  /** A link found at the service: its name, address and place prefilled, to be corrected then saved as any new link. */
  proposal?: LinkProposal | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(
    link !== null
      ? { ...link, placement: link.placement ?? '' }
      : proposal === null
        ? BLANK
        : { ...BLANK, name: proposal.name, url: proposal.url, placement: proposal.placement ?? '' },
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const problems = tried ? linkProblems(draft) : {};
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((before) => ({ ...before, [key]: value }));
  };

  async function save(): Promise<void> {
    setTried(true);
    if (Object.keys(linkProblems(draft)).length > 0) return;
    setBusy(true);
    setRefusal(null);
    const outcome = await saveRedirectLink(creatorId, link?.id ?? null, writeOf(draft));
    setBusy(false);
    if (outcome.kind === 'refused') setRefusal(outcome.message);
    else if (outcome.kind === 'reauth') setReauth(true);
    else await onSaved();
  }

  function submit(event: SyntheticEvent): void {
    event.preventDefault();
    void save();
  }

  const field = (
    key: 'name' | 'url' | 'destination' | 'usageNote',
    label: string,
    hint: string,
    props: { maxLength: number; placeholder: string; mono?: boolean; autofocus?: boolean },
  ): JSX.Element => (
    <div className="nv-field tm-field" data-invalid={problems[key] === undefined ? undefined : 'true'}>
      <label className="nv-field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className={props.mono === true ? 'nv-field__control nv-glass cl-mono' : 'nv-field__control nv-glass'}
        value={draft[key]}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        autoComplete="off"
        spellCheck={key === 'url' ? false : undefined}
        inputMode={key === 'url' ? 'url' : undefined}
        aria-invalid={problems[key] !== undefined}
        aria-describedby={`${id}-${key}-hint`}
        data-autofocus={props.autofocus === true ? true : undefined}
        onChange={(event) => {
          set(key, event.target.value);
        }}
      />
      <p
        id={`${id}-${key}-hint`}
        className={problems[key] === undefined ? 'tm-hint' : 'tm-hint tm-hint--error'}
      >
        {problems[key] ?? hint}
      </p>
    </div>
  );

  return (
    <Dialog
      title={link === null ? 'Nouveau lien' : `Modifier « ${link.name} »`}
      lead="Ce qu’elle lira dans « Mes liens » : le nom, l’endroit et la phrase d’usage."
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        {field('name', 'Nom', 'Court, comme elle le dirait : « Story du jour ».', {
          maxLength: 60,
          placeholder: 'Story du jour',
          autofocus: true,
        })}
        {field('url', 'Adresse', 'L’adresse complète du lien de redirection.', {
          maxLength: 2048,
          placeholder: 'https://…',
          mono: true,
        })}
        {field('destination', 'Où il mène', 'Pour les posts du canal : l’endroit en mots, sans adresse.', {
          maxLength: LINK_DESTINATION_MAX,
          placeholder: 'mon Reveal, mon live ce soir 21 h…',
        })}
        <div className="nv-field tm-field">
          <label className="nv-field__label" htmlFor={`${id}-placement`}>
            Où il est posé
          </label>
          <Select
            id={`${id}-placement`}
            value={draft.placement}
            options={PLACEMENT_OPTIONS}
            placeholder="À renseigner"
            describedBy={`${id}-placement-hint`}
            onChange={(value) => {
              set('placement', value);
            }}
          />
          <p id={`${id}-placement-hint`} className="tm-hint">
            Sans endroit, elle ne le voit pas et rien n’est compté dessus.
          </p>
        </div>
        {field('usageNote', 'Phrase d’usage', 'À quoi il sert et quand le coller, sans adresse.', {
          maxLength: LINK_USAGE_NOTE_MAX,
          placeholder: 'À coller dans ta story du jour',
        })}
        {refusal === null ? null : (
          <p className="tm-hint tm-hint--error" role="alert">
            {refusal}
          </p>
        )}
        {reauth ? (
          <PasswordPrompt
            lead="Pour changer un de ses liens, confirme ton mot de passe et ton code."
            onConfirmed={() => {
              setReauth(false);
              void save();
            }}
            onCancel={() => {
              setReauth(false);
            }}
          />
        ) : null}
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
