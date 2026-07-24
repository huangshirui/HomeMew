import { readFileSync } from "node:fs";
import { parse } from "yaml";

const document=parse(readFileSync(new URL("../openapi.yaml",import.meta.url),"utf8"));
if(document.openapi!=="3.1.0")throw new Error("OpenAPI version must be 3.1.0");
const refs=[];
const visit=(value)=>{if(!value||typeof value!=="object")return;for(const [key,child] of Object.entries(value)){if(key==="$ref"&&typeof child==="string")refs.push(child);else visit(child);}};
visit(document);
for(const ref of refs){
  if(!ref.startsWith("#/"))continue;
  const found=ref.slice(2).split("/").reduce((value,key)=>value?.[key.replaceAll("~1","/").replaceAll("~0","~")],document);
  if(found===undefined)throw new Error(`Unresolved OpenAPI reference: ${ref}`);
}
for(const [path,operations] of Object.entries(document.paths)){
  for(const [method,operation] of Object.entries(operations)){
    if(["parameters","summary","description"].includes(method))continue;
    if(!operation["x-homemew-status"])throw new Error(`${method.toUpperCase()} ${path} is missing x-homemew-status`);
  }
}
console.log(`OpenAPI valid: ${Object.keys(document.paths).length} paths, ${refs.length} references`);
