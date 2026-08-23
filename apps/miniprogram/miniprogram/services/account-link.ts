import { AppError, request } from './api';

const ACCESS_LINK_CHALLENGE_PATTERN = /^alc_[0-9a-f]{64}$/u;

export function normalizeAccessLinkChallengeId(value: string): string {
  const challengeId = value.trim();
  if (!ACCESS_LINK_CHALLENGE_PATTERN.test(challengeId)) {
    throw new AppError('VALIDATION_ERROR', '关联码格式不正确，请从 HomeMew Web 重新复制');
  }
  return challengeId;
}

export async function confirmWebAccessLink(challengeIdInput: string): Promise<void> {
  const challengeId = normalizeAccessLinkChallengeId(challengeIdInput);
  await request<void>(`/api/v1/me/access-link-challenges/${encodeURIComponent(challengeId)}/confirm`, {
    method: 'POST',
    target: 'identity',
    skipRetry: true,
  });
}
