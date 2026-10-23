export type SqlValue=string|number|null|ArrayBuffer;
export interface WorkspaceTransaction {
 all<T>(sql:string,bindings?:readonly SqlValue[]):readonly T[];
 one<T>(sql:string,bindings?:readonly SqlValue[]):T|null;
 exec(sql:string,bindings?:readonly SqlValue[]):void;
}
export function withTransaction<T>(storage:DurableObjectStorage,body:(tx:WorkspaceTransaction)=>T):T {
 return storage.transactionSync(()=>{
 const tx:WorkspaceTransaction={
  all:<R>(sql:string,bindings:readonly SqlValue[]=[])=>storage.sql.exec(sql,...bindings).toArray() as R[],
  one:<R>(sql:string,bindings:readonly SqlValue[]=[])=>{const rows=storage.sql.exec(sql,...bindings).toArray();return (rows[0]??null) as R|null;},
  exec:(sql,bindings=[])=>{storage.sql.exec(sql,...bindings);}
 };
 const result=body(tx);
 if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function')throw Error('ASYNC_TRANSACTION');
 return result;
 });
}
