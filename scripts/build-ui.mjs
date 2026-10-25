import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {styles} from '../src/ui/styles.ts';
await mkdir('dist/ui',{recursive:true});
await Promise.all([
 build({entryPoints:['src/ui/app.ts'],outfile:'dist/ui/app.js',bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'none',logLevel:'warning'}),
 writeFile('dist/ui/styles.css',styles),
 readFile('src/ui/index.html','utf8').then(html=>writeFile('dist/ui/index.html',html))
]);
console.log('R1_UI_BUILD_OK');
