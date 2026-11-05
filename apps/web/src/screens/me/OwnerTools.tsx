import {
  BillingRegimeIdSchema,
  ContractorRegimeIdSchema,
  type BillingRegimes,
  type ContractorFile,
} from '@impera/contracts';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState, type JSX, type SyntheticEvent } from 'react';

import { Refusal, useFileSend } from './FileParts';

import { assignRegime, setPrefix, verifyProfile } from '@/contractors/api';
import {
  askedText,
  earliestRegimeDay,
  prefixOf,
  regimeAhead,
  regimeInForce,
  regimesFor,
  validationText,
} from '@/contractors/model';
import { countryName } from '@/lib/country';
import { fullDay } from '@/scheduling/time';
import { Loading, Unreachable } from '@/screens/pay/parts';
import { Dialog } from '@/shell/Dialog';
import { Panel } from '@/shell/layout';

/**
 * The owner's checks on a member's identity (EQ-06 lot 8b): « Vérifier » the file as he read it, and the prefix of
 * the member's invoices until the first one freezes it. Never on his own file, which he does not check.
 */
export function OwnerIdentityTools({
  file,
  name,
  checks,
}: {
  file: ContractorFile;
  name: string;
  checks: boolean;
}): JSX.Element | null {
  const [verifying, setVerifying] = useState(false);
  const profile = file.profile;
  if (profile === null) return null;
  if (!checks)
    return <p className="py-quiet">C’est ton propre dossier : tu ne le vérifies pas, ni tes pièces.</p>;
  return (
    <div className="rp-sec cf-tools">
      {profile.verifiedAt === null ? (
        <div className="cf-verify">
          <p className="tm-hint">
            Aucune facture ne part au nom de {name} tant que tu n’as pas vérifié son dossier tel qu’il
            s’affiche.
          </p>
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            onClick={() => {
              setVerifying(true);
            }}
          >
            Vérifier
          </button>
        </div>
      ) : null}
      {file.prefixFrozen ? null : <PrefixForm file={file} />}
      {verifying ? (
        <VerifyDialog
          file={file}
          name={name}
          onClose={() => {
            setVerifying(false);
          }}
        />
      ) : null}
    </div>
  );
}

function VerifyDialog({
  file,
  name,
  onClose,
}: {
  file: ContractorFile;
  name: string;
  onClose: () => void;
}): JSX.Element {
  const { busy, refusal, send } = useFileSend(onClose);
  const profile = file.profile;
  return (
    <Dialog
      title={`Vérifier le dossier de ${name}`}
      lead="Ses factures imprimeront ce dossier tel quel."
      busy={busy}
      onClose={onClose}
    >
      <form
        className="tm-dialog__body"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && profile !== null) send(() => verifyProfile(file.memberId, profile.updatedAt));
        }}
      >
        <p className="tm-hint">
          Tu confirmes que le nom, l’adresse et les numéros affichés sont exacts, pièces à l’appui. S’il
          change son dossier ensuite, il repasse à vérifier ; s’il l’a changé depuis que tu l’as ouvert, rien
          n’est vérifié.
        </p>
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
            {busy ? 'Envoi…' : 'Vérifié'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The member's prefix, his alone: 2 to 8 capitals or digits, until his first invoice freezes it. */
function PrefixForm({ file }: { file: ContractorFile }): JSX.Element {
  const id = useId();
  const current = file.profile?.invoicePrefix ?? null;
  const [text, setText] = useState(current ?? '');
  const [tried, setTried] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, refusal, send } = useFileSend(() => {
    setSaved(true);
  });
  const prefix = prefixOf(text);
  const wrong = tried && prefix === null;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    setSaved(false);
    if (busy || prefix === null || prefix === current) return;
    send(() => setPrefix(file.memberId, prefix));
  };

  return (
    <form className="cf-prefix" noValidate onSubmit={submit}>
      <div className="nv-field tm-field" data-invalid={wrong ? 'true' : undefined}>
        <label className="nv-field__label" htmlFor={`${id}-prefix`}>
          Préfixe des factures
        </label>
        <div className="cf-prefix__row">
          <input
            id={`${id}-prefix`}
            className="nv-field__control nv-glass nv-num cf-prefix__input"
            maxLength={8}
            value={text}
            autoComplete="off"
            aria-invalid={wrong}
            aria-describedby={`${id}-prefix-hint`}
            onChange={(event) => {
              setText(event.target.value.toUpperCase());
              setSaved(false);
            }}
          />
          <button
            type="submit"
            className="nv-btn nv-btn--soft nv-btn--sm"
            disabled={busy || (prefix !== null && prefix === current)}
            aria-busy={busy}
          >
            {busy ? 'Envoi…' : 'Enregistrer'}
          </button>
        </div>
        <p
          id={`${id}-prefix-hint`}
          className={wrong ? 'tm-hint tm-hint--error' : 'tm-hint'}
          aria-live="polite"
        >
          {wrong
            ? 'De 2 à 8 majuscules ou chiffres, par exemple NORA.'
            : saved
              ? 'Préfixe enregistré.'
              : 'Ses numéros commencent par lui (NORA-2026-0001) : il se fige à sa première facture.'}
        </p>
      </div>
      <Refusal refusal={refusal} />
    </form>
  );
}

