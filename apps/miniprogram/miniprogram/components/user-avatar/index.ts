/**
 * LifeSpace 用户头像组件。
 *
 * 统一处理：
 * - 根据 userId 构造 Identity 稳定头像资源 URL；
 * - 兼容调用方直接传入 src；
 * - 头像不存在或加载失败时回退到本地默认头像；
 * - 避免每个页面重复实现 binderror 逻辑。
 */

import { getUserAvatarUrl } from '../../services/config';

const DEFAULT_AVATAR_URL = '/assets/images/default-avatar.png';

function resolveAvatarSource(userId: string, src: string): string {
  const directSource = src.trim();
  if (directSource) return directSource;
  const normalizedUserId = userId.trim();
  return normalizedUserId ? getUserAvatarUrl(normalizedUserId) : DEFAULT_AVATAR_URL;
}

Component({
  properties: {
    userId: {
      type: String,
      value: '',
    },
    src: {
      type: String,
      value: '',
    },
    size: {
      type: Number,
      value: 80,
    },
    alt: {
      type: String,
      value: '用户头像',
    },
  },

  data: {
    resolvedSrc: DEFAULT_AVATAR_URL,
  },

  observers: {
    'userId, src'(userId: string, src: string): void {
      const resolvedSrc = resolveAvatarSource(userId || '', src || '');
      if (resolvedSrc !== this.data.resolvedSrc) {
        this.setData({ resolvedSrc });
      }
    },
  },

  methods: {
    onAvatarError(): void {
      const failedSrc = this.data.resolvedSrc;
      if (failedSrc === DEFAULT_AVATAR_URL) return;
      this.setData({ resolvedSrc: DEFAULT_AVATAR_URL });
      this.triggerEvent('error', {
        userId: this.data.userId,
        src: failedSrc,
      });
    },
  },
});
