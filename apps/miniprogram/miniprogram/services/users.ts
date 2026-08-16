/** LifeSpace 全局用户资料。 */

import { request } from './api';
import { UserProfile, UpdateCurrentUserRequest } from '../types/index';

export function getCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/me', { target: 'identity' });
}

export function updateCurrentUser(data: UpdateCurrentUserRequest): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/me', {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
    target: 'identity',
  });
}
