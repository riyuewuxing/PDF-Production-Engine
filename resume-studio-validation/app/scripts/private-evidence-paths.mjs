/** Never include managed evidence metadata or bytes in a source/context bundle, even under custom roots. */
export function isPrivateEvidencePath(relativePath){
  return relativePath.toLowerCase().split(/[\\/]+/).some(part=>
    part==='.evidence-files-v1'||part==='.evidence-index-v1.json'||part.startsWith('.evidence-index-v1.json.')||
    part==='applications.json'||part.startsWith('applications.json.')||part==='.application-snapshots');
}
