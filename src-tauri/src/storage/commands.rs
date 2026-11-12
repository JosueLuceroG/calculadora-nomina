use super::*;
use std::sync::Arc;
use tauri::Manager;

pub type StorageState = Arc<StorageService>;
pub fn application_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(value) = std::env::var_os("NOMINA_STORAGE_TEST_ROOT") {
        let root = PathBuf::from(value);
        let base = std::env::temp_dir().join("opencode");
        if !root.is_absolute() || !root.starts_with(base) || root.components().any(|c| matches!(c,std::path::Component::ParentDir)) || !root.file_name().map(|n|n.to_string_lossy().starts_with("5b7-")).unwrap_or(false) { return Err(failure("UNAVAILABLE")); }
        return Ok(root);
    }
    app.path().app_local_data_dir().map_err(|_|failure("UNAVAILABLE"))
}
async fn run<T: Send+'static>(window:tauri::WebviewWindow,state:StorageState,action:impl FnOnce(&StorageService)->Result<T>+Send+'static)->Result<T>{
    if window.label()!="main" {return Err(failure("UNAVAILABLE"));}
    tauri::async_runtime::spawn_blocking(move||action(&state)).await.map_err(|_|failure("UNAVAILABLE"))?
}
#[tauri::command]
pub async fn storage_info(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>)->Result<StorageInfo>{run(window,state.inner().clone(),|s|s.info()).await}
#[tauri::command]
pub async fn storage_begin_write(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>)->Result<WriteSession>{run(window,state.inner().clone(),|s|s.begin_write()).await}
#[tauri::command]
pub async fn storage_insert(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,generation:String,payload:String,authority:Option<crate::fiscal_execution::AuthorityReference>)->Result<serde_json::Value>{insert_dispatch(window,state.inner().clone(),generation,payload,authority,StoreRoute::Manual).await}
#[tauri::command]
pub async fn storage_insert_automatic(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,generation:String,payload:String,authority:Option<crate::fiscal_execution::AuthorityReference>)->Result<serde_json::Value>{insert_dispatch(window,state.inner().clone(),generation,payload,authority,StoreRoute::Automatic).await}
async fn insert_dispatch(window:tauri::WebviewWindow,state:StorageState,generation:String,payload:String,authority:Option<crate::fiscal_execution::AuthorityReference>,route:StoreRoute)->Result<serde_json::Value>{
 if let Some(a)=authority{let service=window.try_state::<Arc<crate::fiscal_execution::ExecutionService>>().ok_or_else(||failure("UNAVAILABLE"))?.inner().clone();let owner=crate::fiscal_execution::commands::caller(&window,&service).map_err(|e|failure(&e.code))?;service.enabled().map_err(|e|failure(&e.code))?;let _work=service.imports.work().map_err(|e|failure(&e.code))?;return tauri::async_runtime::spawn_blocking(move||service.store_document(&owner,&a,&generation,&payload,route).map_err(|e|failure(&e.code)).and_then(|v|serde_json::to_value(v).map_err(|_|failure("UNAVAILABLE")))).await.map_err(|_|failure("OUTCOME_UNKNOWN"))?;}
 run(window,state,move|s|match route{StoreRoute::Manual=>s.insert(&generation,&payload),StoreRoute::Automatic=>s.insert_automatic(&generation,&payload)}.and_then(|v|serde_json::to_value(v).map_err(|_|failure("UNAVAILABLE")))).await
}
#[tauri::command]
pub async fn storage_list(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,limit:u32,cursor:Option<Cursor>)->Result<HistoryPage>{run(window,state.inner().clone(),move|s|s.list(limit,cursor)).await}
#[tauri::command]
pub async fn storage_get(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,execution_id:String)->Result<Option<String>>{run(window,state.inner().clone(),move|s|s.get(&execution_id)).await}
#[tauri::command]
pub async fn storage_delete(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,execution_id:String)->Result<DeleteResult>{run(window,state.inner().clone(),move|s|s.delete(&execution_id)).await}
#[tauri::command]
pub async fn storage_clear(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>)->Result<WriteSession>{run(window,state.inner().clone(),|s|s.clear()).await}
#[tauri::command]
pub async fn storage_get_preferences(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>)->Result<Preferences>{run(window,state.inner().clone(),|s|s.preferences()).await}
#[tauri::command]
pub async fn storage_set_preferences(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,patch:PreferencePatch)->Result<Preferences>{run(window,state.inner().clone(),move|s|s.set_preferences(patch)).await}
#[tauri::command]
pub async fn storage_recover_corrupt(window:tauri::WebviewWindow,state:tauri::State<'_,StorageState>,acknowledgement:String)->Result<RecoveryResult>{run(window,state.inner().clone(),move|s|s.recover_corrupt(&acknowledgement)).await}
