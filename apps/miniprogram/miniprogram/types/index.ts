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

/** 头像通过 PUT /api/v1/me/avatar 单独上传，资料更新只支持昵称。 */
export interface UpdateCurrentUserRequest {
  displayName: string;
}

export interface AvatarUploadResult {
  avatarUrl: string;
}

// ==================== 家庭相关 ====================

export type FamilyRole = 'admin' | 'member';
export type FamilyStatus = 'active' | 'archived';

export interface FamilyListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  role: FamilyRole;
  memberCount: number;
}

export interface MyFamilyListResponse extends ApiEnvelope<{
  items: FamilyListItem[];
}> {}

export interface CreateFamilyRequest {
  name: string;
  timezone?: string;
}

export interface CreateFamilyResult extends FamilyListItem {
  createdAt: string;
}

export interface CreateFamilyResponse extends ApiEnvelope<CreateFamilyResult> {}

export interface UpdateFamilyRequest {
  name?: string;
  timezone?: string;
}

export interface FamilyDetail {
  id: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  status: FamilyStatus;
  createdBy: string;
  currentUserRole: FamilyRole;
  memberCount: number;
  createdAt: string;
}

export interface FamilyDetailResponse extends ApiEnvelope<FamilyDetail> {}

/** PATCH /families/{id} 的返回（不含 role / memberCount） */
export interface FamilySummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  status: FamilyStatus;
}

export interface FamilySummaryResponse extends ApiEnvelope<FamilySummary> {}

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

export interface InvitePreview {
  family: {
    id: string;
    name: string;
    avatarUrl: string | null;
    memberCount: number;
  };
  expiresAt: string;
  canJoin: boolean;
}

export interface InvitePreviewResponse extends ApiEnvelope<InvitePreview> {}

export interface JoinFamilyResult {
  familyId: string;
  familyName: string;
  role: 'member';
  joinedAt: string;
}

export interface JoinFamilyResponse extends ApiEnvelope<JoinFamilyResult> {}

// ==================== 日程相关 ====================

export type EventStatus = 'active' | 'cancelled';

export interface PersonRef {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

/**
 * 操作主体（Actor）。
 * Core 的 createdBy / updatedBy / completedBy 可能是真实用户，也可能是外部系统。
 * 注意：与家庭成员 PersonRef 不同，Actor 使用 { type, id, name }，
 * 外部系统不应作为参与人 / 负责人展示，也不使用用户头像占位。
 */
export type PrincipalType = 'user' | 'system';

export interface Actor {
  type: PrincipalType;
  id: string;
  name: string;
  avatarUrl: string | null;
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
  createdBy: Actor;
  updatedBy: Actor;
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
  completedBy: Actor | null;
  createdBy: Actor;
  updatedBy: Actor;
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

// ==================== 外部系统（集成）相关 ====================

/** 系统可被授予的权限（MVP 仅支持读写日程与待办、读取家庭信息） */
export type SystemPermission =
  | 'family:read'
  | 'events:read'
  | 'events:write'
  | 'tasks:read'
  | 'tasks:write';

export type IntegrationStatus = 'active' | 'disabled' | 'deleted';

/** 外部系统（integration） */
export interface Integration {
  id: string;
  name: string;
  description: string | null;
  status: IntegrationStatus;
  permissions: SystemPermission[];
  createdBy: Actor;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface IntegrationListResponse extends ApiEnvelope<{
  items: Integration[];
}> {}

export interface IntegrationResponse extends ApiEnvelope<Integration> {}

export interface CreateIntegrationRequest {
  name: string;
  description?: string | null;
  permissions: SystemPermission[];
}

export interface UpdateIntegrationRequest {
  name?: string;
  description?: string | null;
  status?: 'active' | 'disabled';
  permissions?: SystemPermission[];
}

export type CredentialType = 'oauth_client_secret' | 'api_token';
export type CredentialStatus = 'active' | 'revoked';

/** 凭证摘要（列表 / 详情，永远不含完整明文） */
export interface IntegrationCredential {
  id: string;
  type: CredentialType;
  /** 明文尾 4 位，仅用于识别 */
  suffix: string;
  status: CredentialStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CredentialListResponse extends ApiEnvelope<{
  items: IntegrationCredential[];
}> {}

/** 创建 Client Secret 的一次性响应（含明文 clientSecret，仅本次可见） */
export interface ClientSecretCreated extends IntegrationCredential {
  clientId: string;
  clientSecret: string;
}

/** 创建 API Token 的一次性响应（含明文 token，仅本次可见） */
export interface ApiTokenCreated extends IntegrationCredential {
  token: string;
}

// ==================== 内部用户创建 ====================

export interface CreateInternalUserRequest {
  displayName: string;
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
