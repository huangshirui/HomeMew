import type { HealthMetric, HealthObservation } from '../services/health';

export function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}
export function growthMetrics(metrics: HealthMetric[], complete: boolean) {
  const find = (name:string,unit:string) => {
    const matches=metrics.filter(m=>m.name===name);
    return complete && matches.length===1 && matches[0].valueType==='number' && matches[0].defaultUnit===unit ? matches[0] : undefined;
  };
  return {height:find('身高','cm'),weight:find('体重','kg')};
}
export function derivedBmi(rows:HealthObservation[],heightId:string,weightId:string,personId:string, incompleteOldestDate?:string) {
  // Same subject and date only. Ambiguous repeated measurements are not paired.
  const byDate=new Map<string,HealthObservation[]>();
  for(const row of rows) {
    if(row.observedDate===incompleteOldestDate||row.subjectPersonId!==personId||!validDate(row.observedDate)||![heightId,weightId].includes(row.metricId))continue;
    const list=byDate.get(row.observedDate)??[];list.push(row);byDate.set(row.observedDate,list);
  }
  for(const date of [...byDate.keys()].sort().reverse()) {
    const entries=byDate.get(date)!;
    const h=entries.filter(r=>r.metricId===heightId),w=entries.filter(r=>r.metricId===weightId);
    if(h.length!==1||w.length!==1||h[0].unit!=='cm'||w[0].unit!=='kg')continue;
    const height=h[0].valueNumber,weight=w[0].valueNumber;
    if(typeof height!=='number'||typeof weight!=='number'||!Number.isFinite(height)||!Number.isFinite(weight)||height<=0||weight<=0)continue;
    const bmi=weight/((height/100)**2);
    if(Number.isFinite(bmi))return {date,value:Math.round(bmi*10)/10};
  }
  return null;
}

export function healthSince(today:string,days:number) {
  if(!validDate(today)||!Number.isInteger(days)||days<=0)throw Error('日期范围无效');
  const start=new Date(today+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-days+1);return start.toISOString().slice(0,10);
}
export function healthMonth(date:string) {return /^\d{4}-\d{2}/u.test(date)?date.slice(0,7).replace('-','年')+'月':'日期未记录';}

export function familyToday(timezone:string) {
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(k=>p.find(x=>x.type===k)?.value).join('-');
}
export function observationValue(r:HealthObservation) {
  if(typeof r.valueNumber==='number')return String(r.valueNumber);
  if(typeof r.valueBoolean==='boolean')return r.valueBoolean?'是':'否';
  return r.valueText??'—';
}
export function measurementFields(metric:HealthMetric,date:string,raw:string,unit:string,notes:string){
  if(!validDate(date)||!raw.trim())throw Error('请填写有效日期与测量值');
  const numeric=Number(raw);
  if(metric.valueType==='number'&&!Number.isFinite(numeric))throw Error('请输入有效数值');
  if(metric.valueType==='boolean'&&!['true','false'].includes(raw))throw Error('请选择是或否');
  return {metricId:metric.id,observedDate:date,valueNumber:metric.valueType==='number'?numeric:null,valueText:metric.valueType==='text'?raw.trim():null,valueBoolean:metric.valueType==='boolean'?raw==='true':null,unit:unit.trim()||null,notes:notes.trim()||null};
}
export function trendSeries(rows:HealthObservation[]){
  const points=rows.filter(r=>typeof r.valueNumber==='number'&&Number.isFinite(r.valueNumber)&&validDate(r.observedDate)).slice().sort((a,b)=>a.observedDate.localeCompare(b.observedDate));
  if(points.length<2)return {points:[],message:'至少两次数值记录后显示趋势',unit:'',low:0,high:1};
  if(new Set(points.map(p=>p.unit??'')).size!==1)return {points:[],message:'记录单位不同，暂不合并趋势',unit:'',low:0,high:1};
  const ys=points.map(p=>p.valueNumber as number),low=Math.min(...ys),high=Math.max(...ys),pad=(high-low)*.12||Math.max(Math.abs(high)*.05,.1);
  return {points:points.map(p=>({date:p.observedDate,x:Date.parse(p.observedDate),y:p.valueNumber as number})),message:'',unit:points[0].unit??'',low:low-pad,high:high+pad};
}
