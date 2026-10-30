import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const read=(path:string)=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url),'utf8'));
const api=read('spec/openapi.json');
const schemas=api.components.schemas;
const fixtures=()=>read('examples/http/r2-catalog-contracts.json');
const namedRecord='#/components/schemas/WorkspaceProfile/$defs/named_record';
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const validators=new Map<string,ReturnType<typeof ajv.compile>>();
function valid(name:string,value:unknown){
 let validate=validators.get(name);
 if(!validate){validate=ajv.compile({components:api.components,$ref:'#/components/schemas/'+name});validators.set(name,validate);}
 return validate(value);
}
const preview=()=>({expected_profile_revision:1,kind:'project',id:'project_a',operation:'archive',replacement_id:null,reason:'Retire unused project'});
const plan=()=>({id:'catalog_plan_a',profile_revision:1,expires_at:'2026-10-26T15:15:00Z',changes:[{kind:'project',id:'project_a',operation:'archive',before:{id:'project_a',display_name:'Project A',description:'Example',archived:false},after:{id:'project_a',display_name:'Project A',description:'Example',archived:true}}],affected_task_ids:[] as string[],affected_agent_ids:[] as string[],conflicts:[]});
const apply=()=>({preview_id:'catalog_plan_a',expected_profile_revision:1});

