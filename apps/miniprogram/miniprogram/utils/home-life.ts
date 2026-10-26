import { DOMAIN_COPY, type DomainRecord, type PersonOption } from '../services/domains';
import type { LifeKind } from '../services/life-records';

export type HomeLifeRow = DomainRecord & {
  icon: string; meta: string; peopleLabel: string; relatedToMe: boolean;
  checkedInToday: boolean; streakDays: number; checking: boolean;
};

export function homeLifeRows(
  records: DomainRecord[], kind: LifeKind, people: PersonOption[], personId: string,
): HomeLifeRow[] {
  return records.filter(record => {
    if (kind === 'activities') return true;
    if (record.status !== 'active') return false;
    // 仅在指定了 personId（只看我的）时才按成员过滤；看全家时不限定成员
    if (kind === 'habits' && personId && record.subjectPersonId !== personId) return false;
    return true;
  }).slice().sort((a, b) => {
      if (kind === 'habits') return Number(Boolean(a.computed?.checkIn?.checkedInToday)) -
        Number(Boolean(b.computed?.checkIn?.checkedInToday));
      const left = (kind === 'activities' ? a.endDate : a.targetDate) || '9999-12-31';
      const right = (kind === 'activities' ? b.endDate : b.targetDate) || '9999-12-31';
      return left.localeCompare(right);
    }).slice(0, 3).map(record => {
      const ids = record.attendeePersonIds || record.subjectPersonIds || [];
      return {
        ...record,
        icon: record.presentation?.icon?.type === 'emoji' ? record.presentation.icon.value : DOMAIN_COPY[kind].symbol,
        meta: kind === 'habits' ? '' : kind === 'goals'
          ? (record.targetDate ? '目标日期 ' + record.targetDate : '未设置目标日期')
          : [record.startDate || '开始日期不限', record.endDate || '结束日期不限'].join(' — '),
        peopleLabel: ids.map(id => people.find(person => person.personId === id)?.displayName || '家庭成员').join('、'),
        relatedToMe: Boolean(personId) && ids.includes(personId),
        checkedInToday: Boolean(record.computed?.checkIn?.checkedInToday),
        streakDays: record.computed?.checkIn?.streakDays || 0,
        checking: false,
      };
    });
}
