/** Isolated test-server fault injection only; never imported by a product entrypoint. */
export class CompositionFixtureProbe {
 #artifact:'stage'|'upload'|'commit'|null=null;#artifactReceipts:{artifactId:string;phase:'stage'|'upload'|'commit';status:number}[]=[];
 armArtifact(phase:'stage'|'upload'|'commit'){this.#artifact=phase;}
 get artifactReceipts(){return this.#artifactReceipts.map(x=>({...x}));}
 #armed=false;#preparation=false;#receipts:{messageId:string;status:201}[]=[];
 armPreparation(){this.#preparation=true;}
 arm(){this.#armed=true;}
 resume(){this.#armed=false;this.#preparation=false;}
 reset(){this.#artifact=null;this.#artifactReceipts=[];this.#armed=false;this.#preparation=false;this.#receipts=[];}
 get receipts(){return this.#receipts.map(r=>({...r}));}
 async observe(request:Request,response:Response):Promise<Response>{
  const url=new URL(request.url);
  const artifactPhase=request.method==='POST'&&url.pathname==='/v2/workspaces/ws_example/artifacts'?'stage':request.method==='PUT'&&/^\/v2\/workspaces\/ws_example\/artifacts\/[A-Za-z0-9_-]+\/content$/.test(url.pathname)?'upload':request.method==='POST'&&/^\/v2\/workspaces\/ws_example\/artifacts\/[A-Za-z0-9_-]+:commit$/.test(url.pathname)?'commit':null;
  if(this.#artifact&&artifactPhase===this.#artifact&&url.origin==='https://hub.fixture.example.invalid'&&!url.search&&response.status===(artifactPhase==='stage'?201:200)){
   const body=await response.json() as {data?:{id?:unknown;workspace_id?:unknown;status?:unknown}};
   if(!body.data||typeof body.data.id!=='string'||!/^artifact_[A-Za-z0-9_-]+$/.test(body.data.id)||body.data.workspace_id!=='ws_example'||body.data.status!==({stage:'staged',upload:'uploaded',commit:'committed'}[artifactPhase])||this.#artifactReceipts.length>=32)throw Error('FIXTURE_ARTIFACT_RECEIPT_INVALID');
   this.#artifactReceipts.push({artifactId:body.data.id,phase:artifactPhase,status:response.status});this.#artifact=null;throw Error('FIXTURE_DROP_ARTIFACT_RESPONSE');
  }
  if(this.#preparation&&request.method==='POST'&&url.origin==='https://hub.fixture.example.invalid'&&url.pathname==='/v2/workspaces/ws_example/messages:prepare'&&!url.search&&response.status===200){await response.arrayBuffer();throw Error('FIXTURE_DROP_PREPARATION_RESPONSE');}
  if(!this.#armed||request.method!=='POST'||url.origin!=='https://hub.fixture.example.invalid'||url.pathname!=='/v2/workspaces/ws_example/messages'||url.search||response.status!==201)return response;
  // Await the actual authoritative route response, not a pre-dispatch abort or fabricated receipt.
  const body=await response.json() as {data?:{id?:unknown;workspace_id?:unknown}};
  if(!body.data||typeof body.data.id!=='string'||!/^message_[A-Za-z0-9_-]+$/.test(body.data.id)||body.data.workspace_id!=='ws_example'||this.#receipts.length>=32)throw Error('FIXTURE_COMPOSITION_RECEIPT_INVALID');
  this.#receipts.push({messageId:body.data.id,status:201});
  throw Error('FIXTURE_DROP_COMMITTED_COMPOSITION_RESPONSE');
 }
}
