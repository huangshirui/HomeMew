'use strict';

const https = require('https');

const LIFESPACE_KERNEL_CONTRACT = '0.12.0';
const LIFESPACE_MODEL_CONTRACT = 'mct_9a3d9588da8591ab376ef000e5e661f670a64dd8b1ebc14fd146580f0ed1fa45';
const LIFESPACE_IDENTITY_CONTRACT = '0.4.0';
const DEFAULT_IDENTITY_URL = 'https://auth-staging.aisr.online';
const DEFAULT_CORE_URL = 'https://core-staging.aisr.online';
const USER_SCOPES = Object.freeze([
  'profile:read',
  'profile:write',
  'spaces:read',
  'spaces:write',
  'spaces:manage',
  'resources:read',
  'resources:write',
  'creation-drafts:read',
  'creation-drafts:write',
]);

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).replace(/\/+$/u, '');
}

function requestJson({ baseUrl, method, path, bearer, body, timeoutMs = 10000 }) {
  const url = new URL(`${baseUrl}${path}`);
  const payload = body === undefined ? null : JSON.stringify(body);
  const options = {
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method,
    headers: {
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    timeout: timeoutMs,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; }
        catch { data = raw; }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('LifeSpace API 请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createLifeSpaceIdentityClient({
  applicationCredential,
  identityBaseUrl = DEFAULT_IDENTITY_URL,
  coreBaseUrl = DEFAULT_CORE_URL,
  request = requestJson,
} = {}) {
  if (!applicationCredential || !String(applicationCredential).startsWith('lsa_')) {
    throw new Error('未配置有效的 LIFESPACE_APPLICATION_CREDENTIAL');
  }

  const identityUrl = normalizeBaseUrl(identityBaseUrl, DEFAULT_IDENTITY_URL);
  const coreUrl = normalizeBaseUrl(coreBaseUrl, DEFAULT_CORE_URL);

  async function createUser(openid) {
    const displayName = `微信用户${String(openid || '').substring(0, 6)}`;
    const result = await request({
      baseUrl: identityUrl,
      method: 'POST',
      path: '/internal/v1/users',
      bearer: applicationCredential,
      body: { displayName },
    });
    if (result.statusCode === 201 && result.data?.data?.id) return result.data.data.id;
    const error = new Error(result.data?.error?.message || `LifeSpace user creation failed (${result.statusCode})`);
    error.code = result.data?.error?.code || 'LIFESPACE_USER_CREATE_FAILED';
    error.statusCode = result.statusCode;
    throw error;
  }

  async function issueUserToken(userId) {
    const result = await request({
      baseUrl: identityUrl,
      method: 'POST',
      path: '/internal/v1/tokens',
      bearer: applicationCredential,
      body: { subjectId: userId, scopes: [...USER_SCOPES] },
    });
    if (result.statusCode === 200 && result.data?.data?.accessToken && Number.isFinite(result.data?.data?.expiresIn)) {
      return {
        accessToken: result.data.data.accessToken,
        expiresIn: result.data.data.expiresIn,
        scope: result.data.data.scope || '',
      };
    }
    const error = new Error(result.data?.error?.message || `LifeSpace token exchange failed (${result.statusCode})`);
    error.code = result.data?.error?.code || 'LIFESPACE_TOKEN_EXCHANGE_FAILED';
    error.statusCode = result.statusCode;
    throw error;
  }

  return {
    identityBaseUrl: identityUrl,
    coreBaseUrl: coreUrl,
    createUser,
    issueUserToken,
  };
}

module.exports = {
  LIFESPACE_KERNEL_CONTRACT,
  LIFESPACE_MODEL_CONTRACT,
  LIFESPACE_IDENTITY_CONTRACT,
  DEFAULT_IDENTITY_URL,
  DEFAULT_CORE_URL,
  USER_SCOPES,
  createLifeSpaceIdentityClient,
  requestJson,
};
