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
for(const path of [
  "/api/v1/families/{familyId}/day-records",
  "/api/v1/families/{familyId}/day-records/{dayRecordId}",
  "/api/v1/families/{familyId}/day-records/{dayRecordId}/occurrences",
  "/api/v1/families/{familyId}/day-records/{dayRecordId}/archive",
  "/api/v1/families/{familyId}/day-records/{dayRecordId}/restore",
])if(!document.paths[path])throw new Error(`Missing day record path: ${path}`);
if(schemas.DayRecord?.oneOf?.length!==3)throw new Error("DayRecord must be an elapsed/countdown/cycle oneOf");
if(schemas.CreateDayRecordRequest?.oneOf?.length!==3)throw new Error("CreateDayRecordRequest must be an elapsed/countdown/cycle oneOf");
for(const permission of ["day-records:read","day-records:write"]){
  if(!schemas.SystemPermission.enum.includes(permission))throw new Error(`Missing system permission: ${permission}`);
}

const creationDraftPath="/api/v1/families/{familyId}/creation-drafts/interpret";
const creationDraftOperation=document.paths[creationDraftPath]?.post;
if(creationDraftOperation?.["x-homemew-status"]!=="implemented")throw new Error("Creation draft interpretation must be implemented");
if(creationDraftOperation?.responses?.["404"]?.$ref!=="#/components/responses/CreationDraftNotFound")throw new Error("Creation draft interpretation must document its 404 response");
const creationDraftNotFoundCodes=schemas.CreationDraftNotFoundError?.properties?.error?.allOf?.[1]?.properties?.code?.enum;
if(JSON.stringify(creationDraftNotFoundCodes)!==JSON.stringify(["USER_NOT_FOUND","FAMILY_NOT_FOUND"]))throw new Error("Creation draft 404 codes must match runtime");
const creationDraftRequest=schemas.InterpretCreationDraftRequest;
if(creationDraftRequest?.additionalProperties!==false||creationDraftRequest?.properties?.text?.pattern!=="\\S"||creationDraftRequest?.properties?.text?.maxLength!==undefined)throw new Error("Creation draft request must be closed and document validation after trimming text");
const chooseKind=schemas.ChooseCreationKindDraft;
if(chooseKind?.additionalProperties!==false||chooseKind?.properties?.status?.const!=="choose_kind"||chooseKind?.properties?.candidateKinds?.minItems!==2||chooseKind?.properties?.candidateKinds?.uniqueItems!==true)throw new Error("Creation draft choose_kind shape is invalid");
if(schemas.CreationDraftResult?.oneOf?.length!==5)throw new Error("CreationDraftResult must contain choose_kind plus four ready variants");
if(schemas.EventFormDraft?.properties?.summary?.maxLength!==100||schemas.TaskFormDraft?.properties?.name?.maxLength!==100)throw new Error("AI event/task draft titles must be capped at 100 characters");
if(schemas.CreateEventCommon?.properties?.summary?.maxLength!==200||schemas.CreateTaskRequest?.properties?.name?.maxLength!==200)throw new Error("Existing event/task create title limits must remain unchanged");

console.log(`OpenAPI valid: ${Object.keys(document.paths).length} paths, ${refs.length} references`);
