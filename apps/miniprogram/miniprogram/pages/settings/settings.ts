/**
 * 设置页
 *
 * 目前提供「设备时区」选项：
 * - 跟随系统时区（默认）
 * - 指定某个特定时区（从常用 IANA 时区列表中选择）
 *
 * 该偏好仅保存在本地，用于页面展示时区换算，不影响任何家庭业务数据。
 */

import {
  loadTimeZonePreference,
  saveTimeZonePreference,
  resolveDisplayTimeZone,
  TimeZonePreference,
} from '../../services/settings';
import { userStore, currentFamilyStore, loadCurrentUser } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { getWebLogin } from '../../services/web-login';
import { STORAGE_KEYS } from '../../services/config';
import { loadHomeScope, saveHomeScope, type HomeScope } from '../../stores/home-scope';

Page({
  data: {
    user: userStore.value,
    accountLoaded:false,
    accountError:false,
    loginEmail:'',
    linked:false,
    linkStatus:'unlinked',
    emailAvailable:false,
    mode: 'system' as 'system' | 'custom',
    customTimeZone: '',
    systemTimeZone: '',
    displayTimeZone: '',
    /** 优先展示家庭/系统时区，交给 timezone-picker 组件处理 */
    preferredTimeZones: [] as string[],
    /** 首页数据范围：'me' 只看我的（默认）/ 'all' 看全家 */
    homeScope: 'me' as HomeScope,
  },

  onShow(): void { void this.loadAccount(); },
  async loadAccount(): Promise<void> {
    this.setData({accountError:false,user:userStore.value||this.data.user});
    try {
      await ensureRuntimeReady();
      const user=await loadCurrentUser();
      this.setData({user});
      const account=await getWebLogin();
      const email=account.email;
      this.setData({user,accountLoaded:true,linked:account.linked,linkStatus:account.status,emailAvailable:account.available!==false,
        loginEmail:email?email.replace(/^(.).*(@.*)$/,'$1***$2'):''});
      this.refreshHomeScope();
    }catch { this.setData({accountError:!this.data.accountLoaded}); }
  },

  onLoad(): void {
    const pref = loadTimeZonePreference();
    const systemTz = resolveDisplayTimeZone({ mode: 'system', customTimeZone: '' });
    this.setData({
      mode: pref.mode,
      customTimeZone: pref.customTimeZone,
      systemTimeZone: systemTz,
      displayTimeZone: resolveDisplayTimeZone(pref),
      preferredTimeZones: [pref.customTimeZone, systemTz].filter(Boolean) as string[],
    });
    // 进入页面时同步读取已保存的「数据范围」，避免在首屏先用默认『只看我的』渲染，
    // 等异步 loadAccount 完成后才切换到『看全家』造成闪动
    this.refreshHomeScope();
  },

  /** 切换「跟随系统时区 / 指定时区」 */
  onModeChange(e: WechatMiniprogram.TouchEvent): void {
    const mode = e.currentTarget.dataset.mode as 'system' | 'custom';
    if (mode === this.data.mode) return;

    if (mode === 'custom') {
      // 切到「指定时区」：若尚未选过时区，默认填入当前系统时区
      const customTimeZone = this.data.customTimeZone || this.data.systemTimeZone;
      this.setData({ mode, customTimeZone });
    } else {
      // 切回「跟随系统时区」：清空已指定的时区存储
      this.setData({ mode, customTimeZone: '' });
    }
    this.persistAndRefresh();
  },

  /** 时区选择组件回调：更新指定的时区 */
  onTimezoneSelect(e: WechatMiniprogram.CustomEvent<{ value: string }>): void {
    const id = e.detail.value;
    if (!id) return;
    this.setData({ customTimeZone: id, displayTimeZone: id });
    this.persistAndRefresh();
  },

  /** 读取当前生效的首页数据范围（按 家庭 + 用户 维度） */
  refreshHomeScope(): void {
    const familyId = currentFamilyStore.value?.id || (wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as string) || '';
    const userId = userStore.value?.id || '';
    this.setData({ homeScope: familyId ? loadHomeScope(familyId, userId) : 'me' });
  },

  /** 切换「只看我的 / 看全家」 */
  onHomeScopeChange(e: WechatMiniprogram.TouchEvent): void {
    const scope = e.currentTarget.dataset.scope as HomeScope;
    if (scope === this.data.homeScope) return;
    this.setData({ homeScope: scope });
    const familyId = currentFamilyStore.value?.id || (wx.getStorageSync(STORAGE_KEYS.currentFamilyId) as string) || '';
    const userId = userStore.value?.id || '';
    if (familyId) saveHomeScope(familyId, userId, scope);
  },

  persistAndRefresh(): void {
    const pref: TimeZonePreference = {
      mode: this.data.mode,
      customTimeZone: this.data.customTimeZone,
    };
    saveTimeZonePreference(pref);
    let displayTimeZone = resolveDisplayTimeZone(pref);
    if (pref.mode === 'custom' && !pref.customTimeZone) {
      displayTimeZone = '';
    }
    this.setData({ displayTimeZone });
  },
});
