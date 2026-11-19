import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,type PDFDocumentProxy,type PDFDocumentLoadingTask,type RenderTask} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc=workerUrl;
const assets=import.meta.env.BASE_URL+'pdf-assets/';
const control='rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
export default function PdfPreview({blob}:{blob:Blob}){
  const canvas=useRef<HTMLCanvasElement>(null),container=useRef<HTMLDivElement>(null);
  const [doc,setDoc]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;let task:PDFDocumentLoadingTask|undefined;
    setDoc(null);setPage(1);setZoom(1);setBusy(true);setError('');
    void (async()=>{try{const data=new Uint8Array(await blob.arrayBuffer());if(!active)return;
      task=getDocument({data,isEvalSupported:false,enableXfa:false,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/',iccUrl:assets+'iccs/'});
      const loaded=await task.promise;if(active)setDoc(loaded);
    }catch{if(active){setError('此 PDF 无法预览，请下载原文件查看。');setBusy(false);}}})();
    return()=>{active=false;void task?.destroy().catch(()=>{});};
  },[blob]);
  useEffect(()=>{
    if(!doc)return;
    let active=true;let task:RenderTask|undefined;
    setBusy(true);setError('');
    void (async()=>{try{const p=await doc.getPage(page);if(!active||!canvas.current)return;
      const natural=p.getViewport({scale:1});const width=Math.min(container.current?.clientWidth||700,1000)*zoom;
      const scale=Math.min(width/natural.width,Math.sqrt(6_000_000/(natural.width*natural.height)));
      const viewport=p.getViewport({scale});const target=canvas.current;
      target.width=Math.max(1,Math.floor(viewport.width));target.height=Math.max(1,Math.floor(viewport.height));
      const ctx=target.getContext('2d');if(!ctx)throw Error('canvas unavailable');
      task=p.render({canvas:target,canvasContext:ctx,viewport});await task.promise;if(active)p.cleanup();
    }catch{if(active)setError('此 PDF 无法预览，请下载原文件查看。');}
    finally{if(active)setBusy(false);}})();
    return()=>{active=false;task?.cancel();};
  },[doc,page,zoom]);
  return <>
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
      <button type="button" className={control} disabled={busy||page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span className="text-sm">{doc?page+' / '+doc.numPages:'—'}</span><button type="button" className={control} disabled={busy||!doc||page>=doc.numPages} onClick={()=>setPage(p=>p+1)}>下一页</button>
      <button type="button" className={control} disabled={busy||zoom<=1} onClick={()=>setZoom(z=>Math.max(1,z-.25))}>−</button><button type="button" className={control} disabled={busy||zoom>=3} onClick={()=>setZoom(z=>Math.min(3,z+.25))}>＋</button>
    </div>
    {busy?<p role="status" className="text-center text-sm">正在渲染 PDF…</p>:null}{error?<p role="alert" className="text-center text-sm text-red-700">{error}</p>:null}
    <div ref={container} className="min-h-0 flex-1 overflow-auto rounded-lg bg-stone-100"><canvas ref={canvas} hidden={busy||!!error} aria-label="PDF 当前页" className="mx-auto block bg-white"/></div>
  </>;
}
