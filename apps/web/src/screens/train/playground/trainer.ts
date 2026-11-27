import { useRouteContext } from '@tanstack/react-router';

/**
 * Whether the one who trains is the owner (ADR 0092 § 8): an active manager trains too, on the creators of his list, but
 * changes none of her settings, files nothing in her bank and withdraws nothing from it. The server refuses it anyway;
 * the screen offers only what he may do. Drawn outside the app's router (its own tests), the screen is the owner's.
 */
export function useTrainsAsOwner(): boolean {
  const role = useRouteContext({ strict: false, select: (context) => context.user?.role });
  return role === undefined || role === 'owner';
}
