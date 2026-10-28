import {constants,openSync,closeSync,fsyncSync,lstatSync,fstatSync,mkdirSync,realpathSync,statfsSync,type Stats} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** Linux access-controlled local storage, not encryption or an OS keychain.
 * Same-UID hostile processes, root and hostile filesystems are outside this boundary. */
export interface ProtectedSqliteOptions {directory:string;name:string;create?:boolean;}
const reject=():never=>{throw Error('PROTECTED_STORAGE_REJECTED');};
const missing=(error:unknown)=>typeof error==='object'&&error!==null&&'code'in error&&error.code==='ENOENT';
function optionalStat(path:string):Stats|null{try{return lstatSync(path);}catch(error){if(missing(error))return null;throw error;}}
function same(a:Stats,b:Stats):boolean{return a.ino===b.ino&&a.dev===b.dev;}
function file(stat:Stats):void{if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid!()||(stat.mode&0o777)!==0o600||stat.nlink!==1)reject();}
function directory(stat:Stats):void{if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid!()||(stat.mode&0o777)!==0o700)reject();}
function ancestors(path:string):void{
 for(let cursor=path;;cursor=dirname(cursor)){
  const st=optionalStat(cursor);
  if(st){
   if(!st.isDirectory()||st.isSymbolicLink()||(st.uid!==process.getuid!()&&st.uid!==0))reject();
   // A sticky root-owned temporary parent is acceptable; the private root itself is not shared.
   if((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0))reject();
   const git=optionalStat(join(cursor,'.git'));
   if(git&&(git.isFile()||optionalStat(join(cursor,'.git','HEAD'))))reject();
  }
  if(dirname(cursor)===cursor)break;
 }
}
// Documented local Linux filesystem capabilities: ext-family (shared ext2/3/4
// magic, NOT an ext4-only claim), XFS and overlayfs. Operator-managed persistent
// backing and honest fsync are assumptions. tmpfs/network/FUSE/unknown deny.
// Only overlayfs is measured here; this check is not a power-loss qualification.
const supportedFilesystem=(path:string)=>{if(![0xef53,0x58465342,0x794c7630].includes(statfsSync(path).type))reject();};
const syncDirectory=(path:string)=>{const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);}};
function synchronous<T>(value:T):T{if(value!==null&&(typeof value==='object'||typeof value==='function')&&'then'in value)reject();return value;}

/** Strict create/open, synchronous callback transactions, bounded lock wait.
 * Do not open/close raw database descriptors while SQLite is active: a close can
 * drop another connection's POSIX locks. Runtime validation uses lstat only. */
export class ProtectedSqlite {
 readonly #path:string;readonly #directory:string;readonly #root:Stats;readonly #inode:Stats;
 #db:DatabaseSync;#closed=false;#active=false;
 constructor(options:ProtectedSqliteOptions){
  let db:DatabaseSync|undefined;
  try{
   if(process.platform!=='linux'||typeof process.getuid!=='function'||!options||typeof options.directory!=='string'||!options.directory||!/^[-a-z0-9]+\.sqlite$/.test(options.name)||typeof options.create!=='undefined'&&typeof options.create!=='boolean')reject();
   this.#directory=resolve(options.directory);this.#path=join(this.#directory,options.name);
   ancestors(this.#directory);supportedFilesystem(optionalStat(this.#directory)?this.#directory:dirname(this.#directory));
   if(!optionalStat(this.#directory)){
    if(!options.create)reject();mkdirSync(this.#directory,{mode:0o700});syncDirectory(dirname(this.#directory));
   }
   if(realpathSync(this.#directory)!==this.#directory)reject();
   this.#root=lstatSync(this.#directory);directory(this.#root);this.#validateSidecars();
   if(options.create){
    const fd=openSync(this.#path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    try{file(fstatSync(fd));fsyncSync(fd);}finally{closeSync(fd);}
    syncDirectory(this.#directory);
   }
   this.#inode=lstatSync(this.#path);file(this.#inode);
   if(!options.create&&this.#inode.size===0)reject();
   db=new DatabaseSync(this.#path,{enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false,allowExtension:false});
   this.#db=db;
   db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=EXTRA; PRAGMA trusted_schema=OFF;');
   this.#validate();
   const integrity=db.prepare('PRAGMA quick_check(1)').get();if(integrity?.quick_check!=='ok')reject();
  }catch{try{db?.close();}catch{}throw Error('PROTECTED_STORAGE_REJECTED');}
 }
 #validateSidecars():void{
  if(optionalStat(this.#path+'-wal')||optionalStat(this.#path+'-shm'))reject();
  const rollback=optionalStat(this.#path+'-journal');if(rollback)file(rollback);
 }
 #validate():void{
  if(this.#closed)reject();
  const root=lstatSync(this.#directory);directory(root);if(!same(root,this.#root)||realpathSync(this.#directory)!==this.#directory)reject();
  ancestors(this.#directory);supportedFilesystem(this.#directory);
  const named=lstatSync(this.#path);file(named);if(!same(named,this.#inode))reject();this.#validateSidecars();
  if(this.#db.prepare('PRAGMA journal_mode').get()?.journal_mode!=='delete'||this.#db.prepare('PRAGMA synchronous').get()?.synchronous!==3||this.#db.prepare('PRAGMA busy_timeout').get()?.timeout!==5000)reject();
 }
 read<T>(fn:(database:DatabaseSync)=>T):T{
  if(this.#active)reject();
  try{this.#validate();this.#active=true;const value=synchronous(fn(this.#db));this.#validate();return value;}
  catch{throw Error('PROTECTED_STORAGE_REJECTED');}finally{this.#active=false;}
 }
 transaction<T>(fn:(database:DatabaseSync)=>T):T{
  if(this.#active)reject();
  let begun=false;
  try{
   this.#validate();this.#active=true;this.#db.exec('BEGIN IMMEDIATE');begun=true;
   this.#validate();const value=synchronous(fn(this.#db));this.#validate();this.#db.exec('COMMIT');begun=false;this.#validate();return value;
  }catch{if(begun)try{this.#db.exec('ROLLBACK');}catch{}throw Error('PROTECTED_STORAGE_REJECTED');}
  finally{this.#active=false;}
 }
 close():void{if(!this.#closed){this.#closed=true;this.#db.close();}}
}
