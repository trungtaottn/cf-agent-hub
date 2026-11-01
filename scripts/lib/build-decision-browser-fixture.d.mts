import type {Plugin} from 'esbuild';
export function createDecisionFixturePlugin(root:string):Plugin;
export function assertDecisionBuildGraph(options:{root:string;kind:'normal'|'private';inputs:Record<string,unknown>;code:string}):void;
export function buildDecisionBrowserFixture(options:{root:string;outputDirectory:string}):Promise<{privateWorker:string;normalWorker:string;manifest:{kind:string;productionSource:Record<string,string>;builds:Record<string,{sha256:string;graphSha256:string;inputPaths:string[];inputSha256:Record<string,string>}>}}>;
