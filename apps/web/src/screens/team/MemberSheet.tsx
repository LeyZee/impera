import type { CommissionPreset, CreatorSummary, TeamMember } from '@nirvana/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { EditMemberPanel, RatePanel, StatusPanel } from './EditMember';
import { ShareLink } from './ShareLink';
import { addNote, useNotes, useRates } from './api';
import {
  creatorNames,
  deadline,
  ERROR_MESSAGES,
  formatRate,
  invitationState,
  longDay,
  noteDay,
  rateAhead,
  ROLE_LABELS,
} from './model';
import { Avatar, StatusPill } from './parts';

import { localTime } from '@/creators/persona/model';
import { countryFlag, countryName } from '@/lib/country';
import { cityOf } from '@/scheduling/time';
import { useAgencyToday } from '@/screens/pay/data';

/** Arrived less than this many days ago: the « Nouveau » badge of Imperium. */
const NEW_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * One member, read on the right of the list: who they are, their city and hour in one line, their creators, their
 * rate, their first access, and the internal notes the member never reads.
 */
export function MemberSheet({
  member,
  presets,
  creators,
  canManage,
  isSelf,
  onClose,
}: {
  member: TeamMember;
  presets: readonly CommissionPreset[];
  creators: readonly CreatorSummary[];
  canManage: boolean;
  /** His own record: the notes about him are never his to read (the server answers 403). */
  isSelf: boolean;
  onClose: () => void;
}): JSX.Element {
  const now = new Date();
  const theirs = creatorNames(member, creators);
  const arrivedDays = (now.getTime() - new Date(`${member.joinedOn}T12:00:00`).getTime()) / DAY_MS;
  const preset = presets.find((p) => p.id === member.commission?.presetId);
  const access = invitationState(member, now);
  const gone = member.status === 'left';
  // A share counts for a manager only (pay ignores a chatter's): a manager who became a chatter shows none.
  const share = member.teamRole === 'manager' ? (member.commission?.teamShareBps ?? null) : null;
  // A rate set ahead shows from the day it is saved, not only once it starts (Équipe, #318).
  const today = useAgencyToday();
  const rates = useRates(member.id, !gone);
  const ahead = today === null ? null : rateAhead(rates.data ?? [], today);
  const [editing, setEditing] = useState<'member' | 'rate' | 'status' | null>(null);
  const close = (): void => {
    setEditing(null);
  };

  return (
    <section className="nv-plate tm-sheet nv-enter" aria-label={member.displayName}>
      <button type="button" className="nv-btn nv-btn--plain nv-btn--sm tm-back" onClick={onClose}>
        Équipe
      </button>
      <header className="tm-sheet__head">
        <Avatar member={member} large />
        <div className="tm-sheet__who">
          <h2>{member.displayName}</h2>
          <p>
            {member.firstName} {member.lastName} · {ROLE_LABELS[member.teamRole]}
            {arrivedDays >= 0 && arrivedDays < NEW_DAYS ? <span className="tm-new">Nouveau</span> : null}
          </p>
          {/* Where and what hour, one small line: the team is mostly one hour apart (EQ-08). */}
          <p className="tm-sheet__where">
            <span aria-hidden="true">{countryFlag(member.country)} </span>
            {cityOf(member.timeZone)} · <span className="nv-num">{localTime(member.timeZone, now)}</span>
          </p>
          <StatusPill member={member} />
        </div>
        <button type="button" className="tm-close" aria-label="Fermer la fiche" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      {/* What changes once a member is in: the owner's, and nothing for one who left (EQ-10). */}
      {canManage && !gone ? (
        <div className="tm-sheet__actions nv-enter">
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setEditing('member');
            }}
          >
            Modifier
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setEditing('rate');
            }}
          >
            Changer le taux
          </button>
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setEditing('status');
            }}
          >
            Changer le statut
          </button>
        </div>
      ) : null}

      <div className="tm-figures">
        <div className="tm-figure nv-enter" style={{ '--nv-i': 1 }}>
          <span className="nv-figure__label">Commission</span>
          <span className="tm-figure__value">
            {member.commission === null ? '—' : formatRate(member.commission.rateBps)}
          </span>
          <span className="tm-figure__note">
            {member.commission === null
              ? 'Pas encore de taux'
              : `${preset === undefined ? 'Taux à la main' : preset.name} · depuis le ${longDay(member.commission.effectiveFrom)}`}
          </span>
          {ahead === null ? null : (
            <span className="tm-figure__note tm-figure__ahead">
              {formatRate(ahead.rateBps)} à partir du {longDay(ahead.effectiveFrom)}
            </span>
          )}
        </div>
        {share === null ? null : (
          <div className="tm-figure nv-enter" style={{ '--nv-i': 2 }}>
            <span className="nv-figure__label">Part de l’équipe</span>
            <span className="tm-figure__value">{formatRate(share)}</span>
            <span className="tm-figure__note">du net de l’équipe</span>
          </div>
        )}
      </div>

      <dl className="tm-facts nv-enter" style={{ '--nv-i': 3 }}>
        <div>
          <dt>Créatrices</dt>
          <dd>
            {theirs.length === 0 ? (
              <span className="tm-muted">Aucune créatrice confiée</span>
            ) : (
              <span className="nv-tags">
                {theirs.map((creator) => (
                  <span key={creator} className="nv-tag nv-tag--declared">
                    {creator}
                  </span>
                ))}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>E-mail</dt>
          <dd className="tm-mail">{member.email}</dd>
        </div>
        <div>
          <dt>Pays</dt>
          <dd>{countryName(member.country)}</dd>
        </div>
        <div>
          <dt>Dans l’équipe depuis</dt>
          <dd>{longDay(member.joinedOn)}</dd>
        </div>
      </dl>

      {/* Where his work is: the record is not a dead end (EQ-11). Right under the facts, above the notes that grow. */}
      <nav
        className="tm-sheet__links nv-enter"
        style={{ '--nv-i': 4 }}
        aria-label={`Le travail de ${member.displayName}`}
      >
        <Link
          to="/equipe/planning"
          search={{ membre: member.id }}
          className="nv-btn nv-btn--plain nv-btn--sm"
        >
          Ses shifts
        </Link>
        <Link
          to="/equipe/rapports"
          search={{ membre: member.id }}
          className="nv-btn nv-btn--plain nv-btn--sm"
        >
          Ses rapports
        </Link>
        <Link to="/paie/quinzaine" search={{ membre: member.id }} className="nv-btn nv-btn--plain nv-btn--sm">
          Son relevé
        </Link>
      </nav>

      {gone ? null : (
        <section className="tm-block nv-enter" style={{ '--nv-i': 5 }} aria-label="Accès">
          <h3>Accès</h3>
          <p className="tm-hint">
            {access.kind === 'signed-in'
              ? `Son mot de passe est choisi. S’il l’oublie, ${canManage ? 'crée-lui' : 'le propriétaire peut lui créer'} un lien pour en choisir un nouveau.`
              : access.kind === 'reset-sent'
                ? `Son mot de passe est choisi. Un lien pour en choisir un nouveau a été créé : il marche jusqu’à ${deadline(access.until)}.`
                : access.kind === 'valid'
                  ? `Lien d’invitation créé, pas encore ouvert. Il marche jusqu’à ${deadline(access.until)}.`
                  : access.kind === 'expired'
                    ? `Son lien d’invitation a expiré sans être ouvert. ${canManage ? 'Crée-lui un nouveau lien.' : 'Le propriétaire peut lui en créer un nouveau.'}`
                    : 'Il n’a pas encore de lien pour choisir son mot de passe.'}
          </p>
          {canManage ? (
            <ShareLink
              // The member alone: re-reading the list after a link changes `access.kind`, and the link made must stay.
              key={member.id}
              memberId={member.id}
              name={member.displayName}
              purpose={access.kind === 'signed-in' || access.kind === 'reset-sent' ? 'reset' : 'invitation'}
              label={
                access.kind === 'signed-in'
                  ? 'Lien de nouveau mot de passe'
                  : access.kind === 'no-link'
                    ? 'Créer son lien'
                    : access.kind === 'expired'
                      ? 'Nouveau lien'
                      : 'Remplacer le lien'
              }
            />
          ) : null}
        </section>
      )}

      {isSelf ? null : <Notes memberId={member.id} name={member.displayName} />}

      {editing === 'member' ? <EditMemberPanel member={member} creators={creators} onClose={close} /> : null}
      {editing === 'rate' ? <RatePanel member={member} presets={presets} onClose={close} /> : null}
      {editing === 'status' ? <StatusPanel member={member} onClose={close} /> : null}
    </section>
  );
}

