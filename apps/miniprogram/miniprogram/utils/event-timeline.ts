/**
 * 日程时间线纯工具函数（自包含、无 wx / 无相对导入，可在 Node 中单测）。
 *
 * 时区约定：定时事件使用 UTC 时间点，一律按「查看时区」（viewingTimezone）归组，
 * 与列表接口 `timezone` 查询参数保持同一语义——即 Core 用来把
 * `startDate/endDateExclusive` 换算成 UTC 查询窗口的时区。定时事件按「与窗口
 * 重叠的每一天」归组（含跨午夜 / 跨天），与 Core 列表接口的重叠返回语义
 * （start_at < windowEnd && end_at > windowStart）保持一致，否则跨天的定时事件
 * 会在窗口左边界被漏掉。
 * 事件自身的 `startTimezone/endTimezone` 只是端点地点时区元数据（例如航班出发地 /
 * 到达地），仅用于详情与卡片上的时间标签，绝不参与「属于哪一天」的判断，
 * 否则会与 Core 的窗口语义冲突（同一事件在客户端被分到窗口外的另一天）。
 * 定时事件的「时间点 → 时区日期」换算由调用方注入（小程序页面注入
 * utils/datetime.formatInstantInTimeZone，避免真机缺 ICU 时 Intl 抛错）；
 * 未注入时使用带守卫的 Intl 默认实现（Node 单测环境 ICU 完整，结果精确）。
 * 纯日期字符串仅在需要「星期 / 月历网格」时按年月日构造本地 Date，
 * 绝不使用 new Date('YYYY-MM-DD')（会被按 UTC 解析）。
 */

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

/** 'YYYY-MM-DD' -> 本地零点 Date（按年月日构造，不走 UTC 解析） */
function toLocalDate(dateStr: string): Date {
  return new Date(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
  );
}

