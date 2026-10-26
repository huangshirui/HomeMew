import { currentFamilyStore } from '../../stores/index';
import { parseFootballScope } from '../../utils/football-scope';
Page({onLoad(opts:{familyId?:string;scope?:string}):void{
  wx.redirectTo({url:'/pages/football/list?mode=stats&familyId='+encodeURIComponent(opts.familyId||currentFamilyStore.value?.id||'')+'&scope='+encodeURIComponent(JSON.stringify(parseFootballScope(opts.scope)))});
}});
