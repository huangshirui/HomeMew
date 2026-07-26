/**
 * 日期 / 时区安全工具。
 *
 * 两类字段分开处理，避免跨时区显示错乱：
 * - 纯日期字段（YYYY-MM-DD，如全天日程、截止日期）：绝不经过 `new Date('YYYY-MM-DD')`，
 *   否则 JavaScript 会按 UTC 解析，在负时区（如美国）显示成前一天。统一用 parseDateOnly 拆分年月日。
 * - 带时间字段：按家庭 timezone 转换为 UTC ISO，再展示时按同一时区还原。
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 将 'YYYY-MM-DD' 解析为「本地零点」的 Date（按年月日构造，不走 UTC 解析）。
 * 仅用于纯日期字段的展示与天数运算。
 */
export function parseDateOnly(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return new Date(dateStr);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date -> 'YYYY-MM-DD'（本地年月日）。 */
export function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 对纯日期字符串做加减天数，返回 'YYYY-MM-DD'（不经过 UTC 解析）。 */
export function addDaysToDateOnly(dateStr: string, n: number): string {
  const d = parseDateOnly(dateStr);
  d.setDate(d.getDate() + n);
  return formatDateOnly(d);
}

/**
 * 计算某个 UTC 瞬间在指定 IANA 时区下的偏移（分钟，东区为正）。
 * 依赖 Intl.DateTimeFormat 的 timeZone 能力；不可用时回退东八区。
 */
function tzOffsetMinutes(utcDate: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = dtf.formatToParts(utcDate);
    const map: Record<string, number> = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = Number(p.value);
    });
    let hour = map.hour;
    if (hour === 24) hour = 0;
    const asUTC = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
    return Math.round((asUTC - utcDate.getTime()) / 60000);
  } catch {
    // Intl 不可用（部分低版本机型）：回退东八区
    return 8 * 60;
  }
}

/**
 * 将「指定时区的墙上时间」转换为 UTC ISO 字符串。
 * @param date 'YYYY-MM-DD'
 * @param time 'HH:mm'
 * @param timeZone IANA 时区，如 'Asia/Shanghai'
 */
export function zonedDateTimeToIso(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  // 先按该墙上时间当作 UTC，再用时区偏移校正回真正的 UTC。
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset1 = tzOffsetMinutes(new Date(guessUtc), timeZone);
  const actualUtc = guessUtc - offset1 * 60000;
  // 跨 DST 边界时二次校正
  const offset2 = tzOffsetMinutes(new Date(actualUtc), timeZone);
  const finalUtc = offset2 === offset1 ? actualUtc : guessUtc - offset2 * 60000;
  return new Date(finalUtc).toISOString();
}
