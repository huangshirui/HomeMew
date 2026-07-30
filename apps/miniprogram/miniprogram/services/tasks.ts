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
export async function listTasks(
  familyId: string,
  params?: {
    status?: 'pending' | 'completed';
    assigneeId?: string;
    dueDateFrom?: string;
    dueDateTo?: string;
    includeNoDue?: boolean;
    sort?: 'due_asc' | 'due_desc' | 'created_desc' | 'updated_desc';
  },
): Promise<Task[]> {
  const items: Task[] = [];
  let cursor: string | null = null;
  // 循环拉取所有分页，避免顶部计数 / 历史列表只显示第一页。
  // 设置合理上限防止异常游标导致死循环。
  for (let page = 0; page < 50; page++) {
    const query: Record<string, string> = { limit: '100' };
    if (params?.status) query.status = params.status;
    if (params?.assigneeId) query.assigneeId = params.assigneeId;
    if (params?.dueDateFrom) query.dueDateFrom = params.dueDateFrom;
    if (params?.dueDateTo) query.dueDateTo = params.dueDateTo;
    if (params?.includeNoDue !== undefined) {
      query.includeNoDue = String(params.includeNoDue);
    }
    if (params?.sort) query.sort = params.sort;
    if (cursor) query.cursor = cursor;

    const qs = '?' + Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');

    const data: { items: Task[]; nextCursor: string | null } = await request<{
      items: Task[];
      nextCursor: string | null;
    }>(`/api/v1/families/${familyId}/tasks${qs}`);

    items.push(...(data.items ?? []));
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return items;
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
export function completeTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return request<Task>(`/api/v1/families/${familyId}/tasks/${taskId}/complete`, {
    method: 'POST',
    data: { version } as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 恢复待办任务（已完成 → 待完成）
 * POST /api/v1/families/{familyId}/tasks/{taskId}/reopen
 * 返回更新后的 Task（Core 返回最新版本）。
 */
export function reopenTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return request<Task>(`/api/v1/families/${familyId}/tasks/${taskId}/reopen`, {
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
