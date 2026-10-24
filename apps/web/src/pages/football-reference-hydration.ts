/** Resolve references used by the visible match page only, without listing the Activity directory.
 * Ids are de-duplicated, capped by the caller and fetched with bounded concurrency.
 */
export async function fetchUniqueFootballReferences<T>(
  ids: ReadonlyArray<string>,
  fetchOne: (id: string) => Promise<T>,
  concurrency = 4,
): Promise<{ found: T[]; failedIds: string[] }> {
  const unique = [...new Set(ids.filter(Boolean))];
  const found: Array<T | undefined> = Array(unique.length);
  const failedIds: string[] = [];
  let nextIndex = 0;
  const workers = Math.min(unique.length, Math.max(1, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= unique.length) return;
      try {
        found[index] = await fetchOne(unique[index]);
      } catch {
        failedIds.push(unique[index]);
      }
    }
  }));
  return { found: found.filter((value): value is T => value !== undefined), failedIds };
}
