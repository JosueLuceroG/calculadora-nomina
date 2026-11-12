fn main() {
    assert!(!(std::env::var_os("CARGO_FEATURE_FISCAL_IMPORT_QA").is_some() && std::env::var_os("CARGO_FEATURE_FISCAL_PRODUCTION").is_some()), "FISCAL_AUTHORITY_FEATURE_CONFLICT: QA and production are mutually exclusive");
    println!("cargo:rerun-if-env-changed=NOMINA_FISCAL_QA_BUILD_ACK");
    if std::env::var_os("CARGO_FEATURE_FISCAL_IMPORT_QA").is_some() {
        assert_eq!(std::env::var("PROFILE").as_deref(),Ok("debug"),"QA cannot be a release build");
        assert_eq!(std::env::var("NOMINA_FISCAL_QA_BUILD_ACK").as_deref(),Ok("5d3b2-isolated-only"),"Use the explicit isolated QA build launcher");
        assert!(std::fs::read_to_string("tauri.conf.json").expect("config").contains("\"active\": false"),"QA bundling must remain disabled");
    }
    tauri_build::build()
}