/** Date -> 'YYYY-MM-DD'（本地年月日） */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 纯日期字符串加减天数 */
export function addDaysYmd(dateStr: string, n: number): string {
  const d = toLocalDate(dateStr);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** 与 Core Event 对齐的最小字段集（避免该纯模块依赖完整类型文件之外的东西） */
export type TimelineEventLike =
  | {
      isAllDay: true;
      startDate: string;
      endDateExclusive: string;
    }
  | {
      isAllDay: false;
      startAt: string;
      endAt: string;
    };

export type DayCell = {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  hasEvent: boolean;
};

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function maxYmd(a: string, b: string): string {
  return a > b ? a : b;
}

export function minYmd(a: string, b: string): string {
  return a < b ? a : b;
}

/** 'YYYY-MM-DD' 所在月份偏移 n 个月后的当月 1 号 */
export function addMonths(dateStr: string, n: number): string {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}-01`;
}

/** "2026年7月" */
export function monthLabelOf(dateStr: string): string {
  return `${Number(dateStr.slice(0, 4))}年${Number(dateStr.slice(5, 7))}月`;
}

/** "7月27日"；跨年时 "2025年12月31日" */
export function dateLabelOf(dateStr: string, thisYear: string): string {
  const m = Number(dateStr.slice(5, 7));
  const d = Number(dateStr.slice(8, 10));
  if (dateStr.slice(0, 4) === thisYear) return `${m}月${d}日`;
  return `${Number(dateStr.slice(0, 4))}年${m}月${d}日`;
}

/** "周一" */
export function weekLabelOf(dateStr: string): string {
  return `周${WEEK_CN[toLocalDate(dateStr).getDay()]}`;
}

/** 「UTC 时间点 → 指定时区墙钟日期 YYYY-MM-DD」换算函数 */
export type InstantToZonedDate = (instant: string, timeZone: string) => string;

/**
 * 事件在 [rangeStart, rangeEnd) 内占据的日期。
 * - 全天日程：start..end（end 不包含），在覆盖的每一天都出现；
 * - 普通日程：按 viewingTimezone（查看时区）换算后，凡是事件区间
 *   [startAt, endAt) 与那一天重叠的日期都出现（含跨午夜 / 跨天的事件），
 *   与 Core 列表接口的重叠返回语义一致，避免跨天事件在窗口边界被漏掉。
 *
 * @param viewingTimezone 查看日历所用的时区，必须与列表接口 `timezone` 查询
 *   参数完全一致，否则归组结果会落在 Core 查询窗口之外。事件的
 *   `startTimezone/endTimezone` 不参与本函数的任何判断。
 * @param instantToZonedDate 定时事件的时区换算函数。小程序页面必须注入
 *   基于 utils/datetime.formatInstantInTimeZone 的实现（静态偏移表优先，
 *   真机可靠）；缺省实现带 Intl 守卫，仅保证不抛错，供 Node 单测使用。
 */
export function eventDaysInRange(
  e: TimelineEventLike,
  rangeStart: string,
  rangeEnd: string,
  viewingTimezone: string,
  instantToZonedDate: InstantToZonedDate = instantDateInTimeZone,
): string[] {
  if (e.isAllDay) {
    const startDay = e.startDate;
    const endDay = e.endDateExclusive;
    const days: string[] = [];
    let cur = maxYmd(startDay, rangeStart);
    const stop = minYmd(endDay, rangeEnd);
    while (cur < stop) {
      days.push(cur);
      cur = addDaysYmd(cur, 1);
    }
    // 异常数据（end <= start）时至少显示开始日
    if (days.length === 0 && startDay >= rangeStart && startDay < rangeEnd) {
      days.push(startDay);
    }
    return days;
  }
  const startDay = instantToZonedDate(e.startAt, viewingTimezone);
  // 退化数据（缺失 endAt）：回退为仅开始日，保持旧行为
  if (!e.endAt) {
    return startDay >= rangeStart && startDay < rangeEnd ? [startDay] : [];
  }
  const endDay = instantToZonedDate(e.endAt, viewingTimezone);
  // 定时事件按「与窗口重叠的每一天」归组：从 startDay 铺到 endDay（含端点），
  // 再截断到 [rangeStart, rangeEnd)。跨午夜 / 跨天事件会落在多天。
  const days: string[] = [];
  let cur = maxYmd(startDay, rangeStart);
  const last = minYmd(endDay, addDaysYmd(rangeEnd, -1));
  while (cur <= last) {
    days.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  // 异常数据（endAt <= startAt，即 endDay < startDay）：至少显示开始日
  if (days.length === 0 && startDay >= rangeStart && startDay < rangeEnd) {
    days.push(startDay);
  }
  return days;
}

/**
 * 缺省换算实现：仅供未注入 instantToZonedDate 时兜底（Node 单测环境）。
 *
 * 真机微信运行时常缺 ICU 时区库，`Intl.DateTimeFormat` 的 `timeZone` 选项
 * 可能直接抛错（即线上报的「Intl 不存在」），因此这里全程守卫 + try/catch，
 * 失败时退回设备本地日期，绝不让列表构建整体崩溃。
 * 小程序页面不应依赖本兜底，而应注入 utils/datetime.formatInstantInTimeZone。
 */
function instantDateInTimeZone(instant: string, timeZone: string): string {
  const value = new Date(instant);
  if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(value);
      const get = (type: string): string =>
        parts.find(part => part.type === type)?.value || '';
      const day = `${get('year')}-${get('month')}-${get('day')}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    } catch {
      // 落入设备本地日期兜底
    }
  }
  return toYmd(value);
}

/** 构建 6x7 月历矩阵 */
export function buildCalendarMatrix(
  year: number,
  month: number,
  today: string,
  dotDates: Set<string>,
): DayCell[][] {
  const firstDay = new Date(year, month - 1, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: DayCell[] = [];

  // 上个月末尾补充
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const d = new Date(year, month - 2, day);
    cells.push({
      date: toYmd(d),
      day,
      inMonth: false,
      isToday: false,
      hasEvent: false,
    });
  }

  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month)}-${pad2(d)}`;
    cells.push({
      date: dateStr,
      day: d,
      inMonth: true,
      isToday: dateStr === today,
      hasEvent: dotDates.has(dateStr),
    });
  }

  // 下个月开头补充，凑齐 42 格
  let nextDay = 1;
  while (cells.length < 42) {
    const d = new Date(year, month, nextDay);
    cells.push({
      date: toYmd(d),
      day: nextDay,
      inMonth: false,
      isToday: false,
      hasEvent: false,
    });
    nextDay++;
  }

  const rows: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}
