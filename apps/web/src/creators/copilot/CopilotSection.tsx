import type { CopilotSwitches } from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import {
  COPILOT_ERRORS,
  copilotErrorKind,
  copilotQueryKey,
  saveCopilotSwitch,
  useCopilotSwitches,
} from './api';
import './copilot.css';

import { NavIcon, type NavIconName } from '@/shell/NavIcon';

type SwitchName = keyof CopilotSwitches;

/**
 * The fan's card: one figure on a card, in the stroke of the menu's icons (Design 21/11: three figures say « Équipe »,
 * not one fan's card).
 */
function FanCardIcon(): JSX.Element {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.8" y="4.5" width="18.4" height="15" rx="3" />
      <circle cx="8.8" cy="10.6" r="2.3" />
      <path d="M5.4 16.2c.7-1.6 1.9-2.4 3.4-2.4s2.7.8 3.4 2.4" />
      <path d="M14.6 10h3.6M14.6 13.6h2.6" />
    </svg>
  );
}

/** Each switch in the owner's words: what the chatter sees beside Reveal when it is on. */
const SWITCHES: readonly {
  readonly name: SwitchName;
  readonly icon: NavIconName | 'card';
  readonly title: string;
  readonly does: string;
  /** Its state in words, agreed with its name: « Allumée » for the card, « Allumés » for the drafts. */
  readonly on: string;
  readonly off: string;
}[] = [
  {
    name: 'fanCard',
    icon: 'card',
    title: 'Fiche du fan',
    does: 'Ce qu’on sait de lui, ses limites et ce qu’il reste à découvrir, à côté de la conversation.',
    on: 'Allumée',
    off: 'Éteinte',
  },
  {
    name: 'drafts',
    icon: 'tracking',
    title: 'Brouillons de l’IA',
    does: 'L’IA prépare chaque réponse\u00a0; le chatteur la relit, la retouche et l’envoie lui-même dans Reveal.',
    on: 'Allumés',
    off: 'Éteints',
  },
];

/** The answer first (Charles 21/11): what the chatters get for her right now, in one line. */
function headline(
  switches: CopilotSwitches,
  name: string,
): { readonly text: string; readonly tone: 'on' | 'off' } {
  if (switches.drafts && switches.fanCard)
    return { text: `Les chatteurs de ${name} ont la fiche du fan et les brouillons de l’IA.`, tone: 'on' };
  if (switches.drafts)
    return { text: `Les chatteurs de ${name} ont les brouillons, sans la fiche du fan.`, tone: 'on' };
  return {
    text: switches.fanCard
      ? `Dans l’extension, brouillons éteints\u00a0: les chatteurs de ${name} écrivent seuls, avec la fiche du fan.`
      : `Dans l’extension, rien d’allumé\u00a0: les chatteurs de ${name} n’ont ni fiche ni brouillon.`,
    tone: 'off',
  };
}

/**
 * Créatrices › IA › « Copilote dans l'extension » (ADR 0086 § 6), the owner's alone: her two switches of the panel
 * beside Reveal. Each one saves at once, without a save bar: a switch says its state, and nothing is sent to a fan.
 */
export function CopilotSection({
  creatorId,
  creatorName,
}: {
  creatorId: string;
  creatorName: string;
}): JSX.Element {
  const query = useCopilotSwitches(creatorId);
  const client = useQueryClient();
  const [busy, setBusy] = useState<SwitchName | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  if (query.data === undefined) {
    return query.isError ? (
      <section className="nv-plate cc-card" aria-label="Copilote dans l’extension">
        <p className="nv-h3 cc-title">Le copilote ne se charge pas</p>
        <p className="cc-muted">{COPILOT_ERRORS[copilotErrorKind(query.error)]}</p>
        <button
          type="button"
          className="nv-btn nv-btn--soft cc-self-start"
          onClick={() => void query.refetch()}
        >
          Réessayer
        </button>
      </section>
    ) : (
      <section
        className="nv-plate cc-card cc-skeleton"
        aria-busy="true"
        aria-label="Copilote dans l’extension"
      />
    );
  }

  const switches = query.data;
  const head = headline(switches, creatorName);
  const toggle = async (name: SwitchName, on: boolean): Promise<void> => {
    setBusy(name);
    setFailed(null);
    try {
      const saved = await saveCopilotSwitch(creatorId, name === 'drafts' ? { drafts: on } : { fanCard: on });
      client.setQueryData(copilotQueryKey(creatorId), saved);
    } catch (error) {
      setFailed(COPILOT_ERRORS[copilotErrorKind(error)]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="nv-plate cc-card" aria-labelledby="cc-title">
      <header className="cc-head">
        <span className="cc-head__icon">
          <NavIcon name="puzzle" />
        </span>
        <div className="cc-head__words">
          <h2 id="cc-title" className="nv-h3 cc-title">
            Copilote dans l’extension
          </h2>
          <p className="cc-headline" data-tone={head.tone}>
            {head.text}
          </p>
        </div>
      </header>
      <ul className="cc-rows">
        {SWITCHES.map(({ name, icon, title, does, on: onWord, off: offWord }) => {
          const on = switches[name];
          return (
            <li key={name} className="cc-row" data-on={on ? 'true' : 'false'}>
              <span className="cc-row__icon" data-switch={name}>
                {icon === 'card' ? <FanCardIcon /> : <NavIcon name={icon} />}
              </span>
              <div className="cc-row__words">
                <p className="cc-row__title">
                  <span className="cc-row__name">{title}</span>
                  <span className="cc-state">{on ? onWord : offWord}</span>
                </p>
                <p className="cc-muted">{does}</p>
              </div>
              <input
                type="checkbox"
                role="switch"
                className="nv-switch"
                checked={on}
                disabled={busy !== null}
                aria-label={`${title} : ${(on ? onWord : offWord).toLocaleLowerCase('fr-FR')}`}
                onChange={(event) => void toggle(name, event.target.checked)}
              />
            </li>
          );
        })}
      </ul>
      {failed === null ? null : (
        <p className="cc-failed" role="alert">
          Rien n’a changé. {failed}
        </p>
      )}
    </section>
  );
}
