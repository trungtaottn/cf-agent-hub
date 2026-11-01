export function loadJ1RunInput(path:unknown,repositoryRoot:string):{output_root:string;binding:{run_id:string;nonce_sha256:string;source_context_sha256:string};context:{environment:Record<string,string>}};
export function writeJ1Staged(outputRoot:string,binding:unknown,candidate:unknown):unknown;
