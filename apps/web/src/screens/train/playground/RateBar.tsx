import type { PlaygroundState } from '@nirvana/contracts';
import { countUp } from '@nirvana/design-system';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, type JSX } from 'react';

import { euros, FICTIONAL, percent, rateTone } from './logic';

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/**
 * The one number of the screen, and nothing that competes with it: what wrote the answers and what the
 * session cost sit in retreat on the right. The action lives under the answer, not here.
 * This is the playground rate (ADR 0019): it calibrates a voice version and never opens the automatic mode.
 */
export function RateBar({ state, isDemo }: { state: PlaygroundState; isDemo: boolean }): JSX.Element {
  const { target, rated, trendPoints, previousVersion } = state.rate;
  // In the demo nothing is rated for real: its rate is made up, so the screen's one number stays empty.
  const rate = isDemo ? null : state.rate.rate;
  const tone = rateTone(rate, target);
  const valueRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);

  // The rate counts up to its new value from the one on screen, never from zero.
  useEffect(() => {
    const element = valueRef.current;
    if (element === null) return;
    if (rate === null) {
      element.textContent = percent(null);
      return;
    }
    const from = shown.current;
    shown.current = rate;
    return countUp(element, rate, (value) => percent(value), { from, durationMs: 900 });
  }, [rate]);

  return (
    <div className="pg-bar nv-plate">
      <div className={`pg-rate pg-rate--${tone}`}>
        {/* Written by the effect only: React never owns this text, so the count is never overwritten. */}
        <span className={`pg-rate__v ${rate === null ? 'is-empty' : ''}`} ref={valueRef} />
        <span className="pg-rate__t">
          <span className="pg-rate__n">Validées sans retouche</span>
          <span
            className="pg-meter"
            role="img"
            aria-label={`${percent(rate)} sur un objectif de ${percent(target)}`}
          >
            <i style={{ width: `${String((rate ?? 0) * 100)}%` }} />
            <b style={{ left: `${String(target * 100)}%` }} />
          </span>
          <span className="pg-rate__d">
            {isDemo ? (
              'Démo : rien n’est noté pour de vrai'
            ) : rate === null ? (
              'Note ta première réponse pour lancer le taux'
            ) : (
              <>
                Sur {plural(rated, 'réponse notée', 'réponses notées')} · objectif {percent(target)}
                {trendPoints === null || previousVersion === null ? null : (
                  <>
                    {' · '}
                    <b className={trendPoints < 0 ? 'is-down' : undefined}>
                      {trendPoints >= 0 ? '+' : ''}
                      {Math.round(trendPoints)} pts
                    </b>{' '}
                    depuis la voix {previousVersion.voicePrompt}
                  </>
                )}
              </>
            )}
          </span>
        </span>
      </div>
      <span className="pg-bar__sp" />
      {/*
        Whom the answers speak as: the playground's own fictional persona (ADR 0010), never a creator's. Its rate
        calibrates the voice on it, not on the persona she writes with (M13).
      */}
      <span className="pg-bar__meta" title={FICTIONAL}>
        Persona fictive : {state.persona.name}
      </span>
      {isDemo ? (
        <span
          className="pg-demo"
          title="Démo : les réponses sont écrites à l’avance, le serveur n’est pas appelé."
        >
          Démo
        </span>
      ) : null}
      {/* With no key, a model name and a zero cost would read as a voice ready to write: the bar says the one thing. */}
      {state.voice.reachable ? (
        <span className="pg-bar__meta" title="La voix qui écrit, et ce que cette session a coûté">
          <span className="pg-mono">
            Voix {state.version.voicePrompt} · {state.version.voiceModel}
          </span>
          <span>{euros(state.sessionCostEur)} cette session</span>
        </span>
      ) : (
        <Link
          to="/reglages/modeles-ia"
          className="pg-key"
          title="Aucune clé n’atteint le modèle de la voix : l’agent ne pourra pas répondre."
        >
          Clé manquante
        </Link>
      )}
    </div>
  );
}
