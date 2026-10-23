export { WorkspaceDO } from './workspace/workspace-do';
export default {
 async fetch(request:Request):Promise<Response> {
  if(request.method==='GET'&&new URL(request.url).pathname==='/health/live')return new Response('alive',{headers:{'content-type':'text/plain','cache-control':'no-store'}});
  return Response.json({error:{code:'NOT_FOUND',message:'Route unavailable',retryable:false},request_id:crypto.randomUUID()},{status:404});
 }
};
