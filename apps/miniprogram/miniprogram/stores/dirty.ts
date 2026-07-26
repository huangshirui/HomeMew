/**
 * 列表数据脏标记 + 发布订阅
 *
 * 列表页（首页 / 日程 / 待办）在 onShow 时重新拉取数据，但为避免单纯「切换 tab」
 * 也反复请求网络，列表页在「已加载且数据未变脏」时跳过重新拉取。
 *
 * 机制分两层，互为兜底：
 *
 * 1. 脏标记（跨页、持久化）：
 *    其它页面（详情、编辑、新建）在成功创建 / 修改 / 删除对应资源后调用 markDirty，
 *    把脏标记留下；相关列表页在下次 onShow 时通过 consumeDirty / consumeAnyDirty
 *    消费该标记并重新拉取一次。列表页隐藏（navigateTo 去详情 / 切走）期间产生的变更
 *    靠这一层补齐。
 *
 * 2. 发布订阅（当前可见页、实时）：
 *    列表页在 onShow 时 subscribe，onHide 时取消订阅。markDirty 会同步通知所有
 *    当前已订阅的页面，使「此刻正显示在屏幕上」的列表立即刷新。这层用于页面自身可见
 *    期间的实时同步，也作为「万一某处漏写 markDirty」之外的一道实时兜底。
 */

export type DirtyDomain = 'events' | 'tasks';

type DirtyListener = (domain: DirtyDomain) => void;

const dirtyFlags: Record<DirtyDomain, boolean> = {
  events: false,
  tasks: false,
};

/** 当前订阅者集合；仅页面可见期间持有订阅，页面隐藏即移除，避免泄漏与误刷新 */
const listeners = new Set<DirtyListener>();

/** 标记某个域的数据已变更：留下脏标记，并实时通知当前已订阅的页面 */
export function markDirty(domain: DirtyDomain): void {
  dirtyFlags[domain] = true;
  listeners.forEach((listener) => listener(domain));
}

/**
 * 订阅数据变更通知。
 * @returns 取消订阅的函数，应在页面 onHide 时调用。
 */
export function subscribe(listener: DirtyListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 消费某域的脏标记：若已被标记则清除并返回 true（表示需要重新拉取） */
export function consumeDirty(domain: DirtyDomain): boolean {
  if (dirtyFlags[domain]) {
    dirtyFlags[domain] = false;
    return true;
  }
  return false;
}

/** 消费任一域的脏标记（首页同时展示日程与待办时使用） */
export function consumeAnyDirty(): boolean {
  let any = false;
  (Object.keys(dirtyFlags) as DirtyDomain[]).forEach((key) => {
    if (dirtyFlags[key]) {
      dirtyFlags[key] = false;
      any = true;
    }
  });
  return any;
}
