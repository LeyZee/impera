import { z } from 'zod';

/** Dashboard roles (security.md §6): `owner` administers, `operator` chats, `creator` sees her own (phase 5). */
export const UserRoleSchema = z.enum(['owner', 'operator', 'creator']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Who is signed in, as every route sees it. Never carries the session token. `creatorIds`: the creators whose every
 * conversation, fan and figure the account reads. `routedCreatorIds`: the creators where it reads only the
 * conversations routed to it (a team member whose scope is `self`, ADR 0024): their `creatorIds` are moved here.
 */
export const CurrentUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  role: UserRoleSchema,
  creatorIds: z.array(z.uuid()),
  routedCreatorIds: z.array(z.uuid()).default([]),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/**
 * Error code of a sensitive action asked from a session opened too long ago (ADR 0016: AI keys): the page asks for
 * the password again (a new sign-in) and retries.
 */
export const REAUTHENTICATION_ERROR_CODE = 'reauthentication_forbidden';
