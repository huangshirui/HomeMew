/** HomeMew presentation fallback for LifeSpace record projections.
 * Semantic Relation labels belong to LifeSpace; older published models may return
 * the record ID until their referenceLabel migration is deployed. */
type NamedRecord = { id?: string; name?: string | null; summary?: string | null;
  title?: string | null; displayName?: string | null };

function visibleName(value: unknown, recordId: string): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!candidate || candidate === recordId || /^rec_[A-Za-z0-9_-]+$/.test(candidate)) return null;
  return candidate;
}

export function relationDisplayName(
  recordId: string, canonicalLabel?: string | null, record?: NamedRecord,
): string {
  // The model's canonical referenceLabel is authoritative when configured.
  const label = visibleName(canonicalLabel, recordId);
  if (label) return label;
  // Legacy models without referenceLabel retain product-specific title fields.
  for (const value of [record?.name, record?.summary, record?.title, record?.displayName]) {
    const name = visibleName(value, recordId);
    if (name) return name;
  }
  return '名称暂不可用';
}

export function candidateDisplayName(
  modelKey: string, record: NamedRecord & { id: string },
): string {
  // Generic query returns model fields, not a referenceLabel projection.
  const field = modelKey === 'event' ? record.summary : modelKey === 'wish' ? record.title : record.name;
  return visibleName(field, record.id) || '名称暂不可用';
}


/** Only fields returned by the authorized relation hydration; never fetch individual records. */
export type RelatedRecord = NamedRecord & {
  when?: { kind: 'date'|'instant'; start: string; endExclusive: string };
  dueDate?: string|null; anchorDate?: string|null; startDate?: string|null; endDate?: string|null;
  targetDate?: string|null; desiredDate?: string|null; month?: number; day?: number; year?: number|null;
  status?: string; kind?: string; attendeePersonIds?: string[]; assigneePersonIds?: string[];
  subjectPersonIds?: string[]; subjectPersonId?: string; personIds?: string[]; ownerPersonId?: string;
};
type FormatInstant = (instant:string,timezone:string)=>{date:string;time:string};
const dateOnly=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const STATUS:Record<string,Record<string,string>>={
  activity:{planned:'未开始',active:'进行中',completed:'已完成',cancelled:'已取消'},
  task:{pending:'进行中',completed:'已完成',cancelled:'已取消'},
  event:{cancelled:'已取消'},day_record:{archived:'已归档'},
  goal:{active:'进行中',paused:'已暂停',achieved:'已达成',abandoned:'已放弃'},
  habit:{active:'进行中',paused:'已暂停',ended:'已结束'},wish:{open:'未实现',fulfilled:'已实现'},
};
export function relatedRecordMetadata(model:string, record:RelatedRecord|undefined, timezone:string, today:string,
  people:ReadonlyArray<{personId:string;displayName:string}>,formatInstant:FormatInstant){
  let date='',time='',dateLabel='';
  if(record){
    if(model==='event'&&record.when){
      const when=record.when;
      if(when.kind==='date'&&dateOnly(when.start)){date=when.start;dateLabel='全天 '+date;}
      else if(when.kind==='instant'&&typeof when.start==='string'&&Number.isFinite(Date.parse(when.start))){
        try{const local=formatInstant(when.start,timezone);date=local.date;time=local.time;dateLabel=date+' '+time;}catch{}
      }
    }else if(model==='anniversary'&&record.month&&record.day&&dateOnly(today)){
      for(let y=Number(today.slice(0,4));y<Number(today.slice(0,4))+9;y++){
        const candidate=String(y).padStart(4,'0')+'-'+String(record.month).padStart(2,'0')+'-'+String(record.day).padStart(2,'0');
        if(dateOnly(candidate)&&candidate>=today){date=candidate;dateLabel='下次 '+date;break;}
      }
    }else{
      const raw=model==='task'?record.dueDate:model==='day_record'?record.anchorDate:model==='activity'?(record.startDate||record.endDate):
        model==='goal'?(record.targetDate||record.startDate):model==='wish'?record.desiredDate:null;
      if(dateOnly(raw)){date=raw;dateLabel=(model==='task'?'截止 ':model==='day_record'?'日期 ':model==='goal'&&record.targetDate?'目标 ':'日期 ')+date;}
      if(model==='activity'&&dateOnly(record.startDate)&&dateOnly(record.endDate)&&record.startDate!==record.endDate)
        dateLabel=record.startDate+' — '+record.endDate;
    }
  }
  const ids=record?.attendeePersonIds||record?.assigneePersonIds||record?.subjectPersonIds||record?.personIds||
    (record?.subjectPersonId?[record.subjectPersonId]:record?.ownerPersonId?[record.ownerPersonId]:[]);
  const names=Array.isArray(ids)?ids.map(id=>people.find(p=>p.personId===id)?.displayName).filter(Boolean).join('、'):'';
  const status=record?.status?STATUS[model]?.[record.status]||'':'';
  let countdown='';
  if(model==='day_record'&&record?.kind==='countdown'&&dateOnly(date)&&dateOnly(today)){
    const days=Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
    countdown=days===0?'今天':Math.abs(days)+(days>0?' 天后':' 天前');
  }
  return {date,sortKey:date?date+'T'+(time||'00:00'):'',dateLabel,status,peopleLabel:names,countdown};
}

/** Sort only loaded pages; undated records stay last in either direction. */
export function activityTimeline<T extends {id:string;date:string;sortKey:string}>(rows:T[],today:string,order:'asc'|'desc'){
  const items=[...rows].sort((a,b)=>{
    if(!a.date)return b.date?1:a.id.localeCompare(b.id);
    if(!b.date)return -1;
    const cmp=a.sortKey.localeCompare(b.sortKey);
    return (order==='asc'?cmp:-cmp)||a.id.localeCompare(b.id);
  });
  const index=items.findIndex(x=>!x.date||(order==='asc'?x.date>=today:x.date<=today));
  return {items,markerAt:index<0?items.length:index};
}
