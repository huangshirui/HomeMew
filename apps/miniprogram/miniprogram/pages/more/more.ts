import { currentFamilyStore,familiesStore,loadFamilies,refreshFamilyState } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';

Page({
  data:{
    familyName:'尚未加入家庭',familyAvatar:null as string|null,familyCount:0,
    loadError:false,
    groups:[
      {key:'plans',title:'计划与成长',items:[
        {key:'activity',title:'活动',icon:'🗓️',path:'/pages/domains/list?kind=activities'},
        {key:'goal',title:'目标',icon:'🎯',path:'/pages/domains/list?kind=goals'},
        {key:'habit',title:'习惯',icon:'🌱',path:'/pages/domains/list?kind=habits'},
      ]},
      {key:'life',title:'生活与回忆',items:[
        {key:'days',title:'日子',icon:'⏳',path:'/pages/days/list'},
        {key:'anniversary',title:'纪念日',icon:'🎁',path:'/pages/domains/list?kind=anniversaries'},
        {key:'wish',title:'许愿池',icon:'⭐',path:'/pages/wishes/list'},
        {key:'football',title:'足球比赛',icon:'⚽',path:'/pages/football/list'},
      ]},
      {key:'management',title:'家庭管理',items:[
        {key:'family',title:'加入家庭',icon:'🏡',path:'/pages/family/detail'},
        {key:'setting',title:'设置',icon:'⚙️',path:'/pages/settings/settings'},
        {key:'about',title:'关于',icon:'🐱',path:'/pages/about/about'},
      ]},
    ],
  },
  onShow():void{
    this.getTabBar()?.setData({selected:3});
    this.showStores();
    void this.loadData();
  },
  async loadData():Promise<void>{
    this.setData({loadError:false});
    try{
      await ensureRuntimeReady();
      const families=await loadFamilies();
      refreshFamilyState(families);
      this.showStores();
    }catch{
      this.showStores();
      this.setData({loadError:true});
    }
  },
  showStores():void{
    const family=currentFamilyStore.value;
    this.setData({familyName:family?.name||'尚未加入家庭',familyAvatar:family?.avatarUrl||null,
      familyCount:familiesStore.value.length});
  },
  onNav(e:WechatMiniprogram.TouchEvent):void{
    if(e.currentTarget.dataset.key==='family'){
      wx.navigateTo({url:'/pages/family/detail'});
      return;
    }
    const path=String(e.currentTarget.dataset.path||'');
    if(path.startsWith('/pages/'))wx.navigateTo({url:path});
  },
});
