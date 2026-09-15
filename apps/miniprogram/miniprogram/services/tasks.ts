/** HomeMew 待办 -> LifeSpace task 模型与 Actions。 */

import { request } from './api';
import { andFilters, orFilters, queryModelRecords, type CanonicalQueryFilter } from './canonical-query';
import { Actor, Task, CreateTaskRequest, UpdateTaskRequest } from '../types/index';
import {
  ResourceBase,
  SpaceMember,
  auditActor,
  getSpaceMembers,
  modelCollectionPath,
  modelRecordPath,
  personRefs,
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

/**
 * 保持 HomeMew 页面侧契约：参数名与返回值仍为 Task[]。
 * LifeSpace task 已原生使用 pending/completed/cancelled 与 name；查询统一降低为
 * LifeSpace Canonical Query，不在客户端二次筛选或排序。
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
  const dueBounds: CanonicalQueryFilter[] = [];
  if (params?.dueDateFrom) dueBounds.push({ field: 'dueDate', op: 'gte', value: params.dueDateFrom });
  if (params?.dueDateTo) dueBounds.push({ field: 'dueDate', op: 'lte', value: params.dueDateTo });
  const dueRange = andFilters(dueBounds);
  const dueFilter = params?.includeNoDue && dueRange
    ? orFilters([dueRange, { field: 'dueDate', op: 'isNull' }])
    : dueRange;
  const filter = andFilters([
    params?.status ? { field: 'status', op: 'eq', value: params.status } : undefined,
    assigneePersonId
      ? { field: 'assigneePersonIds', op: 'contains', value: assigneePersonId }
      : undefined,
    dueFilter,
  ]);
  const sortMap = {
    due_asc: { field: 'dueDate', direction: 'asc' },
    due_desc: { field: 'dueDate', direction: 'desc' },
    created_desc: { field: 'createdAt', direction: 'desc' },
    updated_desc: { field: 'updatedAt', direction: 'desc' },
  } as const;
  const items: TaskResource[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 50; page++) {
    const data = await queryModelRecords<TaskResource>(familyId, 'task', {
      ...(params?.q ? { search: { text: params.q } } : {}),
      ...(filter ? { filter } : {}),
      sort: [sortMap[params?.sort ?? 'due_asc']],
      page: { cursor, limit: 100 },
    });
    items.push(...(data.items ?? []));
    cursor = data.nextCursor;
    if (!cursor) break;
  }

  return Promise.all(items.map(item => toTask(familyId, item)));
}

export async function getTask(familyId: string, taskId: string): Promise<Task> {
  return toTask(familyId, await request<TaskResource>(modelRecordPath(familyId, 'task', taskId)));
}

export async function createTask(familyId: string, payload: CreateTaskRequest): Promise<Task> {
  const assigneePersonIds = await userIdsToPersonIds(familyId, payload.assigneeIds);
  const raw = await request<TaskResource>(modelCollectionPath(familyId, 'task'), {
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
  const raw = await request<TaskResource>(modelRecordPath(familyId, 'task', taskId), {
    method: 'PATCH', data, skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function deleteTask(familyId: string, taskId: string, version: number): Promise<void> {
  await request<unknown>(modelRecordPath(familyId, 'task', taskId), {
    method: 'DELETE', data: { version }, skipRetry: true,
  });
}

export async function completeTask(familyId: string, taskId: string, version: number): Promise<Task> {
  const raw = await request<TaskResource>(`${modelRecordPath(familyId, 'task', taskId)}/actions/complete`, {
    method: 'POST', data: { version }, skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function reopenTask(familyId: string, taskId: string, version: number): Promise<Task> {
  const raw = await request<TaskResource>(`${modelRecordPath(familyId, 'task', taskId)}/actions/reopen`, {
    method: 'POST', data: { version }, skipRetry: true,
  });
  return toTask(familyId, raw);
}
