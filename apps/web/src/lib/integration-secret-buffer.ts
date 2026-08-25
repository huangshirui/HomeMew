import type { RevealedCredential } from './integrations';

const pending = new Map<string, RevealedCredential>();

export function bufferIntegrationCredential(integrationId: string, credential: RevealedCredential) {
  pending.set(integrationId, credential);
}

export function takeBufferedIntegrationCredential(integrationId: string) {
  const value = pending.get(integrationId) ?? null;
  pending.delete(integrationId);
  return value;
}
