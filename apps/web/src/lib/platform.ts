export const lifeSpaceConfig = {
  identityUrl: import.meta.env.VITE_LIFESPACE_IDENTITY_URL?.replace(/\/$/, '') ?? '',
  coreUrl: import.meta.env.VITE_LIFESPACE_CORE_URL?.replace(/\/$/, '') ?? '',
};

export const browserAuthCapability = {
  status: 'platform-follow-up' as const,
  message:
    'HomeMew Web 尚未接入 LifeSpace 的浏览器登录能力；当前页面只展示界面预览数据。',
};
