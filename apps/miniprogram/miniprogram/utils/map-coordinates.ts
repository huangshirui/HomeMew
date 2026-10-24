// LifeSpace uses WGS84; WeChat openLocation requires GCJ-02.
const PI=Math.PI, A=6378245, EE=0.00669342162296594323;
export function wgs84ToGcj02(latitude:number,longitude:number):{latitude:number;longitude:number}{
  if(longitude<72.004||longitude>137.8347||latitude<0.8293||latitude>55.8271)return {latitude,longitude};
  const x=longitude-105,y=latitude-35;
  let dLat=-100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
  dLat+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  dLat+=(20*Math.sin(y*PI)+40*Math.sin(y/3*PI))*2/3;
  dLat+=(160*Math.sin(y/12*PI)+320*Math.sin(y*PI/30))*2/3;
  let dLon=300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
  dLon+=(20*Math.sin(6*x*PI)+20*Math.sin(2*x*PI))*2/3;
  dLon+=(20*Math.sin(x*PI)+40*Math.sin(x/3*PI))*2/3;
  dLon+=(150*Math.sin(x/12*PI)+300*Math.sin(x/30*PI))*2/3;
  const rad=latitude/180*PI,magic=1-EE*Math.sin(rad)**2,root=Math.sqrt(magic);
  return {latitude:latitude+dLat*180/((A*(1-EE))/(magic*root)*PI),
    longitude:longitude+dLon*180/(A/root*Math.cos(rad)*PI)};
}
