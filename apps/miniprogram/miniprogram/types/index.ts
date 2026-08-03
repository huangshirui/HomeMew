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

export interface EventCommon {
  id: string;
  familyId: string;
  summary: string;
  description: string | null;
  location: string | null;
  status: EventStatus;
  attendees: PersonRef[];
  createdBy: Actor;
  updatedBy: Actor;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TimedEvent extends EventCommon {
  isAllDay: false;
  startAt: string;
  endAt: string;
  startTimezone: string | null;
  endTimezone: string | null;
}

export interface AllDayEvent extends EventCommon {
  isAllDay: true;
  startDate: string;
  endDateExclusive: string;
}

export type Event = TimedEvent | AllDayEvent;

export interface EventResponse extends ApiEnvelope<Event> {}
export interface EventListResponse extends PaginatedResponse<Event> {}

export interface EventWriteCommon {
  summary: string;
  description?: string | null;
  attendeeIds?: string[];
  location?: string | null;
}

export interface CreateTimedEventRequest extends EventWriteCommon {
  isAllDay: false;
  startAt: string;
  endAt: string;
  startTimezone?: string | null;
  endTimezone?: string | null;
  startDate?: never;
  endDateExclusive?: never;
}

export interface CreateAllDayEventRequest extends EventWriteCommon {
  isAllDay: true;
  startDate: string;
  endDateExclusive: string;
  startAt?: never;
  endAt?: never;
  startTimezone?: never;
  endTimezone?: never;
}

export type CreateEventRequest = CreateTimedEventRequest | CreateAllDayEventRequest;

export interface EventUpdateFields {
  summary?: string;
  description?: string | null;
  attendeeIds?: string[];
  location?: string | null;
}

type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>;
}[keyof T];

interface TimedEventUpdateFields extends EventUpdateFields {
  isAllDay?: false;
  startAt?: string;
  endAt?: string;
  startTimezone?: string | null;
  endTimezone?: string | null;
  startDate?: never;
  endDateExclusive?: never;
}

interface AllDayEventUpdateFields extends EventUpdateFields {
  isAllDay?: true;
  startDate?: string;
  endDateExclusive?: string;
  startAt?: never;
  endAt?: never;
  startTimezone?: never;
  endTimezone?: never;
}

export type UpdateTimedEventRequest = { version: number } & RequireAtLeastOne<TimedEventUpdateFields>;
export type UpdateAllDayEventRequest = { version: number } & RequireAtLeastOne<AllDayEventUpdateFields>;
export type UpdateEventRequest = UpdateTimedEventRequest | UpdateAllDayEventRequest;

// ==================== 待办相关 ====================

export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  familyId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
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
  dueDate?: string | null;
  assigneeIds?: string[];
}

interface TaskUpdateFields {
  name?: string;
  description?: string | null;
  dueDate?: string | null;
  assigneeIds?: string[];
}

export type UpdateTaskRequest = { version: number } & RequireAtLeastOne<TaskUpdateFields>;

export interface VersionActionRequest {
  version: number;
}

// ==================== 日子（Day Records）相关 ====================

/** 日子种类：已过去多久 / 倒计时 / 周期事项 */
export type DayRecordKind = 'elapsed' | 'countdown' | 'cycle';

export type DayRecordStatus = 'active' | 'archived';

/** 关注级别，由 Core 依据家庭时区计算 */
export type DayAttentionLevel = 'none' | 'info' | 'warning' | 'critical';

/**
 * Core 计算出的展示状态。
 * 小程序不重新判断关注状态，直接使用这里的值。
 */
export type DayComputedState =
  | 'normal'
  | 'threshold_reached'
  | 'future'
  | 'upcoming'
  | 'today'
  | 'past'
  | 'due'
  | 'overdue';

export interface DayComputedCommon {
  /** 家庭时区下的今天（YYYY-MM-DD） */
  today: string;
  state: DayComputedState;
  attentionLevel: DayAttentionLevel;
  isAttentionRequired: boolean;
}

export interface ElapsedDayComputed extends DayComputedCommon {
  elapsedDays: number;
  /** 未设置提醒阈值时为 null */
  remainingDays: number | null;
}

export interface CountdownDayComputed extends DayComputedCommon {
  remainingDays: number;
}

export interface CycleDayComputed extends DayComputedCommon {
  elapsedDays: number;
  remainingDays: number;
  progressRatio: number;
}

export interface DayRecordCommon {
  id: string;
  familyId: string;
  name: string;
  description: string | null;
  /** 关联对象；null 表示全家 */
  subject: PersonRef | null;
  icon: string | null;
  status: DayRecordStatus;
  version: number;
  createdBy: Actor;
  updatedBy: Actor;
  createdAt: string;
  updatedAt: string;
}

