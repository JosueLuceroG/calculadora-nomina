// Independent Node/OpenSSL authentication. Native semantic validation remains mandatory.
import {canonicalBytes,parseStrict} from './json.mjs'
import {keyId,sha256,verifyPrimitive} from './crypto.mjs'
const check=(value,code)=>{if(!value)throw new Error(`INDEPENDENT_${code}`)}
const closed=(v,fields)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k)),'CLOSED_OBJECT')
const hash=v=>sha256(canonicalBytes(v))
const unique=a=>new Set(a).size===a.length
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const instant=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v)&&!v.startsWith('0000')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v.replace('Z','.000Z')
function publicKey(k){
  const b=Buffer.from(k.publicKey??'','base64url')
  check(b.length===32&&b.toString('base64url')===k.publicKey&&keyId(b)===k.keyId,'PUBLIC_KEY')
}
function roots(records){
  check(Array.isArray(records)&&records.length===3,'THREE_ROOTS')
  const result=new Map()
  for(const k of records){closed(k,['keyId','publicKey']);publicKey(k);check(!result.has(k.keyId),'DUPLICATE_ROOT');result.set(k.keyId,k)}
  return result
}
function signatures(records,purposes){
  check(Array.isArray(records)&&records.length>0&&records.length<=8,'SIGNATURE_COUNT')
  const ids=new Set();let previous=''
  for(const r of records){closed(r,['protected','value']);closed(r.protected,['protocolVersion','algorithm','keyId','purpose']);const h=r.protected,order=h.purpose+'|'+h.keyId
    check(h.protocolVersion===1&&h.algorithm==='Ed25519'&&purposes.includes(h.purpose)&&!ids.has(h.keyId)&&order>previous,'SIGNATURE_ROLE_OR_ORDER');previous=order;ids.add(h.keyId)
    const b=Buffer.from(r.value??'','base64url');check(b.length===64&&b.toString('base64url')===r.value,'SIGNATURE_ENCODING')
  }
}
const scope=f=>`${f.streamId}|${f.exercise}|${f.ruleProfileId}`
export function verifyProductionTrust(bootstrap,chain,now){
  parseStrict(canonicalBytes(bootstrap));parseStrict(canonicalBytes(chain))
  closed(bootstrap,['channel','rootKeys']);check(bootstrap.channel==='production'&&instant(now),'CHANNEL_OR_TIME')
  check(Array.isArray(chain)&&chain.length>0&&chain.length<=16,'TRUST_CHAIN_LIMIT')
  let active=roots(bootstrap.rootKeys),version=1,epoch=0,previousHash=null,previous=null
  for(const [index,envelope] of chain.entries()){
    closed(envelope,['signed','signatures']);const s=envelope.signed
    closed(s,['format','formatVersion','canonicalization','channel','rootVersion','epoch','issuedAt','expiresAt','rootValidity','rootKeys','threshold','delegations','revokedKeyIds','withdrawnPayloads','floors'])
    check(canonicalBytes(envelope).length<=262144,'TRUST_SIZE')
    check(s.format==='mx.nomina.fiscal-trust'&&s.formatVersion===1&&s.canonicalization==='RFC8785'&&s.channel==='production'&&s.threshold===2,'TRUST_FORMAT_OR_CHANNEL')
    closed(s.rootValidity,['from','through'])
    check([s.issuedAt,s.expiresAt,s.rootValidity.from,s.rootValidity.through].every(instant),'TRUST_TIME')
    check(s.rootValidity.from<=s.issuedAt&&s.issuedAt<s.expiresAt&&s.expiresAt<=s.rootValidity.through&&Date.parse(s.expiresAt)-Date.parse(s.issuedAt)<=90*86400000&&Date.parse(s.rootValidity.through)-Date.parse(s.rootValidity.from)<=1830*86400000&&s.issuedAt<=now,'TRUST_VALIDITY')
    const next=roots(s.rootKeys),transition=s.rootVersion===version+1
    check(s.rootVersion===version||transition,'ROOT_CHAIN_GAP')
    check(s.expiresAt>now&&s.rootValidity.through>now||index<chain.length-1&&transition,'TRUST_EXPIRED')
    if(!transition){check([...active].every(([id,k])=>next.get(id)?.publicKey===k.publicKey),'ROOT_TRANSITION_REQUIRED');if(previous)check(hash(previous.rootValidity)===hash(s.rootValidity),'ROOT_TRANSITION_REQUIRED')}
    signatures(envelope.signatures,['trust-root']);let oldCount=0,newCount=0
    for(const r of envelope.signatures){const id=r.protected.keyId,k=active.get(id)??next.get(id);check(k&&verifyPrimitive(r,s,k.publicKey),'ROOT_SIGNATURE');if(active.has(id))oldCount++;if(next.has(id))newCount++}
    check(oldCount>=2&&newCount>=2,'ROOT_QUORUM')
    const payload=hash(s)
    check(s.epoch>0&&s.epoch>=epoch&&(s.epoch!==epoch||payload===previousHash)&&(!transition||s.epoch>epoch),'TRUST_EPOCH')
    check(Array.isArray(s.delegations)&&s.delegations.length+3<=32&&s.revokedKeyIds.length<=1024&&s.withdrawnPayloads.length<=1024&&s.floors.length<=128,'TRUST_LIMIT')
    check(unique(s.revokedKeyIds)&&unique(s.withdrawnPayloads)&&s.withdrawnPayloads.every(digest)&&s.revokedKeyIds.every(id=>/^ed25519-sha256:[a-f0-9]{64}$/.test(id)),'REVOCATION_FORMAT')
    const ids=new Set(next.keys()),streams=new Set()
    for(const f of s.floors){closed(f,['streamId','exercise','ruleProfileId','streamEpoch','minimumRevision','reason']);check(f.streamEpoch>0&&!streams.has(scope(f)),'STREAM_FLOOR');streams.add(scope(f))}
    for(const d of s.delegations){closed(d,['keyId','publicKey','purpose','channel','exercise','parameterSchemaId','ruleProfileId','contextualPolicyId','streamId','streamEpoch','minimumRevision','maximumRevision','notBefore','notAfter','operations']);publicKey(d)
      check(!ids.has(d.keyId)&&!s.revokedKeyIds.includes(d.keyId)&&['package','content-approval'].includes(d.purpose)&&d.channel==='production','DELEGATION_ROLE_OR_CHANNEL');ids.add(d.keyId)
      check(instant(d.notBefore)&&instant(d.notAfter)&&d.notBefore<d.notAfter&&d.notBefore>=s.rootValidity.from&&d.notAfter<=s.rootValidity.through&&d.minimumRevision>0&&d.maximumRevision>=d.minimumRevision&&d.streamEpoch>0,'DELEGATION_VALIDITY')
      check(d.operations.length>0&&d.operations.length<=2&&unique(d.operations)&&d.operations.every(o=>['direct','inverse'].includes(o)),'DELEGATION_OPERATIONS')
      check(s.floors.some(f=>scope(f)===scope(d)&&f.streamEpoch===d.streamEpoch&&d.minimumRevision>=f.minimumRevision),'UNREGISTERED_DELEGATION')
    }
    check([...next.keys()].every(id=>!s.revokedKeyIds.includes(id)),'REVOKED_ROOT')
    if(previous){check(previous.revokedKeyIds.every(id=>s.revokedKeyIds.includes(id))&&previous.withdrawnPayloads.every(id=>s.withdrawnPayloads.includes(id)),'REVOCATION_ROLLBACK')
      for(const old of previous.floors){const f=s.floors.find(f=>scope(f)===scope(old));check(f&&(f.streamEpoch===old.streamEpoch&&f.minimumRevision>=old.minimumRevision||f.streamEpoch===old.streamEpoch+1&&typeof f.reason==='string'&&f.reason.trim()),'FLOOR_ROLLBACK')}
    }
    active=next;version=s.rootVersion;epoch=s.epoch;previousHash=payload;previous=s
  }
  return {head:previous,rootVersion:version,trustEpoch:epoch,trustPayloadSha256:previousHash,bootstrapSha256:hash(bootstrap),chainSha256:chain.map(hash),scope:'editorial-authentication-only',execution:'not-installed-not-authorized'}
}
export function verifyProductionPackage(envelope,bootstrap,chain,revisions,now,operation){
  parseStrict(canonicalBytes(envelope));parseStrict(canonicalBytes(revisions));closed(envelope,['signed','signatures'])
  check(['direct','inverse'].includes(operation),'OPERATION')
  const result=verifyProductionTrust(bootstrap,chain,now),t=result.head,p=envelope.signed
  check(p.channel==='production'&&p.format==='mx.nomina.fiscal-package'&&p.formatVersion===1&&p.canonicalization==='RFC8785','PACKAGE_CHANNEL_OR_FORMAT')
  check(p.publication.minimumTrustEpoch<=t.epoch&&instant(p.publication.publishedAt)&&p.publication.publishedAt<=now,'PACKAGE_TRUST_OR_TIME')
  check(p.manifest.contentIdentity.scheme==='legacy-registry-v1'&&hash(p.registry)===p.manifest.contentIdentity.sha256,'CONTENT_HASH')
  signatures(envelope.signatures,['package','content-approval']);const roles=new Set(),publishingKeys=[],approvalKeys=[]
  for(const r of envelope.signatures){const h=r.protected,d=t.delegations.find(k=>k.keyId===h.keyId)
    check(d&&d.purpose===h.purpose&&!t.revokedKeyIds.includes(d.keyId)&&d.channel===p.channel&&d.exercise===p.manifest.exercise&&d.parameterSchemaId===p.manifest.parameterSchemaId&&d.ruleProfileId===p.manifest.requiredRuleProfileId&&d.contextualPolicyId===p.manifest.requiredContextualPolicyId&&d.streamId===p.publication.streamId&&d.streamEpoch===p.publication.streamEpoch&&p.publication.revision>=d.minimumRevision&&p.publication.revision<=d.maximumRevision,'DELEGATION_SCOPE_OR_ROLE')
    check(now>=d.notBefore&&now<d.notAfter&&d.operations.includes('direct')&&(operation!=='inverse'||d.operations.includes('inverse'))&&p.manifest.requiredCapabilities.every(c=>d.operations.includes(c)),'EDITORIAL_VALIDITY_OR_OPERATION')
    check(verifyPrimitive(r,p,d.publicKey),'EDITORIAL_SIGNATURE');roles.add(h.purpose);(h.purpose==='package'?publishingKeys:approvalKeys).push(h.keyId)
  }
  check(roles.has('package')&&roles.has('content-approval'),'DISTINCT_EDITORIAL_ROLES_REQUIRED')
  const payload=hash(p);check(!t.withdrawnPayloads.includes(payload),'PAYLOAD_WITHDRAWN')
  const f=t.floors.find(f=>scope(f)===`${p.publication.streamId}|${p.manifest.exercise}|${p.manifest.requiredRuleProfileId}`)
  check(f&&f.streamEpoch===p.publication.streamEpoch&&p.publication.revision>=f.minimumRevision,'TRUST_REVISION_FLOOR')
  check(Array.isArray(revisions)&&revisions.length<=128&&unique(revisions.map(r=>`${r.channel}|${scope(r)}`)),'REVISION_STATE')
  for(const r of revisions){closed(r,['channel','streamId','exercise','ruleProfileId','streamEpoch','revision','payloadSha256']);check(digest(r.payloadSha256)&&r.streamEpoch>0,'REVISION_STATE')}
  const local=revisions.find(r=>r.channel===p.channel&&scope(r)===scope(f))
  if(local){check(local.streamEpoch<=p.publication.streamEpoch,'TRUST_METADATA_OUTDATED');if(local.streamEpoch===p.publication.streamEpoch)check(p.publication.revision>local.revision||p.publication.revision===local.revision&&payload===local.payloadSha256,'REVISION_ROLLBACK_OR_CONFLICT')}
  const {head,...publicResult}=result
  return {...publicResult,publishingKeys,approvalKeys,contentSha256:hash(p.registry),signedPayloadSha256:payload,containerSha256:hash(envelope),verification:'independent-Node-OpenSSL-authentication; native-semantic-validation-required'}
}
