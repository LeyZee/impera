import { useSyncExternalStore, type JSX } from 'react';

import { Page, PageHeader, Panel, PanelSection } from '../shell/layout';

import {
  canPromptInstall,
  isStandalone,
  onInstallPrompt,
  platformOf,
  promptInstall,
  type Platform,
} from './install';

const STEPS: Record<
  Exclude<Platform, 'other'>,
  { readonly title: string; readonly steps: readonly string[] }
> = {
  ios: {
    title: 'Sur iPhone',
    steps: [
      'Ouvre Nirvana dans Safari (pas dans une autre application).',
      'Touche le bouton Partager, le carré avec une flèche vers le haut.',
      'Choisis « Sur l’écran d’accueil », puis « Ajouter ».',
      'Ouvre Nirvana depuis son icône : c’est là que les notifications arrivent.',
    ],
  },
  android: {
    title: 'Sur Android',
    steps: [
      'Ouvre Nirvana dans Chrome.',
      'Touche le menu ⋮ en haut à droite.',
      'Choisis « Installer l’application », puis « Installer ».',
      'Ouvre Nirvana depuis son icône.',
    ],
  },
};

/** /aide/installer (CR-01): the steps for an iPhone and an Android phone, the device's own first. */
export function InstallPage(): JSX.Element {
  const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
  const canPrompt = useSyncExternalStore(onInstallPrompt, canPromptInstall, () => false);
  const order: readonly Exclude<Platform, 'other'>[] =
    platform === 'android' ? ['android', 'ios'] : ['ios', 'android'];
  return (
    <Page>
      <PageHeader
        title="Installer Nirvana"
        lead="Une minute, une seule fois : ensuite Nirvana s’ouvre depuis son icône, en plein écran, comme une app."
      />
      <div className="nv-help-install">
        {isStandalone() ? (
          <Panel>
            <PanelSection className="nv-help-install__done">
              <p>Nirvana est installée sur cet appareil : tu l’as ouverte depuis son icône.</p>
            </PanelSection>
          </Panel>
        ) : null}
        {canPrompt ? (
          <Panel>
            <PanelSection className="nv-help-install__now">
              <p>Ton navigateur peut l’installer tout de suite.</p>
              <button
                type="button"
                className="nv-btn nv-btn--neon"
                onClick={() => {
                  void promptInstall();
                }}
              >
                Installer Nirvana
              </button>
            </PanelSection>
          </Panel>
        ) : null}
        <div className="nv-help-install__cards">
          {order.map((key) => (
            <Panel key={key} title={STEPS[key].title}>
              <PanelSection>
                <ol className="nv-help-install__steps">
                  {STEPS[key].steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </PanelSection>
            </Panel>
          ))}
        </div>
        <p className="nv-help-install__note">
          Sur iPhone, les notifications ne marchent que dans l’application installée : c’est une règle
          d’Apple.
        </p>
      </div>
    </Page>
  );
}
