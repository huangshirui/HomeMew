import type { Context, Hono } from "hono";
import type { Bindings, Variables } from "./env";
import { ApiError } from "./errors";
import { requireActiveUser, requireFamilyAdmin } from "./family-access";
import { success } from "./http";
import { createId } from "./ids";
import { randomCredential, parsePermissions, sha256, SYSTEM_PERMISSIONS } from "./system-security";
import { optionalText, requireObject, requireString } from "./validation";
import { verifyJwt } from "./auth";

type AppEnv = { Bindings: Bindings; Variables: Variables };
type App = Hono<AppEnv>;

async function body(c: Context<AppEnv>) {
  try { return requireObject(await c.req.json()); } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
}

async function admin(c: Context<AppEnv>, familyId: string) {
  const p = c.get("currentPrincipal");
  if (p.type !== "user") throw new ApiError("FORBIDDEN", "User administrator access is required", 403);
  await requireActiveUser(c.env, p.id);
  await requireFamilyAdmin(c.env, familyId, p.id);
  return p.id;
}

async function integration(env: Bindings, familyId: string, id: string, includeDeleted = false) {
  const row = await env.DB.prepare(`SELECT s.*,a.permissions,a.status access_status,u.display_name created_by_name
    FROM system_identities s JOIN family_system_access a ON a.system_id=s.id AND a.family_id=s.family_id
    JOIN users u ON u.id=s.created_by_user_id WHERE s.id=? AND s.family_id=? ${includeDeleted ? "" : "AND s.deleted_at IS NULL"}`).bind(id, familyId).first<any>();
  if (!row) throw new ApiError("INTEGRATION_NOT_FOUND", "Integration not found", 404);
  return row;
}

function dto(row: any) {
  return { id: row.id, name: row.name, description: row.description, status: row.status, permissions: JSON.parse(row.permissions),
    createdBy: { type: "user", id: row.created_by_user_id, name: row.created_by_name, avatarUrl: null },
    createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at };
}

async function credentialDto(env: Bindings, id: string) {
  const row = await env.DB.prepare("SELECT * FROM system_credentials WHERE id=?").bind(id).first<any>();
  return { id: row.id, type: row.credential_type, suffix: row.secret_suffix, status: row.status, expiresAt: row.expires_at, lastUsedAt: row.last_used_at, createdAt: row.created_at, revokedAt: row.revoked_at };
}

async function createCredential(c: Context<AppEnv>, type: "oauth_client_secret" | "api_token") {
  const familyId = c.req.param("familyId")!, id = c.req.param("integrationId")!;
  await admin(c, familyId); await integration(c.env, familyId, id); await body(c);
  const raw = randomCredential(type === "api_token" ? "hmw_pat" : "hmw_cs"), credentialId = createId("crd");
  await c.env.DB.prepare("INSERT INTO system_credentials(id,system_id,credential_type,secret_hash,secret_suffix) VALUES(?,?,?,?,?)")
    .bind(credentialId,id,type,await sha256(raw),raw.slice(-4)).run();
  const credential = await credentialDto(c.env, credentialId);
  return c.json(success(type === "api_token" ? { ...credential, token: raw } : { ...credential, clientId: id, clientSecret: raw }), 201);
}

function oauthError(c: Context<AppEnv>, error: string, description: string, status: 400 | 401 | 429 = 400) {
  c.header("cache-control", "no-store"); c.header("pragma", "no-cache");
  return c.json({ error, error_description: description }, status);
}

async function signSystemToken(secret: string, systemId: string, credentialId: string, scopes: string[]) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
  const now=Math.floor(Date.now()/1000),jti=`tok_${crypto.randomUUID().replaceAll("-","")}`;
  const content = `${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:systemId,type:"system",cid:credentialId,jti,scope:scopes.join(" "),iss:"homemew-identity",aud:"homemew-core",iat:now,exp:now+3600})}`;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(content)));
  return {token:`${content}.${btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")}`,jti,expiresAt:now+3600};
}