/**
 * The member's regime of invoicing, from a day on: the one in force, one set ahead, and the owner gives a new one of
 * the member's country, today at the earliest. Never changed backwards.
 */
export function RegimePanel({
  file,
  regimes,
  name,
  checks,
}: {
  file: ContractorFile;
  regimes: UseQueryResult<BillingRegimes>;
  name: string;
  checks: boolean;
}): JSX.Element {
  const [assigning, setAssigning] = useState(false);
  const all = regimes.data?.regimes ?? [];
  const inForce = regimeInForce(file);
  const ahead = regimeAhead(file);
  const regimeOf = (regimeId: string) => all.find((regime) => regime.id === regimeId) ?? null;
  const current = inForce === null ? null : regimeOf(inForce.regimeId);
  const next = ahead === null ? null : regimeOf(ahead.regimeId);
  const available = regimesFor(file.country, all);

  return (
    <Panel
      className="nv-enter"
      eyebrow="Régime"
      title="Régime de facturation"
      actions={
        checks && regimes.data !== undefined ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft nv-btn--sm"
            onClick={() => {
              setAssigning(true);
            }}
          >
            Attribuer un régime
          </button>
        ) : undefined
      }
    >
      {regimes.data === undefined ? (
        regimes.isError ? (
          <Unreachable
            what="la liste des régimes"
            onRetry={() => {
              void regimes.refetch();
            }}
          />
        ) : (
          <Loading rows={1} />
        )
      ) : (
        <div className="rp-sec">
          {inForce === null || current === null ? (
            <p className="tm-warn">
              {name} n’a aucun régime : aucune facture ne part en son nom avant que tu lui en attribues un.
            </p>
          ) : (
            <dl className="tm-facts cf-facts">
              <div>
                <dt>En vigueur</dt>
                <dd>
                  {current.name}, depuis le {fullDay(inForce.from)}
                </dd>
              </div>
              <div>
                <dt>Comptable</dt>
                <dd className={current.validatedOn === null ? 'cf-amber' : undefined}>
                  {validationText(current)}
                </dd>
              </div>
              <div>
                <dt>Pièces</dt>
                <dd>{askedText(current) ?? 'aucune'}</dd>
              </div>
            </dl>
          )}
          {ahead === null || next === null ? null : (
            <p className="py-quiet">
              À partir du {fullDay(ahead.from)} : {next.name}.
            </p>
          )}
          {available.length === 0 ? (
            <p className="py-quiet">
              Aucun régime n’est écrit pour {countryName(file.country)} : il se crée dans Réglages ›
              Facturation, tel que le comptable l’a validé.
            </p>
          ) : null}
        </div>
      )}
      {assigning ? (
        <AssignDialog
          file={file}
          name={name}
          available={available}
          onClose={() => {
            setAssigning(false);
          }}
        />
      ) : null}
    </Panel>
  );
}

