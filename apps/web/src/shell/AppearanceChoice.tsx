import { useId, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { APPEARANCES, readAppearance, setAppearance, type Appearance } from './appearance';

const LABELS: Readonly<Record<Appearance, string>> = { night: 'Nuit', day: 'Jour', device: 'Appareil' };

/** Arrow keys of the radio group and the way they move (as the Dashboard's mode control). */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Nuit, Jour or Appareil, in the account's menu (NAV-03): a choice of this browser, open to every role, applied at
 * once. Appareil follows the light or dark setting of the computer or the phone; without a choice, it is the night.
 */
export function AppearanceChoice(): JSX.Element {
  const [appearance, setChoice] = useState(readAppearance);
  const group = useRef<HTMLDivElement>(null);
  // The menu and the phone's sheet may both hold one: each names its own group.
  const labelId = useId();
  const pick = (value: Appearance): void => {
    setAppearance(value);
    setChoice(value);
  };
  // A radio group: one stop in the Tab order (the checked choice), the arrows move and pick.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = APPEARANCES.indexOf(appearance);
    const next = APPEARANCES[(at + step + APPEARANCES.length) % APPEARANCES.length];
    if (next === undefined) return;
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
    pick(next);
  };
  return (
    <div className="nv-appearance">
      <span className="nv-appearance__label" id={labelId}>
        Apparence
      </span>
      <div
        ref={group}
        className="nv-seg nv-glass nv-glass--thin nv-appearance__seg"
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-hint`}
        style={{ '--nv-seg-count': APPEARANCES.length, '--nv-seg-index': APPEARANCES.indexOf(appearance) }}
        onKeyDown={onKeyDown}
      >
        <span className="nv-seg__thumb nv-glass nv-glass--thin" aria-hidden="true" />
        {APPEARANCES.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            className="nv-seg__opt"
            data-value={value}
            aria-checked={value === appearance}
            tabIndex={value === appearance ? 0 : -1}
            onClick={() => {
              pick(value);
            }}
          >
            {LABELS[value]}
          </button>
        ))}
      </div>
      {/* Said on screen, not in a title: the phone and the touch have no hover (NAV-03). */}
      <p className="nv-appearance__hint" id={`${labelId}-hint`}>
        Appareil suit le réglage clair ou sombre du téléphone ou de l’ordinateur. Le choix vaut pour ce
        navigateur.
      </p>
    </div>
  );
}
