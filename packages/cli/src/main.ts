import {mkdirSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {parseCommand} from './commands';
import {resolveContext,requireRemoteContext} from './context';
import {formatResult,localOutput,type CliOutput} from './output';
import {readInputFile} from './input';
import {ProtectedCredentialProvider,isImportCredentialFormat} from './secret-store';
import {Journal} from './journal';
import {DurableMutations} from './durable-mutations';
import {UploadStore} from './upload-store';
import {DurableUploads} from './durable-uploads';
import {sourceSize,trustedDirectory,syncArtifactDirectory,openSealedContent,validateDownloadDestination,downloadArtifactToFile} from './artifact-files';
import {createNativeClient} from '../../client/src/native-client';
import {prepareNativeOperation} from '../../client/src/native-request';
import {clientOperations} from '../../../src/http/generated/client-operations';
import type {Artifact} from '../../../src/http/dto';
export interface CliDependencies {env:Readonly<Record<string,string|undefined>>;fetch:typeof globalThis.fetch;stdinIsTTY?:boolean;stderrIsTTY?:boolean;beforeInteractiveMutation?:(context:Readonly<{origin:string;workspaceId:string}>)=>void|Promise<void>;}
function rejected():never {throw Error('CLI_INPUT_REJECTED');}
function validateStateRoot(root:string,creating:boolean):void {
 for(let p=root;;p=dirname(p)){const git=join(p,'.git');if(existsSync(git)&&(lstatSync(git).isFile()||existsSync(join(git,'HEAD'))))rejected();if(dirname(p)===p)break;}
 if(existsSync(root)){trustedDirectory(root);if(creating&&readdirSync(root).length)rejected();}
 else {if(!creating)rejected();trustedDirectory(dirname(root),false);}
}
/** Explicit CLI control flow. Network attempts and durable writes are tracked so
 * later failures cannot be misreported as pre-network input rejection. */
async function runCliCore(argv:readonly string[],dependencies:CliDependencies,cleanup:{status:CliCleanupStatus}):Promise<CliOutput> {
 let provider:ProtectedCredentialProvider|undefined,mutations:DurableMutations|undefined,store:UploadStore|undefined,journal:Journal|undefined;
 let effect=false,retainedDiagnostic='';
 const finish=(output:CliOutput):CliOutput=>({...output,stderr:retainedDiagnostic+output.stderr});
 const rememberIntent=(intent:{id:string;key:string|null;operation:string;origin:string;workspaceId:string}):void=>{const safe={id:intent.id,key:intent.key,operation:intent.operation,origin:intent.origin,workspaceId:intent.workspaceId};const text=JSON.stringify(safe);provider!.assertNoSecrets(text);retainedDiagnostic='Intent: '+text+'\n';};
 try{
  if(argv.length===1&&argv[0]==='--help')return {exitCode:0,stdout:CLI_HELP,stderr:''};
  const parsed=parseCommand(argv),{options,command}=parsed;
  const remote=parsed.kind==='native'||['intent inspect','intent dispatch','artifacts inspect-upload','artifacts dispatch-upload'].includes(command);
  const context=resolveContext(options,dependencies.env,remote),root=context.stateDirectory;
  const directories={secrets:join(root,'secrets'),journal:join(root,'journal'),uploads:join(root,'uploads')};
  const interactive=dependencies.stdinIsTTY===true&&dependencies.stderrIsTTY===true&&!options.json;
  const keyOptions={...(options.idempotencyKey?{idempotencyKey:options.idempotencyKey}:{}),interactive};
  let input:Record<string,unknown>={...parsed.input};
  if(parsed.kind==='native'){
   if(options.inputFile)input={...input,body:readInputFile(options.inputFile,options.inputSha256)};
   prepareNativeOperation(context.origin!,context.workspaceId!,parsed.operation!,input);
   if(clientOperations[parsed.operation!].idempotency&&!options.idempotencyKey&&!interactive)rejected();
   if(options.idempotencyKey!==undefined&&(options.idempotencyKey.length>256||! /^[\x21-\x7e]+$/.test(options.idempotencyKey)))rejected();
   if(options.output)validateDownloadDestination(options.output);
  }
  validateStateRoot(root,command==='state init');
  const safeLocal=(value:unknown):CliOutput=>{const text=JSON.stringify(value);provider?.assertNoSecrets(text);return {exitCode:0,stdout:'',stderr:'Local: '+text+'\n'};};
  if(command==='state init'){
   effect=true;if(!existsSync(root)){mkdirSync(root,{mode:0o700});syncArtifactDirectory(dirname(root));}
   provider=new ProtectedCredentialProvider({directory:directories.secrets,create:true});journal=new Journal({directory:directories.journal,create:true,authority:()=>false});store=new UploadStore({directory:directories.uploads,create:true});return localOutput('completed');
  }
  provider=new ProtectedCredentialProvider({directory:directories.secrets});
  if(command==='credential import'){const token=dependencies.env.CF_AGENT_HUB_TOKEN;if(!isImportCredentialFormat(token))rejected();effect=true;provider.importCredential(token);return localOutput('completed');}
  const present=(result:Parameters<typeof formatResult>[0],enrollment=false)=>finish(formatResult(result,{enrollment,assertNoSecrets:text=>provider!.assertNoSecrets(text)}));
  const uploads=()=>store??=new UploadStore({directory:directories.uploads});
  if(command==='artifacts retain'){sourceSize(options.file!);effect=true;const content=uploads().retain(options.file!);return safeLocal(uploads().inspectContent(content.id));}
  if(command==='artifacts inspect-content')return safeLocal(uploads().inspectContent(parsed.id!));
  if(command==='state cleanup'){effect=true;const cleanup=uploads().cleanup();let journalDeleted=0;const journalDeferred=cleanup.blocked!==0;if(!journalDeferred){journal=new Journal({directory:directories.journal,authority:()=>false});journalDeleted=await journal.pruneSettled();}return safeLocal({...cleanup,journalDeleted,journalDeferred});}
  const target=requireRemoteContext(options,dependencies.env);
  if(interactive&&(parsed.operation&&clientOperations[parsed.operation].idempotency||command==='intent dispatch'||command==='artifacts dispatch-upload')){
   try{if(!dependencies.beforeInteractiveMutation)throw Error();const display={origin:target.origin,workspaceId:target.workspaceId};provider.assertNoSecrets(JSON.stringify(display));await dependencies.beforeInteractiveMutation(Object.freeze(display));}catch{return localOutput('uncertain');}
  }
  const coordinator=()=>mutations??=new DurableMutations({origin:target.origin,workspaceId:target.workspaceId,provider:provider!,journalDirectory:directories.journal,fetch:dependencies.fetch});
  const rawUploads=()=>new DurableUploads({origin:target.origin,workspaceId:target.workspaceId,provider:provider!,store:uploads(),mutations:coordinator(),fetch:dependencies.fetch});
  if(command==='intent inspect'){const intent=await coordinator().inspect(parsed.id!);if(!intent||intent.origin!==target.origin||intent.workspaceId!==target.workspaceId)rejected();return safeLocal(intent);}
  if(command==='intent dispatch'){effect=true;return present(await coordinator().dispatch(parsed.id!));}
  if(command==='artifacts inspect-upload')return safeLocal(rawUploads().inspect(parsed.id!));
  if(command==='artifacts dispatch-upload'){effect=true;return present(await rawUploads().dispatch(parsed.id!));}
  const operation=parsed.operation!;
  provider.assertNoSecrets(JSON.stringify({input,key:options.idempotencyKey??null}));
  const client=createNativeClient({origin:target.origin,workspaceId:target.workspaceId,credentialProvider:provider,fetch:dependencies.fetch});
  if(operation==='downloadArtifactContent'){
   effect=true;const metadata=await client.call('getArtifact',input as never);if(!metadata.ok)return present(metadata);
   const download=await client.call('downloadArtifactContent',input as never,{artifact:metadata.data});if(!download.ok)return present(download);
   await downloadArtifactToFile(download.data,options.output!);return present(metadata);
  }
  if(operation==='uploadArtifactContent'){
   const ledger=uploads();let contentId=options.contentId;if(options.file){sourceSize(options.file);effect=true;contentId=ledger.retain(options.file).id;}
   const content=ledger.content(contentId!);if(content.state!=='ready'||!content.sealed)rejected();openSealedContent(ledger.spoolDirectory,content.sealed).close();
   effect=true;const metadata=await client.call('getArtifact',input as never);if(!metadata.ok)return present(metadata);
   const upload=rawUploads(),intent=await upload.prepare(contentId!,metadata.data,keyOptions);rememberIntent(intent);return present(await upload.dispatch(intent.id));
  }
  if(!clientOperations[operation].idempotency){effect=true;return present(await client.call(operation,input as never) as Parameters<typeof formatResult>[0]);}
  let hold:{id:string}|undefined;
  if(operation==='stageArtifact'){
   const ledger=uploads(),content=ledger.content(options.contentId!);if(content.state!=='ready'||!content.sealed)rejected();
   const body=input.body as Record<string,unknown>;if(body.byte_size!==content.sealed.size||body.sha256!==content.sealed.sha256)rejected();openSealedContent(ledger.spoolDirectory,content.sealed).close();
   const binding=provider.binding();if(!binding)rejected();effect=true;hold=ledger.createHold(content.id,'stageArtifact',binding);
  }
  if(operation==='commitArtifact'){
   effect=true;const metadata=await client.call('getArtifact',{path:parsed.input.path!} as never);if(!metadata.ok)return present(metadata);
   const binding=provider.binding();if(!binding)rejected();const contentId=uploads().association(metadata.data as Artifact,binding);if(contentId)hold=uploads().createHold(contentId,'commitArtifact',binding,metadata.data);
  }
  effect=true;const durable=coordinator();const intent=operation==='createRuntime'?await durable.prepareEnrollment(input as never,keyOptions):await durable.prepare(operation,input as never,keyOptions);
  rememberIntent(intent);
  if(hold)uploads().bindHold(hold.id,intent.id);
  const result=operation==='createRuntime'?await durable.dispatchEnrollment(intent.id):await durable.dispatch(intent.id);
  if(result.ok&&hold){if(operation==='stageArtifact')await uploads().recordStageReceipt(hold.id,result.data as Artifact,durable,provider);if(operation==='commitArtifact')await uploads().settleCommit(hold.id,result.data as Artifact,durable,provider);}
  return present(result,operation==='createRuntime');
 }catch{return finish(localOutput(effect?'uncertain':'rejected'));}
 finally{for(const resource of [mutations,journal,store,provider])try{resource?.close();}catch{cleanup.status='cleanup-unknown';/* Public settled outcome stays unchanged. */}}
}

export type CliCleanupStatus='closed'|'cleanup-unknown';
/** Internal observation of the SAME invocation, not a retry or resource override.
 * Observes finally-closes of acquired resources only. A constructor that throws
 * before returning can hide partial cleanup; closed does not prove that cleanup.
 */
export async function runCliWithCleanup(argv:readonly string[],dependencies:CliDependencies):Promise<{output:CliOutput;cleanup:CliCleanupStatus}> {
 const cleanup:{status:CliCleanupStatus}={status:'closed'};
 const output=await runCliCore(argv,dependencies,cleanup);
 return {output,cleanup:cleanup.status};
}
/** Preserve historical public output and settled verdict even when cleanup fails. */
export async function runCli(argv:readonly string[],dependencies:CliDependencies):Promise<CliOutput> {
 return (await runCliWithCleanup(argv,dependencies)).output;
}

/** Static exact global help; it does not resolve environment or inspect state. */
export const CLI_HELP=`cf-agent-hub native CLI

Context: --origin HTTPS_ORIGIN --workspace ID --state-dir ABSOLUTE_DIRECTORY
Environment fallback: CF_AGENT_HUB_URL, CF_AGENT_HUB_WORKSPACE (conflicts reject).
Native commands:
 workspace show | configuration | profile
 tasks list | create | show ID | update ID | ready ID | claim ID | submit-result ID | accept-result ID | fail ID | cancel ID | requeue ID | results ID
 runs show ID | heartbeat ID; agents list | show ID; runtime register | heartbeat ID
 messages send | ack; inbox list; threads show ID
 artifacts list | stage | show ID | upload ID | download ID | commit ID
 events list; search --query TEXT
Bodies: --input FILE; optional --input-sha256 LOWERCASE_SHA256 pins the exact file bytes before effects (body commands only). Mutations: --idempotency-key KEY (required unless both TTYs and not --json).
List queries, where supported: --cursor CURSOR --limit INTEGER; tasks --state --project-id; inbox --acknowledged true|false; artifacts --task-id; events --after-sequence (excludes cursor); search --query --kind.
Stage: --content-id ID --input FILE. Upload: exactly --content-id ID or --file FILE. Download: --output NEW_FILE.
Local controls:
 state init | cleanup --state-dir DIR
 credential import --state-dir DIR (explicit CF_AGENT_HUB_TOKEN, fresh slot only)
 artifacts retain --file FILE --state-dir DIR | inspect-content ID --state-dir DIR
 intent inspect ID | dispatch ID (full context)
 artifacts inspect-upload ID | dispatch-upload ID (full context)
--json is accepted; it never enables interactivity. No --all or automatic pagination/retry.
Native results use canonical JSON envelopes. Pure-local results and suppressed-correlation enrollment failures use stderr only. Binary success emits metadata-read envelope only after durable file publication; its request_id is not a binary receipt.
Exit codes: 0 complete; 2 pre-network input/config rejection; 3 auth denial; 4 conflict; 5 uncertain/reconciliation; 6 other nonretryable remote rejection.
Only exact --help is supported; no mixed help flags.
`;
