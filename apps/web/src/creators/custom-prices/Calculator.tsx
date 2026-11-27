import {
  isPerMinute,
  quoteCustomOrder,
  type CustomFormat,
  type CustomPriceGrid,
  type CustomQuoteLine,
} from '@impera/contracts';
import { useId, useState, type JSX } from 'react';

import { euros, FORMAT_LABELS, lineName, minutesOf, quoteSentence, roundingLine } from './model';
import { Card, UnitInput } from './parts';

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
export function Calculator({ grid, stale }: { grid: CustomPriceGrid; stale: boolean }): JSX.Element {
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
  // The total is rounded to the euro: the detail says by how much, so it adds up (CODE-05).
  const rounding = quote.kind === 'price' ? roundingLine(quote.totalMinor, quote.lines) : null;
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
          {grid.supplements.length === 0 ? null : (
            <>
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
            </>
          )}
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
              {rounding === null ? null : (
                <li className="smp-calc__line">
                  <span>Arrondi</span>
                  <span className="smp-calc__amount">{rounding}</span>
                </li>
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