/** The internal notes: newest first, written by the owner and the active managers, never shown to the member. */
function Notes({ memberId, name }: { memberId: string; name: string }): JSX.Element {
  const client = useQueryClient();
  const notes = useNotes(memberId);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    const body = draft.trim();
    if (body === '' || busy) return;
    setBusy(true);
    setProblem(null);
    const outcome = await addNote(memberId, body);
    setBusy(false);
    if (outcome.kind === 'ok') {
      setDraft('');
      await client.invalidateQueries({ queryKey: ['team', 'notes', memberId] });
    } else {
      setProblem(
        outcome.kind === 'refused'
          ? ERROR_MESSAGES[outcome.code]
          : 'La note n’a pas été enregistrée : le serveur ne répond pas.',
      );
    }
  };

  const list = notes.data ?? [];
  return (
    <section className="tm-block nv-enter" style={{ '--nv-i': 5 }} aria-label="Notes internes">
      <h3>Notes internes</h3>
      <p className="tm-hint">Lues par toi et les managers, jamais par {name}.</p>
      {notes.isError ? (
        <p className="tm-warn">Les notes n’ont pas pu être lues.</p>
      ) : list.length === 0 ? null : (
        <ul className="tm-notes">
          {list.map((note, i) => (
            <li key={note.id} className="nv-enter" style={{ '--nv-i': i + 1 }}>
              <p>{note.body}</p>
              <span className="tm-note__by">
                {note.authorName} · {noteDay(note.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="tm-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <textarea
          className="nv-field__control nv-glass tm-note-input"
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder="Une note pour l’équipe de direction"
          aria-label="Nouvelle note"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <button
          type="submit"
          className="nv-btn nv-btn--soft nv-btn--sm tm-self-end"
          disabled={draft.trim() === '' || busy}
          aria-busy={busy}
        >
          {busy ? 'Enregistrement…' : 'Ajouter la note'}
        </button>
      </form>
      {problem === null ? null : (
        <p className="tm-warn nv-swap" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
