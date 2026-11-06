import type {
  Platform,
  SalesFeedCheckReport,
  SalesFeedChatterLink,
  SalesFeedModelLink,
} from '@impera/contracts';
import { useEffect, useId, useState, type JSX } from 'react';

import { CheckReport } from './CheckReport';
import { fetchLastCheck, runCheck } from './api';
import {
  decodeExport,
  EXPORT_MAX_CHARS,
  fortnightsOver,
  isWholeFortnight,
  lastDayOver,
  rangeLabel,
  rangeProblem,
  type DayRange,
} from './check';
import { platformName, shownOf, type Notice } from './shown';

import { DayField } from '@/scheduling/DayField';
import { useUnreadableTimes } from '@/scheduling/TimeField';
import { SignInAgain } from '@/settings/services/PasswordPrompt';

type Choice = 0 | 1 | 'custom';

interface Shown {
  readonly report: SalesFeedCheckReport;
  /** `null` until the server said whether the switch can rest on it. */
  readonly clean: boolean | null;
  readonly at: Date;
  /** Read back on return, not run on this visit. */
  readonly isKept: boolean;
}

interface ChosenExport {
  readonly name: string;
  readonly text: string;
  readonly lines: number;
}

const capitalized = (text: string): string => text.replace(/^./u, (first) => first.toUpperCase());

const lineCount = (text: string): number =>
  text.split(/\r\n|\r|\n/u).filter((line) => line.trim() !== '').length;

/**
 * The reliability check of Réglages › Ventes (CRM-02, ADR 0050 § 8): the owner picks days already over, adds the
 * dashboard's export if they have it, and reads, to the cent, whether the register says what the platform's
 * statistics and export say. Nothing is written and no amount moves; the export is read for the answer and kept
 * nowhere, on the page or on the server.
 */
