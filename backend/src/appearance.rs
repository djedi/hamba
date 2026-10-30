//! Account appearance: color palette and avatar validation.

/// Curated palette (readable with white text). Keep in sync with
/// `ACCOUNT_COLORS` in frontend/src/lib/accountAppearance.ts and migration 013.
pub const PALETTE: [&str; 12] = [
    "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#b45309",
    "#15803d", "#0f766e", "#0891b2", "#4f46e5", "#a21caf", "#475569",
];

pub fn random_color() -> &'static str {
    let b = uuid::Uuid::new_v4().as_bytes()[0] as usize;
    PALETTE[b % PALETTE.len()]
}

pub fn is_valid_color(c: &str) -> bool {
    c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub const MAX_AVATAR_BYTES: usize = 2 * 1024 * 1024;
pub const AVATAR_MIMES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Account columns without the avatar blob (never load the blob in `SELECT *`).
pub fn account_columns(conn: &rusqlite::Connection) -> String {
    use std::sync::OnceLock;
    static COLS: OnceLock<String> = OnceLock::new();
    COLS.get_or_init(|| {
        let mut stmt = conn
            .prepare("SELECT name FROM pragma_table_info('accounts') WHERE name != 'avatar'")
            .unwrap();
        let names: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().flatten().collect();
        names.join(", ")
    })
    .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_validation() {
        assert!(is_valid_color("#a1B2c3"));
        assert!(!is_valid_color("a1b2c3"));
        assert!(!is_valid_color("#12345"));
        assert!(!is_valid_color("#gggggg"));
        assert!(PALETTE.iter().all(|c| is_valid_color(c)));
    }
}
