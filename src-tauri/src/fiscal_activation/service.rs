use super::*;
use std::{collections::BTreeMap,sync::Mutex,time::{Duration,Instant}};
const ABSOLUTE:Duration=Duration::from_secs(300);
const IDLE:Duration=Duration::from_secs(120);
struct Session{owner:Owner,created:Instant,touched:Instant,prepared:Option<ActivationPreview>,state:State}
pub(crate) struct ActivationService{pub(crate) imports:Arc<ImportService>,sessions:Mutex<BTreeMap<String,Session>>}
impl ActivationService{
    pub fn new(imports:Arc<ImportService>)->Self{Self{imports,sessions:Mutex::new(BTreeMap::new())}}
    pub fn enabled(&self)->Result<()>{self.imports.management_enabled().map_err(|e|error(&e.code))}
    pub fn navigation(&self,label:&str){if let Ok(mut sessions)=self.sessions.lock(){for s in sessions.values_mut().filter(|s|s.owner.label==label){if !matches!(s.state.phase.as_str(),"confirming"|"unknown"|"committed"){s.state.phase="cancelled".into();s.state.preview_nonce=None;s.prepared=None;}}}}
    // Only the independently replayed repository status can release an unknown
    // operation. This is not a frontend assertion of success or rollback.
    pub fn reconciled(&self,operation:&str,receipt:Option<&Receipt>){if let Ok(mut sessions)=self.sessions.lock(){for s in sessions.values_mut().filter(|s|s.state.operation_id==operation&&s.state.phase=="unknown"){s.prepared=None;if let Some(r)=receipt{s.state.phase="committed".into();s.state.receipt=Some(r.clone());s.state.error=None;}else{s.state.phase="rejected".into();s.state.error=Some("NOT_COMMITTED".into());s.state.preview_nonce=None;}}}}
    fn expire(s:&mut Session){if matches!(s.state.phase.as_str(),"ready"|"preparing")&&(s.created.elapsed()>=ABSOLUTE||s.touched.elapsed()>=IDLE){s.state.phase="expired".into();s.state.preview_nonce=None;s.prepared=None;}}
    fn check<'a>(&self,sessions:&'a mut BTreeMap<String,Session>,o:&Owner,id:&str)->Result<&'a mut Session>{
        if self.imports.owner(&o.label,o.native_handle).map_err(|e|error(&e.code))?!=*o{return Err(error("SESSION_OWNER_MISMATCH"));}let s=sessions.get_mut(id).ok_or_else(||error("SESSION_UNKNOWN"))?;if s.owner!=*o{return Err(error("SESSION_OWNER_MISMATCH"));}Self::expire(s);Ok(s)
    }
    pub fn reserve(&self,o:&Owner)->Result<State>{self.enabled()?;let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;for s in sessions.values_mut(){Self::expire(s);}let active=|s:&&Session|matches!(s.state.phase.as_str(),"preparing"|"ready"|"confirming"|"unknown");if sessions.values().filter(active).count()>=4||sessions.values().filter(|s|s.owner==*o).filter(active).count()>=2{return Err(error("SESSION_CAPACITY"));}
        if sessions.len()>=128{let old=sessions.iter().find(|(_,s)|!matches!(s.state.phase.as_str(),"preparing"|"ready"|"confirming"|"unknown")).map(|(id,_)|id.clone());if let Some(id)=old{sessions.remove(&id);}else{return Err(error("SESSION_CAPACITY"));}}
        let state=State{session_id:uuid::Uuid::new_v4().to_string(),operation_id:uuid::Uuid::new_v4().to_string(),phase:"preparing".into(),error:None,preview_nonce:None,summary:None,receipt:None};sessions.insert(state.session_id.clone(),Session{owner:o.clone(),created:Instant::now(),touched:Instant::now(),prepared:None,state:state.clone()});Ok(state)
    }
    pub fn prepare(&self,o:&Owner,id:&str,kind:ActivationIntent,iid:Option<&str>,aid:Option<&str>,exception:Option<&str>)->Result<State>{
        let preview=self.imports.repository.prepare_activation(kind,iid,aid,exception);
        let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;let s=self.check(&mut sessions,o,id)?;if s.state.phase!="preparing"{return Ok(s.state.clone());}
        match preview{Ok(p)=>{let intent=match kind{ActivationIntent::Admit=>"admit",ActivationIntent::Select=>"select",ActivationIntent::Deactivate=>"deactivate"};s.state.summary=Some(Summary{version:1,intent:intent.into(),repository_id:p.repository_id.clone(),repository_generation:p.repository_generation,previous:p.previous.clone(),eligibility:p.eligibility.clone(),admission_id:p.admission_id.clone(),selection_id:p.selection_id.clone(),execution:EXECUTION_CLOSED.into()});s.state.preview_nonce=Some(uuid::Uuid::new_v4().to_string());s.state.phase="ready".into();s.prepared=Some(p);s.touched=Instant::now();},Err(e)=>{s.state.phase="rejected".into();s.state.error=Some(e.code.into());}}Ok(s.state.clone())
    }
    pub fn get(&self,o:&Owner,id:&str)->Result<State>{let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;Ok(self.check(&mut sessions,o,id)?.state.clone())}
    pub fn cancel(&self,o:&Owner,id:&str)->Result<State>{let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;let s=self.check(&mut sessions,o,id)?;if !matches!(s.state.phase.as_str(),"confirming"|"unknown"|"committed"){s.state.phase="cancelled".into();s.prepared=None;s.state.preview_nonce=None;}Ok(s.state.clone())}
    pub fn confirm(&self,o:&Owner,id:&str,nonce:&str)->Result<State>{self.enabled()?;let(preview,operation)={let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;let s=self.check(&mut sessions,o,id)?;if s.state.preview_nonce.as_deref()!=Some(nonce){return Err(error("PREVIEW_NONCE_MISMATCH"));}if s.state.phase=="committed"{return Ok(s.state.clone());}if s.state.phase=="unknown"{return Err(error("RECONCILE_OPERATION_FIRST"));}if s.state.phase!="ready"{return Err(error("SESSION_NOT_READY"));}let p=s.prepared.clone().ok_or_else(||error("SESSION_NOT_READY"))?;s.state.phase="confirming".into();(p,s.state.operation_id.clone())};
        // Once accepted, navigation does not claim cancellation of a commit.
        let result=self.imports.repository.confirm_activation(&operation,&preview);let result=match result{Ok(r)=>Ok(r),Err(e)=>match self.imports.repository.operation_status(&operation){Ok(Some(r))=>Ok(r),Ok(None)=>Err(e),Err(_) if matches!(e.code,"COMMIT_OUTCOME_UNKNOWN"|"COMMITTED_RECOVERY_PENDING")=>Err(crate::fiscal_repository::RepositoryError{code:"COMMIT_OUTCOME_UNKNOWN",core_code:None}),Err(_)=>Err(e)}};
        let mut sessions=self.sessions.lock().map_err(|_|error("UNAVAILABLE"))?;let s=sessions.get_mut(id).ok_or_else(||error("SESSION_UNKNOWN"))?;match result{Ok(r)=>{s.state.phase="committed".into();s.state.receipt=Some(r);s.prepared=None;},Err(e)=>{s.state.error=Some(e.code.into());s.state.phase=if matches!(e.code,"STALE_GENERATION"|"STALE_SELECTION"){"stale"}else if matches!(e.code,"COMMIT_OUTCOME_UNKNOWN"|"COMMITTED_RECOVERY_PENDING"){"unknown"}else{"rejected"}.into();if s.state.phase!="unknown"{s.prepared=None;}}}Ok(s.state.clone())
    }
    pub fn selection(&self)->Result<SelectionStatus>{self.enabled()?;if self.imports.repository.inspect_presence()?=="absent"{return Ok(SelectionStatus{repository_generation:0,selection:SelectionIdentity::integrated(),eligibility:None,execution:EXECUTION_CLOSED.into()});}Ok(self.imports.repository.selection_status()?)}
    #[cfg(test)]pub(crate) fn age(&self,id:&str,absolute:Duration,idle:Duration){let mut sessions=self.sessions.lock().unwrap();let s=sessions.get_mut(id).unwrap();s.created=Instant::now()-absolute;s.touched=Instant::now()-idle;}
}
