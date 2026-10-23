/**
 * Reusable Mini Program recent-selection list for a future football selector.
 * Parent provides verified userId/spaceId; on 'select' parent MUST check the ID
 * using its explicit HomeMew Mini BFF endpoint before using it in a match.
 * After verification, parent may call rememberVerifiedSelection({id, name}).
 */
import { readFootballRecent, removeFootballRecent, rememberFootballRecent,
  type FootballRecentKind, type FootballRecentItem } from '../../utils/football-recent-cache';

Component({
  properties: {
    userId: { type: String, value: '' },
    spaceId: { type: String, value: '' },
    kind: { type: String, value: 'team' },
  },
  data: {
    recent: [] as FootballRecentItem[],
  },
  lifetimes: {
    attached(): void { this.refresh(); },
  },
  observers: {
    'userId,spaceId,kind'(): void { this.refresh(); },
  },
  methods: {
    refresh(): void {
      const { userId, spaceId, kind } = this.properties;
      this.setData({ recent: readFootballRecent(userId, spaceId, kind as FootballRecentKind) });
    },
    onPick(e: WechatMiniprogram.TouchEvent): void {
      const id = e.currentTarget.dataset.id as string;
      const item = this.data.recent.find((x: FootballRecentItem) => x.id === id);
      if (item) this.triggerEvent('select', { id: item.id, name: item.name });
    },
    onForget(e: WechatMiniprogram.TouchEvent): void {
      const id = e.currentTarget.dataset.id as string;
      const { userId, spaceId, kind } = this.properties;
      this.setData({ recent: removeFootballRecent(userId, spaceId, kind as FootballRecentKind, id) });
      this.triggerEvent('forget', { id }); // Local removal only; not a record deletion.
    },
    rememberVerifiedSelection(item: { id: string; name: string }): void {
      const { userId, spaceId, kind } = this.properties;
      this.setData({ recent: rememberFootballRecent(userId, spaceId, kind as FootballRecentKind, item) });
    },
  },
});
