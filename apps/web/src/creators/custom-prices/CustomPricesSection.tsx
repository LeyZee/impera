import {
  CUSTOM_SUPPLEMENTS_MAX,
  isPerMinute,
  READY_VIDEO_LABEL_MAX,
  READY_VIDEOS_MAX,
  type CreatorId,
  type CustomFormat,
  type CustomPriceGridView,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';

import { Calculator } from './Calculator';
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
  FORMAT_HINTS,
  FORMAT_LABELS,
  newReadyVideo,
  newSupplement,
  readDraft,
  savedLine,
  type DraftProblems,
  type FormatDraft,
  type GridDraft,
  type ReadyVideoDraft,
  type SupplementDraft,
} from './model';
import { Card, Offered, UnitInput } from './parts';
import './custom-prices.css';

import { SignInAgain } from '@/settings/services/PasswordPrompt';

/**
 * Créatrices › Sur mesure (ADR 0159 § C), the owner's alone: her grid of custom prices. A price per format, then
 * supplements in percent that add up whatever the format; « Elle le fait » off, the AI declines without asking her.
 * The calculator reads the same sum as the server (`quoteCustomOrder`). One card per subject: Formats, Suppléments,
 * Vidéos déjà tournées (kinds he names, each with the range its price is drawn in), Calculateur. No price is made up: an empty field is « pas encore de prix », and an order that needs it goes to her
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

  const setReadyVideo = (lineId: string, patch: Partial<ReadyVideoDraft>): void => {
    setProblem(null);
    setDraft((current) => ({
      ...current,
      readyVideos: current.readyVideos.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
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
        <h2 className="ps-title nv-h2" id={`${id}-title`}>
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

      <Card
        title="Vidéos déjà tournées"
        lead="Celles qu’elle vend hors des scripts, par type nommé par toi. Chaque vidéo prend un prix rond tiré dans la fourchette de son type, puis le garde. Jamais offerte, jamais deux fois au même fan."
      >
        {draft.readyVideos.length === 0 ? (
          <p className="ps-muted smp-empty">
            Aucun type pour l’instant. Ajoute chaque type de vidéo qu’elle a déjà tournée, avec sa fourchette
            : elle choisit le type en déposant la vidéo.
          </p>
        ) : (
          <>
            <div className="smp-colhead smp-colhead--ready" aria-hidden="true">
              <span>Type de vidéo</span>
              <span>De</span>
              <span>À</span>
              <span />
              <span />
            </div>
            <ul className="smp-rows smp-rows--ready">
              {draft.readyVideos.map((line) => (
                <ReadyVideoRow
                  key={line.id}
                  line={line}
                  problems={read.problems}
                  disabled={saving}
                  onChange={(patch) => {
                    setReadyVideo(line.id, patch);
                  }}
                  onRemove={() => {
                    setDraft((current) => ({
                      ...current,
                      readyVideos: current.readyVideos.filter((one) => one.id !== line.id),
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
          disabled={saving || draft.readyVideos.length >= READY_VIDEOS_MAX}
          onClick={() => {
            setDraft((current) => ({ ...current, readyVideos: [...current.readyVideos, newReadyVideo()] }));
          }}
        >
          <span aria-hidden="true">+</span> Ajouter un type de vidéo
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
          aria-describedby={nameProblem === undefined ? undefined : `${nameId}-error`}
          onChange={(event) => {
            onChange({ label: event.target.value });
          }}
        />
        {nameProblem === undefined ? null : (
          <p className="ps-error" id={`${nameId}-error`}>
            {nameProblem}
          </p>
        )}
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

const FOR_SALE = { on: 'En vente', off: 'Jamais', aria: 'en vente' };

function ReadyVideoRow({
  line,
  problems,
  disabled,
  onChange,
  onRemove,
}: {
  line: ReadyVideoDraft;
  problems: DraftProblems;
  disabled: boolean;
  onChange: (patch: Partial<ReadyVideoDraft>) => void;
  onRemove: () => void;
}): JSX.Element {
  const nameId = useId();
  const label = line.label.trim() || 'Nouveau type';
  const nameProblem = problems.get(`${line.id}.label`);
  return (
    <li className="smp-row smp-row--ready" data-off={line.offered ? undefined : 'true'}>
      <div className="smp-row__name">
        <label className="smp-unit__label" htmlFor={nameId}>
          Type de vidéo
        </label>
        <input
          id={nameId}
          className="nv-glass nv-field__control ps-input smp-row__nameinput"
          placeholder="Type de vidéo"
          maxLength={READY_VIDEO_LABEL_MAX}
          value={line.label}
          disabled={disabled}
          aria-invalid={nameProblem !== undefined}
          aria-describedby={nameProblem === undefined ? undefined : `${nameId}-error`}
          onChange={(event) => {
            onChange({ label: event.target.value });
          }}
        />
        {nameProblem === undefined ? null : (
          <p className="ps-error" id={`${nameId}-error`}>
            {nameProblem}
          </p>
        )}
      </div>
      <UnitInput
        label="De"
        value={line.min}
        unit="€"
        problem={problems.get(`${line.id}.min`)}
        disabled={disabled}
        onChange={(min) => {
          onChange({ min });
        }}
      />
      <UnitInput
        label="À"
        value={line.max}
        unit="€"
        problem={problems.get(`${line.id}.max`)}
        disabled={disabled}
        onChange={(max) => {
          onChange({ max });
        }}
      />
      <Offered
        label={label}
        checked={line.offered}
        disabled={disabled}
        words={FOR_SALE}
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
