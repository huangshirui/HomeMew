import { userStore,currentFamilyStore,familiesStore,loadCurrentUser,loadFamilies } from '../../stores/index';
import { ensureRuntimeReady } from '../../services/runtime-bootstrap';

type Shortcut={key:string;title:string;icon:string;path:string};
Page({
  data:{
    userName:'',familyName:'',familyRole:'',familyCount:0,
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
        {key:'family',title:'家庭与成员',icon:'🏡',path:'/pages/profile/profile'},
        {key:'setting',title:'设置',icon:'⚙️',path:'/pages/settings/settings'},
        {key:'about',title:'关于家事喵',icon:'🐱',path:'/pages/about/about'},
      ]},
    ],
  },
  onShow():void{
    this.getTabBar()?.setData({selected:3});
    this.showStores();
    void ensureRuntimeReady().then(async()=>{await Promise.all([loadCurrentUser(),loadFamilies()]);this.showStores();})
      .catch(()=>{this.showStores();});
  },
  showStores():void{
    const family=currentFamilyStore.value,role=family?.role||'';
    this.setData({userName:userStore.value?.displayName||'我的资料',familyName:family?.name||'尚未加入家庭',
      familyCount:familiesStore.value.length,
      familyRole:(role as string)==='owner'?'创建者':role==='admin'?'管理员':(role as string)==='viewer'?'只读成员':'家庭成员'});
  },
  onNav(e:WechatMiniprogram.TouchEvent):void{
    const path=String(e.currentTarget.dataset.path||'');
    if(path.startsWith('/pages/'))wx.navigateTo({url:path});
  },
  onProfile():void{wx.navigateTo({url:'/pages/profile/profile'});},
  onSwitchFamily():void{wx.navigateTo({url:'/pages/profile/profile'});},
});