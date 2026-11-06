import { z } from 'zod';

/**
 * « Qui sont tes fans » (CR-15, ADR 0063 § 2, 0065 § 2 à § 5, 0074): figures on the whole of a creator's fans, never
 * one fan's. The server ranks each declared fact into a fixed case (ADR 0074 § 3 to § 6) and answers shares only: no
 * case carries its number of fans, a block's « l'ont dit » total is rounded to ten, and a block on fewer than
 * `FAN_FIGURES_MIN_FANS` fans answers `too_few` with nothing else (ADR 0074 § 8). Every object is `strict`: a value a
 * fan wrote, or an exact count, added by mistake fails the contract instead of reaching her screen.
 */

/** A figure is shown only when it bears on at least this many fans (ADR 0065 § 4). */
export const FAN_FIGURES_MIN_FANS = 10;

/** A case of fewer fans joins « Autres » (ADR 0065 § 4). */
export const FAN_FIGURES_MIN_CASE = 3;

/** How many named cases a ranked block (place, job) shows before « Autres » (ADR 0065 § 3). */
export const FAN_FIGURES_TOP = 5;

/** The case every block may end with: what is rare, unrecognised or below `FAN_FIGURES_MIN_CASE`. */
export const OTHER_CASE = 'other';

/** The age bands of ADR 0065 § 3. */
export const AgeBandSchema = z.enum(['18_24', '25_34', '35_44', '45_54', '55_plus']);
export type AgeBand = z.infer<typeof AgeBandSchema>;

/** The 13 regions of metropolitan France, overseas as one (ADR 0074 § 4). */
export const FrenchRegionSchema = z.enum([
  'auvergne_rhone_alpes',
  'bourgogne_franche_comte',
  'bretagne',
  'centre_val_de_loire',
  'corse',
  'grand_est',
  'hauts_de_france',
  'ile_de_france',
  'normandie',
  'nouvelle_aquitaine',
  'occitanie',
  'pays_de_la_loire',
  'provence_alpes_cote_d_azur',
  'outre_mer',
]);
export type FrenchRegion = z.infer<typeof FrenchRegionSchema>;

/** The countries outside France a place is recognised in (ADR 0074 § 4); any other one is « Autres ». */
export const FanCountrySchema = z.enum([
  'belgium',
  'switzerland',
  'luxembourg',
  'monaco',
  'canada',
  'morocco',
  'algeria',
  'tunisia',
  'senegal',
  'ivory_coast',
  'spain',
  'italy',
  'germany',
  'portugal',
  'netherlands',
  'united_kingdom',
  'united_states',
]);
export type FanCountry = z.infer<typeof FanCountrySchema>;

export const FanPlaceSchema = z.union([FrenchRegionSchema, FanCountrySchema]);
export type FanPlace = z.infer<typeof FanPlaceSchema>;

/** The job families of ADR 0074 § 5. */
export const JobFamilySchema = z.enum([
  'health',
  'teaching',
  'engineering',
  'sales',
  'office',
  'building',
  'transport',
  'hospitality',
  'security',
  'agriculture',
  'arts',
  'self_employed',
  'student',
  'retired',
]);
export type JobFamily = z.infer<typeof JobFamilySchema>;

/** The situations of ADR 0074 § 6. */
export const FanSituationSchema = z.enum(['single', 'couple', 'married', 'separated']);
export type FanSituation = z.infer<typeof FanSituationSchema>;

/** What a fan unlocked in all (ADR 0065 § 3): nothing, under 20 €, 20 to 100 €, 100 to 500 €, over 500 €. */
export const SpendingTierSchema = z.enum(['none', 'under_20', '20_100', '100_500', 'over_500']);
export type SpendingTier = z.infer<typeof SpendingTierSchema>;

const share = z.number().int().min(0).max(100);

const caseShare = <K extends z.ZodType<string>>(key: K) =>
  z.strictObject({ key: z.union([key, z.literal(OTHER_CASE)]), share });

/** A block under the threshold: no ring, no number (ADR 0074 § 8). */
const TooFewSchema = z.strictObject({ status: z.literal('too_few') });

/** A count of fans rounded to ten, `null` under `FAN_FIGURES_MIN_FANS` (ADR 0074 § 8). */
const FanCountSchema = z.number().int().min(FAN_FIGURES_MIN_FANS).multipleOf(10).nullable();

/** A block of cases: « environ 40 de tes fans l'ont dit » (`aboutFans`, rounded to ten) and the share of each case. */
const blockOf = <K extends z.ZodType<string>>(key: K) =>
  z.discriminatedUnion('status', [
    TooFewSchema,
    z.strictObject({
      status: z.literal('enough'),
      aboutFans: z.number().int().min(0).multipleOf(10),
      cases: z.array(caseShare(key)),
    }),
  ]);

export const AgeFiguresSchema = z.discriminatedUnion('status', [
  TooFewSchema,
  z.strictObject({
    status: z.literal('enough'),
    aboutFans: z.number().int().min(0).multipleOf(10),
    cases: z.array(caseShare(AgeBandSchema)),
    /** Rounded to the year. */
    averageAge: z.number().int().min(18).max(99),
  }),
]);

/** When they write, in her time zone: a share for each day (0 = Monday) and slot of three hours (0 = 0h–3h). */
export const ActivityCellSchema = z.strictObject({
  day: z.number().int().min(0).max(6),
  slot: z.number().int().min(0).max(7),
  share,
});

export const CreatorFanInsightsSchema = z.strictObject({
  /** The midnight, in her time zone, the figures drawn from facts stop at (ADR 0074 § 2). */
  asOf: z.iso.datetime(),
  /**
   * Her fans of all her accounts (ADR 0065 § 3), rounded to ten like every total of the panel (ADR 0074 § 8);
   * `null` under `FAN_FIGURES_MIN_FANS`, where she reads « moins de 10 » and no exact count.
   */
  fans: z.strictObject({
    total: FanCountSchema,
    newLast30Days: FanCountSchema,
    wroteLast7Days: FanCountSchema,
  }),
  age: AgeFiguresSchema,
  place: blockOf(FanPlaceSchema),
  job: blockOf(JobFamilySchema),
  situation: blockOf(FanSituationSchema),
  /**
   * What they unlocked: the share of fans who unlocked at least one message, the average basket of a paying fan over
   * 30 days (euros, VAT included, as « Tes fans »), and the share of each spending tier.
   */
  spending: z.discriminatedUnion('status', [
    TooFewSchema,
    z.strictObject({
      status: z.literal('enough'),
      payingShare: share,
      averageBasketMinor: z.number().int().min(0).nullable(),
      cases: z.array(caseShare(SpendingTierSchema)),
    }),
  ]),
  /** When they write, over the last 30 days: shares of their messages. */
  activity: z.discriminatedUnion('status', [
    TooFewSchema,
    z.strictObject({ status: z.literal('enough'), cells: z.array(ActivityCellSchema) }),
  ]),
});
export type CreatorFanInsights = z.infer<typeof CreatorFanInsightsSchema>;
