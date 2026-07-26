/**
 * 全局类型声明（本文件不导出任何内容，保持全局脚本作用域）。
 *
 * 供 app.ts 的 App<IAppOption>() 与各页面 getApp<IAppOption>() 使用。
 * 使用 import('...') 内联类型引用，避免本文件成为模块从而导致接口非全局。
 */

interface IAppOption {
  globalData: {
    userInfo: import('./types/index').UserProfile | null;
    currentFamily: import('./types/index').FamilyListItem | null;
    families: import('./types/index').FamilyListItem[];
  };
}
