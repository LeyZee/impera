import { z } from 'zod';

import { TeamMemberIdSchema } from './ids';
import { PayoutCountrySchema } from './payout-countries';

/**
 * « Où te verser » (ADR 0165, trou n° 5 de la grande recette du 21/11): where a member receives his transfers. He writes
 * it himself; the owner reads it beside « Marquer payé », one member at a time. Everything but the way he receives is
 * sealed on the server; nothing of it is logged, exported or written in the audit log.
 */

/** How a WorldRemit transfer reaches him; a new way is a migration of `payout_destinations_method_check`. */
export const PAYOUT_RECEIVE_METHODS = ['mobile_money', 'bank_account', 'cash_pickup'] as const;
export const PayoutReceiveMethodSchema = z.enum(PAYOUT_RECEIVE_METHODS);
export type PayoutReceiveMethod = z.infer<typeof PayoutReceiveMethodSchema>;

/** A first name or a last name, as written on his ID (WorldRemit pays only that name). */
export const PAYOUT_NAME_MAX = 60;
export const PAYOUT_ORGANISATION_MAX = 60;
export const PAYOUT_CITY_MAX = 60;
export const PAYOUT_EMAIL_MAX = 254;
export const PAYOUT_NOTE_MAX = 200;
/** An IBAN, or a national account number (in Benin the RIB, 23 characters): its spaces removed, 6 to 34 letters and digits. */
export const PAYOUT_ACCOUNT_PATTERN = '^[A-Z0-9]{6,34}$';
/** A phone number in international form, `+` then 8 to 15 digits, its spaces removed. */
export const PAYOUT_PHONE_PATTERN = '^\\+[1-9][0-9]{7,14}$';
/** At most so many changes a day per member (ADR 0165 § 5): a stolen session does not try numbers in a loop. */
export const PAYOUT_CHANGES_PER_DAY = 3;
/** A change younger than this is said in amber beside « Marquer payé » (ADR 0165 § 5). */
export const PAYOUT_RECENT_CHANGE_DAYS = 7;

const line = (max: number) => z.string().trim().min(1).max(max);
const compact = (value: string): string => value.replace(/[\s.-]/g, '').toUpperCase();

const note = line(PAYOUT_NOTE_MAX).nullable();

const phone = z.string().regex(new RegExp(PAYOUT_PHONE_PATTERN), 'Un numéro au format +229…');
const account = z.string().regex(new RegExp(PAYOUT_ACCOUNT_PATTERN), 'Un IBAN ou un RIB');
const email = z.email('Une adresse e-mail').max(PAYOUT_EMAIL_MAX).nullable();

/**
 * What is sealed: what a WorldRemit transfer asks of the one who receives it (its pages for Benin, read on 21/11), and a
 * short note. For every way: the country, the first and last names as on his ID, the city (never a full address), a
 * phone to reach him and, if he wants, an email. Then the mobile money number and its operator, or the bank and the
 * account; cash needs nothing more. Never logged, never in the audit, never used to write to him: the app reaches him
 * by his account. The body takes the numbers as typed (`normalised`: spaces, dots and dashes dropped, in capitals);
 * what is kept and given back is already compact.
 */
function details(normalised: boolean) {
  const typed = (pattern: z.ZodString) =>
    normalised ? z.string().transform(compact).pipe(pattern) : pattern;
  const who = {
    country: PayoutCountrySchema,
    firstName: line(PAYOUT_NAME_MAX),
    lastName: line(PAYOUT_NAME_MAX),
    city: line(PAYOUT_CITY_MAX),
    /** To reach him about a transfer: WorldRemit sends him its reference there. */
    contactPhone: typed(phone),
    email: normalised ? z.string().trim().toLowerCase().pipe(email.unwrap()).nullable() : email,
    note,
  };
  return z.discriminatedUnion('method', [
    z.object({
      method: z.literal('mobile_money'),
      ...who,
      /** The mobile money account's number, which may differ from the contact phone. */
      phone: typed(phone),
      /** The operator (MTN, Moov…). */
      operator: line(PAYOUT_ORGANISATION_MAX),
    }),
    z.object({
      method: z.literal('bank_account'),
      ...who,
      account: typed(account),
      bank: line(PAYOUT_ORGANISATION_MAX),
    }),
    z.object({
      method: z.literal('cash_pickup'),
      ...who,
    }),
  ]);
}

export const PayoutDetailsSchema = details(false);
/** `PUT …/payout-destination`: the details as the member typed them. */
export const PutPayoutDetailsBodySchema = details(true);
export type PayoutDetails = z.infer<typeof PayoutDetailsSchema>;
export type PutPayoutDetailsBody = z.input<typeof PutPayoutDetailsBodySchema>;

export const PayoutDestinationParamsSchema = z.object({ memberId: TeamMemberIdSchema });

/**
 * What a list says of a member's destination, never its details: the way he receives and when he last changed it
 * (a key rotation is not a change). `null` fields when he never filled it.
 */
export const PayoutDestinationSummarySchema = z.object({
  memberId: TeamMemberIdSchema,
  method: PayoutReceiveMethodSchema.nullable(),
  changedAt: z.iso.datetime().nullable(),
});
export type PayoutDestinationSummary = z.infer<typeof PayoutDestinationSummarySchema>;

/** The owner's list, for the pay screens. */
export const PayoutDestinationListSchema = z.object({
  destinations: z.array(PayoutDestinationSummarySchema),
});
export type PayoutDestinationList = z.infer<typeof PayoutDestinationListSchema>;

/** One member's destination with its details: his own, or revealed to the owner. `details` is `null` before he fills it. */
export const PayoutDestinationSchema = PayoutDestinationSummarySchema.extend({
  details: PayoutDetailsSchema.nullable(),
});
export type PayoutDestination = z.infer<typeof PayoutDestinationSchema>;

export const PAYOUT_DESTINATION_ERROR_CODES = [
  /** Only the member writes his own; only he and the owner read it; a manager never (ADR 0165 §§ 3 and 4). */
  'payout_destination_forbidden',
  /** More than `PAYOUT_CHANGES_PER_DAY` changes today. */
  'payout_destination_limited',
  /** No encryption key configured: nothing is kept unsealed. */
  'payout_destination_unavailable',
] as const;
export type PayoutDestinationErrorCode = (typeof PAYOUT_DESTINATION_ERROR_CODES)[number];
