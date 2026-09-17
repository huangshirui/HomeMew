/** Current-user profile through the stable HomeMew Mini BFF. */

import { request } from './api';
import { UserProfile, UpdateCurrentUserRequest } from '../types/index';

export function getCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/miniprogram/me');
}

export function updateCurrentUser(data: UpdateCurrentUserRequest): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/miniprogram/me', {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}
