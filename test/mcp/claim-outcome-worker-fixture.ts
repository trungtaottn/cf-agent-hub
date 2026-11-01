/** Test-only composition; public requests still enter the real exported Worker and WorkspaceDO. */
import fixture,{McpFixtureDO} from './local-worker-fixture';
export class ClaimOutcomeFixtureDO extends McpFixtureDO {
 override async snapshot(){return Object.fromEntries(this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(({name})=>{if(!/^[a-z_][a-z0-9_]*$/.test(name))throw Error('FIXTURE_TABLE');return [name,this.ctx.storage.sql.exec('SELECT * FROM '+name+' ORDER BY rowid').toArray()];}));}
}
export default fixture;
