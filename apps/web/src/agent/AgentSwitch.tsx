import { useState, type JSX } from 'react';

import { agentStateOf, pauseChoices, type AgentStateInput, type PauseChoice } from './state';
import { useAgentModeWriter } from './write';
import './switch.css';

import { AutomaticConfirm } from '@/screens/dashboard/AutomaticConfirm';
import { Dialog } from '@/shell/Dialog';

/**
 * Her AI's switch (ADR 0148 § 1): the state in words, and the gestures that change it, the same setting as the
 * Dashboard's control, never a second one. « Pause » (1 h, or until 9:00 tomorrow on her clock; out of her hours,
 * only what ends after she opens again), « Couper » after a confirmation that says what stops and what stays,
 * « Rallumer » back to the mode she had. The global switch is said, never lifted from here. `card` is the line of her
 * card in the list of Créatrices, `header` sits in her sheet's header, next to her name (avis Design, 19/11).
 */
export function AgentSwitch({
  creatorId,
  creatorName,
  zone,
  state: input,
  read,
  variant,
  readOnly = false,
}: {
  creatorId: string;
  creatorName: string;
  /** Her clock: every hour the switch says is read on it. */
  zone: string;
  state: AgentStateInput;
  /** When the server last answered the page: a refusal stays said until the next answer. */
  read: number;
  variant: 'card' | 'header';
  /** The reader may say the state but not change it (a chatter, a scope of one's own): no gesture shown. */
  readOnly?: boolean;
}): JSX.Element {
  const writer = useAgentModeWriter(creatorId, read);
  const [asking, setAsking] = useState<'pause' | 'cut' | null>(null);
  const now = new Date();
  const state = agentStateOf(input, zone, now);
  // An expired session holds nothing she chose: her AI may still be paused or cut while it is captured again.
  const running =
    state.kind === 'on' ||
    state.kind === 'out' ||
    state.kind === 'expired' ||
    state.kind === 'no_scripts' ||
    state.kind === 'drafts_off' ||
    state.kind === 'outage';
  const stopped = state.kind === 'paused' || state.kind === 'off';
  const choices = pauseChoices(zone, now, state.kind === 'out' ? (input.hoursNow?.changesAt ?? null) : null);

  return (
    <div
      className={`ai-switch ai-switch--${variant}`}
      data-state={state.kind}
      aria-busy={writer.pending || undefined}
    >
      <p className="ai-switch__state" role="status">
        <span className={`nv-dot ai-switch__dot ai-switch__dot--${state.kind}`} aria-hidden="true" />
        <span className="ai-switch__words">
          <strong className="ai-switch__label">{state.label}</strong>
          {state.detail === null && variant === 'header' ? null : (
            <span className="ai-switch__detail">{state.detail ?? ''}</span>
          )}
        </span>
      </p>
      {state.kind === 'global' || readOnly ? null : (
        <div className="ai-switch__actions">
          {running ? (
            <>
              {choices.length === 0 ? null : (
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  disabled={writer.pending}
                  onClick={() => {
                    setAsking('pause');
                  }}
                >
                  Pause
                </button>
              )}
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm"
                disabled={writer.pending}
                onClick={() => {
                  setAsking('cut');
                }}
              >
                Couper
              </button>
            </>
          ) : null}
          {stopped ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              disabled={writer.pending}
              onClick={() => {
                writer.setMode(input.resumesAs);
              }}
            >
              Rallumer
            </button>
          ) : null}
        </div>
      )}
      {writer.notice === null ? null : (
        <p className="ai-switch__notice" role="alert">
          {writer.notice}
        </p>
      )}
      {asking === 'pause' ? (
        <PauseDialog
          creatorName={creatorName}
          choices={choices}
          onCancel={() => {
            setAsking(null);
          }}
          onPick={(choice) => {
            setAsking(null);
            writer.setMode('stop', choice.until);
          }}
        />
      ) : null}
      {asking === 'cut' ? (
        <CutDialog
          creatorName={creatorName}
          onCancel={() => {
            setAsking(null);
          }}
          onConfirm={() => {
            setAsking(null);
            writer.setMode('stop');
          }}
        />
      ) : null}
      {writer.asking ? (
        <AutomaticConfirm
          creatorName={creatorName}
          onConfirmed={writer.confirmed}
          onCancel={writer.cancelled}
        />
      ) : null}
    </div>
  );
}

function PauseDialog({
  creatorName,
  choices,
  onCancel,
  onPick,
}: {
  creatorName: string;
  choices: readonly PauseChoice[];
  onCancel: () => void;
  onPick: (choice: PauseChoice) => void;
}): JSX.Element {
  return (
    <Dialog title="Mettre l’IA en pause" onClose={onCancel}>
      <p className="ai-dialog__lead">
        Plus aucun message ne part au nom de {creatorName} pendant la pause. À la fin, l’IA reprend seule dans
        le mode d’avant et répond aux fans qui ont écrit entre-temps.
      </p>
      <div className="ai-pause">
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className="nv-btn nv-btn--soft ai-pause__choice"
            onClick={() => {
              onPick(choice);
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function CutDialog({
  creatorName,
  onCancel,
  onConfirm,
}: {
  creatorName: string;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Dialog title="Couper l’IA ?" onClose={onCancel}>
      <p className="ai-dialog__lead">
        Plus aucun message ne part au nom de {creatorName}, ni proposé ni envoyé.
      </p>
      <ul className="ai-cut">
        <li>Les conversations restent lues et notées.</li>
        <li>Les chatteurs reprennent dans Reveal comme avant.</li>
        <li>« Rallumer » la remet dans le mode d’avant.</li>
      </ul>
      <div className="tm-dialog__foot">
        <button type="button" className="nv-btn nv-btn--soft" data-autofocus onClick={onCancel}>
          Annuler
        </button>
        <button type="button" className="nv-btn nv-btn--soft nv-btn--destructive" onClick={onConfirm}>
          Couper l’IA
        </button>
      </div>
    </Dialog>
  );
}
