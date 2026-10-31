import type {ComposeDatabase,DraftScope,ScopeRecord} from '../../src/ui/compose/draft-store';
/** Deterministic unit transaction oracle, not IndexedDB/browser durability evidence. */
export class MemoryComposeDatabase implements ComposeDatabase {
 #rows=new Map<string,unknown>();#tail:Promise<unknown>=Promise.resolve();failNext=false;
 inject(scope:DraftScope,value:unknown){this.#rows.set(JSON.stringify([scope.workspaceId,scope.principalId]),structuredClone(value));}
 inspect(scope:DraftScope){return structuredClone(this.#rows.get(JSON.stringify([scope.workspaceId,scope.principalId])));}
 transact<T>(scope:DraftScope,change:(stored:unknown)=>{record:ScopeRecord;value:T}):Promise<T>{const key=JSON.stringify([scope.workspaceId,scope.principalId]);const run=this.#tail.then(()=>{const result=change(structuredClone(this.#rows.get(key)));if(this.failNext){this.failNext=false;throw Error('STORAGE_UNAVAILABLE');}this.#rows.set(key,structuredClone(result.record));return structuredClone(result.value);});this.#tail=run.catch(()=>{});return run;}
}
