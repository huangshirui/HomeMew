/**
 * 日子（Day Record）展示文案与视图映射。
 *
 * 关键约定：状态与天数完全来自 Core 返回的 `computed`，本模块只负责把
 * `computed` 转成中文文案，绝不在小程序侧重新判断是否需要关注。
 */

import {
  DayRecord,
  DayRecordKind,
  DayAttentionLevel,
  ElapsedDayRecord,
  CountdownDayRecord,
  CycleDayRecord,
} from '../types/index';

/** 列表 / 关注卡使用的统一视图模型 */
export type DayRecordView = {
  id: string;
  name: string;
  kind: DayRecordKind;
  icon: string;
  iconImagePath: string;
  /** 主文案，如「已使用 86 天」 */
  primaryText: string;
  /** 次文案，如「还有 4 天到期」；无则为空串 */
  secondaryText: string;
  attentionLevel: DayAttentionLevel;
  isAttentionRequired: boolean;
  subjectName: string;
  status: 'active' | 'archived';
  version: number;
  /** 周期进度 0~1（仅 cycle 类型有值，其余为 null） */
  progressRatio: number | null;
};

/** 各 kind 的默认图标（用户未选择时的占位，均为内置 Emoji） */
const DEFAULT_ICONS: Record<DayRecordKind, string> = {
  elapsed: '🕰',
  countdown: '🎯',
  cycle: '🔁',
};

export function dayRecordIcon(record: DayRecord): string {
  return record.presentation?.icon?.type === 'emoji' ? record.presentation.icon.value : DEFAULT_ICONS[record.kind];
}

/** 生活化的种类标签 */
export const KIND_LABELS: Record<DayRecordKind, string> = {
  elapsed: '生活记录',
  countdown: '倒计时',
  cycle: '周期事项',
};

/** elapsed：已经 N 天 / 已达到提醒时间 */
function elapsedTexts(record: ElapsedDayRecord): { primary: string; secondary: string } {
  const primary = `已经 ${record.computed.elapsedDays} 天`;
  const secondary =
    record.computed.state === 'threshold_reached' ? '已达到提醒时间' : '';
  return { primary, secondary };
}

/** countdown：还有 N 天 / 就是今天 / 已经过去 N 天 */
function countdownTexts(record: CountdownDayRecord): { primary: string; secondary: string } {
  const remaining = record.computed.remainingDays;
  let primary: string;
  if (remaining > 0) primary = `还有 ${remaining} 天`;
  else if (remaining === 0) primary = '就是今天';
  else primary = `已经过去 ${-remaining} 天`;
  return { primary, secondary: formatChineseDate(record.anchorDate) };
}

/** cycle：按 computed.state 输出使用进度与到期情况 */
function cycleTexts(record: CycleDayRecord): { primary: string; secondary: string } {
  const { state, elapsedDays, remainingDays } = record.computed;
  switch (state) {
    case 'overdue':
      return { primary: `已超期 ${Math.abs(remainingDays)} 天`, secondary: '' };
    case 'due':
      return { primary: `已使用 ${elapsedDays} 天`, secondary: '今天到期' };
    case 'upcoming':
      return { primary: `已使用 ${elapsedDays} 天`, secondary: `还有 ${remainingDays} 天到期` };
    default:
      return { primary: `已过 ${elapsedDays} 天`, secondary: `建议周期 ${record.cycleDays} 天` };
  }
}

/** 由 Core 的 computed 生成主 / 次文案 */
export function dayRecordTexts(record: DayRecord): { primary: string; secondary: string } {
  switch (record.kind) {
    case 'elapsed':
      return elapsedTexts(record);
    case 'countdown':
      return countdownTexts(record);
    case 'cycle':
      return cycleTexts(record);
    default:
      return { primary: '', secondary: '' };
  }
}

export function mapDayRecordView(record: DayRecord): DayRecordView {
  const { primary, secondary } = dayRecordTexts(record);
  const progressRatio =
    record.kind === 'cycle' ? record.computed.progressRatio : null;
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    icon: dayRecordIcon(record),
    iconImagePath: '',
    primaryText: primary,
    secondaryText: secondary,
    attentionLevel: record.computed.attentionLevel,
    isAttentionRequired: record.computed.isAttentionRequired,
    subjectName: record.subject ? record.subject.displayName : '全家',
    status: record.status,
    version: record.version,
    progressRatio,
  };
}

/** 关注级别排序权重：critical → warning → info → none */
export function attentionRank(level: DayAttentionLevel): number {
  switch (level) {
    case 'critical':
      return 0;
    case 'warning':
      return 1;
    case 'info':
      return 2;
    default:
      return 3;
  }
}

/** YYYY-MM-DD → 2026年8月19日；非法输入原样返回 */
export function formatChineseDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return dateStr;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

/** 可选图标（内置 Emoji，禁止用户提交任意图片 URL） */
export const ICON_CHOICES: string[] = [
  // 时间 / 里程碑
  '🕰️', '🎯', '🔁', '🏠', '🌱', '🐾', '🚗',
  // 生活琐事 / 周期事项
  '💇', '🧹', '🔧', '💊', '📚', '💪', '🪥', '👕',
  '🧺', '🍳', '🛁', '🌿', '🍎', '🐱',
  // 重要日子 / 倒数
  '✈️', '🎂', '💍', '🎓', '🏖️', '🎄', '🎉',
  '💐', '🍰', '👶', '🎆', '🌟',
];
