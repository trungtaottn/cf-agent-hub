// Test-only failure diagnostics. No paths, hashes, content or numeric owner IDs leave this module.
import {lstatSync,realpathSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
export function metadataPredicates(stat,uid,{directory=false,privateLeaf=false,executable=false,maxBytes=Infinity}={}){
 const ownerAllowed=[0,uid].includes(stat.uid),stickyRootTemporary=stat.uid===0&&(stat.mode&0o1000)!==0;
 return {kindAllowed:directory?stat.isDirectory()&&!stat.isSymbolicLink():stat.isFile()&&!stat.isSymbolicLink(),ownerAllowed,modeAllowed:(stat.mode&0o022)===0||(directory&&stickyRootTemporary),privateLeafAllowed:!privateLeaf||(stat.uid===uid&&(stat.mode&0o777)===0o700),singleLink:directory||stat.nlink===1,sizeAllowed:directory||(stat.size>0&&stat.size<=maxBytes),executableAllowed:!executable||(stat.mode&0o111)!==0};
}
export function custodyDiagnostic(spec){
 const uid=process.getuid();
 function dirs(path,privateLeaf,noGit){try{const result={canonical:realpathSync(path)===path,levels:[]};for(let cursor=path,depth=0;;cursor=dirname(cursor),depth++){if(depth>128)return {inspectionFailed:true};result.levels.push({depth,...metadataPredicates(lstatSync(cursor),uid,{directory:true,privateLeaf:privateLeaf&&depth===0}),gitAbsent:!noGit||!existsSync(join(cursor,'.git'))});if(dirname(cursor)===cursor)break;}return result;}catch{return {inspectionFailed:true};}}
 function file(path,maxBytes,executable){try{return {canonical:realpathSync(path)===path,...metadataPredicates(lstatSync(path),uid,{maxBytes,executable}),parents:dirs(dirname(path),false,false)};}catch{return {inspectionFailed:true};}}
 return {receipt:dirs(spec.receiptDirectory,true,true),cwd:dirs(spec.cwd,false,false),node:file(spec.nodePath,268435456,true),entry:file(spec.entryPath,33554432,false)};
}
