/**
 * 统一错误码 → 中文用户提示映射。
 *
 * 页面不应直接展示英文 Core message。统一通过 getErrorMessage(code, message)
 * 获取可展示文案；未知 code 回退到 Core 返回的 message，再回退到通用文案。
 */

export const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '登录状态已过期，请重新登录',
  FORBIDDEN: '你没有权限执行此操作',
  USER_NOT_FOUND: '用户不存在或已被删除',
  USER_DISABLED: '账号已被禁用',
  FAMILY_NOT_FOUND: '家庭不存在或已被删除',
  FAMILY_CREATE_LIMIT_REACHED: '每个用户最多创建 3 个家庭',
  FAMILY_MEMBER_LIMIT_REACHED: '该家庭成员数量已达上限',
  ALREADY_FAMILY_MEMBER: '你已经是该家庭的成员了',
  LAST_ADMIN_CANNOT_BE_REMOVED: '无法移除最后一名管理员',
  CANNOT_REMOVE_SELF: '不能移除你自己',
  INVITE_NOT_FOUND: '邀请不存在或已失效',
  INVITE_REVOKED: '邀请码已被撤销',
  INVITE_EXPIRED: '邀请码已过期',
  INVITE_EXHAUSTED: '邀请码已使用完毕',
  INVALID_REQUEST: '请求参数有误',
  NETWORK_ERROR: '网络请求失败，请检查网络连接',
  TIMEOUT: '请求超时，请稍后重试',

  // 外部系统 / 集成相关
  INTEGRATION_NOT_FOUND: '外部系统不存在或已被删除',
  CREDENTIAL_NOT_FOUND: '凭证不存在或已被吊销',
  CREDENTIAL_REVOKED: '凭证已被吊销',
  INVALID_PERMISSIONS: '权限设置无效',
  SYSTEM_DISABLED: '该外部系统已被停用',
  SYSTEM_ACCESS_DENIED: '该外部系统无权访问本家庭',
  SYSTEM_PERMISSION_DENIED: '该外部系统缺少所需权限',

  // 乐观并发版本冲突（Core 实际返回值）
  TASK_VERSION_CONFLICT: '待办已被其他家庭成员修改，请刷新后重试',
  EVENT_VERSION_CONFLICT: '日程已被其他家庭成员修改，请刷新后重试',

  // 兼容别名，避免契约未明确时使用方拿到不同字符串导致文案缺失
  FAMILY_CREATION_LIMIT_REACHED: '每个用户最多创建 3 个家庭',
  NOT_FOUND: '内容不存在或已被删除',
  CONFLICT: '内容已被其他家庭成员修改，请刷新后重试',
  VERSION_CONFLICT: '内容已被其他家庭成员修改，请刷新后重试',

  // 喵一下（Creation Drafts）— 错误 code 来自 openapi.yaml 的 CreationDraft*Error。
  // INVALID_REQUEST 契约里复用了通用 code，文案沿用上方「请求参数有误」；
  // 下方仅补充喵一下专属的 AI 相关错误码。
  AI_RATE_LIMITED: '喵喵有点忙，稍等一下再试试',
  AI_PROVIDER_UNAVAILABLE: '智能助手暂时不可用，请稍后重试',
  AI_INVALID_RESPONSE: '智能助手暂时不可用，请稍后重试',
  AI_NOT_CONFIGURED: '智能助手尚未配置，暂不可用',
  AI_PROVIDER_TIMEOUT: '智能助手响应超时，请稍后重试',
};

/**
 * 是否为乐观并发版本冲突。
 * 统一判断入口，避免各页面各写一套不一致的错误码判断。
 */
export function isVersionConflict(code?: string): boolean {
  return (
    code === 'TASK_VERSION_CONFLICT' ||
    code === 'EVENT_VERSION_CONFLICT' ||
    code === 'VERSION_CONFLICT' ||
    code === 'CONFLICT'
  );
}

/**
 * 根据错误码获取用户友好提示。
 * @param code Core 返回的错误 code
 * @param fallbackMessage Core 返回的原始 message，未知 code 时回退展示
 */
export function getErrorMessage(code?: string, fallbackMessage?: string): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  return fallbackMessage || '操作失败，请稍后重试';
}
