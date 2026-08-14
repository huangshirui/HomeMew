/** HomeMew 待办 -> LifeSpace task 模型与 Actions。 */

import { request } from './api';
import { Actor, Task, CreateTaskRequest, UpdateTaskRequest } from '../types/index';
import {
  LifeSpacePage,
  ResourceBase,
  getSpaceMembers,
  modelRecordPath,
  personRefs,
  queryString,
  spacePath,
  unavailableActor,
  userIdToPersonId,
  userIdsToPersonIds,
} from './lifespace';

type TaskResource = ResourceBase & {
  title: string;
  description: string | null;
  status: 'open' | 'completed';
  dueDate: string | null;
  assigneePersonIds: string[];
  completedAt: string | null;
  completedBy: { type: 'user' | 'service' | 'device'; id: string; displayName: string } | null;
};

function toActor(raw: TaskResource['completedBy']): Actor | null {
  if (!raw) return null;
  return {
    type: raw.type === 'user' ? 'user' : 'system',
    id: raw.id,
    name: raw.displayName,
    avatarUrl: null,
  };
}

async function toTask(spaceId: string, raw: TaskResource): Promise<Task> {
  const members = await getSpaceMembers(spaceId);
  return {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.title,
    description: raw.description ?? null,
    status: raw.status === 'open' ? 'pending' : 'completed',
    dueDate: raw.dueDate ?? null,
    assignees: personRefs(raw.assigneePersonIds, members),
    completedAt: raw.completedAt ?? null,
    completedBy: toActor(raw.completedBy),
    createdBy: unavailableActor(),
    updatedBy: unavailableActor(),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function platformSort(sort: 'due_asc' | 'due_desc' | 'created_desc' | 'updated_desc' | undefined): string {
  switch (sort) {
    case 'due_desc': return 'dueDate:desc';
    case 'created_desc': return 'createdAt:desc';
    case 'updated_desc': return 'updatedAt:desc';
    case 'due_asc':
    default: return 'dueDate:asc';
  }
}

function inDueRange(
  task: TaskResource,
  params: { dueDateFrom?: string; dueDateTo?: string; includeNoDue?: boolean } | undefined,
): boolean {
  if (!params?.dueDateFrom && !params?.dueDateTo) return true;
  if (!task.dueDate) return params?.includeNoDue === true;
  if (params.dueDateFrom && task.dueDate < params.dueDateFrom) return false;
  if (params.dueDateTo && task.dueDate > params.dueDateTo) return false;
  return true;
}

/**
 * 保持旧 HomeMew 页面侧契约：参数名与返回值仍为 Task[]。
 * LifeSpace 的 open 状态在这里映射为 HomeMew pending；日期窗口在 service 层适配。
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
    q?: string;
  },
): Promise<Task[]> {
  const assigneePersonId = params?.assigneeId
    ? await userIdToPersonId(familyId, params.assigneeId)
    : null;
  const items: TaskResource[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 50; page++) {
    const data: LifeSpacePage<TaskResource> = await request<LifeSpacePage<TaskResource>>(
      `${spacePath(familyId, 'tasks')}${queryString({
        status: params?.status === 'pending' ? 'open' : params?.status,
        assigneePersonIds: assigneePersonId ?? undefined,
        q: params?.q,
        sort: platformSort(params?.sort),
        cursor,
        limit: 100,
      })}`,
    );
    items.push(...(data.items ?? []));
    cursor = data.nextCursor;
    if (!cursor) break;
  }

  const filtered = items.filter(item => inDueRange(item, params));
  return Promise.all(filtered.map(item => toTask(familyId, item)));
}

export async function getTask(familyId: string, taskId: string): Promise<Task> {
  return toTask(familyId, await request<TaskResource>(modelRecordPath(familyId, 'tasks', taskId)));
}

export async function createTask(familyId: string, payload: CreateTaskRequest): Promise<Task> {
  const assigneePersonIds = await userIdsToPersonIds(familyId, payload.assigneeIds);
  const raw = await request<TaskResource>(spacePath(familyId, 'tasks'), {
    method: 'POST',
    data: {
      title: payload.name,
      description: payload.description ?? null,
      dueDate: payload.dueDate ?? null,
      assigneePersonIds,
    },
    skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function updateTask(
  familyId: string,
  taskId: string,
  payload: UpdateTaskRequest,
): Promise<Task> {
  const assigneePersonIds = payload.assigneeIds === undefined
    ? undefined
    : await userIdsToPersonIds(familyId, payload.assigneeIds);
  const data: Record<string, unknown> = { version: payload.version };
  if (payload.name !== undefined) data.title = payload.name;
  if (payload.description !== undefined) data.description = payload.description;
  if (payload.dueDate !== undefined) data.dueDate = payload.dueDate;
  if (assigneePersonIds !== undefined) data.assigneePersonIds = assigneePersonIds;
  const raw = await request<TaskResource>(modelRecordPath(familyId, 'tasks', taskId), {
    method: 'PATCH', data, skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function deleteTask(familyId: string, taskId: string, version: number): Promise<void> {
  await request<unknown>(modelRecordPath(familyId, 'tasks', taskId), {
    method: 'DELETE', data: { version }, skipRetry: true,
  });
}

export async function completeTask(familyId: string, taskId: string, version: number): Promise<Task> {
  const raw = await request<TaskResource>(`${modelRecordPath(familyId, 'tasks', taskId)}/actions/complete`, {
    method: 'POST', data: { version }, skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function reopenTask(familyId: string, taskId: string, version: number): Promise<Task> {
  const raw = await request<TaskResource>(`${modelRecordPath(familyId, 'tasks', taskId)}/actions/reopen`, {
    method: 'POST', data: { version }, skipRetry: true,
  });
  return toTask(familyId, raw);
}
