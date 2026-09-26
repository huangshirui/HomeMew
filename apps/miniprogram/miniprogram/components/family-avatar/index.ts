/**
 * 家庭头像组件。
 *
 * 与用户头像 user-avatar 保持一致的处理方式：
 * - 优先使用调用方传入的 src（家庭头像 URL）；
 * - src 为空时回退到本地默认家庭头像；
 * - 加载失败时回退到默认家庭头像，避免每页重复实现 binderror 逻辑。
 */

const DEFAULT_FAMILY_URL = '/assets/images/default-family.png';

Component({
  properties: {
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
      value: '家庭头像',
    },
  },

  data: {
    resolvedSrc: DEFAULT_FAMILY_URL,
  },

  observers: {
    src(src: string): void {
      const resolved = src && src.trim() ? src.trim() : DEFAULT_FAMILY_URL;
      if (resolved !== this.data.resolvedSrc) {
        this.setData({ resolvedSrc: resolved });
      }
    },
  },

  methods: {
    onError(): void {
      if (this.data.resolvedSrc !== DEFAULT_FAMILY_URL) {
        this.setData({ resolvedSrc: DEFAULT_FAMILY_URL });
      }
    },
  },
});
