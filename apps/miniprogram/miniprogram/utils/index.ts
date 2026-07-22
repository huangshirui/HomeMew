/**
 * 工具函数库
 */

/**
 * 显示成功提示
 */
export function showSuccess(title: string, duration = 1500): void {
  wx.showToast({
    title,
    icon: 'success',
    duration,
  });
}

/**
 * 显示错误提示
 */
export function showError(title: string, duration = 2000): void {
  wx.showToast({
    title,
    icon: 'none',
    duration,
  });
}

/**
 * 显示加载中提示
 */
export function showLoading(title = '加载中...'): void {
  wx.showLoading({
    title,
    mask: true,
  });
}

/**
 * 隐藏加载中提示
 */
export function hideLoading(): void {
  wx.hideLoading();
}

/**
 * 显示确认对话框
 * 返回 Promise<boolean>
 */
export function showConfirm(title: string, content?: string): Promise<boolean> {
  return new Promise(resolve => {
    wx.showModal({
      title,
      content: content || '',
      confirmText: '确定',
      cancelText: '取消',
      success(res) {
        resolve(res.confirm);
      },
      fail() {
        resolve(false);
      },
    });
  });
}

/**
 * 格式化日期为本地显示格式
 */
export function formatDate(dateStr: string, format: 'date' | 'datetime' | 'time' = 'date'): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  switch (format) {
    case 'date':
      return `${year}-${month}-${day}`;
    case 'datetime':
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    case 'time':
      return `${hours}:${minutes}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * 友好相对时间描述
 */
export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  return formatDate(dateStr, 'date');
}

/**
 * 防抖函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay = 300,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function(this: unknown, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 复制文本到剪贴板
 */
export function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success() {
        showSuccess('已复制到剪贴板');
        resolve();
      },
      fail(err) {
        showError('复制失败');
        reject(err);
      },
    });
  });
}

/**
 * 获取默认头像 URL
 */
export function getDefaultAvatar(): string {
  return '/assets/images/default-avatar.png';
}

/**
 * 安全获取头像 URL（空值时使用默认头像）
 */
export function safeAvatarUrl(url: string | null | undefined): string {
  return url || getDefaultAvatar();
}

/**
 * 错误码到用户友好消息的映射
 */
const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: '登录状态已过期，正在重新登录...',
  FORBIDDEN: '你没有权限执行此操作',
  NOT_FOUND: '内容不存在或已被删除',
  CONFLICT: '内容已被其他家庭成员修改，请刷新后重试',
  FAMILY_MEMBER_LIMIT_REACHED: '该家庭已有 8 名成员，暂时无法加入',
  FAMILY_CREATION_LIMIT_REACHED: '每个用户最多创建 3 个家庭',
  INVITE_EXPIRED: '邀请码已过期',
  INVITE_REVOKED: '邀请码已被撤销',
  INVITE_EXHAUSTED: '邀请码已用完',
  ALREADY_FAMILY_MEMBER: '你已经是该家庭的成员了',
  USER_DISABLED: '账号已被禁用',
  NETWORK_ERROR: '网络请求失败，请检查网络连接',
  TIMEOUT: '请求超时，请稍后重试',
  INVALID_REQUEST: '请求参数有误',
};

/**
 * 根据错误码获取用户友好消息
 */
export function getErrorMessage(code: string, fallback?: string): string {
  return ERROR_MESSAGES[code] || fallback || '操作失败，请稍后重试';
}
