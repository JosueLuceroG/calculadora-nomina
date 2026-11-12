use serde::Deserialize;
use tauri::{window::Color, Theme, WebviewWindow};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppTheme { Light, Dark }

fn palette(theme: AppTheme) -> (Theme, Color) {
    match theme {
        AppTheme::Light => (Theme::Light, Color(247, 245, 240, 255)),
        AppTheme::Dark => (Theme::Dark, Color(17, 26, 24, 255)),
    }
}
pub fn apply(window: &WebviewWindow, theme: AppTheme) -> tauri::Result<()> {
    let (native, background) = palette(theme);
    window.set_theme(Some(native))?;
    window.set_background_color(Some(background))
}
#[tauri::command]
pub fn set_app_theme(window: WebviewWindow, theme: AppTheme) -> Result<(), &'static str> {
    if window.label() != "main" { return Err("Ventana no disponible"); }
    apply(&window, theme).map_err(|_| "No se pudo aplicar el tema de la ventana")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_explicit_light_and_dark_are_accepted() {
        assert!(matches!(serde_json::from_str::<AppTheme>("\"light\"").unwrap(), AppTheme::Light));
        assert!(matches!(serde_json::from_str::<AppTheme>("\"dark\"").unwrap(), AppTheme::Dark));
        for value in ["\"system\"", "\"auto\"", "null", "0", "\"Dark\""] { assert!(serde_json::from_str::<AppTheme>(value).is_err()); }
    }
    #[test]
    fn native_palette_matches_canvas_and_keeps_opaque_backgrounds() {
        let (theme, color) = palette(AppTheme::Light);
        assert_eq!(theme, Theme::Light); assert_eq!(color, Color(247,245,240,255));
        let (theme, color) = palette(AppTheme::Dark);
        assert_eq!(theme, Theme::Dark); assert_eq!(color, Color(17,26,24,255));
    }
}
