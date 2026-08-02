export type TimeZoneOption = {
  id: string;
  label: string;
  keywords: string;
};

const COMMON_TIME_ZONES: TimeZoneOption[] = [
  ['UTC', 'UTC', 'universal'],
  ['Pacific/Honolulu', '檀香山', 'honolulu hawaii'],
  ['America/Los_Angeles', '洛杉矶', 'los angeles san francisco'],
  ['America/Denver', '丹佛', 'denver mountain'],
  ['America/Chicago', '芝加哥', 'chicago central'],
  ['America/New_York', '纽约', 'new york eastern'],
  ['Europe/London', '伦敦', 'london'],
  ['Europe/Paris', '巴黎', 'paris'],
  ['Europe/Berlin', '柏林', 'berlin'],
  ['Europe/Rome', '罗马', 'rome'],
  ['Europe/Madrid', '马德里', 'madrid'],
  ['Europe/Amsterdam', '阿姆斯特丹', 'amsterdam'],
  ['Europe/Zurich', '苏黎世', 'zurich'],
  ['Europe/Moscow', '莫斯科', 'moscow'],
  ['Africa/Cairo', '开罗', 'cairo'],
  ['Africa/Johannesburg', '约翰内斯堡', 'johannesburg'],
  ['Asia/Dubai', '迪拜', 'dubai'],
  ['Asia/Kolkata', '加尔各答', 'kolkata india'],
  ['Asia/Bangkok', '曼谷', 'bangkok'],
  ['Asia/Singapore', '新加坡', 'singapore'],
  ['Asia/Shanghai', '上海', 'shanghai beijing china'],
  ['Asia/Hong_Kong', '香港', 'hong kong'],
  ['Asia/Taipei', '台北', 'taipei'],
  ['Asia/Tokyo', '东京', 'tokyo'],
  ['Asia/Seoul', '首尔', 'seoul'],
  ['Asia/Jakarta', '雅加达', 'jakarta'],
  ['Australia/Perth', '珀斯', 'perth'],
  ['Australia/Adelaide', '阿德莱德', 'adelaide'],
  ['Australia/Sydney', '悉尼', 'sydney'],
  ['Pacific/Auckland', '奥克兰', 'auckland'],
].map(([id, label, keywords]) => ({ id, label, keywords }));

function dynamicOption(id: string): TimeZoneOption {
  const parts = id.split('/');
  const city = (parts[parts.length - 1] || id).split('_').join(' ');
  return { id, label: city, keywords: city.toLowerCase() };
}

export function buildTimeZoneOptions(preferred: Array<string | null | undefined>): TimeZoneOption[] {
  const byId = new Map(COMMON_TIME_ZONES.map((option) => [option.id, option]));
  const result: TimeZoneOption[] = [];
  for (const id of preferred) {
    if (!id || result.some((option) => option.id === id)) continue;
    result.push(byId.get(id) || dynamicOption(id));
  }
  for (const option of COMMON_TIME_ZONES) {
    if (!result.some((existing) => existing.id === option.id)) result.push(option);
  }
  return result;
}

export function searchTimeZoneOptions(
  options: TimeZoneOption[],
  query: string,
): TimeZoneOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return options;
  return options.filter(
    (option) =>
      option.id.toLowerCase().includes(needle) ||
      option.label.toLowerCase().includes(needle) ||
      option.keywords.toLowerCase().includes(needle),
  );
}

export function timeZoneLabel(timeZone: string): string {
  return COMMON_TIME_ZONES.find((option) => option.id === timeZone)?.label || dynamicOption(timeZone).label;
}

/** 创建家庭时使用的默认时区。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 常用时区选择器用的扁平列表（仅 id + label，供 picker 展示）。 */
export const COMMON_TIMEZONES: { value: string; label: string }[] = COMMON_TIME_ZONES.map(
  (option) => ({ value: option.id, label: option.label }),
);

/** 给定 IANA 时区，返回其在 COMMON_TIMEZONES 中的下标，找不到时回退到上海。 */
export function timezoneIndex(value: string): number {
  const idx = COMMON_TIMEZONES.findIndex((t) => t.value === value);
  if (idx >= 0) return idx;
  return COMMON_TIMEZONES.findIndex((t) => t.value === DEFAULT_TIMEZONE);
}
