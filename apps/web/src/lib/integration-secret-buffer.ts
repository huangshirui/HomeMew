import type { RevealedCredential } from './integrations';

const pending = new Map<string, RevealedCredential>();

export function bufferIntegrationCredential(integrationId: string, credential: RevealedCredential) {
  pending.set(integrationId, credential);
}

export function getBufferedIntegrationCredential(integrationId: string) {
  return pending.get(integrationId) ?? null;
}

export function clearBufferedIntegrationCredential(integrationId: string) {
  pending.delete(integrationId);
}
