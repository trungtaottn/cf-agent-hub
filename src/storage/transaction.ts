export type SqlValue=string|number|null|ArrayBuffer;
export interface WorkspaceTransaction {
 all<T>(sql:string,bindings?:readonly SqlValue[]):readonly T[];
 one<T>(sql:string,bindings?:readonly SqlValue[]):T|null;
 exec(sql:string,bindings?:readonly SqlValue[]):void;
}
/** SQL-only synchronous scope. Escaped references become unusable on return or throw. */
export function withTransaction<T>(storage:DurableObjectStorage,body:(tx:WorkspaceTransaction)=>T):T {
 return storage.transactionSync(()=>{
  let active=true;
  const assertActive=()=>{if(!active)throw Error('TRANSACTION_CLOSED');};
  const tx:WorkspaceTransaction={
   all:<R>(sql:string,bindings:readonly SqlValue[]=[])=>{assertActive();return storage.sql.exec(sql,...bindings).toArray() as R[];},
   one:<R>(sql:string,bindings:readonly SqlValue[]=[])=>{assertActive();const rows=storage.sql.exec(sql,...bindings).toArray();return (rows[0]??null) as R|null;},
   exec:(sql,bindings=[])=>{assertActive();storage.sql.exec(sql,...bindings);}
  };
  try {
   const result=body(tx);
   if(result!==null&&(typeof result==='object'||typeof result==='function')&&typeof (result as {then?:unknown}).then==='function')throw Error('ASYNC_TRANSACTION');
   return result;
  } finally {active=false;}
 });
}
