import type { TelegramOverview, TelegramSaleSettings, TelegramSaleSettingsEntry } from '@nirvana/contracts';
import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import { fetchSaleSettings, saveSaleSettings } from './api';
import {
  minimumFromText,
  minimumText,
  saleSettingsOf,
  withSaleSettings,
  withoutOwnSaleSettings,
  type Scope,
} from './model';

type Load =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; entries: readonly TelegramSaleSettingsEntry[] };

/**
 * Which sales ring and whether the evening digest goes (CRM-04 lot b), for every creator or one of them, hers winning.
 * Each change is saved at once; a refusal puts back what the server holds.
 */
export function SalesSettings({
  overview,
  scope,
}: {
  overview: TelegramOverview;
  scope: Scope;
}): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { settings } = await fetchSaleSettings();
      setLoad({ kind: 'ready', entries: settings });
    } catch {
      setLoad((current) => (current.kind === 'ready' ? current : { kind: 'failed' }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback(
    (next: TelegramSaleSettingsEntry[]): void => {
      setNotice(null);
      setLoad({ kind: 'ready', entries: next });
      saving.current = saving.current.then(async () => {
        try {
          const saved = await saveSaleSettings(next);
          setLoad({ kind: 'ready', entries: saved.settings });
        } catch {
          setNotice('Le réglage n’a pas été enregistré. Réessaie dans un instant.');
          await refresh();
        }
      });
    },
    [refresh],
  );

  if (load.kind === 'loading') return <div className="nv-plate tg-sales" aria-busy="true" />;
  if (load.kind === 'failed') {
    return (
      <div className="nv-plate tg-sales">
        <p className="tg-sales__notice" role="alert">
          Les réglages des ventes n’ont pas pu être lus.{' '}
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={() => void refresh()}>
            Réessayer
          </button>
        </p>
      </div>
    );
  }

  const { settings, isOwn } = saleSettingsOf(load.entries, scope);
  const name = scope === 'all' ? null : overview.coverage.find((c) => c.creatorId === scope)?.displayName;
  const change = (patch: Partial<TelegramSaleSettings>): void => {
    apply(withSaleSettings(load.entries, scope, { ...settings, ...patch }));
  };

  return (
    <div className="nv-plate tg-sales">
      {scope !== 'all' && !isOwn ? (
        <p className="tg-sales__inherit">
          {name ?? 'Elle'} suit les réglages de toutes les créatrices. Change un réglage ici pour lui en
          donner des siens.
        </p>
      ) : null}
      {scope !== 'all' && isOwn ? (
        <p className="tg-sales__inherit">
          {name ?? 'Elle'} a ses propres réglages.{' '}
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              apply(withoutOwnSaleSettings(load.entries, scope));
            }}
          >
            Revenir aux réglages de toutes
          </button>
        </p>
      ) : null}
      <div className="nv-list">
        <div className="tg-route">
          <div className="tg-lvl">
            <b>Quelles ventes</b>
            <small>Une vente annoncée dit son type, son prix et qui l’a vendue.</small>
          </div>
          <div className="tg-chips" role="radiogroup" aria-label="Quelles ventes annoncer">
            {(
              [
                [false, 'Toutes les ventes'],
                [true, 'Celles de l’agent seulement'],
              ] as const
            ).map(([agentOnly, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={settings.agentOnly === agentOnly}
                onClick={() => {
                  if (settings.agentOnly !== agentOnly) change({ agentOnly });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <MinimumRow
          key={`${scope}:${String(settings.minimumMinor)}`}
          minimumMinor={settings.minimumMinor}
          onSave={(minimumMinor) => {
            if (minimumMinor !== settings.minimumMinor) change({ minimumMinor });
          }}
        />
        <div className="tg-route">
          <div className="tg-lvl">
            <b>Bilan du soir</b>
            <small>
              À 23 h dans son fuseau : les chiffres du jour, remboursements compris, puis chaque vendeur.
            </small>
          </div>
          <label className="tg-sales__switch">
            <span>{settings.eveningDigest ? 'Envoyé' : 'Coupé'}</span>
            <input
              type="checkbox"
              role="switch"
              className="nv-switch"
              checked={settings.eveningDigest}
              aria-label={`Bilan du soir : ${settings.eveningDigest ? 'envoyé' : 'coupé'}`}
              onChange={(event) => {
                change({ eveningDigest: event.target.checked });
              }}
            />
          </label>
        </div>
      </div>
      {notice === null ? null : (
        <p className="tg-sales__notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}

/** The minimum price, saved when the field is left or on Entrée; an unreadable amount says so and saves nothing. */
function MinimumRow({
  minimumMinor,
  onSave,
}: {
  minimumMinor: number;
  onSave: (minimumMinor: number) => void;
}): JSX.Element {
  const id = useId();
  const [text, setText] = useState(() => minimumText(minimumMinor));
  const parsed = minimumFromText(text);
  const save = (): void => {
    if (parsed !== null) onSave(parsed);
  };
  return (
    <div className="tg-route">
      <div className="tg-lvl">
        <label htmlFor={id}>
          <b>Montant minimum</b>
        </label>
        <small>Le prix payé par le fan, TTC, comme dans Reveal. Vide : toutes les ventes.</small>
        {parsed === null ? (
          <small className="tg-route__warn" role="alert">
            Écris un montant en euros, par exemple 20 ou 19,90.
          </small>
        ) : null}
      </div>
      <div className="tg-sales__amount">
        <input
          id={id}
          className="nv-field__control nv-num"
          inputMode="decimal"
          placeholder="0"
          value={text}
          aria-invalid={parsed === null}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
          }}
        />
        <span aria-hidden="true">€</span>
      </div>
    </div>
  );
}
