import {DraftStore,IndexedComposeDatabase,type ComposeDatabase,type DraftScope} from './draft-store';
type OwnedDatabase=ComposeDatabase&{close():Promise<void>};
/** Host-owned lifetime only. Draft/intent semantics remain exclusively in DraftStore/SubmitController. */
export class CompositionStorage {
 #database:OwnedDatabase|null=null;#store:DraftStore|null=null;#erase:Promise<void>|null=null;#dispose:Promise<void>|null=null;#failed=false;#disposed=false;
 constructor(private readonly create:()=>OwnedDatabase=()=>new IndexedComposeDatabase(),private readonly invalidate:()=>void=()=>{},private readonly changed:()=>void=()=>{}){}
 get blocked(){return this.#disposed||this.#failed||this.#erase!==null;}get failed(){return this.#failed;}get erasing(){return this.#erase!==null;}
 private connect(){if(!this.#store){this.#database=this.create();this.#store=new DraftStore(this.#database);}return this.#store;}
 get store(){if(this.blocked)throw Error('COMPOSITION_STORAGE_UNAVAILABLE');return this.connect();}
 erase(scope:DraftScope):Promise<void>{if(this.#erase)return this.#erase;if(this.#disposed)return Promise.resolve();const captured={...scope};this.invalidate();
  const pending=(async()=>{try{const store=this.connect();await store.clearScope(await store.bind(captured));this.#failed=false;}catch{this.#failed=true;}})();
  this.#erase=pending.finally(()=>{this.#erase=null;this.changed();});this.changed();return this.#erase;
 }
 dispose():Promise<void>{if(this.#dispose)return this.#dispose;this.#disposed=true;this.invalidate();this.#dispose=(async()=>{await this.#erase;try{await this.#database?.close();}catch{this.#failed=true;}this.changed();})();return this.#dispose;}
}
