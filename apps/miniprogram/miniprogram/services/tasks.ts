/** Stable HomeMew Task DTOs through the final Mini BFF. */
import { request } from './api';
import { familyCollection, productQuery } from './product-routes';
import { Task, CreateTaskRequest, UpdateTaskRequest } from '../types/index';

export interface ListTasksParams {
  status?: 'pending' | 'completed';
  assigneeId?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
  includeNoDue?: boolean;
  sort?: 'due_asc' | 'due_desc' | 'created_desc' | 'updated_desc';
  q?: string;
}
interface Page<T> { items: T[]; nextCursor: string | null }
const collection = (familyId: string) => familyCollection(familyId, 'tasks');
const record = (familyId: string, taskId: string) => `${collection(familyId)}/${encodeURIComponent(taskId)}`;

export async function listTasks(familyId: string, params: ListTasksParams = {}): Promise<Task[]> {
  const items: Task[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const result: Page<Task> = await request<Page<Task>>(`${collection(familyId)}${productQuery({ ...params, cursor, limit: 100 })}`);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}
export function getTask(familyId: string, taskId: string): Promise<Task> { return request(record(familyId, taskId)); }
export function createTask(familyId: string, data: CreateTaskRequest): Promise<Task> {
  return request(collection(familyId), { method: 'POST', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function updateTask(familyId: string, taskId: string, data: UpdateTaskRequest): Promise<Task> {
  return request(record(familyId, taskId), { method: 'PATCH', data: data as unknown as Record<string, unknown>, skipRetry: true });
}
export function deleteTask(familyId: string, taskId: string, version: number): Promise<void> {
  return request(record(familyId, taskId), { method: 'DELETE', data: { version }, skipRetry: true });
}
export function completeTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return request(`${record(familyId, taskId)}/complete`, { method: 'POST', data: { version }, skipRetry: true });
}
export function reopenTask(familyId: string, taskId: string, version: number): Promise<Task> {
  return request(`${record(familyId, taskId)}/reopen`, { method: 'POST', data: { version }, skipRetry: true });
}
