import {it,expectTypeOf} from 'vitest';
import type {NativeClient,RequestFor,ResponseFor,ApiResult,ArtifactDownloadResult} from '../../packages/client/src/types';
import type {TaskCreateRequest,Task,TaskResult,MessageCreateRequest,Runtime,RuntimeIssue} from '../../src/http/dto';
it('keeps generated request-response correspondence and explicit safe enrollment typing',()=>{
 expectTypeOf<RequestFor<'createTask'>>().toEqualTypeOf<{body:TaskCreateRequest}>();
 expectTypeOf<RequestFor<'createMessage'>>().toEqualTypeOf<{body:MessageCreateRequest}>();
 expectTypeOf<RequestFor<'getTask'>>().toEqualTypeOf<{path:{task_id:string}}>();
 expectTypeOf<ResponseFor<'getTask'>>().toEqualTypeOf<ApiResult<Task>>();
 expectTypeOf<ResponseFor<'listTaskResults'>>().toEqualTypeOf<ApiResult<TaskResult[]>>();
 expectTypeOf<ResponseFor<'createRuntime'>>().toEqualTypeOf<ApiResult<RuntimeIssue>>();
 expectTypeOf<ResponseFor<'downloadArtifactContent'>>().toEqualTypeOf<ArtifactDownloadResult>();
 expectTypeOf<ReturnType<NativeClient['enrollRuntime']>>().toEqualTypeOf<Promise<ApiResult<Runtime>>>();
});
function compileOnly(client:NativeClient){
 // @ts-expect-error R3 operations are not enabled source operations.
 void client.call('approveApproval',{});
 // @ts-expect-error Wrong path key cannot bind a task operation.
 void client.call('getTask',{path:{agent_id:'agent'}});
 // @ts-expect-error Required task body is absent.
 void client.call('createTask',{});
 // @ts-expect-error Canonical DTO stays snake_case.
 void client.call('patchTask',{path:{task_id:'task'},body:{expectedVersion:1}});
 // @ts-expect-error Explicit enrollment requires protected capture.
 void client.enrollRuntime({body:{label:'runtime'}},{idempotencyKey:'key'});
}
void compileOnly;
