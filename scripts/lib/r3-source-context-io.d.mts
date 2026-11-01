export function loadJ1ContextRunInput(path:unknown,repositoryRoot:string):{output_root:string;binding:{run_id:string;nonce_sha256:string;source_context_sha256:string};context:{environment:Record<string,string>}};
export function writeJ1ContextStaged(outputRoot:string,binding:unknown,candidate:unknown):unknown;
export function readJ1ContextStaged(outputRoot:string,binding:unknown):any;
export function sealJ1ContextExecution(outputRoot:string,binding:unknown,actualCompletion:unknown,sourceContextBytes:unknown):any;
