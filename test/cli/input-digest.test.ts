import {afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,existsSync,readdirSync,openSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readInputFile} from '../../packages/cli/src/input';
import {parseCommand} from '../../packages/cli/src/commands';
import {runCli} from '../../packages/cli/src/main';
vi.mock('node:fs',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs')>();return {...actual,openSync:vi.fn(actual.openSync),existsSync:vi.fn(actual.existsSync)};});
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.mocked(openSync).mockClear();vi.mocked(existsSync).mockClear();});
const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function fixture(bytes:string|Buffer='{"label":"Example"}') {const root=mkdtempSync(join(tmpdir(),'cli-digest-'));roots.push(root);const file=join(root,'input.json');writeFileSync(file,bytes);return {root,file};}
const readPinned=readInputFile as (path:string,expected?:string)=>unknown;
const context=['--state-dir','/private/state','--origin','https://hub.example.invalid','--workspace','ws'];
const command=['runtime','register',...context,'--input','/private/body.json','--idempotency-key','key'];
describe('optional exact-byte CLI input digest',()=>{
 it('accepts the correct raw-byte digest and preserves unpinned input',()=>{const bytes=' {"label":"Example"}\n',f=fixture(bytes);expect(readPinned(f.file,digest(bytes))).toEqual({label:'Example'});expect(readInputFile(f.file)).toEqual({label:'Example'});});
 it('rejects a wrong digest without disclosing pin/path/body',()=>{const f=fixture(' {"label":"private-body"}\n');expect(()=>readPinned(f.file,'0'.repeat(64))).toThrow(/^CLI_INPUT_REJECTED$/);});
 it('does not replace raw-byte identity with semantic JSON equality',()=>{const f=fixture('{ "label": "Example" }\n');expect(()=>readPinned(f.file,digest('{"label":"Example"}'))).toThrow(/^CLI_INPUT_REJECTED$/);});
 for(const pin of ['', 'A'.repeat(64),'a'.repeat(63),'a'.repeat(65),'g'.repeat(64)])it('rejects malformed digest before opening '+JSON.stringify(pin),()=>{const f=fixture();vi.mocked(openSync).mockClear();expect(()=>readPinned(f.file,pin)).toThrow(/^CLI_INPUT_REJECTED$/);expect(openSync).not.toHaveBeenCalled();});
 it('rejects a changed same-size file after admission',()=>{const first='{"label":"first"}',f=fixture(first);writeFileSync(f.file,'{"label":"other"}');expect(()=>readPinned(f.file,digest(first))).toThrow(/^CLI_INPUT_REJECTED$/);});
 it('retains symlink, size and UTF-8 protections even with a matching pin',()=>{const f=fixture();const link=join(f.root,'link');symlinkSync(f.file,link);expect(()=>readPinned(link,digest('{"label":"Example"}'))).toThrow();const large=Buffer.alloc(65537,32);writeFileSync(f.file,large);expect(()=>readPinned(f.file,digest(large))).toThrow();const invalid=Buffer.from([123,34,120,34,58,34,255,34,125]);writeFileSync(f.file,invalid);expect(()=>readPinned(f.file,digest(invalid))).toThrow();});
 it('parses the optional pin on body-bearing native commands',()=>{const parsed=parseCommand([...command,'--input-sha256',digest('{}')]);expect(parsed.options).toHaveProperty('inputSha256',digest('{}'));});
 for(const args of [
  [...command,'--input-sha256','A'.repeat(64)],
  [...command,'--input-sha256','a'.repeat(63)],
  [...command,'--input-sha256','a'.repeat(64),'--input-sha256','a'.repeat(64)],
  ['runtime','register',...context,'--input-sha256','a'.repeat(64)],
  ['state','init','--state-dir','/private/state','--input-sha256','a'.repeat(64)],
  ['tasks','list',...context,'--input-sha256','a'.repeat(64)]
 ])it('rejects invalid/unpaired/inapplicable digest arguments '+args.slice(0,2).join(' '),()=>{expect(()=>parseCommand(args)).toThrow(/^CLI_ARGUMENT_REJECTED$/);});
 it('rejects mismatch before fetch or state creation with sanitized output',async()=>{const f=fixture(),state=join(f.root,'state'),fetch=vi.fn();const before=readdirSync(f.root);vi.mocked(existsSync).mockClear();const result=await runCli(['runtime','register','--state-dir',state,'--origin','https://hub.example.invalid','--workspace','ws','--input',f.file,'--input-sha256','0'.repeat(64),'--idempotency-key','key','--json'],{env:{},fetch});expect(result.exitCode).toBe(2);expect(result.stdout).toBe('');expect(result.stderr).not.toContain(f.file);expect(result.stderr).not.toContain('0'.repeat(64));expect(result.stderr).not.toContain('Example');expect(fetch).not.toHaveBeenCalled();expect(existsSync).not.toHaveBeenCalled();expect(existsSync(state)).toBe(false);expect(readdirSync(f.root)).toEqual(before);});
});
