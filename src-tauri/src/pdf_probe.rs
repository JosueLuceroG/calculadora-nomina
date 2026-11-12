//! Frontera PDF específica: diálogo nativo y commit sin reemplazo; sin rutas de JavaScript.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}};

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
#[derive(Debug, Serialize)]
pub struct SaveError { code: &'static str, message: &'static str }
type Result<T> = std::result::Result<T, SaveError>;
fn failure(code: &'static str) -> SaveError {
    SaveError { code, message: match code {
        "INVALID_PDF" => "El documento no tiene un formato PDF admitido o excede 20 MiB.",
        "INVALID_NAME" => "Utiliza un nombre de archivo PDF sin rutas ni caracteres reservados.",
        "INVALID_EXTENSION" => "Elige un nombre con extensión .pdf.",
        "LOCAL_DESTINATION_REQUIRED" => "Elige una unidad local de Windows para guardar el PDF.",
        "ALREADY_EXISTS" => "El archivo ya existe. No se sobrescribió; elige otro nombre.",
        "PERMISSION_DENIED" => "Windows no permitió guardar en esa ubicación. Elige una carpeta con permiso de escritura.",
        "BUSY" => "Ya hay un guardado PDF en curso.",
        "INVALID_DESTINATION" => "La carpeta elegida no está disponible o la ruta no es válida. Elige otra ubicación.",
        "DISK_FULL" => "No hay espacio suficiente para guardar el PDF. Elige otra unidad o libera espacio.",
        "UNAVAILABLE" => "El guardado PDF no está disponible en esta ventana de la aplicación.",
        _ => "No se pudo completar el guardado del PDF. No se confirmó ningún archivo nuevo.",
    } }
}
fn io_error(error: io::Error) -> SaveError { failure(match error.kind() { io::ErrorKind::AlreadyExists => "ALREADY_EXISTS", io::ErrorKind::PermissionDenied|io::ErrorKind::ReadOnlyFilesystem => "PERMISSION_DENIED", io::ErrorKind::StorageFull|io::ErrorKind::QuotaExceeded => "DISK_FULL", io::ErrorKind::NotFound|io::ErrorKind::NotADirectory|io::ErrorKind::InvalidInput|io::ErrorKind::InvalidFilename => "INVALID_DESTINATION", _ => "IO_ERROR" }) }
fn validate_pdf(bytes: &[u8]) -> Result<()> {
    if bytes.len() < 32 || bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-1.") || !bytes[bytes.len().saturating_sub(1024)..].windows(5).any(|w|w == b"%%EOF") { return Err(failure("INVALID_PDF")); }
    Ok(())
}
fn suggested_name(value: &str) -> Result<String> {
    if value.is_empty() || value.len() > 150 || value.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) || value.ends_with([' ', '.']) { return Err(failure("INVALID_NAME")); }
    let stem = value.split('.').next().unwrap_or("").to_ascii_lowercase();
    if ["con","prn","aux","nul"].contains(&stem.as_str()) || (stem.len()==4 && (stem.starts_with("com")||stem.starts_with("lpt")) && matches!(stem.as_bytes()[3],b'1'..=b'9')) { return Err(failure("INVALID_NAME")); }
    let mut path=PathBuf::from(value);
    match path.extension() { None => {path.set_extension("pdf");}, Some(ext) if ext.eq_ignore_ascii_case("pdf") => {}, _ => return Err(failure("INVALID_EXTENSION")) }
    Ok(path.to_string_lossy().into_owned())
}
fn selected_path(mut path: PathBuf) -> Result<PathBuf> {
    if !path.is_absolute() || path.file_name().is_none() { return Err(failure("INVALID_NAME")); }
    match path.extension() { None => {path.set_extension("pdf");}, Some(ext) if ext.eq_ignore_ascii_case("pdf") => {}, _ => return Err(failure("INVALID_EXTENSION")) }
    #[cfg(windows)]
    {
        use std::path::{Component,Prefix};
        let drive=match path.components().next(){Some(Component::Prefix(p))=>match p.kind(){Prefix::Disk(d)|Prefix::VerbatimDisk(d)=>d,_=>return Err(failure("LOCAL_DESTINATION_REQUIRED"))},_=>return Err(failure("LOCAL_DESTINATION_REQUIRED"))};
        #[link(name="kernel32")]
        extern "system" {fn GetDriveTypeW(root:*const u16)->u32;}
        let root=[drive as u16,':' as u16,'\\' as u16,0];
        if unsafe{GetDriveTypeW(root.as_ptr())}==4{return Err(failure("LOCAL_DESTINATION_REQUIRED"));}
    }
    Ok(path)
}
struct TemporaryPdf(PathBuf);
impl Drop for TemporaryPdf { fn drop(&mut self) { let _=fs::remove_file(&self.0); } }
fn reserve_temporary(path: PathBuf) -> io::Result<(TemporaryPdf,File)> {
    let file=OpenOptions::new().write(true).create_new(true).open(&path)?;
    // Solo se adquiere la limpieza después de crear el archivo con exclusividad.
    Ok((TemporaryPdf(path),file))
}
#[cfg(windows)]
fn commit_without_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name="kernel32")]
    extern "system" { fn MoveFileExW(existing: *const u16, destination: *const u16, flags: u32) -> i32; }
    let a:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();
    let b:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
    // Mismo directorio/volumen, WRITE_THROUGH y SIN REPLACE_EXISTING.
    if unsafe {MoveFileExW(a.as_ptr(),b.as_ptr(),8)} == 0 {Err(io::Error::last_os_error())} else {Ok(())}
}
#[cfg(not(windows))]
fn commit_without_replace(from: &Path, to: &Path) -> io::Result<()> { fs::hard_link(from,to)?;fs::remove_file(from) }

