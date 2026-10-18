//! Color schemes made by the Language Model from the writer's description. Each scheme is eight
//! colors; the frontend checks readability and expands them into a palette
//! (`src/lib/color-schemes.ts`). Saved schemes live in the app config directory as
//! `color-schemes.json`. Which scheme is shown is a setting (`theme_scheme_id`), not stored here.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::{command, AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SchemeColors {
    pub background: String,
    pub surface: String,
    pub text: String,
    pub text_dim: String,
    pub text_muted: String,
    pub accent: String,
    pub accent2: String,
    pub selection: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorScheme {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub colors: SchemeColors,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorSchemeLibrary {
    pub version: u32,
    pub items: Vec<ColorScheme>,
}

impl Default for ColorSchemeLibrary {
    fn default() -> Self {
        Self { version: 1, items: Vec::new() }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveRequest {
    id: Option<String>,
    name: String,
    prompt: String,
    colors: SchemeColors,
}

fn hex_digits(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|c| c.is_ascii_hexdigit())
}

/// An opaque `#rgb` or `#rrggbb`.
fn opaque_color(value: &str) -> bool {
    value.strip_prefix('#').is_some_and(|h| hex_digits(h, 3) || hex_digits(h, 6))
}

/// `#rrggbbaa` or `rgba(r, g, b, a)`, the forms the frontend stores for the selection.
fn translucent_color(value: &str) -> bool {
    if let Some(h) = value.strip_prefix('#') {
        return hex_digits(h, 8);
    }
    let Some(inner) = value.strip_prefix("rgba(").and_then(|v| v.strip_suffix(')')) else { return false };
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    parts.len() == 4
        && parts[..3].iter().all(|p| p.parse::<u8>().is_ok())
        && parts[3].parse::<f32>().is_ok_and(|a| (0.0..=1.0).contains(&a))
}

/// Shape only; contrast is checked by the frontend before anything is saved.
fn validate(colors: &SchemeColors) -> Result<(), String> {
    let opaque = [
        ("background", &colors.background), ("surface", &colors.surface), ("text", &colors.text),
        ("textDim", &colors.text_dim), ("textMuted", &colors.text_muted), ("accent", &colors.accent),
        ("accent2", &colors.accent2),
    ];
    for (key, value) in opaque {
        if !opaque_color(value) { return Err(format!("{key} must be an opaque #rgb or #rrggbb color.")); }
    }
    if !translucent_color(&colors.selection) {
        return Err("selection must be #rrggbbaa or rgba(r, g, b, a).".into());
    }
    Ok(())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Storage in one file, separated from the command layer for tests.
struct Store { file: PathBuf }

impl Store {
    /// Entries that are malformed (hand-edited, or from a newer version) are dropped rather than
    /// reaching the palette.
    fn load(&self) -> ColorSchemeLibrary {
        let mut library = fs::read_to_string(&self.file).ok()
            .and_then(|text| serde_json::from_str::<ColorSchemeLibrary>(&text).ok())
            .unwrap_or_default();
        library.items.retain(|item| valid_id(&item.id) && validate(&item.colors).is_ok());
        library
    }

    fn write(&self, library: &ColorSchemeLibrary) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Could not create the settings folder: {e}"))?;
        }
        let json = serde_json::to_vec_pretty(library).map_err(|e| e.to_string())?;
        crate::storage::write(&self.file, &json, false).map_err(|e| format!("Could not save color schemes: {e}"))
    }

    fn save(&self, request: SaveRequest) -> Result<ColorScheme, String> {
        let name = request.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err("Give the color scheme a name of up to 80 characters.".into());
        }
        if request.prompt.len() > 4000 {
            return Err("The prompt is too long to store.".into());
        }
        validate(&request.colors)?;
        let mut library = self.load();
        let now = now_ms();
        let item = match request.id {
            Some(id) => {
                let existing = library.items.iter_mut().find(|item| item.id == id)
                    .ok_or("No saved color scheme has that ID.")?;
                existing.name = name.to_owned();
                existing.prompt = request.prompt;
                existing.colors = request.colors;
                existing.updated_at = now;
                existing.clone()
            }
            None => {
                let mut id = format!("scheme-{now}");
                while library.items.iter().any(|item| item.id == id) { id.push('x'); }
                let item = ColorScheme { id, name: name.to_owned(), prompt: request.prompt, created_at: now, updated_at: now, colors: request.colors };
                library.items.push(item.clone());
                item
            }
        };
        self.write(&library)?;
        Ok(item)
    }

    fn delete(&self, id: &str) -> Result<(), String> {
        let mut library = self.load();
        let before = library.items.len();
        library.items.retain(|item| item.id != id);
        if library.items.len() == before {
            return Err("No saved color scheme has that ID.".into());
        }
        self.write(&library)
    }
}

