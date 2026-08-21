/** HomeMew 待办 -> LifeSpace task 模型与 Actions。 */

import { request } from './api';
import { Actor, Task, CreateTaskRequest, UpdateTaskRequest } from '../types/index';
import {
  LifeSpacePage,
  ResourceBase,
  SpaceMember,
  auditActor,
  getSpaceMembers,
  modelRecordPath,
  personRefs,
  queryString,
  spacePath,
  userIdToPersonId,
  userIdsToPersonIds,
} from './lifespace';

type TaskResource = ResourceBase & {
  name: string;
  description: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  dueDate: string | null;
  assigneePersonIds: string[];
  completedAt: string | null;
  completedByType: 'user' | 'service' | 'device' | null;
  completedById: string | null;
};

function toCompletedActor(raw: TaskResource, members: SpaceMember[]): Actor | null {
  if (!raw.completedByType || !raw.completedById) return null;
  if (raw.completedByType === 'user') {
    const member = members.find(item => item.userId === raw.completedById);
    return {
      type: 'user',
      id: raw.completedById,
      name: member?.displayName ?? raw.completedById,
      avatarUrl: null,
    };
  }
  return {
    type: 'system',
    id: raw.completedById,
    name: raw.completedById,
    avatarUrl: null,
  };
}

async function toTask(spaceId: string, raw: TaskResource): Promise<Task> {
  const members = await getSpaceMembers(spaceId);
  return {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.name,
    description: raw.description ?? null,
    status: raw.status,
    dueDate: raw.dueDate ?? null,
    assignees: personRefs(raw.assigneePersonIds, members),
    completedAt: raw.completedAt ?? null,
    completedBy: toCompletedActor(raw, members),
    createdBy: auditActor(raw.createdBy),
    updatedBy: auditActor(raw.updatedBy),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function platformSort(sort: 'due_asc' | 'due_desc' | 'created_desc' | 'updated_desc' | undefined): string | undefined {
  if (sort === 'due_desc') return 'dueDate:desc';
  if (sort === 'due_asc' || sort === undefined) return 'dueDate:asc';
  return undefined;
}

function clientSort(
  items: TaskResource[],
  sort: 'due_asc' | 'due_desc' | 'created_desc' | 'updated_desc' | undefined,
): TaskResource[] {
  if (sort !== 'created_desc' && sort !== 'updated_desc') return items;
  const field = sort === 'created_desc' ? 'createdAt' : 'updatedAt';
  return [...items].sort((a, b) => b[field].localeCompare(a[field]));
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
 * 保持 HomeMew 页面侧契约：参数名与返回值仍为 Task[]。
 * LifeSpace task 已原生使用 pending/completed/cancelled 与 name；日期窗口以及
 * created/updated 排序在 HomeMew service 层适配。
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
        status: params?.status,
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

  const filtered = clientSort(
    items.filter(item => inDueRange(item, params)),
    params?.sort,
  );
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
      name: payload.name,
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
  if (payload.name !== undefined) data.name = payload.name;
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
