/** HomeMew 待办 -> LifeSpace task model。 */

import { request } from './api';
import {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
} from '../types/index';
import {
  ResourceBase,
  LifeSpacePage,
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
  name: string;
  description: string | null;
  dueDate: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  assigneePersonIds: string[];
  completedAt: string | null;
  completedById: string | null;
  completedByType: 'user' | 'service' | 'device' | null;
};

async function toTask(spaceId: string, raw: TaskResource): Promise<Task> {
  const members = await getSpaceMembers(spaceId);
  const completedMember = raw.completedByType === 'user'
    ? members.find(item => item.userId === raw.completedById)
    : undefined;
  return {
    id: raw.id,
    familyId: raw.spaceId,
    name: raw.name,
    description: raw.description ?? null,
    dueDate: raw.dueDate ?? null,
    status: raw.status,
    assignees: personRefs(raw.assigneePersonIds, members),
    completedAt: raw.completedAt ?? null,
    completedBy: completedMember ? {
      type: 'user',
      id: completedMember.userId,
      name: completedMember.displayName,
      avatarUrl: null,
    } : null,
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
    const data = await request<LifeSpacePage<TaskResource>>(
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
  const sortMap = {
    due_asc: 'dueDate:asc',
    due_desc: 'dueDate:desc',
    created_desc: 'createdAt:desc',
    updated_desc: 'updatedAt:desc',
  } as const;
  const base = {
    status: params?.status,
    assigneePersonIds: assigneePersonId ?? undefined,
    q: params?.q,
    sort: params?.sort ? sortMap[params.sort] : 'dueDate:asc',
  };
  const ranged = await fetchAllRaw(familyId, {
    ...base,
    dueDateFrom: params?.dueDateFrom,
    dueDateTo: params?.dueDateTo,
  });

  let raw = ranged;
  if (params?.includeNoDue && (params.dueDateFrom || params.dueDateTo)) {
    const allMatching = await fetchAllRaw(familyId, base);
    raw = [...ranged, ...allMatching.filter(item => item.dueDate === null)];
    raw = raw.filter((item, index, values) => values.findIndex(other => other.id === item.id) === index);
  }
  return Promise.all(raw.map(item => toTask(familyId, item)));
}

export async function getTask(familyId: string, taskId: string): Promise<Task> {
  return toTask(familyId, await request<TaskResource>(modelRecordPath(familyId, 'tasks', taskId)));
}

export async function createTask(familyId: string, data: CreateTaskRequest): Promise<Task> {
  const assigneePersonIds = await userIdsToPersonIds(familyId, data.assigneeIds);
  const raw = await request<TaskResource>(spacePath(familyId, 'tasks'), {
    method: 'POST',
    data: {
      name: data.name,
      description: data.description ?? null,
      dueDate: data.dueDate ?? null,
      assigneePersonIds,
    },
    skipRetry: true,
  });
  return toTask(familyId, raw);
}

export async function updateTask(
  familyId: string,
  taskId: string,
  data: UpdateTaskRequest,
): Promise<Task> {
  const { assigneeIds, ...rest } = data;
  const payload: Record<string, unknown> = { ...rest };
  if (assigneeIds !== undefined) payload.assigneePersonIds = await userIdsToPersonIds(familyId, assigneeIds);
  const raw = await request<TaskResource>(modelRecordPath(familyId, 'tasks', taskId), {
    method: 'PATCH',
    data: payload,
    skipRetry: true,
  });
  return toTask(familyId, raw);
}

async function action(familyId: string, taskId: string, actionKey: 'complete' | 'reopen', version: number): Promise<Task> {
  const raw = await request<TaskResource>(
    `${modelRecordPath(familyId, 'tasks', taskId)}/actions/${actionKey}`,
    { method: 'POST', data: { version }, skipRetry: true },
  );
  return toTask(familyId, raw);
}

export function completeTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return action(familyId, taskId, 'complete', version);
}

export function reopenTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return action(familyId, taskId, 'reopen', version);
}

export function deleteTask(familyId: string, taskId: string, version: number): Promise<void> {
  return request<void>(modelRecordPath(familyId, 'tasks', taskId), {
    method: 'DELETE',
    data: { version },
    skipRetry: true,
  });
}
