export const lifeSpaceConfig = {
  identityUrl: import.meta.env.VITE_LIFESPACE_IDENTITY_URL?.replace(/\/$/, '') ?? '',
  coreUrl: import.meta.env.VITE_LIFESPACE_CORE_URL?.replace(/\/$/, '') ?? '',
};

export const browserAuthCapability = {
  status: 'platform-follow-up' as const,
  message:
    '暂时无法登录家事喵，请稍后再试。',
};
