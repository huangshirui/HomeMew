/**
 * 日程复制缓冲区
 *
 * 详情页点击「复制」时，把源日程的完整字段存入此处，再跳转到创建页，
 * 由创建页在成员加载完成后消费并预填表单。与喵一下草稿缓冲同理，
 * 使用模块级单例避免经 query 字符串传递超长内容或丢失数组/null 字段。
 *
 * 生命周期：detail 页 setCloneSource → 跳转 edit 页 → edit 页 consumeCloneSource；
 * 若离开 edit 页未消费则 clearCloneSource。
 */

import { Event } from '../types/index';

let _cloneSource: Event | null = null;

/** 暂存待复制的源日程 */
export function setCloneSource(event: Event): void {
  _cloneSource = event;
}

/** 取出并清空复制源；无则返回 null */
export function consumeCloneSource(): Event | null {
  const source = _cloneSource;
  _cloneSource = null;
  return source;
}

/** 清空复制源（离开创建页未消费时调用） */
export function clearCloneSource(): void {
  _cloneSource = null;
}
