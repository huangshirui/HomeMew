import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('direct attachment viewer preserves the bounded authorized transport and transient lifecycle',()=>{
  const view=source('./src/components/ui/document-preview.tsx');
  for(const value of ["credentials:'same-origin'","cache:'no-store'","redirect:'error'","15*1024*1024","AbortController","URL.revokeObjectURL","download={file.name}","showModal()","close()"])assert.ok(view.includes(value),value);
  assert.doesNotMatch(view,/localStorage|sessionStorage|iframe|https?:\/\//);
});
test('PDF viewer is lazy, uses local CMaps and destroys tasks',()=>{
  const pdf=source('./src/components/ui/pdf-preview.tsx'),prepare=source('./prepare-pdf-assets.mjs'),pkg=JSON.parse(source('./package.json'));
  for(const value of ['pdfjs-dist/legacy/build/pdf.worker.min.mjs?url','isEvalSupported:false','enableXfa:false','cMapUrl:','standardFontDataUrl:','wasmUrl:','iccUrl:','task?.destroy()','task?.cancel()','6_000_000'])assert.ok(pdf.includes(value),value);
  for(const folder of ['cmaps','standard_fonts','wasm','iccs'])assert.ok(prepare.includes(folder));
  assert.equal(pkg.dependencies['pdfjs-dist'],'5.4.624');
  assert.match(pkg.scripts.build,/prepare-pdf-assets/);
});
