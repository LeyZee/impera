/**
 * Two creators may carry the same name (nothing refuses it yet): on a chip they would be the same word, and an alert
 * could go to the wrong one (recette du 28/10). Each name shared by several creators gets « · 1 », « · 2 »… in the
 * order they were created (their ids are UUIDv7, so they sort by time); a name worn once is left as it is.
 */
export function distinctNames<T extends { readonly displayName: string }>(
  items: readonly T[],
  idOf: (item: T) => string,
): T[] {
  const keyOf = (item: T): string => item.displayName.trim().toLocaleLowerCase('fr');
  const idsByName = new Map<string, string[]>();
  for (const item of items) idsByName.set(keyOf(item), [...(idsByName.get(keyOf(item)) ?? []), idOf(item)]);
  return items.map((item) => {
    const ids = idsByName.get(keyOf(item)) ?? [];
    if (ids.length < 2) return item;
    const rank = [...ids].sort().indexOf(idOf(item)) + 1;
    return { ...item, displayName: `${item.displayName.trim()} · ${String(rank)}` };
  });
}
