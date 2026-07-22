/**
 * HomeMew Core API 类型定义
 * 基于 /apps/core/openapi.yaml
 */

// ==================== 通用类型 ====================

/** API 错误响应 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/** API 成功信封 */
export interface ApiEnvelope<T> {
  data: T;
}

/** 分页游标响应 */
export interface PaginatedResponse<T> {
  data: {
    items: T[];
    nextCursor: string | null;
  };
}

// ==================== 用户相关 ====================

export type UserStatus = 'active' | 'disabled';

export interface UserProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
}

export interface CurrentUserResponse extends ApiEnvelope<UserProfile> {}

export interface UpdateCurrentUserRequest {
  displayName?: string;
  avatarUrl?: string | null;
}

// ==================== 家庭相关 ====================

export type FamilyRole = 'admin' | 'member';
export type FamilyStatus = 'active' | 'archived';

export interface FamilyListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: FamilyRole;
  memberCount: number;
}

export interface MyFamilyListResponse extends ApiEnvelope<{
  items: FamilyListItem[];
}> {}

export interface CreateFamilyRequest {
  name: string;
  avatarUrl?: string | null;
}

export interface CreateFamilyResult extends FamilyListItem {
  createdAt: string;
}

export interface CreateFamilyResponse extends ApiEnvelope<CreateFamilyResult> {}

export interface UpdateFamilyRequest {
  name?: string;
  avatarUrl?: string | null;
}

export interface FamilyDetail {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: FamilyStatus;
  createdBy: string;
  currentUserRole: FamilyRole;
  memberCount: number;
  createdAt: string;
}

export interface FamilyDetailResponse extends ApiEnvelope<FamilyDetail> {}

export interface FamilySummaryResponse extends ApiEnvelope<{
  id: string;
  name: string;
  avatarUrl: string | null;
  status: FamilyStatus;
}> {}

// ==================== 成员相关 ====================

export interface FamilyMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: FamilyRole;
  joinedAt: string;
}

export interface FamilyMemberListResponse extends ApiEnvelope<{
  items: FamilyMember[];
}> {}

export interface UpdateMemberRoleRequest {
  role: FamilyRole;
}

export interface UpdateMemberRoleResponse extends ApiEnvelope<{
  userId: string;
  role: FamilyRole;
}> {}

// ==================== 邀请相关 ====================

export type InviteStatus = 'active' | 'expired' | 'exhausted' | 'revoked';

export interface CreateInviteRequest {
  expiresInMinutes?: number;
  maxUses?: number;
}

export interface InviteCreated {
  id: string;
  code: string;
  joinPath: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
}

export interface CreateInviteResponse extends ApiEnvelope<InviteCreated> {}

export interface InviteListItem {
  id: string;
  status: InviteStatus;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  createdBy: string;
  createdAt: string;
}

export interface InviteListResponse extends ApiEnvelope<{
  items: InviteListItem[];
}> {}

export interface InvitePreviewResponse extends ApiEnvelope<{
  family: {
    id: string;
    name: string;
    avatarUrl: string | null;
    memberCount: number;
  };
  expiresAt: string;
  canJoin: boolean;
}> {}

export interface JoinFamilyResponse extends ApiEnvelope<{
  familyId: string;
  familyName: string;
  role: 'member';
  joinedAt: string;
}> {}

// ==================== 日程相关 ====================

export type EventStatus = 'active' | 'cancelled';

export interface PersonRef {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface Event {
  id: string;
  familyId: string;
  summary: string;
  description: string | null;
  start: string;
  end: string;
  isAllDay: boolean;
  timezone: string;
  location: string | null;
  status: EventStatus;
  attendees: PersonRef[];
  createdBy: PersonRef;
  updatedBy: PersonRef;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EventResponse extends ApiEnvelope<Event> {}
export interface EventListResponse extends PaginatedResponse<Event> {}

export interface CreateEventRequest {
  summary: string;
  description?: string | null;
  start: string;
  end: string;
  isAllDay: boolean;
  timezone: string;
  attendeeIds?: string[];
  location?: string | null;
}

export interface UpdateEventRequest {
  summary?: string;
  description?: string | null;
  start?: string;
  end?: string;
  isAllDay?: boolean;
  timezone?: string;
  attendeeIds?: string[];
  location?: string | null;
  version: number;
}

// ==================== 待办相关 ====================

export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  familyId: string;
  name: string;
  description: string | null;
  due: string | null;
  status: TaskStatus;
  assignees: PersonRef[];
  completedAt: string | null;
  completedBy: PersonRef | null;
  createdBy: PersonRef;
  updatedBy: PersonRef;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskResponse extends ApiEnvelope<Task> {}
export interface TaskListResponse extends PaginatedResponse<Task> {}

export interface CreateTaskRequest {
  name: string;
  description?: string | null;
  due?: string | null;
  assigneeIds?: string[];
}

export interface UpdateTaskRequest {
  name?: string;
  description?: string | null;
  due?: string | null;
  assigneeIds?: string[];
  version: number;
}

export interface VersionActionRequest {
  version: number;
}

// ==================== 内部用户创建 ====================

export interface CreateInternalUserRequest {
  displayName: string;
  avatarUrl?: string | null;
  createdFrom: 'wechat_miniprogram' | 'wecom' | 'admin' | 'other';
}

export interface InternalUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  status: UserStatus;
  createdFrom: string;
  createdAt: string;
}

export interface InternalUserResponse extends ApiEnvelope<InternalUser> {}

// ==================== 登录云函数相关 ====================

export interface LoginRequest {
  /** 微信登录临时凭证 */
  code: string;
}

export interface LoginResponse {
  /** HomeMew 短期访问令牌 (JWT) */
  accessToken: string;
  /** 令牌过期时间 (ISO 8601) */
  expiresAt: string;
  /** 是否为新用户（首次登录） */
  isNewUser: boolean;
  /** Core API 基础地址（由云函数回传，避免客户端硬编码） */
  coreApiUrl: string;
}
