/** Private deployment capability types. These are not product recovery commands. */
export interface Identity {workspace_id:string;environment_id:string;object_name:string;}
export interface Tuple {authority_epoch:number;ledger_sha256:string;generation:number;}
export type Anchor=Identity&Tuple;
export type Capability='bootstrap'|'rotation';
export interface Publication extends Identity {operation_id:string;expected:Tuple|null;next:{authority_epoch:number;ledger_sha256:string};}
export interface Receipt {operation_id:string;capability:Capability;anchor:Anchor;}
export interface AnchorStorage {
 sql:{exec(query:string,...bindings:(string|number|null)[]):{toArray():Record<string,unknown>[]}};
 transactionSync<T>(callback:()=>T):T;
}