fn write_pdf_using(path: &Path, bytes: &[u8], write:impl FnOnce(&mut File,&[u8])->io::Result<()>) -> Result<String> {
    validate_pdf(bytes)?;
    if path.exists() { return Err(failure("ALREADY_EXISTS")); }
    let parent=path.parent().ok_or_else(||failure("INVALID_NAME"))?;
    let (temp,mut file)=reserve_temporary(parent.join(format!(".nomina-pdf-{}.tmp",uuid::Uuid::new_v4()))).map_err(io_error)?;
    write(&mut file,bytes).map_err(io_error)?;
    drop(file);
    commit_without_replace(&temp.0,path).map_err(io_error)?;
    Ok(format!("{:x}",Sha256::digest(bytes)))
}
fn write_pdf_without_replace(path:&Path,bytes:&[u8])->Result<String>{write_pdf_using(path,bytes,|file,data|{file.write_all(data)?;file.sync_all()})}
fn allowed_probe_url(url: &tauri::Url) -> bool { cfg!(debug_assertions) && url.scheme()=="http" && matches!(url.host_str(),Some("127.0.0.1")|Some("localhost")) && url.port()==Some(1420) && url.path()=="/dev/pdf.html" && url.username().is_empty() && url.password().is_none() && url.query().is_none() && url.fragment().is_none() }
fn allowed_report_url(url: &tauri::Url) -> bool {
    if !url.username().is_empty()||url.password().is_some() {return false;}
    let application=matches!(url.path(),"/"|"/index.html")&&url.query().is_none()&&url.fragment().is_none();
    if application&&((matches!(url.scheme(),"http"|"https")&&url.host_str()==Some("tauri.localhost")&&url.port().is_none())||(url.scheme()=="tauri"&&url.host_str()==Some("localhost")&&url.port().is_none())) {return true;}
    cfg!(debug_assertions)&&url.scheme()=="http"&&matches!(url.host_str(),Some("127.0.0.1")|Some("localhost"))&&url.port()==Some(1420)&&(application||url.path()=="/dev/history.html")
}
#[cfg(debug_assertions)]
fn probe_initial_directory() -> Option<PathBuf> {
    let path=PathBuf::from(std::env::var_os("NOMINA_PDF_PROBE_DIRECTORY")?);
    if path.is_absolute() && path.starts_with(std::env::temp_dir().join("opencode")) && !path.components().any(|p|matches!(p,std::path::Component::ParentDir)) && (path.file_name()?.to_string_lossy().starts_with("5b10-")||path.file_name()?.to_string_lossy().starts_with("5b11-")) && path.is_dir(){Some(path)}else{None}
}

#[derive(Serialize)]
#[serde(tag="status",rename_all="kebab-case")]
pub enum SaveResult { Cancelled, Saved { path: String, bytes: usize, sha256: String } }

