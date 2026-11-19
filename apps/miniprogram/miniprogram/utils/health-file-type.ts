export function healthFileType(buffer:ArrayBuffer):{ext:string;mime:string}|null{
  const b=new Uint8Array(buffer,0,Math.min(buffer.byteLength,16));const ascii=(a:number,z:number)=>String.fromCharCode(...Array.from(b.slice(a,z)));
  if(ascii(0,5)==='%PDF-')return{ext:'pdf',mime:'application/pdf'};
  if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return{ext:'png',mime:'image/png'};
  if(b[0]===255&&b[1]===216&&b[2]===255)return{ext:'jpg',mime:'image/jpeg'};
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return{ext:'webp',mime:'image/webp'};
  return null;
}
