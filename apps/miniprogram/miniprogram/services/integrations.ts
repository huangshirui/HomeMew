/**
 * 外部系统（集成）相关 API 服务
 *
 * 这些接口只由家庭管理员调用，Core 会再次校验目标家庭的 active admin 身份。
 * 小程序只负责管理配置，不参与 OAuth Token 签发。
 *
 * 写请求（POST/PATCH/DELETE）显式 skipRetry: true，避免重复提交。
 * 凭证创建（Client Secret / API Token）的完整明文只在本次响应返回一次，
 * 调用方必须立即展示且不得持久化。
 */

import { request } from './api';
import {
  Integration,
  IntegrationCredential,
  CreateIntegrationRequest,
  UpdateIntegrationRequest,
  ClientSecretCreated,
  ApiTokenCreated,
} from '../types/index';

/**
 * 获取家庭下的外部系统列表
 * GET /api/v1/families/{familyId}/integrations
 */
export function listIntegrations(familyId: string): Promise<Integration[]> {
  return request<{ items: Integration[] }>(`/api/v1/families/${familyId}/integrations`)
    .then(data => data.items ?? []);
}

/**
 * 创建外部系统
 * POST /api/v1/families/{familyId}/integrations
 */
export function createIntegration(
  familyId: string,
  data: CreateIntegrationRequest,
): Promise<Integration> {
  return request<Integration>(`/api/v1/families/${familyId}/integrations`, {
    method: 'POST',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 获取外部系统详情
 * GET /api/v1/families/{familyId}/integrations/{integrationId}
 */
export function getIntegration(familyId: string, integrationId: string): Promise<Integration> {
  return request<Integration>(`/api/v1/families/${familyId}/integrations/${integrationId}`);
}

/**
 * 更新外部系统（名称 / 说明 / 状态 / 权限）
 * PATCH /api/v1/families/{familyId}/integrations/{integrationId}
 * 停用或修改权限后 Core 立即生效。
 */
export function updateIntegration(
  familyId: string,
  integrationId: string,
  data: UpdateIntegrationRequest,
): Promise<Integration> {
  return request<Integration>(`/api/v1/families/${familyId}/integrations/${integrationId}`, {
    method: 'PATCH',
    data: data as unknown as Record<string, unknown>,
    skipRetry: true,
  });
}

/**
 * 删除外部系统（软删除；不会删除该系统已创建的日程与待办）
 * DELETE /api/v1/families/{familyId}/integrations/{integrationId}
 */
export function deleteIntegration(familyId: string, integrationId: string): Promise<void> {
  return request<void>(`/api/v1/families/${familyId}/integrations/${integrationId}`, {
    method: 'DELETE',
    skipRetry: true,
  });
}

/**
 * 获取外部系统的凭证列表（仅摘要，不含完整明文）
 * GET /api/v1/families/{familyId}/integrations/{integrationId}/credentials
 */
export function listCredentials(
  familyId: string,
  integrationId: string,
): Promise<IntegrationCredential[]> {
  return request<{ items: IntegrationCredential[] }>(
    `/api/v1/families/${familyId}/integrations/${integrationId}/credentials`,
  ).then(data => data.items ?? []);
}

/**
 * 创建 OAuth Client Secret（完整 clientSecret 仅本次返回）
 * POST /api/v1/families/{familyId}/integrations/{integrationId}/client-secrets
 */
export function createClientSecret(
  familyId: string,
  integrationId: string,
): Promise<ClientSecretCreated> {
  return request<ClientSecretCreated>(
    `/api/v1/families/${familyId}/integrations/${integrationId}/client-secrets`,
    {
      method: 'POST',
      data: {},
      skipRetry: true,
    },
  );
}

/**
 * 创建长期 API Token（完整 token 仅本次返回）
 * POST /api/v1/families/{familyId}/integrations/{integrationId}/api-tokens
 */
export function createApiToken(
  familyId: string,
  integrationId: string,
): Promise<ApiTokenCreated> {
  return request<ApiTokenCreated>(
    `/api/v1/families/${familyId}/integrations/${integrationId}/api-tokens`,
    {
      method: 'POST',
      data: {},
      skipRetry: true,
    },
  );
}

/**
 * 吊销单条凭证（立即生效）
 * DELETE /api/v1/families/{familyId}/integrations/{integrationId}/credentials/{credentialId}
 */
export function revokeCredential(
  familyId: string,
  integrationId: string,
  credentialId: string,
): Promise<void> {
  return request<void>(
    `/api/v1/families/${familyId}/integrations/${integrationId}/credentials/${credentialId}`,
    {
      method: 'DELETE',
      skipRetry: true,
    },
  );
}