static SAVE_BUSY: std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
struct SaveLease;
impl Drop for SaveLease {fn drop(&mut self){SAVE_BUSY.store(false,std::sync::atomic::Ordering::Release)}}

async fn perform_save(window:tauri::WebviewWindow,bytes:Vec<u8>,suggested_name:String,title:&'static str)->Result<SaveResult>{
    use tauri_plugin_dialog::DialogExt;
    validate_pdf(&bytes)?;let name=self::suggested_name(&suggested_name)?;
    if SAVE_BUSY.compare_exchange(false,true,std::sync::atomic::Ordering::Acquire,std::sync::atomic::Ordering::Relaxed).is_err(){return Err(failure("BUSY"));}
    let lease=SaveLease;
    tauri::async_runtime::spawn_blocking(move||{
        let _lease=lease;
        let dialog=window.dialog().file().set_parent(&window).set_title(title).add_filter("Documento PDF",&["pdf"]).set_file_name(name);
        #[cfg(debug_assertions)]
        let dialog=if let Some(directory)=probe_initial_directory(){dialog.set_directory(directory)}else{dialog};
        let Some(chosen)=dialog.blocking_save_file() else{return Ok(SaveResult::Cancelled)};
        let path=selected_path(chosen.into_path().map_err(|_|failure("INVALID_NAME"))?)?;
        let sha256=write_pdf_without_replace(&path,&bytes)?;
        Ok(SaveResult::Saved{path:path.to_string_lossy().into_owned(),bytes:bytes.len(),sha256})
    }).await.map_err(|_|failure("IO_ERROR"))?
}

#[tauri::command]
pub async fn save_pdf_report(window:tauri::WebviewWindow,bytes:Vec<u8>,suggested_name:String)->Result<SaveResult>{
    if window.label()!="main"||!allowed_report_url(&window.url().map_err(|_|failure("UNAVAILABLE"))?){return Err(failure("UNAVAILABLE"));}
    perform_save(window,bytes,suggested_name,"Guardar reporte de simulación salarial").await
}

