const BINDING_V1_PREFIX = 'homemew:v1:space=';
const BINDING_V2_PREFIX = 'homemew:v2:space=';
const DISCARDED_PREFIX = 'homemew:v1:discarded=';

function isSpaceId(value) {
  return typeof value === 'string' && /^spc_[A-Za-z0-9_-]+$/u.test(value);
}

function isAgentId(value) {
  return typeof value === 'string' && /^agt_[A-Za-z0-9_-]+$/u.test(value);
}

export function isReservedIntegrationDescription(value) {
  return typeof value === 'string'
    && (value.startsWith(BINDING_V1_PREFIX)
      || value.startsWith(BINDING_V2_PREFIX)
      || value.startsWith(DISCARDED_PREFIX));
}

export function encodeIntegrationBinding(spaceId, description, agentId = null) {
  if (!isSpaceId(spaceId)) throw new Error('spaceId is invalid');
  if (agentId !== null && !isAgentId(agentId)) throw new Error('agentId is invalid');
  const marker = agentId
    ? `${BINDING_V2_PREFIX}${spaceId};agent=${agentId}`
    : `${BINDING_V1_PREFIX}${spaceId}`;
  return `${marker}\n${description ?? ''}`;
}

export function encodeDiscardedIntegrationBinding(spaceId, description) {
  if (!isSpaceId(spaceId)) throw new Error('spaceId is invalid');
  return `${DISCARDED_PREFIX}${spaceId}\n${description ?? ''}`;
}

export function isDiscardedIntegrationDescription(value) {
  return typeof value === 'string' && value.startsWith(DISCARDED_PREFIX);
}

export function decodeIntegrationBinding(value) {
  if (typeof value !== 'string') return { spaceId: null, agentId: null, description: null };

  const newline = value.indexOf('\n');
  const marker = newline < 0 ? value : value.slice(0, newline);
  const description = newline < 0 ? '' : value.slice(newline + 1).trim();

  if (marker.startsWith(BINDING_V2_PREFIX)) {
    const payload = marker.slice(BINDING_V2_PREFIX.length);
    const separator = payload.indexOf(';agent=');
    if (separator < 0) return { spaceId: null, agentId: null, description: value.trim() || null };
    const spaceId = payload.slice(0, separator);
    const agentId = payload.slice(separator + ';agent='.length);
    if (!isSpaceId(spaceId) || !isAgentId(agentId)) {
      return { spaceId: null, agentId: null, description: value.trim() || null };
    }
    return { spaceId, agentId, description: description || null };
  }

  if (marker.startsWith(BINDING_V1_PREFIX)) {
    const spaceId = marker.slice(BINDING_V1_PREFIX.length);
    if (!isSpaceId(spaceId)) return { spaceId: null, agentId: null, description: value.trim() || null };
    return { spaceId, agentId: null, description: description || null };
  }

  return { spaceId: null, agentId: null, description: value.trim() || null };
}
