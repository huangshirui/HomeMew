import { lazy, Suspense, useEffect, useRef, useState } from 'react';
const PdfPreview=lazy(()=>import('./pdf-preview'));
const MAX_BYTES=15*1024*1024;
const extensions:Record<string,string>={'application/pdf':'.pdf','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
const control='rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
type PreviewFile={blob:Blob;url:string;name:string};
export async function readPreviewFile(url:string,signal:AbortSignal):Promise<{blob:Blob;name?:string}>{
  // Only the calling application provides the explicit same-origin authorized route.
  if(!url.startsWith('/')||url.startsWith('//'))throw Error('文件地址无效');
  const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal,redirect:'error'});
  if(!response.ok||!response.body)throw Error('文件暂时无法读取');
  const type=((response.headers.get('content-type')??'').split(';')[0]??'').trim().toLowerCase();
  if(!Object.hasOwn(extensions,type)){await response.body.cancel();throw Error('不支持预览此文件类型');}
  const reader=response.body.getReader();const chunks:BlobPart[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('文件超过 15 MB');}chunks.push(new Uint8Array(value));}}finally{reader.releaseLock();}
  if(!size)throw Error('文件为空');
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(response.headers.get('content-disposition')??'')?.[1];
  let name:string|undefined;if(encoded)try{name=decodeURIComponent(encoded);}catch{/* fallback */}
  return {blob:new Blob(chunks,{type}),name};
}
export function DocumentPreview({url,title,close}:{url:string;title:string;close:()=>void}){
  const modal=useRef<HTMLDialogElement>(null);
  const [file,setFile]=useState<PreviewFile|null>(null),[error,setError]=useState(''),[zoom,setZoom]=useState(1);
  useEffect(()=>{const node=modal.current;node?.showModal();return()=>node?.close();},[]);
  useEffect(()=>{
    let active=true,objectUrl='';const abort=new AbortController();setFile(null);setError('');setZoom(1);
    void (async()=>{try{const result=await readPreviewFile(url,abort.signal);if(!active)return;objectUrl=URL.createObjectURL(result.blob);setFile({blob:result.blob,url:objectUrl,name:result.name||title+extensions[result.blob.type]});}
    catch(e){if(active)setError(e instanceof Error?e.message:'文件暂时无法预览');}})();
    return()=>{active=false;abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[url,title]);
  return <dialog ref={modal} aria-label="文件预览" onCancel={e=>{e.preventDefault();close();}} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-hidden bg-white p-0 text-stone-900 backdrop:bg-black/40">
    <div className="flex h-full min-h-0 flex-col gap-2 px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-[max(.75rem,env(safe-area-inset-bottom))]">
      <header className="flex shrink-0 items-center gap-2"><h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>{file?<a className={control} href={file.url} download={file.name}>下载</a>:null}<button type="button" className={control} onClick={close} autoFocus>关闭</button></header>
      {error?<p role="alert" className="m-auto text-sm text-red-700">{error}</p>:!file?<p role="status" className="m-auto text-sm text-stone-500">正在安全读取文件…</p>:file.blob.type==='application/pdf'?<Suspense fallback={<p role="status" className="m-auto">正在加载 PDF 阅读器…</p>}><PdfPreview blob={file.blob}/></Suspense>:<>
        <div className="flex shrink-0 justify-center gap-2"><button type="button" className={control} disabled={zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.25))}>缩小</button><button type="button" className={control} disabled={zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.25))}>放大</button></div>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-stone-100"><img src={file.url} alt={title} className="mx-auto block h-auto" style={{width:(zoom*100)+'%',maxWidth:zoom===1?'100%':'none'}}/></div>
      </>}
    </div>
  </dialog>;
}
