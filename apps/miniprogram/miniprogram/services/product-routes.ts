/** Bounded HomeMew Mini product URLs. Upstream paths and query syntax stay in the BFF. */
export function familyCollection(familyId: string, resource: 'events' | 'tasks' | 'day-records' | 'wishes'): string {
  return `/api/v1/miniprogram/families/${encodeURIComponent(familyId)}/${resource}`;
}

export function productQuery(values: object): string {
  const params = Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!params.length) return '';
  return `?${params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')}`;
}