fn store(app: &AppHandle) -> Result<Store, String> {
    Ok(Store { file: app.path().app_config_dir().map_err(|e| e.to_string())?.join("color-schemes.json") })
}

#[command]
pub fn color_schemes_load(app: AppHandle) -> Result<ColorSchemeLibrary, String> {
    Ok(store(&app)?.load())
}

#[command]
pub fn color_scheme_save(app: AppHandle, request: SaveRequest) -> Result<ColorScheme, String> {
    if request.id.as_deref().is_some_and(|id| !valid_id(id)) {
        return Err("Invalid color scheme ID.".into());
    }
    store(&app)?.save(request)
}

#[command]
pub fn color_scheme_delete(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) { return Err("Invalid color scheme ID.".into()); }
    store(&app)?.delete(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn sepia() -> SchemeColors {
        SchemeColors {
            background: "#f4ecd8".into(), surface: "#e9dfc6".into(), text: "#3a2e1f".into(), text_dim: "#5e4d36".into(),
            text_muted: "#8a7a62".into(), accent: "#9a4f1c".into(), accent2: "#5b6e3a".into(), selection: "rgba(154, 79, 28, 0.3)".into(),
        }
    }

    fn temp_store() -> (Store, PathBuf) {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("bustermark-schemes-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        (Store { file: dir.join("color-schemes.json") }, dir)
    }

    #[test]
    fn validates_color_forms() {
        assert!(validate(&sepia()).is_ok());
        assert!(validate(&SchemeColors { selection: "#9a4f1c4d".into(), background: "#FFF".into(), ..sepia() }).is_ok());
        assert!(validate(&SchemeColors { text: "black".into(), ..sepia() }).unwrap_err().starts_with("text "));
        assert!(validate(&SchemeColors { accent: "#9a4f1c80".into(), ..sepia() }).unwrap_err().starts_with("accent "));
        assert!(validate(&SchemeColors { selection: "#9a4f1c".into(), ..sepia() }).is_err());
        assert!(validate(&SchemeColors { selection: "rgba(300, 0, 0, 0.3)".into(), ..sepia() }).is_err());
        assert!(validate(&SchemeColors { selection: "rgba(1, 2, 3, 1.5)".into(), ..sepia() }).is_err());
    }

    #[test]
    fn saves_lists_updates_and_deletes_schemes() {
        let (store, root) = temp_store();
        assert_eq!(store.load(), ColorSchemeLibrary::default());
        let item = store.save(SaveRequest { id: None, name: " Sepia ".into(), prompt: "warm sepia".into(), colors: sepia() }).unwrap();
        assert_eq!(item.name, "Sepia");
        assert!(item.id.starts_with("scheme-"));
        assert_eq!(store.load().items, vec![item.clone()]);

        let updated = store.save(SaveRequest { id: Some(item.id.clone()), name: "Sepia night".into(), prompt: "p".into(),
            colors: SchemeColors { background: "#1d1812".into(), ..sepia() } }).unwrap();
        assert_eq!(updated.created_at, item.created_at);
        assert_eq!(store.load().items[0].colors.background, "#1d1812");

        assert!(store.save(SaveRequest { id: None, name: "Broken".into(), prompt: String::new(),
            colors: SchemeColors { selection: "blue".into(), ..sepia() } }).is_err());
        assert!(store.save(SaveRequest { id: None, name: "  ".into(), prompt: String::new(), colors: sepia() }).is_err());
        assert!(store.save(SaveRequest { id: Some("scheme-missing".into()), name: "X".into(), prompt: String::new(), colors: sepia() }).is_err());
        assert_eq!(store.load().items.len(), 1);

        store.delete(&item.id).unwrap();
        assert!(store.load().items.is_empty());
        assert!(store.delete(&item.id).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn drops_malformed_entries_and_unreadable_files() {
        let (store, root) = temp_store();
        let kept = store.save(SaveRequest { id: None, name: "Kept".into(), prompt: String::new(), colors: sepia() }).unwrap();
        let mut library = store.load();
        library.items.push(ColorScheme { id: "scheme-bad".into(), name: "Bad".into(), prompt: String::new(), created_at: 0, updated_at: 0,
            colors: SchemeColors { text: "url(x)".into(), ..sepia() } });
        store.write(&library).unwrap();
        assert_eq!(store.load().items, vec![kept]);

        fs::write(&store.file, "not json").unwrap();
        assert_eq!(store.load(), ColorSchemeLibrary::default());
        fs::remove_dir_all(root).unwrap();
    }
}
