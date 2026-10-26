import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function harness(path: string) {
  const family={id:'spc_one',name:'家一',role:'admin',avatarUrl:null};
  const other={...family,id:'spc_two',name:'家二'};
  const currentFamilyStore={value:family as any};
  const routes:string[]=[];
  let page:any;
  const stores={
    currentFamilyStore,familiesStore:{value:[family,other]},
    userStore:{value:{id:'usr_one',displayName:'小喵',avatarUrl:null}},
    loadCurrentUser:async()=>{},loadFamilies:async()=>[family,other],
    setCurrentFamily:(value:any)=>{currentFamilyStore.value=value;},
    refreshFamilyState:(values:any[])=>{currentFamilyStore.value=values.find(f=>f.id===currentFamilyStore.value?.id)||values[0]||null;},
  };
  const source=readFileSync(new URL(`../miniprogram/pages/${path}.ts`,import.meta.url),'utf8');
  runInNewContext(stripTypeScriptTypes(source.replace(/^import[\s\S]*?from ['"][^'"]+['"];?\r?$/gm,'')),{
    ...stores,loadFamilies:()=>stores.loadFamilies(),
    ensureRuntimeReady:async()=>{},showSuccess:()=>{},showError:()=>{},getErrorMessage:()=>'',
    getFamily:async(id:string)=>({...family,id}),isFamilyOwner:async()=>false,
    getApp:()=>({globalData:{}}),console:{error:()=>{}},
    wx:{navigateTo:({url}:any)=>routes.push(url),redirectTo:({url}:any)=>routes.push(url)},
    Page:(definition:any)=>{page=definition;},
  });
  page.setData=(patch:any)=>Object.assign(page.data,patch);
  return {page,routes,stores,other};
}

test('More family entry always opens the unified manager, including no-family state',()=>{
  const {page,routes,stores}=harness('more/more');
  page.onNav({currentTarget:{dataset:{key:'family'}}});
  stores.currentFamilyStore.value=null;
  page.onNav({currentTarget:{dataset:{key:'family'}}});
  assert.deepEqual(routes,['/pages/family/detail','/pages/family/detail']);
});

test('More reflects a changed current family without a personal profile block',()=>{
  const {page,stores,other}=harness('more/more');
  stores.currentFamilyStore.value=other;page.showStores();
  assert.equal(page.data.familyName,'家二');
  const template=readFileSync(new URL('../miniprogram/pages/more/more.wxml',import.meta.url),'utf8');
  assert.doesNotMatch(template,/profile-header|identity-card/);
  assert.match(template,/family-avatar/);
});

test('historical profile URL redirects to unified family management',()=>{
  const {page,routes}=harness('profile/profile');page.onLoad();
  assert.deepEqual(routes,['/pages/family/detail']);
});

test('family management distinguishes load failure from a successful empty family list',async()=>{
  const {page,stores}=harness('family/detail');
  stores.loadFamilies=async()=>{throw new Error('offline');};await page.loadManagement();
  assert.equal(page.data.loadError,true);
  stores.loadFamilies=async()=>[];await page.loadManagement();
  assert.equal(page.data.loadError,false);
  assert.equal(page.data.familyId,'');assert.equal(stores.currentFamilyStore.value,null);
});

test('switching family refreshes management in place and ignores unknown ids',async()=>{
  const {page,stores,other,routes}=harness('family/detail');
  await page.loadManagement();
  page.onSwitchFamily();
  assert.equal(page.data.choosingFamily,true);
  await page.onSelectFamily({currentTarget:{dataset:{id:'missing'}}});
  assert.equal(stores.currentFamilyStore.value.id,'spc_one');
  await page.onSelectFamily({currentTarget:{dataset:{id:other.id}}});
  assert.equal(page.data.choosingFamily,false);
  assert.equal(stores.currentFamilyStore.value.id,other.id);
  assert.equal(page.data.detail.id,other.id);assert.deepEqual(routes,[]);
  page.onSwitchFamily();
  page.onSheetTouchStart({touches:[{clientY:100}]});
  page.onSheetTouchEnd({changedTouches:[{clientY:180}]});
  assert.equal(page.data.choosingFamily,false);
  assert.equal(stores.currentFamilyStore.value.id,other.id);
  page.onSwitchFamily();
  await page.onSelectFamily({currentTarget:{dataset:{id:other.id}}});
  assert.equal(page.data.choosingFamily,false);
});

test('profile and email stay optional and do not become startup gates',()=>{
  const source=readFileSync(new URL('../miniprogram/services/entry-navigation.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/account-email|profile-setup/);
  const settings=readFileSync(new URL('../miniprogram/pages/settings/settings.wxml',import.meta.url),'utf8');
  assert.match(settings,/profile-setup/);assert.match(settings,/pages\/account-link\/account-link/);
});
