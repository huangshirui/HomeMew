'use strict';

async function resolveIdentity({
  openid,
  existingMapping,
  verifyUser,
  createUser,
  addMapping,
  updateMapping,
  nowIso = () => new Date().toISOString(),
}) {
  const now = nowIso();
  if (!existingMapping?.homemewUserId) {
    const userId = await createUser(openid);
    await addMapping({
      openid,
      homemewUserId: userId,
      provider: 'wechat_miniprogram',
      createdAt: now,
      updatedAt: now,
    });
    return { userId, isNewUser: true };
  }

  const existingUserId = existingMapping.homemewUserId;
  if (await verifyUser(existingUserId)) {
    await updateMapping({
      mappingId: existingMapping._id,
      data: { updatedAt: now },
    });
    return { userId: existingUserId, isNewUser: false };
  }

  const replacementUserId = await createUser(openid);
  await updateMapping({
    mappingId: existingMapping._id,
    data: {
      homemewUserId: replacementUserId,
      updatedAt: now,
    },
  });
  return { userId: replacementUserId, isNewUser: true };
}

module.exports = { resolveIdentity };
