/** « 14 h 05 », the way the CRM writes an hour (the popup's watch, the copilot's cooldown). */
export function hourOf(at: Date): string {
  return `${String(at.getHours())}\u00a0h\u00a0${String(at.getMinutes()).padStart(2, '0')}`;
}
