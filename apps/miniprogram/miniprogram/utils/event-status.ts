/**
 * 日程状态派生（纯函数，无 wx / 无平台依赖，可直接在 Node 单测中导入）。
 *
 * 仅基于事件字段与「当前时刻」判断：
 * - 是否已结束（非全天事件且结束时刻早于 now；全天事件当天内不算已结束）；
 * - 是否正在进行（非全天且 startAt <= now < endAt）；
 * - 今日列表展示排序键（已结束沉底，未结束按开始时间升序、全天优先）。
 *
 * 注意：这些判据只看本地 now，是客户端展示口径，不替代 Core 的状态校验。
 */

/** 判断所需的事件字段子集（避免运行时类型导入依赖） */
type StatusInput = {
  isAllDay: boolean;
  startAt?: string | null;
  endAt?: string | null;
  startDate?: string | null;
  endDateExclusive?: string | null;
};

/** 本地日期（设备时区）转 YYYY-MM-DD，用于全天事件「今天」比较 */
function localYmd(now: number): string {
  const d = new Date(now);
  const m = `${d.getMonth() + 1}`;
  const day = `${d.getDate()}`;
  return `${d.getFullYear()}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 是否已结束：
 * - 非全天事件：结束时刻早于 now；
 * - 全天事件：结束日期（endDateExclusive，含当天为 exclusive）早于今天，即整个日程已过去。
 * 注意：首页「今天安排」只会出现包含「今天」的日程，其中全天事件的 endDateExclusive 必然晚于今天，
 * 因此不会被误判为已结束；此处判据对首页与日程页同时成立。
 */
export function isEventEnded(e: StatusInput, now: number): boolean {
  if (e.isAllDay) {
    return !!e.endDateExclusive && e.endDateExclusive <= localYmd(now);
  }
  return !!e.endAt && new Date(e.endAt).getTime() < now;
}

/** 非全天且 startAt <= now < endAt 视为进行中 */
export function isEventOngoing(e: StatusInput, now: number): boolean {
  return (
    !e.isAllDay &&
    !!e.startAt &&
    !!e.endAt &&
    new Date(e.startAt).getTime() <= now &&
    new Date(e.endAt).getTime() > now
  );
}

/**
 * 今日列表排序比较：已结束沉底；未结束按开始时间升序（全天优先，映射为 0）。
 */
export function eventDisplayRank(a: StatusInput, b: StatusInput, now: number): number {
  const aEnded = isEventEnded(a, now);
  const bEnded = isEventEnded(b, now);
  if (aEnded !== bEnded) return aEnded ? 1 : -1;
  const aTime = a.isAllDay ? 0 : new Date(a.startAt as string).getTime();
  const bTime = b.isAllDay ? 0 : new Date(b.startAt as string).getTime();
  return aTime - bTime;
}
