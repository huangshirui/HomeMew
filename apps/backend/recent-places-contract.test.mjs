import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cfg=JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
const worker=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
test('RecentPlaces has versioned SQLite DO and isolated bindings',()=>{
 assert.deepEqual(cfg.migrations.at(-1),{tag:'v6',new_sqlite_classes:['RecentPlaces']});
 for(const a of [cfg.durable_objects.bindings,cfg.env.staging.durable_objects.bindings,
 cfg.env.production.durable_objects.bindings])assert.ok(a.some(x=>x.name==='RECENT_PLACES'&&x.class_name==='RecentPlaces'));
 assert.match(worker,/resolveCurrentLifeSpaceUser\(request,env\)/);
 assert.match(worker,/RECENT_PLACES_PERSISTENCE_ALLOWED !== 'true'/);
});
