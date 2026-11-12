use super::*;
use std::path::{PathBuf,Component};
pub fn is_qa()->bool{cfg!(feature="fiscal-import-qa")}
pub fn message(qa:bool,can_import:bool)->String{
    if qa{
        #[cfg(feature="fiscal-import-qa")]return format!("{} · QA: paquetes de ensayo, no publicación fiscal oficial. Instalar no activa ni autoriza cálculos.",QA_ARTIFACT_MARKER);
        #[cfg(not(feature="fiscal-import-qa"))]return "QA: paquetes de ensayo, no publicación fiscal oficial. Instalar no activa ni autoriza cálculos.".into();
    }
    if can_import{return "Host productivo aprovisionado. Instalación, admisión y selección se confirman por separado. Cada ejecución y guardado requieren autorización nativa vigente; las firmas no certifican el cálculo salarial.".into();}
    "La importación externa no está configurada: falta el bootstrap de producción. El paquete integrado 2026 sigue disponible.".into()
}
pub fn validate_qa_environment()->Result<Option<PathBuf>>{
    if !is_qa(){return Ok(None);}if !cfg!(debug_assertions){return Err(fail("QA_DISTRIBUTION_FORBIDDEN"));}
    let root=PathBuf::from(std::env::var_os("NOMINA_STORAGE_TEST_ROOT").ok_or_else(||fail("QA_CONTEXT_REQUIRED"))?);
    if !root.is_absolute()||!root.starts_with(std::env::temp_dir().join("opencode"))||root.components().any(|c|matches!(c,Component::ParentDir))||!root.file_name().map(|s|s.to_string_lossy().starts_with("5b7-5d3b2-")).unwrap_or(false){return Err(fail("QA_CONTEXT_REQUIRED"));}
    let web=std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").map(PathBuf::from).ok_or_else(||fail("QA_WEBVIEW_ISOLATION_REQUIRED"))?;let name=web.file_name().map(|n|n.to_string_lossy().into_owned()).unwrap_or_default();if web.parent()!=Some(root.as_path())||!(name=="webview"||name.strip_prefix("webview-").map(|s|uuid::Uuid::parse_str(s).is_ok()).unwrap_or(false)){return Err(fail("QA_WEBVIEW_ISOLATION_REQUIRED"));}
    for item in [&root,&web]{for p in item.ancestors(){let m=std::fs::symlink_metadata(p)?;if !m.is_dir()||m.file_type().is_symlink(){return Err(fail("QA_CONTEXT_REQUIRED"));}#[cfg(windows)]{use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err(fail("QA_CONTEXT_REQUIRED"));}}}}
    Ok(Some(root))
}
pub fn make(root:PathBuf)->Arc<ImportService>{
    #[cfg(feature="fiscal-import-qa")]let policy=Policy::import_qa();
    #[cfg(not(feature="fiscal-import-qa"))]let policy=Policy::production();
    Arc::new(ImportService::new(Repository::new(root,policy),is_qa()))
}
pub fn allowed_url(url:&tauri::Url)->bool{if !url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||!matches!(url.path(),"/"|"/index.html"){return false;}
    (matches!(url.scheme(),"http"|"https")&&url.host_str()==Some("tauri.localhost")&&url.port().is_none())||(url.scheme()=="tauri"&&url.host_str()==Some("localhost")&&url.port().is_none())||(cfg!(debug_assertions)&&url.scheme()=="http"&&matches!(url.host_str(),Some("localhost"|"127.0.0.1"))&&url.port()==Some(1420))
}
#[cfg(feature="fiscal-import-qa")]pub const QA_ARTIFACT_MARKER:&str="NOMINA_FISCAL_IMPORT_QA_ONLY_5D3B2";
