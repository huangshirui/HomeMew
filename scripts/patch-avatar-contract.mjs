import fs from 'node:fs';

const path = new URL('../apps/core/openapi.yaml', import.meta.url);
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`OpenAPI patch target not found: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`OpenAPI patch target is not unique: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`  /api/v1/me/families:\n`,
`  /api/v1/me/avatar:\n    put:\n      tags: [Users]\n      summary: Upload and replace the current user's avatar\n      operationId: uploadCurrentUserAvatar\n      x-homemew-status: implemented\n      requestBody:\n        required: true\n        content:\n          multipart/form-data:\n            schema:\n              type: object\n              required: [file]\n              additionalProperties: false\n              properties:\n                file:\n                  type: string\n                  format: binary\n                  description: JPEG, PNG, or WebP image, at most 5 MB.\n      responses:\n        '200':\n          description: Avatar stored in R2 and assigned to the current user\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/AvatarUploadResponse'\n        '400':\n          $ref: '#/components/responses/InvalidRequest'\n        '401':\n          $ref: '#/components/responses/Unauthorized'\n        '403':\n          $ref: '#/components/responses/Forbidden'\n        '413':\n          description: Avatar exceeds the 5 MB limit\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/ErrorResponse'\n        '415':\n          description: Unsupported avatar media type\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/ErrorResponse'\n  /api/v1/me/families:\n`,
'avatar upload path',
);

replaceOnce(
`    UpdateCurrentUserRequest:\n      type: object\n      minProperties: 1\n      additionalProperties: false\n      properties:\n        displayName:\n          type: string\n          minLength: 1\n        avatarUrl:\n          type: [string, 'null']\n          format: uri\n`,
`    UpdateCurrentUserRequest:\n      type: object\n      required: [displayName]\n      additionalProperties: false\n      properties:\n        displayName:\n          type: string\n          minLength: 1\n    AvatarUploadResponse:\n      type: object\n      required: [data]\n      properties:\n        data:\n          type: object\n          required: [avatarUrl]\n          properties:\n            avatarUrl:\n              type: string\n              format: uri\n              description: Public HTTPS URL derived by Core from ASSETS_PUBLIC_URL and users.avatar_key.\n`,
'current user write schema',
);

replaceOnce(
`        avatarUrl:\n          type: [string, 'null']\n          format: uri\n        createdFrom:\n`,
`        createdFrom:\n`,
'internal user avatar input',
);

fs.writeFileSync(path, source);
