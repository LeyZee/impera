import { z } from 'zod';

import { AnnouncementIdSchema, CreatorIdSchema, TeamMemberIdSchema } from './ids';

/**
 * Annonces (EQ-12, ADR 0024 « Équipe : …, Annonces »): the owner or an active manager writes to the whole team or to
 * the members of one creator; each member reads it in Aujourd'hui and says « Lu »; the author sees who has read it.
 * Never fan data: the screen says so, the server cannot tell. Error codes of `/v1/team/announcements`:
 * - `announcement_not_found` (404): unknown, withdrawn, or not addressed to the reader;
 * - `announcement_creator_forbidden` (403): a manager writing to the members of a creator outside his own list;
 * - `announcement_withdraw_forbidden` (403): withdrawn by neither its author nor the owner.
 */

export const ANNOUNCEMENT_BODY_MAX = 1000;

/** `POST /v1/team/announcements`: `creatorId` `null` writes to the whole team. */
export const CreateAnnouncementBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(ANNOUNCEMENT_BODY_MAX),
  creatorId: CreatorIdSchema.nullable(),
});
export type CreateAnnouncementBody = z.infer<typeof CreateAnnouncementBodySchema>;

/** How many of those it is addressed to have read it: the owner's and the managers' view only. */
export const AnnouncementReadCountSchema = z.object({
  read: z.number().int().min(0),
  of: z.number().int().min(0),
});

export const AnnouncementSchema = z.object({
  id: AnnouncementIdSchema,
  body: z.string().min(1).max(ANNOUNCEMENT_BODY_MAX),
  /** `null`: the whole team. */
  creatorId: CreatorIdSchema.nullable(),
  creatorName: z.string().min(1).nullable(),
  authorName: z.string().min(1),
  /** The reader wrote it. */
  mine: z.boolean(),
  createdAt: z.iso.datetime(),
  /** When the reader said « Lu »; `null` while he has not, and for the owner, who is no member. */
  readAt: z.iso.datetime().nullable(),
  /** `null` for a chatter: who read it is the author's and the managers' to see. */
  reads: AnnouncementReadCountSchema.nullable(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** `GET /v1/team/announcements`: the newest first, withdrawn ones left out. */
export const AnnouncementListSchema = z.object({ announcements: z.array(AnnouncementSchema) });
export type AnnouncementList = z.infer<typeof AnnouncementListSchema>;

/** `POST /v1/team/announcements/:announcementId/read`: the first « Lu » stays, a second one returns it. */
export const AnnouncementReadSchema = z.object({
  announcementId: AnnouncementIdSchema,
  readAt: z.iso.datetime(),
});
export type AnnouncementRead = z.infer<typeof AnnouncementReadSchema>;

/** One member it is addressed to, and when he read it. */
export const AnnouncementReaderSchema = z.object({
  memberId: TeamMemberIdSchema,
  name: z.string().min(1),
  readAt: z.iso.datetime().nullable(),
});
export type AnnouncementReader = z.infer<typeof AnnouncementReaderSchema>;

/** `GET /v1/team/announcements/:announcementId/readers`, owner and active managers: those who read first, by time. */
export const AnnouncementReaderListSchema = z.object({ readers: z.array(AnnouncementReaderSchema) });
export type AnnouncementReaderList = z.infer<typeof AnnouncementReaderListSchema>;
