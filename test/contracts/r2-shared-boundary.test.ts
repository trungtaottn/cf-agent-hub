import {it,expect} from 'vitest';
import * as validators from '../../src/http/generated/auth-validators.js';
import {parseBoundedJson} from '../../src/http/bounds';
import type {HttpSchemaName} from '../../src/http/generated/http-schemas';
import {createCursorCodec,type CursorPayload} from '../../src/http/cursors';
const validate=validators as unknown as Record<string,(value:unknown)=>boolean>;
it('canonical_r2_amendment_validators_are_generated_not_placeholder_aliases',()=>{
 for(const name of ['Task','Run','Artifact','Agent','Credential','CredentialIssue','Runtime','RuntimeIssue','SearchHit','TaskCommandResult','TaskResultListResponse','CatalogPlan','CatalogPreviewRequest','CatalogApplyRequest','ImportEnvelope','ImportRow','ImportBatch','ImportPreview','ImportApplyRequest','ImportReport','Import'])expect(validate['validate'+name],name).toBeTypeOf('function');
});
it('closed_r2_requests_and_import_envelope_preserve_row_rejection',async()=>{
 const request=(body:unknown)=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 await expect(parseBoundedJson(request({title:'Task',description:'',actor:'forged'}),'TaskCreateRequest' as HttpSchemaName)).rejects.toMatchObject({status:400});
 await expect(parseBoundedJson(request({title:'Task',description:''}),'TaskCreateRequest' as HttpSchemaName)).resolves.toEqual({title:'Task',description:''});
 const envelope={source_namespace:'source',source_revision:'v1',rows:[null,42,{unexpected:true}]};
 await expect(parseBoundedJson(request(envelope),'ImportEnvelope' as HttpSchemaName)).resolves.toEqual(envelope);
 expect(validate.validateImportBatch(envelope)).toBe(false);
 expect(validate.validateImportRow(envelope.rows[2])).toBe(false);
});
it('existing_canonical_utf8_byte_limits_survive_generator_expansion',async()=>{
 const request=(body:string)=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body,recipient_agent_ids:['agent_a'],refs:[],artifact_ids:[]})});
 await expect(parseBoundedJson(request('😀'.repeat(8192)),'MessageCreateRequest')).resolves.toHaveProperty('body');
 await expect(parseBoundedJson(request('😀'.repeat(8192)+'a'),'MessageCreateRequest')).rejects.toMatchObject({status:413});
});
it.each(['unknown','search','task-results','__proto__','constructor'])('unknown_unimplemented_or_wrong_shape_cursor_operation_denied_%s',async operation=>{
 const codec=createCursorCodec('a'.repeat(64),{bytes:n=>crypto.getRandomValues(new Uint8Array(n))});
 const payload={version:1,binding:{workspaceId:'ws_a',principalId:'p_a',lane:'agent',credentialId:'c_a',sessionId:null,operation,queryHash:'a'.repeat(64)},highWater:{createdAt:2,id:'a'},lastScanned:{createdAt:1,id:'a'},expiresAt:1000} as CursorPayload;
 await expect(codec.encodeCursor(payload)).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
