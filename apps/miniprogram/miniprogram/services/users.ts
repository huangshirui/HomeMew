/**
 * 用户相关 API 服务
 */

import { request } from './api';
import {
  UserProfile,
  UpdateCurrentUserRequest,
} from '../types/index';

/**
 * 获取当前用户信息
 * GET /api/v1/me
 */
export function getCurrentUser(): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/me');
}

/**
 * 更新当前用户资料
 * PATCH /api/v1/me
 */
export function updateCurrentUser(data: UpdateCurrentUserRequest): Promise<UserProfile> {
  return request<UserProfile>('/api/v1/me', {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}
