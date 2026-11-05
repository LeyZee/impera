import type { CreatorId, InvitationLinkCreated } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { createCreatorLink, creatorAccountKey, useCreatorAccount } from './api';

import { LinkShare, type LinkOutcome } from '@/screens/team/ShareLink';
import { deadline, invitationState } from '@/screens/team/model';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/**
 * Accès, on her sheet, for the owner alone (CR-02, ADR 0042 § 1): her own account and its link. The first link names
 * her e-mail and makes her account; the next ones replace it, correcting her e-mail while she has never signed in
 * (ADR 0071 § 3), or give her a new password once she is in. Impera sends
 * nothing: the owner hands the message over himself, as for a member (EQ-12).
 */
export function AccessSection({
  creatorId,
  creatorName,
}: {
  creatorId: CreatorId;
  creatorName: string;
}): JSX.Element {
  const client = useQueryClient();
  const query = useCreatorAccount(creatorId);
  const [email, setEmail] = useState('');
  /** Her e-mail corrected before her first sign-in (ADR 0071 § 3); `null` while untouched: the account's. */
  const [fixed, setFixed] = useState<string | null>(null);
  /** The link just made: it stays on screen while her account is read again, whatever state that brings. */
  const [made, setMade] = useState<InvitationLinkCreated | null>(null);

  if (query.isError) {
    return (
      <section className="nv-plate ps-panel" aria-label="Accès">
        <p className="ps-title">Son accès ne se charge pas</p>
        <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
        <button
          type="button"
          className="nv-btn nv-btn--soft ps-self-start"
          onClick={() => void query.refetch()}
        >
          Réessayer
        </button>
      </section>
    );
  }
  if (query.isPending) return <section className="nv-plate ps-panel ps-skeleton" aria-busy="true" />;

  const account = query.data;
  const keep = async (outcome: LinkOutcome): Promise<LinkOutcome> => {
    if (outcome.kind === 'ok') {
      setMade(outcome.value);
      await client.invalidateQueries({ queryKey: creatorAccountKey(creatorId) });
    }
    return outcome;
  };

  if (account === null) {
    const typed = email.trim();
    return (
      <section className="nv-plate ps-panel cr-access nv-enter" aria-label="Accès">
        <h2 className="ps-title">Son espace</h2>
        <p className="ps-muted">
          {creatorName} n’a pas encore de compte. Son e-mail crée son compte et un lien d’accès, valable 72
          heures, que tu lui envoies toi-même.
        </p>
        <label className="nv-field">
          <span className="nv-field__label">Son e-mail</span>
          <input
            className="nv-field__control nv-glass"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>
        <LinkShare
          key="link"
          label="Créer son lien"
          welcome={welcomeOf(creatorName)}
          disabled={!EMAIL.test(typed)}
          make={() => createCreatorLink(creatorId, { purpose: 'invitation', email: typed }).then(keep)}
        />
      </section>
    );
  }

  const access = invitationState(account, new Date());
  const reset = access.kind === 'signed-in' || access.kind === 'reset-sent';
  const target = (fixed ?? account.email).trim();
  const corrected = target.toLowerCase() !== account.email.trim().toLowerCase();
  return (
    <section className="nv-plate ps-panel cr-access nv-enter" aria-label="Accès">
      <h2 className="ps-title">Son espace</h2>
      <p className="ps-muted">
        {access.kind === 'signed-in'
          ? `Son mot de passe est choisi. Elle se connecte avec ${account.email}. Si elle l’oublie, crée-lui un lien pour en choisir un nouveau.`
          : access.kind === 'reset-sent'
            ? `Son mot de passe est choisi. Un lien pour en choisir un nouveau a été créé : il marche jusqu’à ${deadline(access.until)}.`
            : access.kind === 'valid'
              ? `Lien d’invitation créé pour ${account.email}, pas encore utilisé. Il marche jusqu’à ${deadline(access.until)}.`
              : access.kind === 'expired'
                ? `Son lien d’invitation a expiré sans être utilisé. Crée-lui un nouveau lien.`
                : `Son compte attend son premier lien (${account.email}).`}
      </p>
      {reset ? null : (
        // Until her password is chosen, a typo in her e-mail is corrected here: the link out stops working.
        <label className="nv-field">
          <span className="nv-field__label">Son e-mail</span>
          <input
            className="nv-field__control nv-glass"
            type="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="email"
            value={fixed ?? account.email}
            onChange={(event) => {
              setFixed(event.target.value);
            }}
          />
          {corrected ? (
            <span className="ps-hint">
              Son compte prendra cet e-mail et l’ancien lien cessera de marcher.
            </span>
          ) : null}
        </label>
      )}
      <LinkShare
        key="link"
        initial={made}
        label={
          access.kind === 'signed-in'
            ? 'Lien de nouveau mot de passe'
            : corrected
              ? 'Corriger et créer son lien'
              : access.kind === 'expired' || access.kind === 'no-link'
                ? 'Nouveau lien'
                : 'Remplacer le lien'
        }
        welcome={reset ? `${creatorName}, choisis ton nouveau mot de passe ici :` : welcomeOf(creatorName)}
        disabled={!reset && !EMAIL.test(target)}
        make={() =>
          createCreatorLink(
            creatorId,
            reset ? { purpose: 'reset' } : { purpose: 'invitation', email: target },
          ).then((outcome) => {
            if (outcome.kind === 'ok') setFixed(null);
            return keep(outcome);
          })
        }
      />
    </section>
  );
}

/** Her welcome, before the link: her space, never « l’équipe ». */
const welcomeOf = (name: string): string => `${name}, ton espace t’attend. Choisis ton mot de passe ici :`;
