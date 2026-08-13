'use strict';

async function resolveIdentity({
  openid,
  existingMapping,
  verifyUser,
  createUser,
  addMapping,
  updateMapping,
  mappingField = 'homemewUserId',
  nowIso = () => new Date().toISOString(),
}) {
  if (!mappingField || typeof mappingField !== 'string') {
    throw new Error('mappingField is required');
  }

  const now = nowIso();
  const existingUserId = existingMapping?.[mappingField];
  if (!existingUserId) {
    const userId = await createUser(openid);
    if (existingMapping?._id) {
      await updateMapping({
        mappingId: existingMapping._id,
        data: {
          [mappingField]: userId,
          updatedAt: now,
        },
      });
    } else {
      await addMapping({
        openid,
        [mappingField]: userId,
        provider: 'wechat_miniprogram',
        createdAt: now,
        updatedAt: now,
      });
    }
    return { userId, isNewUser: true };
  }

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
      [mappingField]: replacementUserId,
      updatedAt: now,
    },
  });
  return { userId: replacementUserId, isNewUser: true };
}

module.exports = { resolveIdentity };
