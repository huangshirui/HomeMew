/**
 * 待办任务相关 API 服务
 *
 * - GET 请求允许 401 自动重试
 * - 写操作（POST/PATCH/DELETE）显式 skipRetry: true，避免重复创建
 */

import { request } from './api';
import {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  VersionActionRequest,
} from '../types/index';

/**
 * 列出家庭待办任务
 *
 * GET /api/v1/families/{familyId}/tasks
 *
 * @param status 按 status 筛选：pending | completed
 * @param assigneeId 仅看指定负责人；传 'me' 表示仅看自己的
 */
export function listTasks(
  familyId: string,
  params?: { status?: 'pending' | 'completed'; assigneeId?: string },
): Promise<Task[]> {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.assigneeId) query.assigneeId = params.assigneeId;

  const qs = Object.keys(query).length
    ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
    : '';

  return request<{ items: Task[]; nextCursor: string | null }>(
    `/api/v1/families/${familyId}/tasks${qs}`,
  ).then(data => data.items ?? []);
}

/**
 * 获取单个待办任务详情
 * GET /api/v1/families/{familyId}/tasks/{taskId}
 */
export function getTask(familyId: string, taskId: string): Promise<Task> {
  return request<Task>(`/api/v1/families/${familyId}/tasks/${taskId}`);
}

/**
 * 创建待办任务
 * POST /api/v1/families/{familyId}/tasks
 */
export function createTask(familyId: string, data: CreateTaskRequest): Promise<Task> {
  return request<Task>(`/api/v1/families/${familyId}/tasks`, {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 更新待办任务
 * PATCH /api/v1/families/{familyId}/tasks/{taskId}
 */
export function updateTask(
  familyId: string,
  taskId: string,
  data: UpdateTaskRequest,
): Promise<Task> {
  return request<Task>(`/api/v1/families/${familyId}/tasks/${taskId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 完成待办任务
 * POST /api/v1/families/{familyId}/tasks/{taskId}/complete
 */
export function completeTask(familyId: string, taskId: string, version: number): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/tasks/${taskId}/complete`, {
    method: 'POST',
    data: { version } as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 恢复待办任务（已完成 → 待完成）
 * POST /api/v1/families/{familyId}/tasks/{taskId}/reopen
 */
export function reopenTask(familyId: string, taskId: string, version: number): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/tasks/${taskId}/reopen`, {
    method: 'POST',
    data: { version } as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 删除待办任务
 * DELETE /api/v1/families/{familyId}/tasks/{taskId}?version=N
 */
export function deleteTask(familyId: string, taskId: string, version: number): Promise<void> {
  return request<void>(
    `/api/v1/families/${familyId}/tasks/${taskId}?version=${version}`,
    {
      method: 'DELETE',
      skipRetry: true,
    },
  );
}
