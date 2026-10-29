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
                use std::fs;

                // Get app data directory and ensure it exists
                let app_data_dir = _app.path().app_data_dir()
                    .expect("Failed to get app data directory");
                fs::create_dir_all(&app_data_dir)
                    .expect("Failed to create app data directory");

                // Set database path inside app data directory
                let db_path = app_data_dir.join("hamba.db");
                let db_path_str = db_path.to_string_lossy().to_string();

                let sidecar = _app.shell().sidecar("backend")
                    .expect("Failed to create sidecar command")
                    .env("DATABASE_PATH", &db_path_str);

                let (_rx, child) = sidecar.spawn()
                    .expect("Failed to spawn backend sidecar");
                _app.manage(child);

                println!("Backend sidecar started with DATABASE_PATH={}", db_path_str);
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
