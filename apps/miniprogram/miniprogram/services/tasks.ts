/** HomeMew 待办 -> LifeSpace task 模型与 Actions。 */

import { request } from './api';
import { Task, CreateTaskRequest, UpdateTaskRequest } from '../types/index';
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

async function toTask(spaceId: string, raw: TaskResource): Promise<Task> {
  const members = await getSpaceMembers(spaceId);
  return {
    id: raw.id,
    familyId: raw.spaceId,
    title: raw.title,
    description: raw.description ?? null,
    status: raw.status,
    dueDate: raw.dueDate ?? null,
    assignees: personRefs(raw.assigneePersonIds, members),
    completedAt: raw.completedAt ?? null,
    completedBy: raw.completedBy
      ? { userId: raw.completedBy.id, displayName: raw.completedBy.displayName, avatarUrl: null }
      : null,
    createdBy: unavailableActor(),
    updatedBy: unavailableActor(),
    version: raw.version,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

async function fetchAllRaw(
  familyId: string,
  query: Record<string, string | number | boolean | null | undefined>,
): Promise<TaskResource[]> {
  const items: TaskResource[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const data: LifeSpacePage<TaskResource> = await request<LifeSpacePage<TaskResource>>(
      `${spacePath(familyId, 'tasks')}${queryString({ ...query, cursor, limit: 100 })}`,
    );
    items.push(...(data.items ?? []));
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return items;
}

export async function listTasks(
  familyId: string,
  params?: {
    status?: 'open' | 'completed';
    assigneeId?: string;
    dueFrom?: string;
    dueTo?: string;
    q?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<{ items: Task[]; nextCursor: string | null }> {
  const assigneePersonId = params?.assigneeId
    ? await userIdToPersonId(familyId, params.assigneeId)
    : null;
  const data = await request<LifeSpacePage<TaskResource>>(
    `${spacePath(familyId, 'tasks')}${queryString({
      status: params?.status,
      assigneePersonIds: assigneePersonId ?? undefined,
      dueDateGte: params?.dueFrom,
      dueDateLte: params?.dueTo,
      q: params?.q,
      sort: 'dueDate:asc',
      cursor: params?.cursor,
      limit: params?.limit ?? 100,
    })}`,
  );
  return {
    items: await Promise.all((data.items ?? []).map(item => toTask(familyId, item))),
    nextCursor: data.nextCursor,
  };
}

export async function listAllTasks(
  familyId: string,
  params?: { status?: 'open' | 'completed'; assigneeId?: string; dueFrom?: string; dueTo?: string; q?: string },
): Promise<Task[]> {
  const assigneePersonId = params?.assigneeId
    ? await userIdToPersonId(familyId, params.assigneeId)
    : null;
  const rows = await fetchAllRaw(familyId, {
    status: params?.status,
    assigneePersonIds: assigneePersonId ?? undefined,
    dueDateGte: params?.dueFrom,
    dueDateLte: params?.dueTo,
    q: params?.q,
    sort: 'dueDate:asc',
  });
  return Promise.all(rows.map(item => toTask(familyId, item)));
}

export async function getTask(familyId: string, taskId: string): Promise<Task> {
  return toTask(familyId, await request<TaskResource>(modelRecordPath(familyId, 'tasks', taskId)));
}

export async function createTask(familyId: string, payload: CreateTaskRequest): Promise<Task> {
  const assigneePersonIds = await userIdsToPersonIds(familyId, payload.assigneeIds);
  const raw = await request<TaskResource>(spacePath(familyId, 'tasks'), {
    method: 'POST',
    data: {
      title: payload.title,
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
  if (payload.title !== undefined) data.title = payload.title;
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
