import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8');
const normal="github.event_name != 'workflow_dispatch' || inputs.visual_evidence != true || github.ref != 'refs/heads/factory-visual-evidence'";
test('visual capture is explicit manual-only and ordinary source gates remain on',()=>{
 assert.match(workflow,/visual_evidence:\n\s+description:.*\n\s+required: false\n\s+type: boolean\n\s+default: false/);
 for(const name of ['source','native-source','local-sandbox','native-build','native-service','dependencies']){const chunk=workflow.split('\n  '+name+':\n')[1]?.split(/\n  [a-z-]+:\n/)[0];assert.ok(chunk?.includes('if: '+normal),name);}
 assert.match(workflow,/if: github.event_name == 'workflow_dispatch' && inputs.visual_evidence == true && github.ref == 'refs\/heads\/factory-visual-evidence'/);
 for(const event of ['push','pull_request','workflow_dispatch'])for(const flag of [undefined,false,true])for(const ref of ['refs/heads/main','refs/heads/factory-visual-evidence','refs/pull/138/merge']){const visual=event==='workflow_dispatch'&&flag===true&&ref==='refs/heads/factory-visual-evidence';assert.equal(event!=='workflow_dispatch'||flag!==true||ref!=='refs/heads/factory-visual-evidence',!visual);}
});
test('visual job binds immutable product and driver, narrow artifact upload and read-only permission',()=>{
 const job=workflow.split('\n  factory-visual:\n')[1];assert.ok(job);assert.match(job,/ref: 77ee610c13a61077dc866a66556eafdfcb1d2553/);assert.match(job,/ref: \$\{\{ github.sha \}\}/);assert.match(job,/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);assert.match(job,/product\/factory-visual-evidence\/\*\.png/);assert.match(job,/product\/factory-visual-evidence\/receipt.json/);assert.doesNotMatch(job,/secrets\.|permissions:|storageState|\.zip|trace/);assert.match(workflow,/permissions:\n  contents: read\n/);assert.match(job,/retention-days: 3/);
});

test('capture waits exact run and uploads only visible dedicated directory',()=>{const capture=readFileSync(new URL('../visual/factory.visual.ts',import.meta.url),'utf8');assert.match(capture,/task-run.*toHaveAttribute\('data-status','ready'\)/);assert.match(capture,/Status: submitted/);assert.doesNotMatch(workflow,/include-hidden-files: true|product\/\.visual-evidence/);assert.match(capture,/const out='factory-visual-evidence'/);});
