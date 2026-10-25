export interface ReadinessInput {origin:string;environment_id:string;workspace_id:string;expected_actor_id:string;expected_config_epoch:number;expected_schema_version:number;credential_fd:string;}
export function parseReadinessConfig(input:unknown):ReadinessInput;
export function readinessCredentials(input:unknown):{session_cookie:string;access_client_id?:string;access_client_secret?:string};
export function verifyReadiness(input:unknown,credentials:unknown,transport?:(url:URL,credentials:Record<string,string>)=>Promise<{status:number;value:unknown}>,clock?:()=>number):Promise<{assurance:string;environment_id:string;workspace_id:string;actor_id:string;config_epoch:number;schema_version:number;ready:boolean;observed_at:string;request_ids:string[]}>;
export function runCli(argv?:string[]):Promise<number>;