export interface ElapsedDayRecord extends DayRecordCommon {
  kind: 'elapsed';
  /** 最近一次发生日期；只能通过新增 occurrence 推进，不可 PATCH */
  anchorDate: string;
  attentionAfterDays: number | null;
  computed: ElapsedDayComputed;
}

export interface CountdownDayRecord extends DayRecordCommon {
  kind: 'countdown';
  /** 目标日期；countdown 允许通过 PATCH 修改 */
  anchorDate: string;
  attentionBeforeDays: number | null;
  computed: CountdownDayComputed;
}

export interface CycleDayRecord extends DayRecordCommon {
  kind: 'cycle';
  /** 上次处理日期；只能通过新增 occurrence 推进，不可 PATCH */
  anchorDate: string;
  cycleDays: number;
  /** 只读，由 Core 计算 */
  nextDueDate: string;
  attentionBeforeDays: number | null;
  computed: CycleDayComputed;
}

export type DayRecord = ElapsedDayRecord | CountdownDayRecord | CycleDayRecord;

export interface DayRecordResponse extends ApiEnvelope<DayRecord> {}
export interface DayRecordListResponse extends PaginatedResponse<DayRecord> {}

interface CreateDayRecordCommon {
  name: string;
  description?: string | null;
  anchorDate: string;
  subjectUserId?: string | null;
  icon?: string | null;
}

export interface CreateElapsedDayRecordRequest extends CreateDayRecordCommon {
  kind: 'elapsed';
  attentionAfterDays?: number | null;
}

export interface CreateCountdownDayRecordRequest extends CreateDayRecordCommon {
  kind: 'countdown';
  attentionBeforeDays?: number | null;
}

export interface CreateCycleDayRecordRequest extends CreateDayRecordCommon {
  kind: 'cycle';
  cycleDays: number;
  attentionBeforeDays?: number | null;
}

export type CreateDayRecordRequest =
  | CreateElapsedDayRecordRequest
  | CreateCountdownDayRecordRequest
  | CreateCycleDayRecordRequest;

/**
 * 更新日子。
 *
 * Core 会拒绝与所存 kind 不匹配的字段：
 * - 只有 countdown 接受 anchorDate；
 * - cycleDays / attentionBeforeDays 仅适用于 cycle 与 countdown；
 * - attentionAfterDays 仅适用于 elapsed。
 */
interface DayRecordUpdateFields {
  name?: string;
  description?: string | null;
  icon?: string | null;
  subjectUserId?: string | null;
  anchorDate?: string;
  cycleDays?: number;
  attentionBeforeDays?: number | null;
  attentionAfterDays?: number | null;
}

export type UpdateDayRecordRequest = { version: number } & RequireAtLeastOne<DayRecordUpdateFields>;

/** occurrence 来源：initial 为创建时的初始记录 */
export type DayRecordOccurrenceSource = 'initial' | 'manual';

export interface DayRecordOccurrence {
  id: string;
  dayRecordId: string;
  occurredOn: string;
  note: string | null;
  source: DayRecordOccurrenceSource;
  /** 与上一次记录的间隔天数；初始记录为 null */
  intervalDays: number | null;
  recordedBy: Actor;
  createdAt: string;
}

export interface DayRecordOccurrenceListResponse extends PaginatedResponse<DayRecordOccurrence> {}

export interface CreateDayRecordOccurrenceRequest {
  occurredOn: string;
  note?: string | null;
  version: number;
}

export interface CreateDayRecordOccurrenceResult {
  previousAnchorDate: string;
  intervalDays: number;
  /** 推进后的最新记录（含新 version），后续操作必须使用它 */
  record: DayRecord;
}

// ==================== 许愿池（Wishes）相关 ====================

export type WishStatus = 'open' | 'claimed' | 'fulfilled' | 'archived';

export interface Wish {
  id: string;
  familyId: string;
  title: string;
  description: string | null;
  /** 期望日期，纯日期，不做 UTC 转换 */
  desiredDate: string | null;
  status: WishStatus;
  /** 许愿人，由 Core 设为创建者 */
  owner: PersonRef;
  claimant: PersonRef | null;
  claimedAt: string | null;
  fulfilledBy: PersonRef | null;
  fulfilledAt: string | null;
  createdBy: Actor;
  updatedBy: Actor;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface WishResponse extends ApiEnvelope<Wish> {}
export interface WishListResponse extends PaginatedResponse<Wish> {}

export interface CreateWishRequest {
  title: string;
  description?: string | null;
  desiredDate?: string | null;
}

interface WishUpdateFields {
  title?: string;
  description?: string | null;
  desiredDate?: string | null;
}

export type UpdateWishRequest = { version: number } & RequireAtLeastOne<WishUpdateFields>;

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
