import { listDomainRecords,getDomainRecord,createDomainRecord } from '../../services/domains';
import { saveTeam } from '../../services/football';
import { readFootballRecent,rememberFootballRecent,removeFootballRecent,type FootballRecentItem,type FootballRecentKind } from '../../utils/football-recent-cache';
Component({
  options:{pureDataPattern:/^_/},
  properties:{familyId:{type:String,value:''},userId:{type:String,value:''},kind:{type:String,value:'team'},value:{type:String,value:''},label:{type:String,value:''},placeholder:{type:String,value:'请选择'},allowCreate:{type:Boolean,value:false},disabled:{type:Boolean,value:false}},
  data:{_generation:0,_selectionGeneration:0,_timer:0 as ReturnType<typeof setTimeout>|0,name:'',open:false,search:'',searched:'',busy:false,saving:false,error:'',nextCursor:null as string|null,rows:[] as {id:string;name?:string}[],recent:[] as FootballRecentItem[],canCreate:false},
  observers:{'familyId,value':function():void{this.data._generation++;this.setData({open:false,busy:false});void this.hydrate();}},
  lifetimes:{detached():void{this.data._generation++;this.data._selectionGeneration++;if(this.data._timer)clearTimeout(this.data._timer);}},
  methods:{
    model(): 'activities'|'football-teams'{return this.properties.kind==='competition'?'activities':'football-teams';},
    async hydrate():Promise<void>{
      const generation=++this.data._selectionGeneration,{familyId,value}=this.properties;this.setData({name:'',error:''});
      if(!familyId||!value)return;
      try{const record=await getDomainRecord(familyId,this.model(),value);if(generation===this.data._selectionGeneration)this.setData({name:record.name||'未命名'});}
      catch{if(generation===this.data._selectionGeneration)this.setData({name:'暂不可查看'});}
    },
    onOpen():void{
      if(this.properties.disabled)return;
      const {userId,familyId,kind}=this.properties,recent=readFootballRecent(userId,familyId,kind as FootballRecentKind);
      this.data._generation++;this.setData({open:true,search:'',searched:'',rows:[],error:'',canCreate:false,nextCursor:null,recent});
      if(!recent.length)void this.searchRecords(true);
    },
    onClose():void{if(!this.data.saving){this.data._generation++;if(this.data._timer)clearTimeout(this.data._timer);this.setData({open:false,busy:false});}},noop():void{},
    onInput(e:WechatMiniprogram.Input):void{
      if(this.data._timer)clearTimeout(this.data._timer);this.data._generation++;
      const search=e.detail.value;this.setData({search,error:'',canCreate:false,busy:false,rows:[],nextCursor:null,searched:''});
      if(search.trim().length>=2)this.data._timer=setTimeout(()=>void this.searchRecords(true),320);
    },
    onSearch():void{if(this.data._timer)clearTimeout(this.data._timer);void this.searchRecords(true);},
    onMore():void{if(this.data.nextCursor&&!this.data.busy)void this.searchRecords(false);},
    async searchRecords(reset:boolean):Promise<void>{
      const term=this.data.search.trim();if(term&&term.length<2){this.setData({error:'请输入至少两个字'});return;}
      const generation=++this.data._generation;this.setData({busy:true,error:'',canCreate:false});
      try{
        const page=await listDomainRecords(this.properties.familyId,this.model(),{q:term||undefined,limit:20,period:'all',cursor:reset?undefined:this.data.nextCursor||undefined});
        if(generation!==this.data._generation)return;
        const rows=reset?page.items:[...this.data.rows,...page.items];
        this.setData({rows,searched:term,nextCursor:page.nextCursor,canCreate:this.properties.allowCreate&&term.length>=2&&reset&&!rows.length&&!page.nextCursor});
      }catch(e){if(generation===this.data._generation)this.setData({error:(e as Error).message||'搜索失败'});}
      finally{if(generation===this.data._generation)this.setData({busy:false});}
    },
    async onPick(e:WechatMiniprogram.TouchEvent):Promise<void>{
      if(this.data.busy)return;const id=String(e.currentTarget.dataset.id),{familyId,userId,kind}=this.properties;
      const generation=++this.data._generation;this.setData({busy:true,error:''});
      try{
        const record=await getDomainRecord(familyId,this.model(),id);if(generation!==this.data._generation)return;
        rememberFootballRecent(userId,familyId,kind as FootballRecentKind,{id:record.id,name:record.name||'未命名'});
        this.setData({open:false,name:record.name||'未命名'});this.triggerEvent('select',{id:record.id,name:record.name||'未命名'});
      }catch(e){if(generation===this.data._generation){removeFootballRecent(userId,familyId,kind as FootballRecentKind,id);this.setData({error:(e as Error).message||'该记录暂不可选'});}}
      finally{if(generation===this.data._generation)this.setData({busy:false});}
    },
    onClear():void{if(this.properties.disabled)return;this.setData({name:''});this.triggerEvent('select',{id:'',name:''});},
    onForget(e:WechatMiniprogram.TouchEvent):void{const {familyId,userId,kind}=this.properties;this.setData({recent:removeFootballRecent(userId,familyId,kind as FootballRecentKind,String(e.currentTarget.dataset.id))});},
    onCreate():void{
      if(!this.data.canCreate||this.data.busy)return;const name=this.data.searched;
      wx.showModal({title:this.properties.kind==='competition'?'新建赛事':'新建球队',content:'新建“'+name+'”？',success:async answer=>{
        if(!answer.confirm||this.data.busy)return;this.setData({busy:true,saving:true,error:''});
        try{
          const {familyId,userId,kind}=this.properties;
          const record=kind==='competition'?await createDomainRecord(familyId,'activities',{name,description:null}):await saveTeam(familyId,{name,description:null,memberPersonIds:[]});
          rememberFootballRecent(userId,familyId,kind as FootballRecentKind,{id:record.id,name});this.setData({open:false,name});this.triggerEvent('select',{id:record.id,name});
        }catch(e){this.setData({error:(e as Error).message||'创建失败'});}
        finally{this.setData({busy:false,saving:false});}
      }});
    },
  },
});
