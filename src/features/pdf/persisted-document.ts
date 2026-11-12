import {createNativeStorageApi} from '../storage/storage-api'
import {originalDocumentIdentity} from '../documents/original-document'
import {documentFromHistory} from './document-model'

/** External current-result export must re-read the committed original, rather
 * than exporting the session's cached finalization as if it were persisted. */
export async function documentFromPersisted(executionId:string,checksum:string,reader:Pick<ReturnType<typeof createNativeStorageApi>,'get'>=createNativeStorageApi()){
 const snapshot=await reader.get(executionId)
 if(!snapshot||snapshot.executionId!==executionId||originalDocumentIdentity(snapshot)?.source!=='storage-read'||originalDocumentIdentity(snapshot)?.sha256!==checksum)throw Error('INCOMPATIBLE_DOCUMENT_SOURCE: PERSISTED_ORIGINAL_MISMATCH')
 return documentFromHistory(snapshot)
}