export function CheckPanel({
  platform,
  models,
  chatters,
}: {
  platform: Platform;
  models: readonly SalesFeedModelLink[];
  chatters: readonly SalesFeedChatterLink[];
}): JSX.Element {
  const id = useId();
  const name = platformName(platform);
  const [opened] = useState(() => new Date());
  const lastOver = lastDayOver(opened);
  const fortnights = fortnightsOver(opened);
  const [choice, setChoice] = useState<Choice>(0);
  const [custom, setCustom] = useState<DayRange>(fortnights[0]);
  const [chosen, setChosen] = useState<ChosenExport | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [result, setResult] = useState<Shown | null>(null);

  // The latest report kept is shown again on return (CRM-03); a check run since replaces it. Failing to read it hides
  // nothing the owner needs: the form is there to check again.
  useEffect(() => {
    let isCurrent = true;
    fetchLastCheck(platform).then(
      ({ last }) => {
        if (!isCurrent || last === null) return;
        setResult(
          (before) => before ?? { report: last.report, clean: last.clean, at: new Date(), isKept: true },
        );
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [platform]);

  const range: DayRange = choice === 'custom' ? custom : fortnights[choice];
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const problem =
    choice === 'custom' && unreadable
      ? 'Deux jours comme 01/10/2026, ou 1/10.'
      : rangeProblem(range, lastOver);

  const choose = (file: File | undefined): void => {
    setFileProblem(null);
    if (file === undefined) {
      setChosen(null);
      return;
    }
    file.arrayBuffer().then(
      (bytes) => {
        const text = decodeExport(bytes);
        if (text.length > EXPORT_MAX_CHARS) {
          setChosen(null);
          setFileProblem('Ce fichier dépasse 2 Mo : exporte moins de jours à la fois.');
          return;
        }
        setChosen({ name: file.name, text, lines: lineCount(text) });
      },
      () => {
        setChosen(null);
        setFileProblem('Ce fichier n’a pas pu être lu. Télécharge-le de nouveau puis réessaie.');
      },
    );
  };

  const check = (): void => {
    if (problem !== null || isBusy) return;
    setNotice(null);
    setIsBusy(true);
    const lead = 'La vérification n’a pas eu lieu.';
    runCheck(platform, { from: range.from, to: range.to, export: chosen?.text ?? null })
      .then(
        (answer) => {
          if (answer.ok) {
            const { report } = answer;
            setResult({ report, clean: null, at: new Date(), isKept: false });
            // Whether the switch can rest on it is the server's rule: read back with the report it kept.
            fetchLastCheck(platform).then(
              ({ last }) => {
                if (last?.report.generatedAt !== report.generatedAt) return;
                setResult((shown) => (shown?.report === report ? { ...shown, clean: last.clean } : shown));
              },
              () => undefined,
            );
            return;
          }
          setNotice({ message: `${lead} ${answer.refusal.message}`, isSessionExpired: false, tone: 'error' });
        },
        (error: unknown) => {
          setNotice({ ...shownOf(error, lead), tone: 'error' });
        },
      )
      .finally(() => {
        setIsBusy(false);
      });
  };

  return (
    <section className="nv-plate sf-check" aria-labelledby={`${id}-title`}>
      <header className="sf-links__head sf-check__head">
        <h3 id={`${id}-title`} className="sf-links__title">
          Vérification de fiabilité
        </h3>
        <p className="sv-muted">
          Avant qu’un compte passe sur le net de {name}, compare au centime le registre d’Impera avec les
          statistiques de {name} et l’export de son dashboard, jour par jour puis membre par membre. Rien
          n’est écrit, aucun montant ne bouge.
        </p>
      </header>

      <form
        className="sf-check__form"
        aria-busy={isBusy}
        onSubmit={(event) => {
          event.preventDefault();
          check();
        }}
      >
        <fieldset className="sf-fieldset">
          <legend className="nv-field__label">Les jours</legend>
          <div className="sf-choices">
            {fortnights.map((fortnight, index) => (
              <label key={fortnight.from} className="sf-choice">
                <input
                  type="radio"
                  name={`${id}-days`}
                  checked={choice === index}
                  disabled={isBusy}
                  onChange={() => {
                    setChoice(index === 0 ? 0 : 1);
                  }}
                />
                <span>{capitalized(rangeLabel(fortnight))}</span>
              </label>
            ))}
            <label className="sf-choice">
              <input
                type="radio"
                name={`${id}-days`}
                checked={choice === 'custom'}
                disabled={isBusy}
                onChange={() => {
                  setChoice('custom');
                }}
              />
              <span>Autres jours</span>
            </label>
          </div>
          {choice === 'custom' ? (
            <div className="sf-dates">
              <div className="nv-field">
                <label className="nv-field__label" htmlFor={`${id}-from`}>
                  Du
                </label>
                <DayField
                  id={`${id}-from`}
                  value={custom.from}
                  disabled={isBusy}
                  onChange={(next) => {
                    setCustom({ ...custom, from: next });
                  }}
                  today={lastOver}
                  toward="past"
                  onUnreadable={(bad) => {
                    onUnreadable('from', bad);
                  }}
                />
              </div>
              <div className="nv-field">
                <label className="nv-field__label" htmlFor={`${id}-to`}>
                  Au
                </label>
                <DayField
                  id={`${id}-to`}
                  value={custom.to}
                  disabled={isBusy}
                  onChange={(next) => {
                    setCustom({ ...custom, to: next });
                  }}
                  today={lastOver}
                  toward="past"
                  onUnreadable={(bad) => {
                    onUnreadable('to', bad);
                  }}
                />
              </div>
            </div>
          ) : null}
          {problem === null ? (
            <p className="sv-muted sf-small">
              Des jours déjà terminés, à l’heure de Paris, 31 au plus.
              {isWholeFortnight(range) ? null : ' La bascule du compte demandera une quinzaine entière.'}
            </p>
          ) : (
            <p className="sf-warn" role="status">
              {problem}
            </p>
          )}
        </fieldset>

        <div className="nv-field">
          <span className="nv-field__label" id={`${id}-file-label`}>
            Export du dashboard <span className="sf-faint">facultatif</span>
          </span>
          {/* The browser's own file button speaks its language, not the page's: a pill of ours over the input. */}
          <label
            className="nv-btn nv-btn--soft nv-btn--sm sf-file"
            data-disabled={isBusy ? 'true' : undefined}
          >
            <input
              key={fileKey}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain"
              aria-labelledby={`${id}-file-label`}
              aria-describedby={`${id}-file-hint`}
              disabled={isBusy}
              onChange={(event) => {
                choose(event.target.files?.[0]);
              }}
            />
            <span aria-hidden="true">
              {chosen === null ? 'Choisir le fichier CSV' : 'Choisir un autre fichier'}
            </span>
          </label>
          {fileProblem === null ? null : (
            <p className="sf-warn" role="alert">
              {fileProblem}
            </p>
          )}
          {chosen === null ? null : (
            <p className="sf-chosen">
              <span>
                {chosen.name} ·{' '}
                {chosen.lines > 1 ? `${String(chosen.lines)} lignes` : `${String(chosen.lines)} ligne`}
              </span>
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={isBusy}
                onClick={() => {
                  setChosen(null);
                  setFileKey((key) => key + 1);
                }}
              >
                Retirer le fichier
              </button>
            </p>
          )}
          <p id={`${id}-file-hint`} className="sv-muted sf-small">
            Le fichier CSV des ventes de {name}, téléchargé juste avant de lancer : une vente arrivée après
            n’y serait pas. Il est lu pour la réponse et gardé nulle part. Sans lui, le registre n’est comparé
            qu’aux statistiques, et le verdict reste « incomplet » : la bascule demande les trois sources.
          </p>
        </div>

        <div className="sf-check__act">
          <button type="submit" className="nv-btn nv-btn--soft" disabled={problem !== null || isBusy}>
            {isBusy ? 'Vérification…' : 'Vérifier ces jours'}
          </button>
        </div>

        {notice === null ? null : (
          <>
            <p className="sv-notice" role="alert" data-tone={notice.tone}>
              {notice.message}
            </p>
            {notice.isSessionExpired ? <SignInAgain /> : null}
          </>
        )}
      </form>

      {result === null ? null : (
        <CheckReport
          report={result.report}
          isKept={result.isKept}
          clean={result.clean}
          platformName={name}
          models={models}
          chatters={chatters}
          now={result.at}
        />
      )}
    </section>
  );
}
