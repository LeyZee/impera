import {
  CUSTOM_SUPPLEMENTS_MAX,
  isPerMinute,
  quoteCustomOrder,
  type CreatorId,
  type CustomFormat,
  type CustomPriceGrid,
  type CustomPriceGridView,
  type CustomQuoteLine,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';

import {
  CUSTOM_PRICES_ERRORS,
  customPricesErrorKind,
  customPricesQueryKey,
  saveCustomPrices,
  useCustomPrices,
  type CustomPricesErrorKind,
} from './api';
import {
  changesBetween,
  draftOf,
  euros,
  FORMAT_HINTS,
  FORMAT_LABELS,
  lineName,
  minutesOf,
  newSupplement,
  quoteSentence,
  readDraft,
  savedLine,
  type DraftProblems,
  type FormatDraft,
  type GridDraft,
  type SupplementDraft,
} from './model';
import './custom-prices.css';

import { SignInAgain } from '@/settings/services/PasswordPrompt';

/**
 * Créatrices › Sur mesure (ADR 0159 § C), the owner's alone: her grid of custom prices. A price per format, then
 * supplements in percent that add up whatever the format; « Elle le fait » off, the AI declines without asking her.
 * The calculator reads the same sum as the server (`quoteCustomOrder`). One card per subject: Formats, Suppléments,
 * Calculateur. No price is made up: an empty field is « pas encore de prix », and an order that needs it goes to her
 * without a price.
 */
export function CustomPricesSection({
  creatorId,
  creatorName,
  onDirty = ignore,
}: {
  creatorId: CreatorId;
  creatorName: string;
  /** Told whether the grid holds changes not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const query = useCustomPrices(creatorId);
  if (query.data === undefined) {
    if (query.isError) {
      const kind = customPricesErrorKind(query.error);
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Ses prix sur mesure ne se chargent pas</p>
            <p className="ps-muted">{CUSTOM_PRICES_ERRORS[kind]}</p>
            {kind === 'session_expired' ? (
              <SignInAgain />
            ) : kind === 'unavailable' ? (
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => void query.refetch()}
              >
                Réessayer
              </button>
            ) : null}
          </div>
        </section>
      );
    }
    return (
      <section className="ps-page" aria-busy="true" aria-label="Prix sur mesure">
        <div className="nv-plate ps-head ps-skeleton" />
        <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
      </section>
    );
  }
  return (
    <GridSheet
      key={`${creatorId}:${String(query.data.version)}`}
      creatorId={creatorId}
      creatorName={creatorName}
      view={query.data}
      onDirty={onDirty}
    />
  );
}

const ignore = (): void => undefined;

function GridSheet({
  creatorId,
  creatorName,
  view,
  onDirty,
}: {
  creatorId: CreatorId;
  creatorName: string;
  view: CustomPriceGridView;
  onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const id = useId();
  const queryClient = useQueryClient();
  const saved = useMemo(() => draftOf(view.grid), [view.grid]);
  const [draft, setDraft] = useState<GridDraft>(saved);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<CustomPricesErrorKind | null>(null);
  const sending = useRef(false);
  const head = useRef<HTMLDivElement>(null);
  const headSeen = useOnScreen(head);

  const changes = changesBetween(saved, draft);
  const dirty = changes > 0;
  const read = readDraft(draft);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const setFormat = (format: CustomFormat, patch: Partial<FormatDraft>): void => {
    setProblem(null);
    setDraft((current) => ({
      ...current,
      formats: current.formats.map((line) => (line.format === format ? { ...line, ...patch } : line)),
    }));
  };
  const setSupplement = (supplementId: string, patch: Partial<SupplementDraft>): void => {
    setProblem(null);
    setDraft((current) => ({
      ...current,
      supplements: current.supplements.map((line) =>
        line.id === supplementId ? { ...line, ...patch } : line,
      ),
    }));
  };

  const save = async (): Promise<void> => {
    if (read.grid === null || sending.current) return;
    sending.current = true;
    setSaving(true);
    setProblem(null);
    try {
      const next = await saveCustomPrices(creatorId, view.version, read.grid);
      queryClient.setQueryData(customPricesQueryKey(creatorId), next);
    } catch (error) {
      setProblem(customPricesErrorKind(error));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };
  const reset = (): void => {
    setDraft(saved);
    setProblem(null);
  };
  const blocked = read.grid === null ? 'Une ligne à corriger avant d’enregistrer.' : null;
  const changeText =
    read.grid === null
      ? 'Une ligne à corriger'
      : changes === 1
        ? '1 modification'
        : `${String(changes)} modifications`;

  return (
    <section className="ps-page smp-page" aria-labelledby={`${id}-title`}>
      <div className="nv-plate ps-head smp-head" ref={head}>
        <p className="nv-eyebrow">Réservé au propriétaire</p>
        <h2 className="ps-title smp-title" id={`${id}-title`}>
          Prix sur mesure de {creatorName}
        </h2>
        <p className="ps-muted">
          Le prix d’une demande : celui du format, plus chaque supplément en pourcentage de ce prix. Ce calcul
          pré-remplit le prix proposé à {creatorName}, elle l’accepte ou le change, et rien n’est annoncé au
          fan avant son oui. Tout se paie dans Reveal.
        </p>
        <p className="ps-muted smp-saved">{savedLine(view.updatedAt)}</p>
        {problem === null ? null : (
          <p className="ps-error" role="alert">
            {CUSTOM_PRICES_ERRORS[problem]}
          </p>
        )}
        {problem === 'session_expired' ? <SignInAgain /> : null}
        {problem === 'conflict' ? (
          <button
            type="button"
            className="nv-btn nv-btn--soft ps-self-start"
            onClick={() => void queryClient.invalidateQueries({ queryKey: customPricesQueryKey(creatorId) })}
          >
            Recharger la grille
          </button>
        ) : null}
        {dirty ? (
          <div className="smp-head__actions">
            <button type="button" className="nv-btn nv-btn--plain" disabled={saving} onClick={reset}>
              Annuler
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              disabled={saving || read.grid === null}
              aria-busy={saving}
              onClick={() => void save()}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        ) : null}
      </div>

      <Card
        title="Formats"
        lead="Ce qu’il commande. Un champ vide : pas encore de prix, la demande partira sans prix proposé."
      >
        <div className="smp-colhead smp-colhead--formats" aria-hidden="true">
          <span>Format</span>
          <span>Prix</span>
          <span>Minutes</span>
          <span>Minute en plus</span>
          <span />
        </div>
        <ul className="smp-rows smp-rows--formats">
          {draft.formats.map((line) => (
            <FormatRow
              key={line.format}
              line={line}
              problems={read.problems}
              disabled={saving}
              onChange={(patch) => {
                setFormat(line.format, patch);
              }}
            />
          ))}
        </ul>
      </Card>

      <Card
        title="Suppléments"
        lead="Ce qu’il y a dedans, nommé par toi. Un pourcentage du prix du format, ajouté quel que soit le format : un supplément à +50 % rend plus chères la vidéo, l’appel et la visio."
      >
        {draft.supplements.length === 0 ? (
          <p className="ps-muted smp-empty">
            Aucun supplément pour l’instant. Ajoute ce qui rend une demande plus chère, et éteins « Elle le
            fait » pour ce qu’elle refuse : l’IA déclinera sans lui demander.
          </p>
        ) : (
          <>
            <div className="smp-colheads" aria-hidden="true">
              {(draft.supplements.length > 1 ? [0, 1] : [0]).map((index) => (
                <div key={index} className="smp-colhead smp-colhead--supplements">
                  <span>Supplément</span>
                  <span>Majoration</span>
                  <span />
                  <span />
                </div>
              ))}
            </div>
            <ul className="smp-rows smp-rows--supplements">
              {draft.supplements.map((line) => (
                <SupplementRow
                  key={line.id}
                  line={line}
                  problems={read.problems}
                  disabled={saving}
                  onChange={(patch) => {
                    setSupplement(line.id, patch);
                  }}
                  onRemove={() => {
                    setDraft((current) => ({
                      ...current,
                      supplements: current.supplements.filter((one) => one.id !== line.id),
                    }));
                  }}
                />
              ))}
            </ul>
          </>
        )}
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm ps-self-start smp-add"
          disabled={saving || draft.supplements.length >= CUSTOM_SUPPLEMENTS_MAX}
          onClick={() => {
            setDraft((current) => ({
              ...current,
              supplements: [...current.supplements, newSupplement()],
            }));
          }}
        >
          <span aria-hidden="true">+</span> Ajouter un supplément
        </button>
      </Card>

      <Calculator grid={read.grid ?? view.grid} stale={read.grid === null} />

      <SaveBar
        show={dirty && !headSeen}
        warn={read.grid === null}
        text={changeText}
        saveLabel="Enregistrer"
        saving={saving}
        blocked={blocked}
        onReset={reset}
        onSave={() => void save()}
      />
    </section>
  );
}

function Card({ title, lead, children }: { title: string; lead: string; children: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <div className="nv-plate ps-panel smp-card" role="group" aria-labelledby={id}>
      <div className="smp-card__head">
        <h3 className="smp-card__title" id={id}>
          {title}
        </h3>
        <p className="ps-muted">{lead}</p>
      </div>
      {children}
    </div>
  );
}

/** A number typed in a field with its unit inside, at its end (€, €/min, %, min). */
function UnitInput({
  label,
  value,
  unit,
  problem,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  unit: string;
  problem: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="smp-unit">
      <label className="smp-unit__label" htmlFor={id}>
        {label}
      </label>
      <div className="smp-unit__box">
        <input
          id={id}
          className="nv-glass nv-field__control ps-input smp-unit__input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="—"
          value={value}
          disabled={disabled}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : `${id}-error`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <span className="smp-unit__sign" aria-hidden="true">
          {unit}
        </span>
      </div>
      {problem === undefined ? null : (
        <p className="ps-error smp-unit__error" id={`${id}-error`}>
          {problem}
        </p>
      )}
    </div>
  );
}

/** « Elle le fait » : the design system's switch, never a bare checkbox. */
function Offered({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="smp-offered">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={checked}
        disabled={disabled}
        aria-label={`${label} : elle le fait`}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <label htmlFor={id} className="smp-offered__text" aria-hidden="true">
        {checked ? 'Elle le fait' : 'Jamais'}
      </label>
    </div>
  );
}

function FormatRow({
  line,
  problems,
  disabled,
  onChange,
}: {
  line: FormatDraft;
  problems: DraftProblems;
  disabled: boolean;
  onChange: (patch: Partial<FormatDraft>) => void;
}): JSX.Element {
  const label = FORMAT_LABELS[line.format];
  const perMinute = isPerMinute(line.format);
  return (
    <li className="smp-row" data-off={line.offered ? undefined : 'true'}>
      <div className="smp-row__name">
        <span className="smp-row__label">{label}</span>
        <span className="ps-hint">{FORMAT_HINTS[line.format]}</span>
      </div>
      {line.offered ? (
        <>
          <UnitInput
            label={perMinute ? 'Prix à la minute' : 'Prix'}
            value={line.price}
            unit={perMinute ? '€/min' : '€'}
            problem={problems.get(`${line.format}.price`)}
            disabled={disabled}
            onChange={(price) => {
              onChange({ price });
            }}
          />
          {perMinute ? (
            <UnitInput
              label="Minimum"
              value={line.minMinutes}
              unit="min"
              problem={problems.get(`${line.format}.minMinutes`)}
              disabled={disabled}
              onChange={(minMinutes) => {
                onChange({ minMinutes });
              }}
            />
          ) : line.format === 'video' ? (
            <UnitInput
              label="Minutes comprises"
              value={line.includedMinutes}
              unit="min"
              problem={problems.get('video.includedMinutes')}
              disabled={disabled}
              onChange={(includedMinutes) => {
                onChange({ includedMinutes });
              }}
            />
          ) : (
            <span className="smp-cell--none" />
          )}
          {line.format === 'video' ? (
            <UnitInput
              label="Par minute en plus"
              value={line.extraMinutePercent}
              unit="%"
              problem={problems.get('video.extraMinutePercent')}
              disabled={disabled}
              onChange={(extraMinutePercent) => {
                onChange({ extraMinutePercent });
              }}
            />
          ) : (
            <span className="smp-cell--none" />
          )}
        </>
      ) : (
        <p className="ps-muted smp-row__never">L’IA décline sans lui demander.</p>
      )}
      <Offered
        label={label}
        checked={line.offered}
        disabled={disabled}
        onChange={(offered) => {
          onChange({ offered });
        }}
      />
    </li>
  );
}

function SupplementRow({
  line,
  problems,
  disabled,
  onChange,
  onRemove,
}: {
  line: SupplementDraft;
  problems: DraftProblems;
  disabled: boolean;
  onChange: (patch: Partial<SupplementDraft>) => void;
  onRemove: () => void;
}): JSX.Element {
  const nameId = useId();
  const label = line.label.trim() || 'Nouveau supplément';
  const nameProblem = problems.get(`${line.id}.label`);
  return (
    <li className="smp-row" data-off={line.offered ? undefined : 'true'}>
      <div className="smp-row__name">
        <label className="smp-unit__label" htmlFor={nameId}>
          Nom du supplément
        </label>
        <input
          id={nameId}
          className="nv-glass nv-field__control ps-input smp-row__nameinput"
          placeholder="Nom du supplément"
          maxLength={40}
          value={line.label}
          disabled={disabled}
          aria-invalid={nameProblem !== undefined}
          onChange={(event) => {
            onChange({ label: event.target.value });
          }}
        />
        {nameProblem === undefined ? null : <p className="ps-error">{nameProblem}</p>}
      </div>
      {line.offered ? (
        <UnitInput
          label="Majoration"
          value={line.percent}
          unit="%"
          problem={problems.get(`${line.id}.percent`)}
          disabled={disabled}
          onChange={(percent) => {
            onChange({ percent });
          }}
        />
      ) : (
        <p className="ps-muted smp-row__never">L’IA décline.</p>
      )}
      <Offered
        label={label}
        checked={line.offered}
        disabled={disabled}
        onChange={(offered) => {
          onChange({ offered });
        }}
      />
      <button
        type="button"
        className="nv-btn nv-btn--plain nv-btn--sm smp-row__remove"
        disabled={disabled}
        aria-label={`Retirer ${label}`}
        onClick={onRemove}
      >
        Retirer
      </button>
    </li>
  );
}

/** A line of the sum, as she will read it: « Vidéo pour lui 100 € », « <supplement> +50 % 50 € ». */
function lineText(grid: CustomPriceGrid, line: CustomQuoteLine): { name: string; amount: string } {
  if (line.kind === 'format')
    return {
      name:
        line.minutes === undefined
          ? FORMAT_LABELS[line.format]
          : `${FORMAT_LABELS[line.format]}, ${String(line.minutes)} min`,
      amount: euros(line.amountMinor),
    };
  if (line.kind === 'extra_minutes')
    return { name: `${String(line.minutes)} min en plus`, amount: `+${euros(line.amountMinor)}` };
  return {
    name: `${lineName(grid, line.id)} +${String(line.percent)} %`,
    amount: `+${euros(line.amountMinor)}`,
  };
}

/** Try the grid: a format, supplements, minutes when they count; the price the same sum as the server's. */
function Calculator({ grid, stale }: { grid: CustomPriceGrid; stale: boolean }): JSX.Element {
  const id = useId();
  const [format, setFormat] = useState<CustomFormat>('video');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [minutesText, setMinutesText] = useState('');
  const minutes = minutesOf(minutesText);
  const minutesCount = isPerMinute(format) || format === 'video';
  const ask = {
    format,
    supplements: picked.filter((one) => grid.supplements.some((line) => line.id === one)),
    ...(minutesCount && typeof minutes === 'number' ? { minutes } : {}),
  };
  const quote = quoteCustomOrder(grid, ask);
  return (
    <Card
      title="Calculateur"
      lead="Essaie ta grille : choisis un format et des suppléments, le prix s’affiche tel que le code le calculera."
    >
      {stale ? (
        <p className="ps-muted" role="status">
          Une ligne à corriger : le calcul lit la grille enregistrée.
        </p>
      ) : null}
      <div className="smp-calc">
        <div className="smp-calc__inputs">
          <p className="nv-eyebrow" id={`${id}-format`}>
            Format
          </p>
          <div className="ps-chips" role="radiogroup" aria-labelledby={`${id}-format`}>
            {grid.formats.map((line) => (
              <button
                key={line.format}
                type="button"
                role="radio"
                className="nv-chip"
                aria-checked={format === line.format}
                onClick={() => {
                  setFormat(line.format);
                }}
              >
                {FORMAT_LABELS[line.format]}
              </button>
            ))}
          </div>
          <p className="nv-eyebrow" id={`${id}-supplements`}>
            Suppléments
          </p>
          <div className="ps-chips" role="group" aria-labelledby={`${id}-supplements`}>
            {grid.supplements.map((line) => (
              <button
                key={line.id}
                type="button"
                className="nv-chip"
                aria-pressed={picked.includes(line.id)}
                onClick={() => {
                  setPicked((current) =>
                    current.includes(line.id)
                      ? current.filter((one) => one !== line.id)
                      : [...current, line.id],
                  );
                }}
              >
                {line.label}
              </button>
            ))}
          </div>
          {minutesCount ? (
            <UnitInput
              label={format === 'video' ? 'Durée de la vidéo' : 'Durée'}
              value={minutesText}
              unit="min"
              problem={minutes === 'invalid' ? 'De 1 à 240 minutes.' : undefined}
              disabled={false}
              onChange={setMinutesText}
            />
          ) : null}
        </div>
        <div className="nv-glass smp-calc__result" aria-live="polite" data-kind={quote.kind}>
          <p className="nv-eyebrow">Prix proposé</p>
          <p className="smp-calc__total">{quote.kind === 'price' ? euros(quote.totalMinor) : '—'}</p>
          <p className="ps-muted">{quoteSentence(grid, quote)}</p>
          {quote.kind === 'price' ? (
            <ul className="smp-calc__lines">
              {quote.lines.map((line, index) => {
                const shown = lineText(grid, line);
                return (
                  <li key={index} className="smp-calc__line">
                    <span>{shown.name}</span>
                    <span className="smp-calc__amount">{shown.amount}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
