/** Pure native chart projection. Shared month axis, null gaps, and a separate match-count scale. */
import { metricPair,type MonthMetric,type Trend } from './football-stats';
export function footballChart(months:MonthMetric[],trend:Trend):{width:number;background:string}{
  const width=Math.max(360,months.length*76+48),left=30,top=20,bottom=158,barTop=202,barBottom=264;
  const pairs=months.map(m=>metricPair(m,trend));
  const values=pairs.reduce<number[]>((all,pair)=>all.concat(pair.filter((v):v is number=>v!==null)),[]);
  const max=Math.max(1,...values)*1.1,countMax=Math.max(1,...months.map(m=>m.matches));
  const cell=(width-left-16)/Math.max(1,months.length),x=(i:number)=>left+cell*(i+.5),y=(v:number)=>bottom-v/max*(bottom-top);
  let svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="306" viewBox="0 0 '+width+' 306">';
  for(let i=0;i<4;i++){
    const v=max*i/3,py=y(v);svg+='<path d="M'+left+' '+py+'H'+width+'" stroke="#e7e5e4" stroke-dasharray="3 4"/><text x="0" y="'+(py+4)+'" font-size="10" fill="#78716c">'+Number(v.toFixed(1))+'</text>';
  }
  for(let series=0;series<2;series++){
    let started=false,path='';const color=series?'#d97706':'#059669';
    pairs.forEach((p,i)=>{const v=p[series];if(v===null){started=false;return;}path+=(started?'L':'M')+x(i).toFixed(1)+','+y(v).toFixed(1);started=true;});
    svg+='<path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2.2"/>';
    pairs.forEach((p,i)=>{const v=p[series];if(v!==null)svg+='<circle cx="'+x(i)+'" cy="'+y(v)+'" r="3" fill="'+color+'"/>';});
  }
  svg+='<text x="'+left+'" y="190" font-size="11" fill="#78716c">每月参赛场次</text>';
  months.forEach((m,i)=>{
    const height=m.matches/countMax*(barBottom-barTop),px=x(i);
    svg+='<rect x="'+(px-12)+'" y="'+(barBottom-height)+'" width="24" height="'+height+'" rx="3" fill="#a7f3d0"/><text x="'+px+'" y="'+(barBottom-height-6)+'" text-anchor="middle" font-size="10" fill="#57534e">'+m.matches+'</text><text x="'+px+'" y="288" text-anchor="middle" font-size="10" fill="#78716c">'+m.month+'</text>';
  });
  svg+='</svg>';
  return{width,background:'url("data:image/svg+xml,'+encodeURIComponent(svg).replace(/'/g,'%27')+'")'};
}
