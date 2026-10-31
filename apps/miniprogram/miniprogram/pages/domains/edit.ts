import { ensureRuntimeReady } from '../../services/runtime-bootstrap';
import { markRefreshDirty } from '../../services/refresh-policy';
import { currentFamilyStore } from '../../stores/index';
import { getDomainRecord,createDomainRecord,updateDomainRecord,deleteDomainRecord,listDomainPeople,DOMAIN_COPY,type DomainKind,type DomainRecord,type PersonOption } from '../../services/domains';
import { originalIconState,prepareRecordIcon,pickerChangeState,type RecordIconPickerChange } from '../../utils/record-icon-edit';
import { downloadRecordIconImage } from '../../services/record-icons';
import { shiftDateEndWithStart } from '../../utils/event-time-shift';

type Kind='activities'|'goals'|'habits'|'anniversaries';
const KINDS:Kind[]=['activities','goals','habits','anniversaries'];
const modelKeys={activities:'activity',goals:'goal',habits:'habit',anniversaries:'anniversary'} as const;
const isValidAnniversary=(month:number,day:number,year:number|null)=>{
  if(!Number.isInteger(month)||!Number.isInteger(day)||month<1||month>12||day<1||day>31||
    (year!==null&&(!Number.isInteger(year)||year<1||year>9999)))return false;
  const y=year??2024, date=new Date(Date.UTC(y,month-1,day));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
};
const errorMessage=(e:unknown)=>e instanceof Error?e.message:'保存失败，请重试';
Page({
  data:{
    familyId:'',kind:'activities' as Kind,recordId:'',version:0,title:'活动',loading:true,submitting:false,error:'',
    name:'',description:'',iconEmoji:'',iconFileId:'',iconImagePath:'',iconTouched:false,
    startDate:'',endDate:'',targetDate:'',month:'',day:'',year:'',
    personIds:[] as string[],personOptions:[] as (PersonOption&{selected:boolean})[],
    subjectPersonId:'',selectedPersonIndex:0,intervalDays:'1',
  },
  async onLoad(opts:{kind?:string;familyId?:string;id?:string}):Promise<void>{
    const kind=KINDS.includes(opts.kind as Kind)?opts.kind as Kind:'activities';
    const familyId=opts.familyId||currentFamilyStore.value?.id||'';
    this.setData({kind,familyId,recordId:opts.id||'',title:(opts.id?'编辑':'新建')+DOMAIN_COPY[kind].title,loading:true,error:''});
    try {
      await ensureRuntimeReady();
      const [people,record]=await Promise.all([listDomainPeople(familyId),opts.id?getDomainRecord(familyId,kind,opts.id):Promise.resolve(null)]);
      const ids=record?.attendeePersonIds||record?.subjectPersonIds||record?.personIds||[];
      const subject=record?.subjectPersonId||people[0]?.personId||'';
      this.setData({
        loading:false,personOptions:people.map(p=>({...p,selected:ids.includes(p.personId)})),
        selectedPersonIndex:Math.max(0,people.findIndex(p=>p.personId===subject)),
        subjectPersonId:subject,personIds:ids,
        version:record?.version||0,name:record?.name||'',description:record?.description||'',
        startDate:record?.startDate||'',endDate:record?.endDate||'',targetDate:record?.targetDate||'',
        month:record?.month?String(record.month):'',day:record?.day?String(record.day):'',
        year:record?.year?String(record.year):'',intervalDays:String(record?.intervalDays||1),
        ...originalIconState(record?.presentation?.icon),
      });
      if(record?.presentation?.icon?.type==='image'){
        const fileId=record.presentation.icon.fileId;
        void downloadRecordIconImage(familyId,modelKeys[kind],record.id,fileId).then(iconImagePath=>{
          if(!this.data.iconTouched&&this.data.iconFileId===fileId)this.setData({iconImagePath});
        }).catch(()=>{});
      }
    }catch(e){this.setData({loading:false,error:errorMessage(e)});}
  },
  onFieldInput(e:WechatMiniprogram.Input):void{
    const name=String(e.currentTarget.dataset.name||'');
    if(!['name','description','intervalDays','month','day','year'].includes(name))return;
    this.setData({[name]:e.detail.value});
  },
  onDateChange(e:WechatMiniprogram.PickerChange):void{
    const name=String(e.currentTarget.dataset.name||'');
    const value=String(e.detail.value);
    if(name==='startDate'&&(this.data.kind==='activities'||this.data.kind==='goals')){
      const endField=this.data.kind==='activities'?'endDate':'targetDate';
      this.setData({startDate:value,[endField]:shiftDateEndWithStart(this.data.startDate,this.data[endField],value)});
    }else if(['endDate','targetDate'].includes(name))this.setData({[name]:value});
  },
  onTogglePerson(e:WechatMiniprogram.TouchEvent):void{
    if(this.data.kind==='habits'&&this.data.recordId)return;
    const id=String(e.currentTarget.dataset.id||'');
    const personIds=this.data.personIds.includes(id)?this.data.personIds.filter(x=>x!==id):[...this.data.personIds,id];
    this.setData({personIds,personOptions:this.data.personOptions.map(p=>({...p,selected:personIds.includes(p.personId)}))});
  },
  onSubjectChange(e:WechatMiniprogram.PickerChange):void{
    if(this.data.recordId)return;
    const index=Number(e.detail.value),person=this.data.personOptions[index];
    if(person)this.setData({subjectPersonId:person.personId,selectedPersonIndex:index});
  },
  onRecordIconChange(e:WechatMiniprogram.CustomEvent<RecordIconPickerChange>):void{this.setData(pickerChangeState(e.detail));},
  async onSubmit():Promise<void>{
    if(this.data.submitting)return;
    const d=this.data,kind=d.kind,name=d.name.trim(),description=d.description.trim()||null;
    if(!name){wx.showToast({title:'请输入名称',icon:'none'});return;}
    let fields:Record<string,unknown>={name,description};
    if(kind==='activities'){
      if(d.startDate&&d.endDate&&d.endDate<d.startDate){wx.showToast({title:'结束日期不能早于开始日期',icon:'none'});return;}
      fields={...fields,startDate:d.startDate||null,endDate:d.endDate||null,attendeePersonIds:d.personIds};
    }else if(kind==='goals'){
      fields={...fields,startDate:d.startDate||null,targetDate:d.targetDate||null,subjectPersonIds:d.personIds};
    }else if(kind==='habits'&&!d.recordId){
      const intervalDays=Number(d.intervalDays);
      if(!d.subjectPersonId||!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365){
        wx.showToast({title:'请选择所属人，间隔为 1–365 天',icon:'none'});return;
      }
      fields={...fields,subjectPersonId:d.subjectPersonId,intervalDays};
    }else if(kind==='anniversaries'){
      const month=Number(d.month),day=Number(d.day),year=d.year.trim()?Number(d.year):null;
      if(!isValidAnniversary(month,day,year)){wx.showToast({title:'纪念日日期无效',icon:'none'});return;}
      fields={...fields,month,day,year,personIds:d.personIds};
    }
    this.setData({submitting:true,error:''});
    try{
      const presentation=await prepareRecordIcon(d.familyId,modelKeys[kind],d.recordId?'edit':'create',d);
      if(presentation)fields.presentation=presentation;
      if(d.recordId){await updateDomainRecord(d.familyId,kind,d.recordId,{...fields,version:d.version});markRefreshDirty('domains');}
      else{
        const record=await createDomainRecord(d.familyId,kind,fields);
        markRefreshDirty('domains');
        wx.showToast({title:'创建成功',icon:'success'});
        if(kind!=='anniversaries'&&record.id){
          wx.redirectTo({url:'/pages/domains/detail?kind='+kind+'&familyId='+d.familyId+'&id='+encodeURIComponent(record.id)});
          return;
        }
      }
      wx.navigateBack();
    }catch(e){this.setData({error:errorMessage(e)});}
    finally{this.setData({submitting:false});}
  },
  onDelete():void{
    const d=this.data;if(!d.recordId||d.submitting)return;
    wx.showModal({title:'确认删除',content:'删除“'+d.name+'”？此操作无法撤销。',confirmColor:'#E85A5A',
      success:async res=>{
        if(!res.confirm)return;
        this.setData({submitting:true,error:''});
        try{await deleteDomainRecord(d.familyId,d.kind,d.recordId,d.version);markRefreshDirty('domains');wx.redirectTo({url:'/pages/domains/list?kind='+d.kind});}
        catch(e){this.setData({error:errorMessage(e)});}
        finally{this.setData({submitting:false});}
      },
    });
  },
});
