import type { RevealedCredential } from './integrations';

const pending = new Map<string, RevealedCredential>();

export function bufferIntegrationCredential(integrationId: string, credential: RevealedCredential) {
  pending.set(integrationId, credential);
}

export function takeBufferedIntegrationCredential(integrationId: string) {
  const credential = pending.get(integrationId) ?? null;
  pending.delete(integrationId);
  return credential;
}
