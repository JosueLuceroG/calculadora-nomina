use tauri::{LogicalSize, PhysicalPosition, WebviewWindow};

const TARGET_WIDTH: f64 = 1180.0;
const TARGET_HEIGHT: f64 = 760.0;
const EDGE_MARGIN: f64 = 8.0;

/// Client size in logical pixels. The native frame and taskbar are reserved first.
fn fitted_size(work: (u32, u32), frame: (u32, u32), scale: f64) -> LogicalSize<f64> {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let usable_width = work.0.saturating_sub(frame.0) as f64 / scale;
    let usable_height = work.1.saturating_sub(frame.1) as f64 / scale;
    if usable_width >= TARGET_WIDTH && usable_height >= TARGET_HEIGHT {
        return LogicalSize::new(TARGET_WIDTH, TARGET_HEIGHT);
    }
    let available_width = (usable_width - EDGE_MARGIN * 2.0).max(1.0);
    let available_height = (usable_height - EDGE_MARGIN * 2.0).max(1.0);
    let ratio = (available_width / TARGET_WIDTH)
        .min(available_height / TARGET_HEIGHT)
        .min(1.0);
    LogicalSize::new((TARGET_WIDTH * ratio).floor(), (TARGET_HEIGHT * ratio).floor())
}

pub fn prepare_window(window: &WebviewWindow) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let Some(monitor) = monitor else {
        return window.center();
    };
    let work = monitor.work_area();
    let outer = window.outer_size()?;
    let inner = window.inner_size()?;
    let frame = (outer.width.saturating_sub(inner.width), outer.height.saturating_sub(inner.height));
    let size = fitted_size((work.size.width, work.size.height), frame, monitor.scale_factor());

    // Small work areas take precedence over the nominal minimum.
    window.set_min_size(None::<LogicalSize<f64>>)?;
    window.set_size(size)?;
    window.set_min_size(Some(LogicalSize::new(900.0_f64.min(size.width), 600.0_f64.min(size.height))))?;

    let outer = window.outer_size()?;
    let x = work.position.x + (work.size.width.saturating_sub(outer.width) / 2) as i32;
    let y = work.position.y + (work.size.height.saturating_sub(outer.height) / 2) as i32;
    window.set_position(PhysicalPosition::new(x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_fits_at_supported_scales_when_work_area_is_large_enough() {
        for scale in [1.0, 1.25, 1.5] {
            let size = fitted_size((2560, 1400), (24, 60), scale);
            assert_eq!(size, LogicalSize::new(1180.0, 760.0));
        }
    }

    #[test]
    fn smaller_work_areas_fit_proportionally_including_frame_at_each_scale() {
        for scale in [1.0, 1.25, 1.5] {
            for work in [(1366, 728), (1280, 680), (1024, 560), (800, 440)] {
                let frame = (20, 50);
                let size = fitted_size(work, frame, scale);
                assert!(size.width * scale + frame.0 as f64 + EDGE_MARGIN * 2.0 * scale <= work.0 as f64);
                assert!(size.height * scale + frame.1 as f64 + EDGE_MARGIN * 2.0 * scale <= work.1 as f64);
                assert!(size.width <= TARGET_WIDTH && size.height <= TARGET_HEIGHT);
                assert!((size.width / size.height - TARGET_WIDTH / TARGET_HEIGHT).abs() < 0.01);
            }
        }
    }

    #[test]
    fn invalid_scale_falls_back_to_one_without_panicking() {
        for scale in [0.0, -1.0, f64::NAN] {
            assert_eq!(fitted_size((1920, 1040), (16, 40), scale), LogicalSize::new(1180.0, 760.0));
        }
    }

    #[test]
    fn target_is_preserved_when_only_the_native_frame_fits() {
        assert_eq!(fitted_size((1200, 810), (20, 50), 1.0), LogicalSize::new(1180.0, 760.0));
    }
}
