export function uniqueTextValues(values: string[]) {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}