describe('R2 catalog design contracts (not runtime endpoint evidence)',()=>{
 for(const [name,factory]of Object.entries({CatalogPreviewRequest:preview,CatalogApplyRequest:apply,CatalogPlan:plan})){
  it(`accepts closed ${name}`,()=>expect(valid(name,factory())).toBe(true));
  it(`rejects unknown ${name} field`,()=>expect(valid(name,{...factory(),unreviewed:true})).toBe(false));
  for(const field of Object.keys(factory()))it(`requires ${name}.${field}`,()=>{const value:Record<string,unknown>=factory();delete value[field];expect(valid(name,value)).toBe(false);});
 }
 for(const revision of [0,-1,1.5,'1',null])for(const name of ['CatalogPreviewRequest','CatalogApplyRequest'])
  it(`rejects ${name} revision ${JSON.stringify(revision)}`,()=>expect(valid(name,{...(name==='CatalogPreviewRequest'?preview():apply()),expected_profile_revision:revision})).toBe(false));
 it('requires positive safe-integer plan revision',()=>{for(const revision of [0,1.5,Number.MAX_SAFE_INTEGER+1])expect(valid('CatalogPlan',{...plan(),profile_revision:revision})).toBe(false);});
 it('rejects unsupported catalog kind or operation',()=>{for(const change of [{kind:'agent'},{operation:'delete'}])expect(valid('CatalogPreviewRequest',{...preview(),...change})).toBe(false);});
 it('binds archive to null and remap to a replacement identifier',()=>{
  expect(valid('CatalogPreviewRequest',{...preview(),replacement_id:'project_b'})).toBe(false);
  expect(valid('CatalogPreviewRequest',{...preview(),operation:'remap'})).toBe(false);
  expect(valid('CatalogPreviewRequest',{...preview(),kind:'work_role',operation:'remap',replacement_id:'role_b'})).toBe(true);
 });
 it('rejects empty IDs and reason',()=>{for(const field of ['id','reason'])expect(valid('CatalogPreviewRequest',{...preview(),[field]:''})).toBe(false);expect(valid('CatalogApplyRequest',{...apply(),preview_id:''})).toBe(false);});
 it('references nullable canonical named records without adding fields',()=>{
  const change=schemas.CatalogPlan.properties.changes.items;
  for(const key of ['before','after'])expect(change.properties[key]).toEqual({anyOf:[{$ref:namedRecord},{type:'null'}]});
  const value=plan();expect(valid('CatalogPlan',{...value,changes:[{...value.changes[0],before:null,after:null}]})).toBe(true);
  for(const patch of [{extra:true},{before:{id:'project_a',archived:true}},{after:{...value.changes[0].after,version:2}}])expect(valid('CatalogPlan',{...value,changes:[{...value.changes[0],...patch}]})).toBe(false);
 });
 for(const field of ['affected_task_ids','affected_agent_ids'])it(`bounds ${field} at 200 and rejects duplicate IDs`,()=>{
  const ids=Array.from({length:201},(_,i)=>'entity_'+i);
  expect(valid('CatalogPlan',{...plan(),[field]:ids.slice(0,200)})).toBe(true);
  expect(valid('CatalogPlan',{...plan(),[field]:ids})).toBe(false);
  expect(valid('CatalogPlan',{...plan(),[field]:['entity_a','entity_a']})).toBe(false);
 });
 it('declares the combined 200 bound and trusted 15-minute expiry without claiming runtime enforcement',()=>{
  expect(schemas.CatalogPlan['x-max-affected-entities']).toBe(200);
  expect(schemas.CatalogPlan['x-plan-ttl-seconds']).toBe(900);
  expect(schemas.CatalogPlan.description).toContain('combined');
  expect(schemas.CatalogPlan.description).toContain('internally');
  expect(valid('CatalogPlan',{...plan(),expires_at:'not-a-time'})).toBe(false);
  expect(schemas.CatalogPlan.properties).not.toHaveProperty('created_at');
  expect(schemas.CatalogPlan.properties).not.toHaveProperty('touched_versions');
 });
 it('closes conflicts and changes',()=>{
  const conflict={resource_kind:'task',resource_id:'task_a',code:'VERSION_CONFLICT'};
  expect(valid('CatalogPlan',{...plan(),conflicts:[conflict]})).toBe(true);
  for(const value of [{...conflict,extra:true},{...conflict,resource_kind:'workspace'},{...conflict,code:''}])expect(valid('CatalogPlan',{...plan(),conflicts:[value]})).toBe(false);
 });
 for(const [action,id,request,response]of [['preview','previewCatalogChange','CatalogPreviewRequest','CatalogPlanResponse'],['apply','applyCatalogChange','CatalogApplyRequest','ProfileDataResponse']])it(`binds human-only ${action} route to current authority and exact DTOs`,()=>{
  const operation=api.paths['/v2/workspaces/{workspace_id}/catalog:'+action]?.post;
  expect(operation).toBeDefined();expect(operation.operationId).toBe(id);
  expect(operation.security).toEqual([{HumanSession:[]}]);expect(operation['x-actor-kind']).toBe('human');
  expect(operation['x-required-scopes']).toEqual(['profile:edit']);expect(operation['x-r1-available']).toBe(false);
  expect(operation['x-conditional-scopes']).toEqual({task_remap:['tasks:edit'],agent_roles:['agents:manage']});
  expect(operation.parameters).toEqual([{$ref:'#/components/parameters/IdempotencyKey'},{...api.components.parameters.CsrfToken,required:true}]);
  expect(operation.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/'+request);
  expect(operation.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/'+response);
  expect(operation.responses).toHaveProperty('409');
 });
 it('validates every catalog fixture entry through its canonical schema',()=>{
  const collection=fixtures();expect(collection.contract_revision).toBe('0.1');expect(collection.fixtures.length).toBeGreaterThanOrEqual(4);
  for(const entry of collection.fixtures)expect(valid(entry.schema.split('/').at(-1),entry.value),entry.name).toBe(true);
 });
 it('preserves profile transport and Workspace while adding only reviewed duplicate-name advisory',()=>{
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const profile=structuredClone(schemas.ProfilePreview);
  expect(profile.properties.conflicts.items.properties.code.enum).toEqual(['REFERENCED_ARCHIVE','REFERENCED_REMAP','DUPLICATE_NAME']);
  expect(profile.description).toContain('DUPLICATE_NAME is advisory');
  profile.properties.conflicts.items.properties.code.enum.pop();
  profile.description='field is a JSON Pointer into canonical merged profile. Arrays <=200; entire UTF-8 response envelope <=65536 bytes. Reject overflow, never truncate. Stale revision409; malformed shapes/duplicates use normal validation errors.';
  expect(digest(profile)).toBe('f210028142756dcb4b15aad3f14dfcdb0c38ff1170880254fce0dc3ed2977a98');
  for(const [name,hash]of Object.entries({Workspace:'126799170b9252c40c25b616e48289df3ae1e621daa13014c820cbdec75be1a0',ProfileWriteRequest:'4408816804c224c9cbf146f422402fe611de0c1fe177cbae8f6e5af824614571'}))expect(digest(schemas[name])).toBe(hash);
  expect(digest(api.paths['/v2/workspaces/{workspace_id}/profile'])).toBe('687d9772cdfd9f50f97ec52e1527a3560dc34f6947ccd3675357c3e4321acd2c');
  expect(digest(api.paths['/v2/workspaces/{workspace_id}/profile:preview'])).toBe('de11913a5143d64cdc8e91461daf46a5bdeee94eed176cdeb0aff246ddc1456f');
  expect(api.paths).not.toHaveProperty('/v2/workspaces/{workspace_id}/profile:apply');
 });
});