function AssignDialog({
  file,
  name,
  available,
  onClose,
}: {
  file: ContractorFile;
  name: string;
  available: BillingRegimes['regimes'];
  onClose: () => void;
}): JSX.Element {
  const id = useId();
  const { busy, refusal, send } = useFileSend(onClose);
  const earliest = earliestRegimeDay(file);
  const [regimeId, setRegimeId] = useState(available[0]?.id ?? '');
  const [from, setFrom] = useState(earliest);
  const [tried, setTried] = useState(false);
  // One key per choice, kept in state (a memo is a cache React may drop): the same choice sent again after a lost
  // answer is the same assignment; a choice changed draws a new key.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const chosen = available.find((regime) => regime.id === regimeId) ?? null;
  const fromOk = /^\d{4}-\d{2}-\d{2}$/u.test(from) && from >= earliest;

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    setTried(true);
    if (busy || chosen === null || !fromOk) return;
    send(() =>
      assignRegime(file.memberId, {
        id: ContractorRegimeIdSchema.parse(key),
        regimeId: BillingRegimeIdSchema.parse(chosen.id),
        from,
      }),
    );
  };

  return (
    <Dialog
      title={`Attribuer un régime à ${name}`}
      lead={`Un régime de ${countryName(file.country)}, à partir d’aujourd’hui au plus tôt et après le dernier déjà attribué : jamais en arrière.`}
      busy={busy}
      onClose={onClose}
    >
      <form className="tm-dialog__body" noValidate onSubmit={submit}>
        {available.length === 0 ? (
          <p className="tm-warn">
            Aucun régime n’est écrit pour {countryName(file.country)} : crée-le d’abord dans Réglages ›
            Facturation.
          </p>
        ) : (
          <>
            <div className="nv-field tm-field">
              <label className="nv-field__label" htmlFor={`${id}-regime`}>
                Régime
              </label>
              <select
                id={`${id}-regime`}
                className="nv-field__control nv-glass tm-select"
                value={regimeId}
                onChange={(event) => {
                  setRegimeId(event.target.value);
                  setKey(crypto.randomUUID());
                }}
              >
                {available.map((regime) => (
                  <option key={regime.id} value={regime.id}>
                    {regime.name}
                  </option>
                ))}
              </select>
              {chosen === null ? null : (
                <p className={chosen.validatedOn === null ? 'tm-hint cf-amber' : 'tm-hint'}>
                  {validationText(chosen)}.
                </p>
              )}
            </div>
            <div className="nv-field tm-field" data-invalid={tried && !fromOk ? 'true' : undefined}>
              <label className="nv-field__label" htmlFor={`${id}-from`}>
                À partir du
              </label>
              <input
                id={`${id}-from`}
                type="date"
                className="nv-field__control nv-glass nv-num"
                min={earliest}
                value={from}
                aria-invalid={tried && !fromOk}
                aria-describedby={`${id}-from-hint`}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
              <p id={`${id}-from-hint`} className={tried && !fromOk ? 'tm-hint tm-hint--error' : 'tm-hint'}>
                {tried && !fromOk
                  ? earliest === file.today
                    ? `Aujourd’hui au plus tôt, le ${fullDay(earliest)}.`
                    : `Après le régime déjà prévu, le ${fullDay(earliest)} au plus tôt.`
                  : 'Ses relevés en attente sont repris ce jour-là.'}
              </p>
            </div>
          </>
        )}
        <Refusal refusal={refusal} />
        <div className="tm-dialog__foot">
          <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onClose}>
            Annuler
          </button>
          {available.length === 0 ? null : (
            <button type="submit" className="nv-btn nv-btn--neon" disabled={busy} aria-busy={busy}>
              {busy ? 'Envoi…' : 'Attribuer'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
