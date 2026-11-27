import { z } from 'zod';

/**
 * The chatter's review (ADR 0170 §§ B and 26 to 32). The faults themselves, their labels and the agency's rules
 * live in the database, out of this public repository: here, a fault is only a neutral code and its level.
 */

/**
 * How a fault is treated, set by its code and never by the model (ADR 0170 § 28):
 * - `advice`: a piece of advice, never counted;
 * - `standard`: explained the first time, then a firm reminder, a case at three times in two weeks after the
 *   explanation;
 * - `firm`: a firm remark from the first time, a case at the second time in two weeks;
 * - `owner_alert`: a case for the owner from the first time, as fraud or safety.
 */
export const FaultLevelSchema = z.enum(['advice', 'standard', 'firm', 'owner_alert']);
export type FaultLevel = z.infer<typeof FaultLevelSchema>;

/** A fault's neutral code, as the grid names it (`fault.<letters, digits, underscores>`). */
export const FaultCodeSchema = z
  .string()
  .regex(/^fault\.[a-z0-9_]{1,60}$/u)
  .brand<'FaultCode'>();
export type FaultCode = z.infer<typeof FaultCodeSchema>;

/** The tone a card takes, read from the level and the count (ADR 0170 § 30). */
export const FaultToneSchema = z.enum(['advice', 'explain', 'firm', 'grave']);
export type FaultTone = z.infer<typeof FaultToneSchema>;

export const FAULT_LEVELS = FaultLevelSchema.options;

/** How a manager settles a contested remark (ADR 0170 § 14). */
export const RemarkRulingSchema = z.enum(['upheld', 'dropped']);
export type RemarkRuling = z.infer<typeof RemarkRulingSchema>;
export const REMARK_RULINGS = RemarkRulingSchema.options;

/** A fault's label, as the owner saves it out of the repository. */
export const FAULT_LABEL_MAX = 200;
/** A contest in one line (ADR 0170 § 14). */
export const REMARK_CONTEST_MAX = 300;
