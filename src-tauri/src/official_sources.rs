use tauri::Url;

// La URL concreta procede del catálogo verificado. La integración nativa acepta
// únicamente publicaciones HTTPS de las autoridades utilizadas, nunca comandos,
// archivos, credenciales, parámetros de consulta ni sitios ajenos.
fn allowed_official_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "URL oficial inválida.".to_string())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Se requiere un documento oficial HTTPS sin parámetros adicionales.".into());
    }
    let path = url.path();
    let allowed = match url.host_str() {
        Some("sidof.segob.gob.mx") => path
            .strip_prefix("/notas/docFuente/")
            .map(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
            .unwrap_or(false),
        Some("www.sat.gob.mx") => {
            path.starts_with("/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/")
                && path.ends_with(".pdf")
        }
        Some("www.inegi.org.mx") => {
            path.starts_with("/contenidos/saladeprensa/boletines/")
                && path.contains("/uma/")
                && path.ends_with(".pdf")
        }
        Some("www.diputados.gob.mx") => matches!(
            path,
            "/LeyesBiblio/pdf/LISR.pdf" | "/LeyesBiblio/pdf/LSS.pdf" | "/LeyesBiblio/pdf/LFT.pdf"
        ),
        _ => false,
    };
    if !allowed {
        return Err("El enlace no pertenece a las publicaciones oficiales admitidas.".into());
    }
    Ok(url)
}

#[cfg(target_os = "windows")]
fn open_in_browser(url: &Url) -> Result<(), String> {
    use std::ffi::{c_void, OsStr};
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
    }
    let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(Some(0)).collect();
    let document: Vec<u16> = OsStr::new(url.as_str()).encode_wide().chain(Some(0)).collect();
    // ShellExecute abre el manejador HTTPS del usuario; no ejecuta una shell ni
    // concatena el enlace a una línea de comandos.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(), operation.as_ptr(), document.as_ptr(),
            std::ptr::null(), std::ptr::null(), 1,
        )
    };
    if result <= 32 {
        Err(format!("No se pudo abrir el navegador predeterminado ({result})."))
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn open_in_browser(_url: &Url) -> Result<(), String> {
    Err("La apertura nativa está disponible en Windows.".into())
}

#[tauri::command]
pub async fn open_official_source(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Solicitud fuera de la ventana principal.".into());
    }
    open_in_browser(&allowed_official_url(&url)?)
}

#[cfg(test)]
mod tests {
    use super::allowed_official_url;

    #[test]
    fn accepts_official_documents_used_by_the_catalog() {
        for url in [
            "https://sidof.segob.gob.mx/notas/docFuente/5777219",
            "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf",
            "https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf",
            "https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf",
        ] {
            assert!(allowed_official_url(url).is_ok(), "{url}");
        }
    }
    #[test]
    fn rejects_other_protocols_and_unrelated_hosts() {
        for url in ["file:///C:/Windows/notepad.exe", "javascript:alert(1)", "http://sidof.segob.gob.mx/notas/docFuente/5777219", "https://example.com/LSS.pdf", "https://www.diputados.gob.mx.ejemplo.test/LeyesBiblio/pdf/LSS.pdf"] {
            assert!(allowed_official_url(url).is_err(), "{url}");
        }
    }
    #[test]
    fn rejects_credentials_queries_and_unrelated_paths() {
        for url in ["https://user@www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf?next=other", "https://www.diputados.gob.mx/LeyesBiblio/pdf/LSS.pdf#other", "https://sidof.segob.gob.mx/notas/docFuente/abc", "https://www.sat.gob.mx/", "https://www.diputados.gob.mx:8443/LeyesBiblio/pdf/LSS.pdf"] {
            assert!(allowed_official_url(url).is_err(), "{url}");
        }
    }
}