async function rate(env: Bindings, dimension: string, subject: string, failed = false) {
  const now=Math.floor(Date.now()/1000), window=now-(now%60);
  const existing=await env.DB.prepare("SELECT * FROM oauth_rate_limits WHERE dimension=? AND subject=?").bind(dimension,subject).first<any>();
  if (existing?.locked_until && existing.locked_until>now) return false;
  const expiredLock=Boolean(existing?.locked_until&&existing.locked_until<=now);
  const count=existing?.window_started_at===window ? existing.request_count+1 : 1;
  const failures=failed ? ((expiredLock?0:(existing?.failure_count??0))+1) : 0;
  const lock=failures>=5 ? now+900 : null;
  await env.DB.prepare(`INSERT INTO oauth_rate_limits(dimension,subject,window_started_at,request_count,failure_count,locked_until) VALUES(?,?,?,?,?,?)
    ON CONFLICT(dimension,subject) DO UPDATE SET window_started_at=excluded.window_started_at,request_count=excluded.request_count,failure_count=excluded.failure_count,locked_until=excluded.locked_until`)
    .bind(dimension,subject,window,count,failures,lock).run();
  return count<=10 && !lock;
}

export function registerIntegrationRoutes(app: App) {
  app.get("/api/v1/families/:familyId/integrations", async c => {
    const familyId=c.req.param("familyId"); await admin(c,familyId);
    const rows=await c.env.DB.prepare(`SELECT s.*,a.permissions,u.display_name created_by_name FROM system_identities s JOIN family_system_access a ON a.system_id=s.id JOIN users u ON u.id=s.created_by_user_id WHERE s.family_id=? AND s.deleted_at IS NULL ORDER BY s.created_at`).bind(familyId).all<any>();
    return c.json(success({items:rows.results.map(dto)}));
  });
  app.post("/api/v1/families/:familyId/integrations", async c => {
    const familyId=c.req.param("familyId"), userId=await admin(c,familyId), input=await body(c);
    const name=requireString(input.name,"name",100), description=optionalText(input.description,"description",500)??null, permissions=parsePermissions(input.permissions);
    if(Object.keys(input).some(k=>!["name","description","permissions"].includes(k))) throw new ApiError("INVALID_REQUEST","Unknown field",400);
    const id=createId("sys");
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO system_identities(id,family_id,name,description,created_by_user_id) VALUES(?,?,?,?,?)").bind(id,familyId,name,description,userId),
      c.env.DB.prepare("INSERT INTO family_system_access(family_id,system_id,permissions,created_by_user_id) VALUES(?,?,?,?)").bind(familyId,id,JSON.stringify(permissions),userId)
    ]);
    return c.json(success(dto(await integration(c.env,familyId,id))),201);
  });
  app.get("/api/v1/families/:familyId/integrations/:integrationId",async c=>{const f=c.req.param("familyId");await admin(c,f);return c.json(success(dto(await integration(c.env,f,c.req.param("integrationId")))));});
  app.patch("/api/v1/families/:familyId/integrations/:integrationId",async c=>{
    const f=c.req.param("familyId"),id=c.req.param("integrationId");await admin(c,f);const old=await integration(c.env,f,id),input=await body(c);
    if(Object.keys(input).some(k=>!["name","description","status","permissions"].includes(k)))throw new ApiError("INVALID_REQUEST","Unknown field",400);
    if(Object.keys(input).length===0)throw new ApiError("INVALID_REQUEST","At least one field is required",400);
    const name=input.name===undefined?old.name:requireString(input.name,"name",100),description=input.description===undefined?old.description:optionalText(input.description,"description",500)??null;
    const status=input.status===undefined?old.status:input.status;if(status!=="active"&&status!=="disabled")throw new ApiError("INVALID_REQUEST","status is invalid",400);
    const permissions=input.permissions===undefined?JSON.parse(old.permissions):parsePermissions(input.permissions);
    await c.env.DB.batch([c.env.DB.prepare("UPDATE system_identities SET name=?,description=?,status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(name,description,status,id),c.env.DB.prepare("UPDATE family_system_access SET status=?,permissions=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE system_id=?").bind(status,JSON.stringify(permissions),id)]);
    return c.json(success(dto(await integration(c.env,f,id))));
  });
  app.delete("/api/v1/families/:familyId/integrations/:integrationId",async c=>{const f=c.req.param("familyId"),id=c.req.param("integrationId");await admin(c,f);await integration(c.env,f,id);await c.env.DB.batch([c.env.DB.prepare("UPDATE system_identities SET status='deleted',deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id),c.env.DB.prepare("UPDATE family_system_access SET status='disabled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE system_id=?").bind(id),c.env.DB.prepare("UPDATE system_credentials SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE system_id=? AND status='active'").bind(id)]);return c.body(null,204);});
  app.post("/api/v1/families/:familyId/integrations/:integrationId/api-tokens",c=>createCredential(c,"api_token"));
  app.post("/api/v1/families/:familyId/integrations/:integrationId/client-secrets",c=>createCredential(c,"oauth_client_secret"));
  app.get("/api/v1/families/:familyId/integrations/:integrationId/credentials",async c=>{const f=c.req.param("familyId"),id=c.req.param("integrationId");await admin(c,f);await integration(c.env,f,id);const rows=await c.env.DB.prepare("SELECT * FROM system_credentials WHERE system_id=? ORDER BY created_at").bind(id).all<any>();return c.json(success({items:rows.results.map(r=>({id:r.id,type:r.credential_type,suffix:r.secret_suffix,status:r.status,expiresAt:r.expires_at,lastUsedAt:r.last_used_at,createdAt:r.created_at,revokedAt:r.revoked_at}))}));});
  app.delete("/api/v1/families/:familyId/integrations/:integrationId/credentials/:credentialId",async c=>{const f=c.req.param("familyId"),id=c.req.param("integrationId"),cid=c.req.param("credentialId");await admin(c,f);await integration(c.env,f,id);const r=await c.env.DB.prepare("UPDATE system_credentials SET status='revoked',revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND system_id=? AND status='active'").bind(cid,id).run();if(!r.meta.changes)throw new ApiError("CREDENTIAL_NOT_FOUND","Credential not found",404);return c.body(null,204);});

  app.post("/oauth/token",async c=>{
    if(!c.req.header("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded"))return oauthError(c,"invalid_request","Content-Type must be application/x-www-form-urlencoded");
    const form=await c.req.parseBody(), basic=c.req.header("authorization")?.startsWith("Basic ");
    let clientId=typeof form.client_id==="string"?form.client_id:"",clientSecret=typeof form.client_secret==="string"?form.client_secret:"";
    if(basic){if(clientId||clientSecret)return oauthError(c,"invalid_request","Use one client authentication method");try{const [id,...rest]=atob(c.req.header("authorization")!.slice(6)).split(":");clientId=decodeURIComponent(id);clientSecret=decodeURIComponent(rest.join(":"));}catch{return oauthError(c,"invalid_client","Client authentication failed",401);}}
    const ip=c.req.header("cf-connecting-ip")??"unknown";if(!(await rate(c.env,"ip",ip)))return oauthError(c,"temporarily_unavailable","Rate limit exceeded",429);
    if(form.grant_type!=="client_credentials")return oauthError(c,"unsupported_grant_type","Only client_credentials is supported");
    const credential=await c.env.DB.prepare(`SELECT c.*,s.status system_status,s.deleted_at,a.status access_status,a.permissions FROM system_credentials c JOIN system_identities s ON s.id=c.system_id JOIN family_system_access a ON a.system_id=s.id WHERE s.id=? AND c.credential_type='oauth_client_secret' AND c.secret_hash=? AND (c.expires_at IS NULL OR julianday(c.expires_at)>julianday('now'))`).bind(clientId,await sha256(clientSecret)).first<any>();
    if(!credential||credential.status!=="active"||credential.revoked_at||credential.system_status!=="active"||credential.deleted_at||credential.access_status!=="active"){await rate(c.env,"client",clientId||"unknown",true);return oauthError(c,"invalid_client","Client authentication failed",401);}
    if(!(await rate(c.env,"client",clientId)))return oauthError(c,"temporarily_unavailable","Client is temporarily locked",429);
    const granted=JSON.parse(credential.permissions) as string[], requested=typeof form.scope==="string"&&form.scope.trim()?form.scope.trim().split(/\s+/):granted;
    if(requested.some(s=>!SYSTEM_PERMISSIONS.includes(s as any)||!granted.includes(s)))return oauthError(c,"invalid_scope","Requested scope is not granted");
    const signed=await signSystemToken(c.env.JWT_SECRET,clientId,credential.id,requested);
    await c.env.DB.batch([c.env.DB.prepare("INSERT INTO oauth_access_tokens(jti,system_id,credential_id,expires_at) VALUES(?,?,?,?)").bind(signed.jti,clientId,credential.id,signed.expiresAt),c.env.DB.prepare("UPDATE system_credentials SET last_used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(credential.id)]);
    c.header("cache-control","no-store");c.header("pragma","no-cache");return c.json({access_token:signed.token,token_type:"Bearer",expires_in:3600,scope:requested.join(" ")});
  });
}
