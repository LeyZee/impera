import type { JSX } from 'react';

/**
 * « Le serveur ne répond pas », said the same way on every screen that reads first (DASH-22): the sentence, what it
 * holds back, and « Réessayer ». Amber, a warning: the red stays the urgencies'.
 */
export function ServerSilent({
  text,
  onRetry,
  headline = false,
}: {
  /** What could not be read, and what that means meanwhile. */
  text: string;
  onRetry: () => void;
  /** The page's own headline (the Dashboard has no title above it); a section's heading otherwise. */
  headline?: boolean;
}): JSX.Element {
  const Heading = headline ? 'h1' : 'h2';
  return (
    <section className="nv-silent nv-enter" role="status" aria-live="polite">
      <span className="nv-orb nv-tone--warn" aria-hidden="true" />
      <div className="nv-silent__body">
        <Heading className="nv-silent__title">
          Le serveur <em>ne répond pas</em>
        </Heading>
        <p className="nv-silent__text">{text}</p>
      </div>
      <button type="button" className="nv-btn nv-btn--soft nv-btn--sm nv-silent__retry" onClick={onRetry}>
        Réessayer
      </button>
    </section>
  );
}
