use super::*;
use std::collections::BTreeMap;
use self::core::{wire::*,canonical,hashes,trust::TrustedState,revisions::{MemoryRevisions,RevisionFloor},compatibility::CompiledPolicy};
type Scope=(String,String,u64,String);
pub(super) struct View{pub trust:TrustedState,pub signed:Option<SignedTrust>,pub episode:u64,pub heads:BTreeMap<Scope,RevisionFloor>,pub aliases:BTreeMap<String,(String,String)>}
pub(super) struct Source<'a>{pub connection:&'a Connection,pub pending:BTreeMap<(String,String),Vec<u8>>}
impl Source<'_>{pub fn load(&self,table:&str,hash:&str,max:u64)->Result<Vec<u8>>{let b=if let Some(b)=self.pending.get(&(table.into(),hash.into())){b.clone()}else{bytes(self.connection,table,hash,max)?};limits::size(&b,max)?;if hashes::sha256(&b)!=hash{return Err(fail("CORRUPT_OBJECT"));}Ok(b)}}
pub(super) fn intent(action:&Action)->Result<String>{let v=match action{Action::Trust{documents}=>serde_json::json!({"kind":"trust","documents":documents}),Action::Install{envelope_sha256,operations,..}=>serde_json::json!({"kind":"install","envelopeSha256":envelope_sha256,"operations":operations}),Action::Grant{document,target,previous_floor}=>serde_json::json!({"kind":"grant","document":document,"target":target,"previousFloor":previous_floor}),_=>return activation::intent(action)};Ok(hashes::sha256(&canonical::bytes(&v)?))}
pub(super) fn entry(id:&str,seq:u64,request:&str,at:&str,body:&[u8],previous:&str,receipt:&[u8])->Result<String>{let c=canonical::bytes(&serde_json::json!({"domain":"mx.nomina.fiscal-repository.operation.v1","id":id,"sequence":seq,"request":request,"at":at,"body":hashes::sha256(body),"previous":previous,"receipt":hashes::sha256(receipt)}))?;Ok(hashes::sha256(&c))}
fn put_simple(c:&Connection,table:&str,hash:&str,b:&[u8])->Result<()>{if blob(c,table,hash,b)?{limits::budget(object_total(c)?,b.len() as u64,limits::BLOB_BYTES)?;c.execute(&format!("INSERT INTO {table}(sha256,bytes) VALUES(?1,?2)"),params![hash,b])?;}Ok(())}
fn projections(c:&Connection,s:&SignedTrust,episode:u64,payload:&str)->Result<()>{
    c.execute("DELETE FROM trust_head",[])?;c.execute("INSERT INTO trust_head VALUES(1,?1,?2,?3,?4)",params![episode,s.root_version,s.epoch,payload])?;
    for t in ["delegations","revoked_keys","withdrawn_payloads","signed_revision_floors"]{c.execute(&format!("DELETE FROM {t}"),[])?;}
    for d in &s.delegations{c.execute("INSERT INTO delegations VALUES(?1,?2)",params![d.key_id,canonical::bytes(d)?])?;}
    for k in &s.revoked_key_ids{c.execute("INSERT INTO revoked_keys VALUES(?1)",[k])?;}
    for h in &s.withdrawn_payloads{c.execute("INSERT INTO withdrawn_payloads VALUES(?1)",[h])?;}
    for f in &s.floors{c.execute("INSERT INTO signed_revision_floors VALUES(?1,?2,?3,?4,?5)",params![f.stream_id,f.exercise,f.rule_profile_id,f.stream_epoch,f.minimum_revision])?;}Ok(())
}
pub(super) fn apply(dst:&Connection,src:&Source<'_>,view:&mut View,action:&Action,op:&str,seq:u64,at:&str,policy:&Policy)->Result<Receipt>{
    let mut installation=None;
    match action{
        Action::Trust{documents}=>{
            if documents.is_empty()||documents.len()>core::limits::MAX_TRANSITIONS{return Err(fail("TRUST_TRANSITION_LIMIT"));}
            limits::budget(count(dst,"trust_episodes")?,1,limits::EPISODES)?;
            let updates=documents.iter().map(|h|src.load("trust_documents",h,limits::TRUST_BYTES)).collect::<Result<Vec<_>>>()?;
            let next=view.trust.propose_chain(&updates,at)?;let s=next.current(at)?.clone();let payload=hashes::canonical_hash(&s)?;
            for (h,b) in documents.iter().zip(&updates){put_simple(dst,"trust_documents",h,b)?;}
            dst.execute("INSERT INTO trust_episodes VALUES(?1,?2,?3,?4)",params![seq,s.root_version,s.epoch,payload])?;
            for (i,h) in documents.iter().enumerate(){dst.execute("INSERT INTO trust_episode_documents VALUES(?1,?2,?3)",params![seq,i as u64,h])?;}
            projections(dst,&s,seq,&payload)?;view.trust=next;view.signed=Some(s);view.episode=seq;
        },
        Action::Install{envelope_sha256,operations,installation_id,admission_id}=>{
            if operations.as_slice()!=[Capability::Direct]&&operations.as_slice()!=[Capability::Direct,Capability::Inverse]{return Err(fail("INVALID_OPERATIONS"));}
            if uuid::Uuid::parse_str(installation_id).is_err()||uuid::Uuid::parse_str(admission_id).is_err(){return Err(fail("INVALID_ID"));}
            let b=src.load("containers",envelope_sha256,limits::OBJECT_BYTES)?;let revisions=MemoryRevisions::new(view.heads.values().cloned().collect())?;
            let mut candidates=vec![];for capability in operations{candidates.push(core::verify_candidate(&b,&view.trust,&CompiledPolicy::current_2026(),&revisions,*capability,at)?);}
            let p=candidates[0].package();let identities=&candidates[0].report().identities;let content=&identities.content;let payload=&identities.signed_payload_sha256;
            let alias=(p.manifest.package_id.clone(),p.manifest.parameter_version.clone());if view.aliases.get(&content.sha256).map(|old|old!=&alias).unwrap_or(false){return Err(fail("IDENTITY_CONFLICT"));}view.aliases.insert(content.sha256.clone(),alias);
            let content_bytes=canonical::bytes(&p.registry)?;let payload_bytes=canonical::bytes(p)?;
            if blob(dst,"content_objects",&content.sha256,&content_bytes)?{limits::budget(object_total(dst)?,content_bytes.len() as u64,limits::BLOB_BYTES)?;dst.execute("INSERT INTO content_objects VALUES(?1,?2,?3)",params![content.scheme,content.sha256,content_bytes])?;}
            if blob(dst,"signed_payloads",payload,&payload_bytes)?{limits::budget(object_total(dst)?,payload_bytes.len() as u64,limits::BLOB_BYTES)?;dst.execute("INSERT INTO signed_payloads VALUES(?1,?2,?3,?4)",params![payload,content.scheme,content.sha256,payload_bytes])?;}
            if blob(dst,"containers",envelope_sha256,&b)?{limits::budget(count(dst,"containers")?,1,limits::INSTALLATIONS)?;limits::budget(object_total(dst)?,b.len() as u64,limits::BLOB_BYTES)?;dst.execute("INSERT INTO containers VALUES(?1,?2,?3)",params![envelope_sha256,payload,b])?;}
            let channel=policy.channel.clone();let scope=(channel.clone(),p.publication.stream_id.clone(),p.manifest.exercise,p.manifest.required_rule_profile_id.clone());
            let existing:Option<String>=dst.query_row("SELECT payload_sha256 FROM publications WHERE channel=?1 AND stream=?2 AND exercise=?3 AND profile=?4 AND epoch=?5 AND revision=?6",params![scope.0,scope.1,scope.2,scope.3,p.publication.stream_epoch,p.publication.revision],|r|r.get(0)).optional()?;
            if let Some(old)=existing{if old!=*payload{return Err(fail("REVISION_CONFLICT"));}}else{limits::budget(count(dst,"publications")?,1,limits::PUBLICATIONS)?;dst.execute("INSERT INTO publications VALUES(?1,?2,?3,?4,?5,?6,?7)",params![scope.0,scope.1,scope.2,scope.3,p.publication.stream_epoch,p.publication.revision,payload])?;}
            if dst.query_row("SELECT 1 FROM publication_containers WHERE container_sha256=?1",[envelope_sha256],|r|r.get::<_,i64>(0)).optional()?.is_none(){dst.execute("INSERT INTO publication_containers VALUES(?1,?2)",params![payload,envelope_sha256])?;}
            let old:Option<String>=dst.query_row("SELECT id FROM installations WHERE container_sha256=?1",[envelope_sha256],|r|r.get(0)).optional()?;
            if let Some(old)=old{if old!=*installation_id{return Err(fail("IDENTITY_CONFLICT"));}}else{limits::budget(count(dst,"installations")?,1,limits::INSTALLATIONS)?;dst.execute("INSERT INTO installations VALUES(?1,?2,?3)",params![installation_id,envelope_sha256,op])?;}
            for (cap,candidate) in operations.iter().zip(&candidates){dst.execute("INSERT INTO verification_records VALUES(?1,?2,?3,?4,?5)",params![op,if *cap==Capability::Direct{"direct"}else{"inverse"},envelope_sha256,view.episode,canonical::bytes(candidate.report())?])?;}
            dst.execute("INSERT INTO admissions VALUES(?1,?2,?3,'recorded-not-executable')",params![admission_id,installation_id,op])?;
            let changed=view.heads.get(&scope).map(|old|(p.publication.stream_epoch,p.publication.revision)>(old.stream_epoch,old.revision)).unwrap_or(true);
            if changed{if !view.heads.contains_key(&scope){limits::budget(view.heads.len() as u64,1,128)?;}
                let f=RevisionFloor{channel:p.channel,stream_id:scope.1.clone(),exercise:scope.2,rule_profile_id:scope.3.clone(),stream_epoch:p.publication.stream_epoch,revision:p.publication.revision,payload_sha256:payload.clone()};
                dst.execute("DELETE FROM accepted_heads WHERE channel=?1 AND stream=?2 AND exercise=?3 AND profile=?4",params![scope.0,scope.1,scope.2,scope.3])?;
                dst.execute("INSERT INTO accepted_heads VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![scope.0,scope.1,scope.2,scope.3,f.stream_epoch,f.revision,payload,op])?;view.heads.insert(scope,f);
            }installation=Some(installation_id.clone());
        },
        Action::Grant{document,target,previous_floor}=>{
            let b=src.load("rollback_documents",document,limits::TRUST_BYTES)?;let target_bytes=bytes(src.connection,"signed_payloads",target,limits::OBJECT_BYTES)?;let raw=core::strict_json::parse(&target_bytes)?;let p:SignedPackage=core::decode_closed(&raw)?;
            let grant=core::revisions::verify_rollback(&b,&view.trust,at,*previous_floor,target)?;
            let scope=(policy.channel.clone(),p.publication.stream_id.clone(),p.manifest.exercise,p.manifest.required_rule_profile_id.clone());let h=view.heads.get(&scope).ok_or_else(||fail("UNKNOWN_TARGET_SCOPE"))?;
            if grant.stream_id!=p.publication.stream_id||grant.stream_epoch!=p.publication.stream_epoch||h.stream_epoch!=grant.stream_epoch||h.revision!=*previous_floor{return Err(fail("ROLLBACK_SCOPE_MISMATCH"));}
            if blob(dst,"rollback_documents",document,&b)?{limits::budget(count(dst,"rollback_documents")?,1,limits::GRANTS)?;limits::budget(object_total(dst)?,b.len() as u64,limits::BLOB_BYTES)?;dst.execute("INSERT INTO rollback_documents VALUES(?1,?2,?3)",params![document,b,op])?;}
        },
        Action::AdmitV1{..}|Action::SelectV1{..}|Action::DeactivateV1{..}=>return activation::apply(dst,src,view,action,op,seq,at,policy),
    }
    Ok(Receipt{operation_id:op.into(),sequence:seq,generation:seq,installation_id:installation,execution:"not-authorized-for-execution".into()})
}
pub(super) fn rebuild(c:&Connection,policy:&Policy,marker:&Marker)->Result<View>{
    Ok(rebuild_snapshot(c,policy,marker)?.0)
}
pub(super) fn rebuild_snapshot(c:&Connection,policy:&Policy,marker:&Marker)->Result<(View,Connection)>{
    schema::check(c)?;let expected=Connection::open_in_memory()?;expected.execute_batch("PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;")?;seed_at(&expected,marker,schema::version(c)?)?;
    let mut view=View{trust:policy.initial()?,signed:None,episode:0,heads:BTreeMap::new(),aliases:BTreeMap::new()};let src=Source{connection:c,pending:BTreeMap::new()};
    let mut previous="0".repeat(64);let mut maximum=String::new();let mut sequence=0u64;
    let mut stmt=c.prepare("SELECT id,seq,request_sha256,accepted_at,body,previous_hash,entry_hash,receipt,length(body),length(receipt) FROM operations ORDER BY seq")?;let mut rows=stmt.query([])?;
    while let Some(row)=rows.next()?{
        let body_len:i64=row.get(8)?;let receipt_len:i64=row.get(9)?;if !(1..=limits::MANIFEST as i64).contains(&body_len)||!(1..=limits::MANIFEST as i64).contains(&receipt_len){return Err(fail("CORRUPT_RECORD"));}
        let id:String=row.get(0)?;let seq:u64=row.get(1)?;let request:String=row.get(2)?;let at:String=row.get(3)?;let body:Vec<u8>=row.get(4)?;let prev:String=row.get(5)?;let hash:String=row.get(6)?;let receipt:Vec<u8>=row.get(7)?;
        sequence=sequence.checked_add(1).ok_or_else(||fail("CAPACITY_EXCEEDED"))?;limits::budget(0,sequence,limits::OPERATIONS)?;
        if uuid::Uuid::parse_str(&id).is_err()||seq!=sequence||prev!=previous{return Err(fail("CORRUPT_JOURNAL"));}clock::check(&at,&maximum)?;
        let value=core::strict_json::parse_with_limit(&body,limits::MANIFEST as usize)?;canonical::require_wire(&body,&value)?;let action:Action=core::decode_closed(&value)?;
        if request!=intent(&action)?||hash!=entry(&id,seq,&request,&at,&body,&prev,&receipt)?{return Err(fail("CORRUPT_JOURNAL"));}
        expected.execute("INSERT INTO operations VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",params![id,seq,request,at,body,prev,hash,receipt])?;
        let produced=apply(&expected,&src,&mut view,&action,&id,seq,&at,policy)?;if canonical::bytes(&produced)?!=receipt{return Err(fail("CORRUPT_RECEIPT"));}
        expected.execute("UPDATE repository_meta SET generation=?1,head=?2,max_utc=?3 WHERE id=1",params![seq,hash,at])?;previous=hash;maximum=at;
    }
    if schema::digest(c)?!=schema::digest(&expected)?{return Err(fail("CORRUPT_PROJECTION"));}Ok((view,expected))
}
