import { EMOJI_GROUPS, EMOJI_TOTAL, type EmojiEntry } from './emoji-data';

const PAGE_SIZE = 72;
const POPULAR = ['🎉', '❤️', '🏠', '⚽', '📅', '📚', '🎂', '🎁', '✈️', '🎯', '💡', '✅', '⭐', '🍀', '🎵', '💻', '🏆', '🏃', '🍎', '🐱', '🌻', '🚗', '🏫', '👨‍👩‍👧', '🎮', '💰', '🔔', '🧹'];
const POPULAR_ITEMS: EmojiEntry[] = POPULAR.map(x => [x, ''] as const);
const CATEGORIES = [{ key: 'popular', title: '常用' }, ...EMOJI_GROUPS.map(g => ({ key: g.key, title: g.title }))];

/** Chinese keyword hints supplement canonical Unicode English names. */
const ALIASES: Record<string, string> = {
  '足球': 'soccer', '篮球': 'basketball', '排球': 'volleyball', '运动': 'sport',
  '生日': 'birthday', '派对': 'party', '蛋糕': 'cake', '礼物': 'gift',
  '书': 'book', '阅读': 'book', '学习': 'school', '学校': 'school',
  '旅游': 'travel', '旅行': 'airplane', '飞机': 'airplane', '汽车': 'car',
  '猫': 'cat', '狗': 'dog', '花': 'flower', '树': 'tree', '食物': 'food',
  '吃饭': 'meal', '汉堡': 'hamburger', '咖啡': 'coffee', '爱心': 'heart',
  '开心': 'smile', '哭': 'crying', '笑': 'laugh', '星星': 'star',
  '旗': 'flag', '国旗': 'flag', '工作': 'office', '电脑': 'computer',
  '手机': 'mobile phone', '家庭': 'family', '房子': 'house',
  '完成': 'check mark', '提醒': 'bell', '金钱': 'money',
  '医生': 'doctor', '音乐': 'music', '奖杯': 'trophy',
  '天气': 'weather', '太阳': 'sun', '月亮': 'moon',
};

type DisplayItem = { emoji: string; selected: boolean };
const categoryEntries = (category: string): EmojiEntry[] =>
  category === 'popular' ? POPULAR_ITEMS : EMOJI_GROUPS.find(g => g.key === category)?.entries ?? [];

Component({
  properties: {
    /** A trigger is shown even if all values are absent. */
    emoji: { type: String, value: '' },
    imagePath: { type: String, value: '' },
    /** File identity exists but picture bytes have not yet loaded. */
    imageFileId: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    visible: false,
    categories: CATEGORIES,
    activeCategory: 'popular',
    search: '',
    displayed: [] as DisplayItem[],
    total: 0,
    shown: 0,
    allEmojiCount: EMOJI_TOTAL,
    currentCategoryTitle: '常用',
  },
  methods: {
    onOpen(): void {
      if (this.properties.disabled) return;
      this.setData({ visible: true, activeCategory: 'popular', search: '' });
      this.refresh();
    },
    onClose(): void { this.setData({ visible: false }); },
    onNoop(): void { /* prevent sheet taps from closing the dialog */ },
    onCategoryTap(e: WechatMiniprogram.TouchEvent): void {
      const key = String(e.currentTarget.dataset.key ?? '');
      if (key && (key !== this.data.activeCategory || this.data.search.trim())) {
        this.setData({ activeCategory: key, search: '' });
        this.refresh();
      }
    },
    onSearchInput(e: WechatMiniprogram.Input): void {
      this.setData({ search: e.detail.value || '' });
      this.refresh();
    },
    results(): EmojiEntry[] {
      const search = this.data.search.trim().toLocaleLowerCase();
      if (!search) return categoryEntries(this.data.activeCategory);
      // Search all categories, not only the currently selected tab.
      const equivalent = ALIASES[search] || search;
      const result: EmojiEntry[] = [];
      for (const group of EMOJI_GROUPS) {
        const matchesCategory = group.title.includes(search);
        for (const entry of group.entries) {
          if (matchesCategory || entry[0].includes(search)
            || entry[1].toLocaleLowerCase().includes(equivalent)) result.push(entry);
        }
      }
      return result;
    },
    refresh(): void {
      const entries = this.results();
      const count = Math.min(entries.length, PAGE_SIZE);
      const current = String(this.properties.emoji || '');
      this.setData({
        displayed: entries.slice(0, count).map(([emoji]) => ({ emoji, selected: emoji === current })),
        total: entries.length,
        shown: count,
        currentCategoryTitle: this.data.search.trim() ? '搜索结果'
          : (CATEGORIES.find(x => x.key === this.data.activeCategory)?.title || '常用'),
      });
    },
    onLoadMore(): void {
      if (this.data.shown >= this.data.total) return;
      const entries = this.results();
      const count = Math.min(entries.length, this.data.shown + PAGE_SIZE);
      const current = String(this.properties.emoji || '');
      this.setData({
        displayed: entries.slice(0, count).map(([emoji]) => ({ emoji, selected: emoji === current })),
        shown: count,
      });
    },
    onSelectEmoji(e: WechatMiniprogram.TouchEvent): void {
      const emoji = String(e.currentTarget.dataset.emoji || '');
      if (!emoji) return;
      this.triggerEvent('change', { type: 'emoji', emoji });
      this.onClose();
    },
    onChooseImage(): void {
      // The caller stores a temporary image path; binary upload happens on Save.
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
        success: result => {
          const path = result.tempFiles?.[0]?.tempFilePath;
          if (!path) return;
          this.triggerEvent('change', { type: 'image', path });
          this.onClose();
        },
      });
    },
    onClear(): void {
      this.triggerEvent('change', { type: 'clear' });
      this.onClose();
    },
  },
});
