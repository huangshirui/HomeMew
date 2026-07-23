/**
 * 当前家庭解析的纯函数（不依赖 wx，便于独立测试）。
 */

import type { FamilyListItem } from '../types/index';

/**
 * 根据家庭列表与已缓存的当前家庭 id 解析应选中的当前家庭。
 * 规则：
 * - 列表为空：返回 null（需清除缓存）。
 * - 缓存 id 仍有效：返回该家庭。
 * - 无缓存或缓存失效：返回第一个家庭（需清除缓存）。
 */
export function resolveCurrentFamily(
  families: FamilyListItem[],
  savedId?: string,
): { family: FamilyListItem | null; clearSaved: boolean } {
  if (families.length === 0) {
    return { family: null, clearSaved: true };
  }
  const valid = savedId ? families.find(f => f.id === savedId) : undefined;
  if (valid) {
    return { family: valid, clearSaved: false };
  }
  return { family: families[0], clearSaved: true };
}
