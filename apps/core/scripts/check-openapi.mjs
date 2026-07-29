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

const eventListParameters=document.paths["/api/v1/families/{familyId}/events"].get.parameters;
const eventParameter=(name)=>eventListParameters.find((parameter)=>parameter.name===name);
for(const name of ["startDate","endDateExclusive"]){
  if(!eventParameter(name)?.required)throw new Error(`${name} must be a required event-list parameter`);
}
if(eventParameter("start")||eventParameter("end"))throw new Error("Legacy event-list range parameters are forbidden");

const schemas=document.components.schemas;
if(schemas.Event.oneOf?.length!==2)throw new Error("Event must be a timed/all-day oneOf");
if(schemas.CreateEventRequest.oneOf?.length!==2)throw new Error("CreateEventRequest must be a timed/all-day oneOf");
if(schemas.UpdateEventRequest.oneOf?.length!==3)throw new Error("UpdateEventRequest must separate common, timed, and all-day patches");
if(schemas.TimedEvent.unevaluatedProperties!==false||schemas.AllDayEvent.unevaluatedProperties!==false)throw new Error("Event response variants must reject fields from the other time shape");
if(schemas.UtcDateTime.pattern!=="Z$")throw new Error("UtcDateTime must require a Z suffix");
const rawDateTimes=[];
const findRawDateTimes=(value,path=[])=>{
  if(!value||typeof value!=="object")return;
  if(value.format==="date-time"&&value!==schemas.UtcDateTime)rawDateTimes.push(path.join("."));
  for(const [key,child] of Object.entries(value))findRawDateTimes(child,[...path,key]);
};
findRawDateTimes(document);
if(rawDateTimes.length)throw new Error(`All date-time schemas must use UtcDateTime: ${rawDateTimes.join(", ")}`);
if(!schemas.Task.required.includes("dueDate")||schemas.Task.properties.due)throw new Error("Task must expose dueDate and not due");

console.log(`OpenAPI valid: ${Object.keys(document.paths).length} paths, ${refs.length} references`);
