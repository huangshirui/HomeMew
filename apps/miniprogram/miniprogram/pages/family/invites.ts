/**
 * 家庭邀请管理页
 *
 * 用户旅程：
 * - 首选生成微信小程序码图片，允许保存或全屏截图交给家人扫码
 * - 备用方式只复制邀请码（小程序内部 joinPath 不可作为微信聊天链接）
 * - 邀请撤销、过期或用完后不再提供小程序码生成与复制操作
 *
 * 邀请历史仅展示状态。LifeSpace 仅在新建时返回明文码。
 */

import { listInvites, createInvite, revokeInvite, generateFamilyInviteMiniCode } from '../../services/families';
import {
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm,
  getErrorMessage,
  copyToClipboard,
  formatDate,
} from '../../utils/index';
import { InviteListItem, InviteCreated } from '../../types/index';

type InviteView = InviteListItem & { statusText: string; subText: string; expiresAtText: string };
type CreatedView = { expiresAtText: string; usesText: string };

const STATUS_TEXT: Record<string, string> = {
  active: '有效',
  expired: '已过期',
  exhausted: '已用完',
  revoked: '已撤销',
};

function isUsable(invite: InviteCreated, status?: InviteListItem['status']): boolean {
  return (!status || status === 'active')
    && Date.parse(invite.expiresAt) > Date.now()
    && invite.usedCount < invite.maxUses;
}

function createdView(invite: InviteCreated): CreatedView {
  return {
    expiresAtText: formatDate(invite.expiresAt, 'datetime'),
    usesText: `剩余可使用 ${Math.max(0, invite.maxUses - invite.usedCount)} 次`,
  };
}

