import {describe,it,expect} from 'vitest';
import {isPrivateEvidencePath} from './private-evidence-paths.mjs';
describe('local evidence source packing boundary',()=>{
  it('excludes evidence metadata, temporaries, and all vault descendants at any path depth',()=>{
    for(const p of ['.evidence-index-v1.json','.evidence-index-v1.json.synthetic.tmp','data/.evidence-index-v1.json','custom/.evidence-files-v1','custom/.evidence-files-v1/uuid.txt','custom\\.evidence-files-v1\\uuid.pdf','nested/custom/.evidence-index-v1.json.123.tmp','CUSTOM/.EVIDENCE-FILES-V1/fixture.txt','CUSTOM/.EVIDENCE-INDEX-V1.JSON','applications.json','custom/APPLICATIONS.JSON.12.tmp','custom/.application-snapshots/app-fixture.json'])
      expect(isPrivateEvidencePath(p)).toBe(true);
    for(const p of ['src/server/evidenceStore.ts','src/schema/evidenceSchema.ts','docs/evidence-index.md','custom/evidence-files-v1/other.txt','scripts/private-evidence-paths.mjs'])
      expect(isPrivateEvidencePath(p)).toBe(false);
  });
});
