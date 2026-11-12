#[cfg(all(feature = "fiscal-import-qa", feature = "fiscal-production"))]
compile_error!("FISCAL_AUTHORITY_FEATURE_CONFLICT: QA and production are mutually exclusive");

mod window_layout;
mod official_sources;
mod storage;
mod appearance;
mod pdf_probe;
mod fiscal_repository;
mod fiscal_import;
mod fiscal_activation;
mod fiscal_execution;

use tauri::Manager;

pub fn run() {
    fiscal_import::host_context::validate_qa_environment().expect("Invalid isolated fiscal QA context");
    let builder = tauri::Builder::default();
    let builder = builder.plugin(tauri_plugin_dialog::init());
    builder
        .invoke_handler(tauri::generate_handler![official_sources::open_official_source, appearance::set_app_theme, pdf_probe::save_pdf_probe, pdf_probe::save_pdf_report,
            storage::commands::storage_info, storage::commands::storage_begin_write,
            storage::commands::storage_insert, storage::commands::storage_insert_automatic, storage::commands::storage_list,
            storage::commands::storage_get, storage::commands::storage_delete,
            storage::commands::storage_clear, storage::commands::storage_get_preferences,
            storage::commands::storage_set_preferences, storage::commands::storage_recover_corrupt,
            fiscal_import::commands::fiscal_import_info, fiscal_import::commands::fiscal_import_begin,
            fiscal_import::commands::fiscal_import_get, fiscal_import::commands::fiscal_import_details,
            fiscal_import::commands::fiscal_import_refresh, fiscal_import::commands::fiscal_import_cancel,
            fiscal_import::commands::fiscal_import_confirm, fiscal_import::commands::fiscal_packages_list,
            fiscal_import::commands::fiscal_operation_status,
            fiscal_activation::commands::fiscal_activation_eligibility,
            fiscal_activation::commands::fiscal_activation_prepare,
            fiscal_activation::commands::fiscal_activation_get,
            fiscal_activation::commands::fiscal_activation_cancel,
            fiscal_activation::commands::fiscal_activation_confirm,
            fiscal_activation::commands::fiscal_selection_get,
            fiscal_activation::commands::fiscal_selection_deactivate,
            fiscal_execution::commands::fiscal_execution_prepare,
            fiscal_execution::commands::fiscal_execution_material,
            fiscal_execution::commands::fiscal_execution_cancel,
            fiscal_execution::commands::fiscal_execution_status,
            fiscal_execution::commands::fiscal_execution_complete,
            fiscal_execution::commands::fiscal_execution_finalize,
            fiscal_execution::commands::fiscal_execution_reconcile])
        .on_page_load(|webview,payload|{
            if let Some(service)=webview.app_handle().try_state::<std::sync::Arc<fiscal_import::ImportService>>(){service.navigation(webview.window().label(),matches!(payload.event(),tauri::webview::PageLoadEvent::Started));}
            if matches!(payload.event(),tauri::webview::PageLoadEvent::Started){if let Some(service)=webview.app_handle().try_state::<std::sync::Arc<fiscal_activation::ActivationService>>(){service.navigation(webview.window().label());}}
            if matches!(payload.event(),tauri::webview::PageLoadEvent::Started){if let Some(service)=webview.app_handle().try_state::<std::sync::Arc<fiscal_execution::ExecutionService>>(){service.navigation(webview.window().label());}}
        })
        .on_window_event(|window,event|{if matches!(event,tauri::WindowEvent::Destroyed){if let Some(service)=window.app_handle().try_state::<std::sync::Arc<fiscal_import::ImportService>>(){service.navigation(window.label(),true);}if let Some(service)=window.app_handle().try_state::<std::sync::Arc<fiscal_activation::ActivationService>>(){service.navigation(window.label());}if let Some(service)=window.app_handle().try_state::<std::sync::Arc<fiscal_execution::ExecutionService>>(){service.navigation(window.label());}}})
        .setup(|app| {
            let root=fiscal_import::host_context::validate_qa_environment().map_err(|e|e.code)?.unwrap_or(app.path().app_local_data_dir()?);
            let imports=fiscal_import::host_context::make(root);
            app.manage(std::sync::Arc::new(fiscal_activation::ActivationService::new(imports.clone())));
            let salary=std::sync::Arc::new(storage::StorageService::new(storage::commands::application_root(app.handle())));
            app.manage(std::sync::Arc::new(fiscal_execution::ExecutionService::with_storage(imports.clone(),salary.clone())));
            app.manage(imports);
            app.manage(salary);
            if let Some(window) = app.get_webview_window("main") {
                if fiscal_import::host_context::is_qa(){window.set_title("Calculadora de Nómina — QA de importación fiscal")?;}
                // No abrir SQLite en setup: Claro hasta la lectura de preferencias de UI.
                if appearance::apply(&window, appearance::AppTheme::Light).is_err() {
                    eprintln!("No se pudo preparar el tema de la ventana");
                }
                if let Err(error) = window_layout::prepare_window(&window) {
                    eprintln!("No se pudo ajustar la ventana al monitor: {error}");
                }
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("No se pudo iniciar Calculadora de Nómina");
}
