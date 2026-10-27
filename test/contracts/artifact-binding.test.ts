import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Script has no separate declaration surface.
import {artifactBindingIssues} from '../../scripts/verify-artifact-bindings.mjs';
const config=(product='private-products',recovery='private-recovery')=>({r2_buckets:[{binding:'ARTIFACT_BUCKET',bucket_name:product},{binding:'RECOVERY_BUCKET',bucket_name:recovery}]});
it('declared actual product bindings are distinct and production remains unbound',()=>{const raw=JSON.parse(readFileSync('wrangler.jsonc','utf8'));expect(artifactBindingIssues(raw)).toEqual([]);expect(raw.r2_buckets.some((b:{binding:string})=>b.binding==='ARTIFACT_BUCKET')).toBe(false);expect(raw.env.dev.r2_buckets.some((b:{binding:string})=>b.binding==='ARTIFACT_BUCKET')).toBe(false);});
it('same bucket behind distinct opaque runtime handles is rejected in trusted deployment declarations',()=>{expect(artifactBindingIssues(config('same','same'))).not.toEqual([]);expect(artifactBindingIssues({env:{test:config('same','same')}})).not.toEqual([]);});
it('missing recovery counterpart duplicate bindings and aliased preview identities are rejected',()=>{const c=config();expect(artifactBindingIssues({r2_buckets:[c.r2_buckets[0]]})).not.toEqual([]);expect(artifactBindingIssues({r2_buckets:[...c.r2_buckets,c.r2_buckets[0]]})).not.toEqual([]);expect(artifactBindingIssues({r2_buckets:c.r2_buckets.map(b=>({...b,preview_bucket_name:'same-preview'}))})).not.toEqual([]);});
it('an absent product binding stays a supported closed capability',()=>expect(artifactBindingIssues({r2_buckets:[{binding:'RECOVERY_BUCKET',bucket_name:'recovery'}]})).toEqual([]));
