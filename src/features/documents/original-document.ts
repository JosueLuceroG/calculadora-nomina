import {decodeFiscalSnapshot,type StoredFiscalSnapshot} from '../storage/snapshot'
import {hashBytes} from './evidence-v3'

export type OriginalDocumentIdentity=Readonly<{sha256:string;byteLength:number;source:'storage-read'|'document-preview'}>
const originals=new WeakMap<StoredFiscalSnapshot,OriginalDocumentIdentity>()
/** Read-only association with the EXACT input wire. Never a persistence receipt,
 * execution reference or authority. In particular, do not hash a re-encoding. */
export function readOriginalDocument(wire:string,source:OriginalDocumentIdentity['source']='document-preview'):StoredFiscalSnapshot{
 const snapshot=decodeFiscalSnapshot(wire),bytes=new TextEncoder().encode(wire)
 originals.set(snapshot,Object.freeze({sha256:hashBytes(bytes),byteLength:bytes.length,source}))
 return snapshot
}
export const originalDocumentIdentity=(snapshot:StoredFiscalSnapshot)=>originals.get(snapshot)??null
