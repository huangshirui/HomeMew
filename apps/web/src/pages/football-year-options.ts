/** Keep the year filter short; any older or future year can still be selected manually.
 * The current year is read when the UI renders, so the options roll forward every January.
 */
export function footballYearOptions(currentYear: number, selectedYear = ''): string[] {
  const recent = Array.from({ length: 5 }, (_, index) => String(currentYear - index));
  return [...new Set([...recent, ...(/^\d{4}$/.test(selectedYear) ? [selectedYear] : [])])]
    .sort((left, right) => Number(right) - Number(left));
}
