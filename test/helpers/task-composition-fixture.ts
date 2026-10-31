/** Isolated test-server response-loss probe; never imported by production code. */
export class TaskCompositionFixtureProbe {
 #armed=false;#receipts:{taskId:string;status:201}[]=[];
 arm(){this.#armed=true;}resume(){this.#armed=false;}reset(){this.#armed=false;this.#receipts=[];}
 get receipts(){return this.#receipts.map(r=>({...r}));}
 async observe(request:Request,response:Response):Promise<Response>{
  const url=new URL(request.url);
  if(!this.#armed||request.method!=='POST'||url.origin!=='https://hub.fixture.example.invalid'||url.pathname!=='/v2/workspaces/ws_example/tasks'||url.search||response.status!==201)return response;
  const body=await response.json() as {data?:{id?:unknown;workspace_id?:unknown}};
  if(!body.data||typeof body.data.id!=='string'||!/^task_[A-Za-z0-9_-]+$/.test(body.data.id)||body.data.workspace_id!=='ws_example'||this.#receipts.length>=32)throw Error('FIXTURE_TASK_RECEIPT_INVALID');
  this.#receipts.push({taskId:body.data.id,status:201});throw Error('FIXTURE_DROP_COMMITTED_TASK_RESPONSE');
 }
}
