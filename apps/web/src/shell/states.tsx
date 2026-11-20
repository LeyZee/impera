import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { useOnline } from '@/pwa/online';

/*
 * The three states a screen has besides its content, one face each on every screen (recette visuelle 16/11, T6):
 * nothing there yet (`Empty`), the server silent (`Failure`), the content on its way (`Skeleton`).
 */

/**
 * Nothing here yet (COH-04): one sentence in the whisper face, at most one line under it, at most one soft button
 * (`nv-btn nv-btn--soft`, a link or a button). On a card of its own with `plate`, inside the card it stands in for
 * otherwise.
 */
export function Empty({
  title,
  children,
  action,
  icon,
  art,
  plate = false,
  className,
}: {
  /** The sentence: what is not there, said calmly (« Pas encore de facture. »). */
  title: ReactNode;
  /** One line: what brings it, or what to do. */
  children?: ReactNode;
  /** One soft button, never a neon one: the screen keeps its own neon. */
  action?: ReactNode;
  /** A pictogram above the sentence, in a round of glass (the compass of a page that leads nowhere). */
  icon?: ReactNode;
  /**
   * A picture above the sentence (`shell/art`), in place of the pictogram: for a screen that is empty as a whole, never
   * for a line inside a card that holds other things.
   */
  art?: ReactNode;
  /** On a card of its own, when nothing else on the screen holds it. */
  plate?: boolean;
  className?: string;
}): JSX.Element {
  // On a card of its own, the sentence is the card's heading; inside another card, a line of it.
  const Title = plate ? 'h2' : 'p';
  const body = (
    <div className={cn('nv-empty', plate ? undefined : className)}>
      {art === undefined ? null : (
        <span className="nv-empty__art" aria-hidden="true">
          {art}
        </span>
      )}
      {icon === undefined || art !== undefined ? null : (
        <span className="nv-empty__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <Title className="nv-empty__title">{title}</Title>
      {children === undefined ? null : <p className="nv-empty__text">{children}</p>}
      {action === undefined ? null : <div className="nv-empty__action">{action}</div>}
    </div>
  );
  // The plate of a `Panel` (shell/layout.tsx), written here: the layout's `ComingSoon` is an `Empty` itself.
  return plate ? (
    <section className={cn('nv-plate nv-panel nv-empty-plate', className)}>{body}</section>
  ) : (
    body
  );
}

/** A second way out of a failure, before « Réessayer » (the Playground's « Ouvrir Modèles IA »). */
export interface FailureAction {
  readonly label: string;
  readonly onClick: () => void;
}

/** What to do, under the title, when the caller says nothing else. */
export const RETRY_SOON = 'Réessaie dans un instant.';

/**
 * The server is silent (ETA-04): « Le serveur ne répond pas » in amber, one line that says what to do, « Réessayer ».
 * One per screen (ETA-05): the cards whose reads fail for the same reason say nothing of their own. Without a
 * network, it says so: the server is not the one silent (CREA-04). Announced once by a screen reader (`role="alert"`).
 */
export function Failure({
  title,
  children,
  onRetry,
  action,
  headline = false,
  inline = false,
  className,
}: {
  /** « Le serveur ne répond pas » unless said otherwise (a provider's own failure, named as such). */
  title?: ReactNode;
  /** One line: what to do now. « Réessaie dans un instant. » by default. */
  children?: ReactNode;
  onRetry: () => void;
  /** A second button, before « Réessayer ». */
  action?: FailureAction;
  /** The page's own title (a screen with no header above it): an h1, an h2 otherwise. */
  headline?: boolean;
  /** Inside a card already there: no card, no orb, one line. */
  inline?: boolean;
  className?: string;
}): JSX.Element {
  const online = useOnline();
  const Heading = headline ? 'h1' : inline ? 'p' : 'h2';
  const said = title ?? (online ? 'Le serveur ne répond pas' : 'Pas de réseau');
  const todo = children ?? (online ? RETRY_SOON : 'Réessaie dès que le réseau revient.');
  return (
    <section
      className={cn(
        'nv-failure',
        inline ? 'nv-failure--inline' : 'nv-plate nv-plate--pad nv-enter',
        className,
      )}
      role="alert"
    >
      {inline ? null : <span className="nv-orb nv-tone--warn" aria-hidden="true" />}
      <div className="nv-failure__body">
        <Heading className="nv-failure__title">{said}</Heading>
        <p className="nv-failure__text">{todo}</p>
      </div>
      <div className="nv-failure__actions">
        {action === undefined ? null : (
          <button type="button" className="nv-btn nv-btn--soft" onClick={action.onClick}>
            {action.label}
          </button>
        )}
        <button type="button" className="nv-btn nv-btn--soft" onClick={onRetry}>
          Réessayer
        </button>
      </div>
    </section>
  );
}

/**
 * The content on its way (ETA-14, ETA-15): the shapes of the screen it stands for, on the same cards. Said once to a
 * screen reader (« Chargement… »); the shapes themselves are hidden from it. Its children are the shapes
 * (`SkeletonCard`s); one card of three lines without them.
 */
export function Skeleton({
  children,
  columns,
  label = 'Chargement…',
  className,
}: {
  children?: ReactNode;
  /** Cards side by side on a computer, as the loaded screen sets them (one column on a phone). */
  columns?: 2 | 3;
  label?: string;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('nv-skeleton', className)} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="nv-skeleton__shapes" data-columns={columns} aria-hidden="true">
        {children ?? <SkeletonCard />}
      </div>
    </div>
  );
}

/** One card of a skeleton: a title's bar, then lines; as tall as the card it stands for with `height`. */
export function SkeletonCard({
  lines = 3,
  title = true,
  height,
  className,
}: {
  lines?: number;
  title?: boolean;
  /** The loaded card's height in px, so that nothing jumps when it comes. */
  height?: number;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn('nv-plate nv-plate--pad nv-skeleton__card', className)}
      style={height === undefined ? undefined : { minHeight: height }}
    >
      {title ? <i className="nv-skeleton__bar nv-skeleton__bar--title" /> : null}
      {Array.from({ length: lines }, (_, index) => (
        <i key={index} className="nv-skeleton__bar" />
      ))}
    </div>
  );
}
