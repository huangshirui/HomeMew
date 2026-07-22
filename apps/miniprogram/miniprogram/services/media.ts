/**
 * 媒体上传服务
 *
 * 把用户选择的本地头像（来自微信 chooseAvatar 或相册）上传到微信云存储，
 * 返回可长期访问的 cloud:// 文件 ID。该 ID 可直接作为 <image> 的 src，
 * 同时作为用户的 avatarUrl 持久化到 HomeMew Core。
 *
 * 说明：
 * - chooseAvatar / chooseMedia 返回的是本地临时文件路径（wxfile:// 或 http://tmp/...），
 *   不能直接写入 Core，否则换设备/临时文件清理后头像无法显示。
 * - 微信云开发已在 app.ts 中初始化（wx.cloud.init），可直接使用 wx.cloud.uploadFile。
 */

/**
 * 上传头像到微信云存储
 * @param tempFilePath 本地临时文件路径
 * @returns cloud:// 文件 ID
 */
export function uploadAvatar(tempFilePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('文件路径为空'));
      return;
    }

    if (!wx.cloud) {
      reject(new Error('当前环境不支持云存储'));
      return;
    }

    const extMatch = tempFilePath.split('?')[0].split('.');
    const ext = (extMatch.length > 1 ? extMatch.pop()! : 'png').toLowerCase();
    const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png';
    const cloudPath = `avatars/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${safeExt}`;

    wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath,
      success(res) {
        if (res.fileID) {
          resolve(res.fileID);
        } else {
          reject(new Error('上传成功但未返回文件 ID'));
        }
      },
      fail(err) {
        console.error('[Media] Upload avatar failed:', err);
        reject(new Error((err && err.errMsg) || '头像上传失败'));
      },
    });
  });
}
