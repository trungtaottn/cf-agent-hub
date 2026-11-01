import {runInvocation,type InvocationContext} from './reporter';
/** Neutral notification boundary: no logs, decisions, context or permission output.
 * Trusted caller creates the shared deadline before context/provider preparation.
 * Executable process-entry budgeting is wired by the separate build entry. */
export async function runHook(context:InvocationContext,input:ReadableStream<Uint8Array>):Promise<0>{
 try{await runInvocation(context,input);}catch{}return 0;
}