#[tauri::command]
pub async fn save_pdf_probe(window: tauri::WebviewWindow, bytes: Vec<u8>, suggested_name: String) -> Result<SaveResult> {
    #[cfg(not(debug_assertions))]
    {let _=(window,bytes,suggested_name);Err(failure("UNAVAILABLE"))}
    #[cfg(debug_assertions)]
    {
        if window.label()!="main" || !allowed_probe_url(&window.url().map_err(|_|failure("UNAVAILABLE"))?) {return Err(failure("UNAVAILABLE"));}
        perform_save(window,bytes,suggested_name,"Guardar PDF de prueba - Calculadora de Nómina").await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample()->Vec<u8>{b"%PDF-1.3\n% synthetic envelope used only in filesystem unit tests\nstartxref\n0\n%%EOF\n".to_vec()}
    fn folder()->PathBuf{let p=std::env::temp_dir().join("opencode").join(format!("5b10-pdf-rust-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&p).unwrap();p}
    #[test]fn payload_is_bounded_and_pdf_specific(){for value in [vec![],b"not a pdf".to_vec(),b"%PDF-1.3 no final marker and enough bytes".to_vec(),vec![0;MAX_PDF_BYTES+1]]{assert_eq!(validate_pdf(&value).unwrap_err().code,"INVALID_PDF")};validate_pdf(&sample()).unwrap()}
    #[test]fn suggested_names_are_basenames_with_pdf_extension(){assert_eq!(suggested_name("simulación-ñ").unwrap(),"simulación-ñ.pdf");assert_eq!(suggested_name("prueba.PDF").unwrap(),"prueba.PDF");for n in ["../x.pdf","C:\\x.pdf","NUL.pdf","COM1.pdf","x.txt","x.",""]{assert!(suggested_name(n).is_err(),"{n}")}}
    #[test]fn selected_extension_is_explicit(){let p=folder();assert_eq!(selected_path(p.join("nomina")).unwrap(),p.join("nomina.pdf"));assert!(selected_path(p.join("x.txt")).is_err());assert!(selected_path(PathBuf::from("relative.pdf")).is_err());fs::remove_dir_all(p).unwrap()}
    #[test]fn commit_is_exact_and_leaves_no_temporary_files(){let p=folder();let file=p.join("prueba.pdf");let bytes=sample();let hash=write_pdf_without_replace(&file,&bytes).unwrap();assert_eq!(fs::read(&file).unwrap(),bytes);assert_eq!(hash,format!("{:x}",Sha256::digest(&bytes)));assert_eq!(fs::read_dir(&p).unwrap().count(),1);fs::remove_dir_all(p).unwrap()}
    #[test]fn existing_files_are_never_replaced(){let p=folder();let file=p.join("existente.pdf");fs::write(&file,b"original").unwrap();assert_eq!(write_pdf_without_replace(&file,&sample()).unwrap_err().code,"ALREADY_EXISTS");assert_eq!(fs::read(&file).unwrap(),b"original");assert_eq!(fs::read_dir(&p).unwrap().count(),1);fs::remove_dir_all(p).unwrap()}
    #[test]fn temporary_collision_never_deletes_a_file_it_did_not_create(){let p=folder();let file=p.join("colision.tmp");fs::write(&file,b"conservar").unwrap();assert!(reserve_temporary(file.clone()).is_err());assert_eq!(fs::read(&file).unwrap(),b"conservar");assert_eq!(fs::read_dir(&p).unwrap().count(),1);fs::remove_dir_all(p).unwrap()}
    #[test]fn simultaneous_saves_do_not_overwrite_each_other(){let p=folder();let file=p.join("race.pdf");std::thread::scope(|s|{let a=s.spawn(||write_pdf_without_replace(&file,&sample()));let b=s.spawn(||write_pdf_without_replace(&file,&sample()));let results=[a.join().unwrap(),b.join().unwrap()];assert_eq!(results.iter().filter(|r|r.is_ok()).count(),1);assert_eq!(results.iter().filter(|r|r.as_ref().is_err_and(|e|e.code=="ALREADY_EXISTS")).count(),1)});assert_eq!(fs::read_dir(&p).unwrap().count(),1);fs::remove_dir_all(p).unwrap()}
    #[test]fn failed_destination_does_not_create_an_output(){let p=folder();let file=p.join("missing").join("x.pdf");assert!(write_pdf_without_replace(&file,&sample()).is_err());assert_eq!(fs::read_dir(&p).unwrap().count(),0);fs::remove_dir_all(p).unwrap()}
    #[test]fn production_and_remote_origins_cannot_save(){for url in ["http://127.0.0.1:1420/","http://127.0.0.1:1420/dev/history.html","https://example.com/dev/pdf.html","http://127.0.0.1:1432/dev/pdf.html","http://user@127.0.0.1:1420/dev/pdf.html"]{assert!(!allowed_probe_url(&url.parse().unwrap()))};assert_eq!(allowed_probe_url(&"http://127.0.0.1:1420/dev/pdf.html".parse().unwrap()),cfg!(debug_assertions))}
    #[test]fn report_boundary_accepts_only_application_origins(){for url in ["http://tauri.localhost/","https://tauri.localhost/index.html","tauri://localhost/"]{assert!(allowed_report_url(&url.parse().unwrap()))};for url in ["https://example.com/","http://tauri.localhost.evil/","http://user@tauri.localhost/","file:///C:/x.html","http://tauri.localhost/dev/pdf.html","http://127.0.0.1:1432/"]{assert!(!allowed_report_url(&url.parse().unwrap()))};assert_eq!(allowed_report_url(&"http://127.0.0.1:1420/".parse().unwrap()),cfg!(debug_assertions))}
    #[test]fn partial_write_storage_full_does_not_publish_a_pdf_or_leave_a_temp(){let p=folder();let file=p.join("full.pdf");let result=write_pdf_using(&file,&sample(),|handle,_|{handle.write_all(b"%PDF-partial")?;Err(io::Error::from(io::ErrorKind::StorageFull))});assert_eq!(result.unwrap_err().code,"DISK_FULL");assert!(!file.exists());assert_eq!(fs::read_dir(&p).unwrap().count(),0);fs::remove_dir_all(p).unwrap()}
    #[cfg(windows)]
    #[test]fn network_paths_are_not_an_authorized_local_destination(){assert_eq!(selected_path(PathBuf::from(r"\\servidor\carpeta\prueba.pdf")).unwrap_err().code,"LOCAL_DESTINATION_REQUIRED")}
}