Page({
  data: {
    familyId: '',
    invites: [] as InviteView[],
    newInvite: null as InviteCreated | null,
    newInviteView: null as CreatedView | null,
    newInviteAvailable: false,
    creating: false,
    loaded: false,
    sharing: false,
    savingAlbum: false,
    albumPermissionRequired: false,
    qrVisible: false,
    qrCodePath: '',
    qrCodeVersion: '' as 'develop' | 'trial' | 'release' | '',

  },

  _listRequest: 0,

  onLoad(options: { familyId?: string }): void {
    const familyId = options?.familyId;
    if (!familyId) {
      showError('缺少家庭参数');
      setTimeout(() => wx.navigateBack(), 1200);
      return;
    }
    this.setData({ familyId });
    void this.loadInvites();
  },

  onShow(): void {
    // Unverified Mini Program accounts cannot reliably share cards/images;
    // this page provides QR saving or user-controlled screenshots instead.
    wx.hideShareMenu({});
    if (this.data.familyId && this.data.loaded) {
      void this.loadInvites(true);
    }
  },

  mapInvites(list: InviteListItem[]): InviteView[] {
    return list.map(i => {
      const expiresAtText = formatDate(i.expiresAt, 'datetime');
      let subText = '';
      switch (i.status) {
        case 'active':
          subText = `有效期至 ${expiresAtText}`;
          break;
        case 'expired':
          subText = `已于 ${expiresAtText} 过期`;
          break;
        case 'exhausted':
          subText = '邀请次数已用完';
          break;
        case 'revoked':
          subText = '已撤销';
          break;
        default:
          subText = STATUS_TEXT[i.status] || i.status;
      }
      return {
        ...i,
        statusText: STATUS_TEXT[i.status] || i.status,
        expiresAtText,
        subText,
      };
    });
  },

  async loadInvites(silent = false): Promise<void> {
    const seq = ++this._listRequest;
    try {
      const invites = await listInvites(this.data.familyId);
      if (seq !== this._listRequest) return;
      const newInvite = this.data.newInvite;
      const latest = invites.find(i => i.id === newInvite?.id);
      const current = newInvite && latest
        ? { ...newInvite, usedCount: latest.usedCount, maxUses: latest.maxUses, expiresAt: latest.expiresAt }
        : newInvite;
      this.setData({
        invites: this.mapInvites(invites),
        loaded: true,
        newInvite: current,
        newInviteView: current ? createdView(current) : null,
        newInviteAvailable: Boolean(current && isUsable(current, latest?.status)),
        qrVisible: Boolean(current && isUsable(current, latest?.status) && this.data.qrVisible),
      });
    } catch (error: unknown) {
      if (seq !== this._listRequest) return;
      console.error('[Invites] Load failed:', error);
      const err = error as { code?: string; message?: string };
      if (!silent) showError(getErrorMessage(err.code, err.message));
      this.setData({ loaded: true });
    }
  },

  async onCreate(): Promise<void> {
    if (this.data.creating) return;
    this.setData({ creating: true, qrVisible: false, qrCodePath: '' });
    showLoading('生成邀请中...');
    try {
      const created = await createInvite(this.data.familyId);
      this._listRequest++;
      this.setData({
        newInvite: created,
        newInviteView: createdView(created),
        newInviteAvailable: isUsable(created),
      });
      hideLoading();
      showSuccess('邀请已生成');
      // 状态与剩余次数从服务端同步；获取列表失败不影响已创建的邀请。
      await this.loadInvites(true);
    } catch (error: unknown) {
      console.error('[Invites] Create failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    } finally {
      hideLoading();
      this.setData({ creating: false });
    }
  },

  async onRevoke(e: WechatMiniprogram.TouchEvent): Promise<void> {
    const inviteId = e.currentTarget.dataset.id as string;
    const confirmed = await showConfirm('撤销邀请', '确定要撤销该邀请吗？');
    if (!confirmed) return;

    showLoading('撤销中...');
    try {
      await revokeInvite(this.data.familyId, inviteId);
      hideLoading();
      showSuccess('已撤销');
      if (this.data.newInvite?.id === inviteId) {
        this.setData({ newInviteAvailable: false, qrVisible: false, qrCodePath: '' });
      }
      await this.loadInvites(true);
    } catch (error: unknown) {
      hideLoading();
      console.error('[Invites] Revoke failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message));
    }
  },

  /**
   * 开发版/体验版分享给外部体验者时必须使用 trial；正式版用 release。
   * 开发版上传体验版本后才能让有体验权限的微信好友扫码。
   */
  qrTargetVersion(): 'trial' | 'release' {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'release' ? 'release' : 'trial';
    } catch {
      return 'trial';
    }
  },

  async onGenerateMiniCode(): Promise<void> {
    const invite = this.data.newInvite;
    if (this.data.sharing) return;
    if (!invite || !this.data.newInviteAvailable || !isUsable(invite)) {
      showError('邀请已失效，请再生成一个邀请');
      return;
    }
    this.setData({ sharing: true });
    try {
      const envVersion = this.qrTargetVersion();
      const qr = await generateFamilyInviteMiniCode(this.data.familyId, invite.code, envVersion);
      // 生成过程中更换/撤销的邀请码不能展示旧图片。
      if (this.data.newInvite?.id !== invite.id || !this.data.newInviteAvailable) return;
      const suffix = qr.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const filePath = `${wx.env.USER_DATA_PATH}/homemew-invite-${invite.id}.${suffix}`;
      wx.getFileSystemManager().writeFileSync(filePath, qr.imageBase64, 'base64');
      this.setData({ qrCodePath: filePath, qrCodeVersion: envVersion, qrVisible: true });
    } catch (error: unknown) {
      console.error('[Invites] Mini code generation failed:', error);
      const err = error as { code?: string; message?: string };
      showError(getErrorMessage(err.code, err.message), 3000);
    } finally {
      this.setData({ sharing: false });
    }
  },

  onPreviewMiniCode(): void {
    const filePath = this.data.qrCodePath;
    if (!filePath) return;
    wx.previewImage({
      current: filePath,
      urls: [filePath],
      fail: (error) => {
        console.warn('[Invites] Preview image failed:', error?.errMsg ?? 'unknown');
        showError('无法预览图片，请使用邀请码');
      },
    });
  },

  saveQrToAlbum(): void {
    const filePath = this.data.qrCodePath;
    if (!filePath) {
      this.setData({ savingAlbum: false });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => {
        this.setData({ savingAlbum: false, albumPermissionRequired: false });
        showSuccess('已保存小程序码，可在微信聊天中发送');
      },
      fail: (error) => {
        this.setData({ savingAlbum: false });
        const errMsg = error?.errMsg || '';
        console.warn('[Invites] Save QR image failed:', errMsg);
        if (/auth|permission|deny|denied|authorize/u.test(errMsg.toLowerCase())) {
          wx.getSetting({
            success: (setting) => {
              if (setting.authSetting?.['scope.writePhotosAlbum'] !== true) {
                this.setData({ albumPermissionRequired: true });
                showError('请开启相册权限后再保存', 3000);
              } else {
                showError('微信或系统未允许写入照片，可全屏截图后发送', 3500);
              }
            },
            fail: () => showError('无法检查相册授权，可全屏截图后发送', 3500),
          });
          return;
        }
        showError('保存失败，可全屏截图后发送或复制邀请码', 3500);
      },
    });
  },

  onSaveMiniCode(): void {
    if (!this.data.qrCodePath || this.data.savingAlbum) return;
    this.setData({ savingAlbum: true });
    wx.getSetting({
      success: (setting) => {
        const authorized = setting.authSetting?.['scope.writePhotosAlbum'];
        if (authorized === true) {
          this.saveQrToAlbum();
          return;
        }
        if (authorized === false) {
          this.setData({ savingAlbum: false, albumPermissionRequired: true });
          showError('请点击「开启相册权限」后再保存', 3000);
          return;
        }
        // First-time authorization is requested only when the user presses Save.
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: () => this.saveQrToAlbum(),
          fail: (error) => {
            console.warn('[Invites] Album authorization denied:', error?.errMsg ?? 'unknown');
            this.setData({ savingAlbum: false, albumPermissionRequired: true });
            showError('相册授权未开启，请点击「开启相册权限」', 3000);
          },
        });
      },
      fail: (error) => {
        console.warn('[Invites] Album setting lookup failed:', error?.errMsg ?? 'unknown');
        this.setData({ savingAlbum: false });
        showError('无法获取相册权限，请检查微信与手机设置', 3000);
      },
    });
  },

  onAlbumSettingChanged(event: { detail?: { authSetting?: Record<string, boolean> } }): void {
    const authorized = event.detail?.authSetting?.['scope.writePhotosAlbum'] === true;
    this.setData({ albumPermissionRequired: !authorized });
    if (authorized && this.data.qrVisible) {
      this.onSaveMiniCode();
    } else if (!authorized) {
      showError('未开启相册权限，可全屏截图后发送', 3000);
    }
  },

  onCloseMiniCode(): void {
    this.setData({ qrVisible: false });
  },

  onStopQrTap(): void {
    // 阻止弹层内容的点击穿透到遮罩。
  },

  onCopyCode(): void {
    const invite = this.data.newInvite;
    if (!invite || !this.data.newInviteAvailable || !isUsable(invite)) {
      showError('邀请已失效，请再生成一个邀请');
      return;
    }
    // 复制纯邀请码以便在“加入家庭”页粘贴；失败提示由工具函数处理。
    void copyToClipboard(invite.code).catch(() => {});
  },


});
