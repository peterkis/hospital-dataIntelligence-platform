import {provision} from './review-ci-database.mjs';
export {peer,inspect,resolveTarget,upgradeManifestReferenceAccess} from './review-ci-database.mjs';
// Provision the reviewed prefix without renaming or hiding tracked SQL files.
export async function provisionAt0076(){
 if(process.env.HDIP_REVIEW_CI_MANIFEST_UPGRADE!=='1')throw new Error('REVIEW_MANIFEST_UPGRADE_MODE_REQUIRED');
 return provision();
}
