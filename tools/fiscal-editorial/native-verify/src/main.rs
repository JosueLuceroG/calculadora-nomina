use nomina_fiscal_package as n;
use n::{errors::{Failure,Result,Stage},wire::*,trust::TrustedState};
use serde::Deserialize;
use serde_json::{Value,json};
use std::io::{Read,Write};
mod editorial;
fn read(path:&str,max:usize)->Result<Vec<u8>>{let mut bytes=vec![];std::fs::File::open(path).map_err(|_|Failure::new(Stage::Processing,"EDITORIAL_READ_FAILED"))?.take((max+1)as u64).read_to_end(&mut bytes).map_err(|_|Failure::new(Stage::Processing,"EDITORIAL_READ_FAILED"))?;if bytes.len()>max{return Err(Failure::new(Stage::Processing,"FILE_LIMIT"));}Ok(bytes)}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]struct Bootstrap{channel:Channel,root_keys:Vec<RootKey>}
fn state(bootstrap:&str,chain:&str,now:&str,production:bool,editorial_production:bool)->Result<TrustedState>{
    if production{return Ok(TrustedState::unconfigured_production());}
    if editorial_production {
        let initial=editorial::bootstrap(&read(bootstrap,16384)?)?;
        return initial.propose_chain(&updates(chain)?,now);
    }
    let bootstrap:Bootstrap=serde_json::from_value(n::strict_json::parse_with_limit(&read(bootstrap,16384)?,16384)?).map_err(|_|Failure::new(Stage::Trust,"INVALID_HOST_BOOTSTRAP"))?;
    if bootstrap.channel!=Channel::Qa{return Err(Failure::new(Stage::Trust,"PRODUCTION_BOOTSTRAP_MISSING"));}
    let paths:Vec<String>=serde_json::from_value(n::strict_json::parse_with_limit(&read(chain,65536)?,65536)?).map_err(|_|Failure::new(Stage::Trust,"INVALID_HOST_CHAIN"))?;
    if paths.len()>n::limits::MAX_TRANSITIONS{return Err(Failure::new(Stage::Trust,"TRUST_TRANSITION_LIMIT"));}
    let updates=paths.iter().map(|p|read(p,n::limits::MAX_TRUST_BYTES)).collect::<Result<Vec<_>>>()?;TrustedState::qa_bootstrap(&bootstrap.root_keys)?.propose_chain(&updates,now)
}
fn updates(chain:&str)->Result<Vec<Vec<u8>>>{
    let paths:Vec<String>=serde_json::from_value(n::strict_json::parse_with_limit(&read(chain,65536)?,65536)?).map_err(|_|Failure::new(Stage::Trust,"INVALID_HOST_CHAIN"))?;
    if paths.len()>n::limits::MAX_TRANSITIONS{return Err(Failure::new(Stage::Trust,"TRUST_TRANSITION_LIMIT"));}
    paths.iter().map(|p|read(p,n::limits::MAX_TRUST_BYTES)).collect()
}
fn run(args:&[String])->Result<Value>{
    let cmd=args.first().map(String::as_str).unwrap_or("");
    match cmd{
        "prepare-production" if args.len()==2=>{std::io::stdout().write_all(&editorial::prepare(&read(&args[1],n::limits::MAX_BYTES)?)?).map_err(|_|Failure::new(Stage::Processing,"OUTPUT_FAILED"))?;Ok(Value::Null)},
        "signing-message" if args.len()==4=>{std::io::stdout().write_all(&editorial::signing_message(&read(&args[1],n::limits::MAX_BYTES)?,&args[2],&args[3])?).map_err(|_|Failure::new(Stage::Processing,"OUTPUT_FAILED"))?;Ok(Value::Null)},
        "verify-production-trust" if args.len()==5=>{
            let initial=editorial::bootstrap(&read(&args[2],16384)?)?;let mut chain=updates(&args[3])?;chain.push(read(&args[1],n::limits::MAX_TRUST_BYTES)?);
            let next=initial.propose_chain(&chain,&args[4])?;next.current(&args[4])?;
            Ok(json!({"channel":"production","rootVersion":next.root_version(),"trustEpoch":next.epoch(),"scope":"editorial-input-only","execution":"not-installed-not-authorized"}))
        },
        "canonical" if args.len()==2=>{let raw=n::strict_json::parse(&read(&args[1],n::limits::MAX_BYTES)?)?;let bytes=n::canonical::bytes(&raw)?;std::io::stdout().write_all(&bytes).map_err(|_|Failure::new(Stage::Processing,"OUTPUT_FAILED"))?;Ok(Value::Null)},
        "validate" if args.len()==2=>{
            let input=read(&args[1],n::limits::MAX_BYTES)?;let raw=n::strict_json::parse(&input)?;let e:Envelope=n::decode_closed(&raw)?;n::canonical::require_wire(&input,&raw)?;n::verify::validate_structure(&e.signed,None)?;n::compatibility::CompiledPolicy::current_2026().guard(&e.signed)?;n::validation_2026::validate(&e.signed)?;
            if e.signed.manifest.content_identity.scheme!="legacy-registry-v1"||n::hashes::canonical_hash(&raw["signed"]["registry"])?!=e.signed.manifest.content_identity.sha256{return Err(Failure::new(Stage::Integrity,"CONTENT_HASH_MISMATCH"));}
            Ok(json!({"kind":"untrusted-data-report","authentication":"not-checked","editorialApproval":"not-checked","content":e.signed.manifest.content_identity,"signedPayloadSha256":n::hashes::canonical_hash(&raw["signed"])? ,"containerSha256":n::hashes::sha256(&input),"execution":"not-installed-not-authorized"}))},
        "verify" if args.len()==8=>{
            if !["qa","production","direct-only","production-editorial"].contains(&args[7].as_str()){return Err(Failure::new(Stage::Processing,"INVALID_EDITORIAL_MODE"));}
            let now=&args[5];let trust=state(&args[2],&args[3],now,args[7]=="production",args[7]=="production-editorial")?;
            let floors=serde_json::from_value(n::strict_json::parse_with_limit(&read(&args[4],65536)?,65536)?).map_err(|_|Failure::new(Stage::Revision,"INVALID_HOST_REVISIONS"))?;
            let revisions=n::revisions::MemoryRevisions::new(floors)?;let operation=match args[6].as_str(){"direct"=>Capability::Direct,"inverse"=>Capability::Inverse,_=>return Err(Failure::new(Stage::Processing,"INVALID_OPERATION"))};
            let policy=if args[7]=="direct-only"{n::compatibility::CompiledPolicy::current_2026().direct_only()}else{n::compatibility::CompiledPolicy::current_2026()};
            Ok(serde_json::to_value(n::verify_candidate(&read(&args[1],n::limits::MAX_BYTES)?,&trust,&policy,&revisions,operation,now)?.report()).map_err(|_|Failure::new(Stage::Processing,"OUTPUT_FAILED"))?)},
        "trust" if args.len()==5=>{let t=state(&args[1],&args[2],&args[3],args[4]=="production",args[4]=="production-editorial")?;t.current(&args[3])?;Ok(json!({"epoch":t.epoch(),"rootVersion":t.root_version(),"state":"proposed-in-memory-only"}))},
        "rollback" if args.len()==8=>{let t=state(&args[2],&args[3],&args[4],args[7]=="production",false)?;let floor=args[5].parse().map_err(|_|Failure::new(Stage::Revision,"INVALID_HOST_FLOOR"))?;let grant=n::revisions::verify_rollback(&read(&args[1],n::limits::MAX_TRUST_BYTES)?,&t,&args[4],floor,&args[6])?;Ok(json!({"authorization":grant,"execution":"not-installed-not-authorized"}))},
        "vector" if args.len()==4=>{let public=n::signature::decode::<32>(&args[1])?;let id=n::hashes::key_id(&public);let key=n::signature::public_key(&args[1],&id)?;
            use base64::Engine;let message=base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&args[3]).map_err(|_|Failure::new(Stage::Authentication,"INVALID_VECTOR_MESSAGE"))?;
            let protected=Protected{protocol_version:1,algorithm:"Ed25519".into(),key_id:id,purpose:Purpose::Package};let _=protected;
            // Raw public vectors are primitive tests only, never trusted candidates.
            let valid=n::verify_raw_vector(&key,&message,&args[2])?;Ok(json!({"rawPrimitiveVectorValid":valid,"candidateAuthority":"none"}))},
        _=>Err(Failure::new(Stage::Processing,"INVALID_EDITORIAL_ARGUMENTS")),
    }
}
fn main(){let args=std::env::args().skip(1).collect::<Vec<_>>();match run(&args){Ok(value)=>{if !matches!(args.first().map(String::as_str),Some("canonical"|"prepare-production"|"signing-message")){println!("{}",json!({"ok":true,"result":value}));}},Err(error)=>{println!("{}",json!({"ok":false,"error":error}));std::process::exit(2);}}}
