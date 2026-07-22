/**
 * 小程序全局数据类型扩展
 */

import { UserProfile, FamilyListItem } from './index';

interface IAppOption {
  globalData: {
    userInfo: UserProfile | null;
    currentFamily: FamilyListItem | null;
    families: FamilyListItem[];
  };
}
