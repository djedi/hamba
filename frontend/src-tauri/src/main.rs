#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // In release mode, spawn the backend sidecar
            // In dev mode, run backend separately: cd backend && bun run dev
            #[cfg(not(debug_assertions))]
            {
                let sidecar = _app.shell().sidecar("backend")
                    .expect("Failed to create sidecar command");
                let (_rx, child) = sidecar.spawn()
                    .expect("Failed to spawn backend sidecar");
                _app.manage(child);
            }

            #[cfg(debug_assertions)]
            {
                println!("Dev mode: Run backend separately with 'cd backend && bun run dev'");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
