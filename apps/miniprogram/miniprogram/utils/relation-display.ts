/** HomeMew presentation fallback for LifeSpace record projections.
 * Semantic Relation labels belong to LifeSpace; older published models may return
 * the record ID until their referenceLabel migration is deployed. */
type NamedRecord = { id?: string; name?: string | null; summary?: string | null;
  title?: string | null; displayName?: string | null };

function visibleName(value: unknown, recordId: string): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate === recordId || /^rec_[A-Za-z0-9_-]+$/.test(candidate)) return null;
  return candidate;
}

export function relationDisplayName(
  recordId: string, canonicalLabel?: string | null, record?: NamedRecord,
): string {
  // The model's canonical referenceLabel is authoritative when configured.
  const label = visibleName(canonicalLabel, recordId);
  if (label) return label;
  // Legacy models without referenceLabel retain product-specific title fields.
  for (const value of [record?.name, record?.summary, record?.title, record?.displayName]) {
    const name = visibleName(value, recordId);
    if (name) return name;
  }
  return '名称暂不可用';
}

export function candidateDisplayName(
  modelKey: string, record: NamedRecord & { id: string },
): string {
  // Generic query returns model fields, not a referenceLabel projection.
  const field = modelKey === 'event' ? record.summary : modelKey === 'wish' ? record.title : record.name;
  return visibleName(field, record.id) || '名称暂不可用';
}
