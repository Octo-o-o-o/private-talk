use crate::commands::secrets;
use crate::db::{collect_rows, now_timestamp, DbState};
use rusqlite::{params, types::Value, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

const API_TYPE_OPENAI_COMPATIBLE: &str = "openai-compatible";

#[derive(Debug, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub api_type: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
}

// ---------- DB-only helpers (testable without Tauri State) ----------

fn list_providers_db(conn: &Connection) -> Result<Vec<Provider>, String> {
    // We deliberately ignore the DB's api_key column when reading; the
    // secrets module owns it (Keychain on iOS, DB column elsewhere) so
    // every row goes through `secrets::load_provider_api_key` instead.
    let mut providers = collect_rows(
        conn,
        "SELECT id, name, api_type, base_url, models, is_default, created_at \
         FROM providers ORDER BY created_at ASC",
        [],
        |row| {
            let models_json: String = row.get(4)?;
            let is_default: i32 = row.get(5)?;
            Ok(Provider {
                id: row.get(0)?,
                name: row.get(1)?,
                api_type: row.get(2)?,
                base_url: row.get(3)?,
                api_key: String::new(),
                models: serde_json::from_str(&models_json).unwrap_or_default(),
                is_default: is_default != 0,
                created_at: row.get(6)?,
            })
        },
    )?;

    for provider in providers.iter_mut() {
        provider.api_key = secrets::load_provider_api_key(conn, &provider.id)
            .unwrap_or_default();
    }
    Ok(providers)
}

fn create_provider_db(
    conn: &Connection,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> Result<Provider, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_timestamp();
    let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;

    // First provider becomes the default automatically.
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM providers", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let is_default = count == 0;

    // Insert with an empty api_key — the secrets module writes it to its
    // platform-appropriate backing immediately after the row exists.
    conn.execute(
        "INSERT INTO providers \
           (id, name, api_type, base_url, api_key, models, is_default, created_at) \
         VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7)",
        params![
            id,
            name,
            API_TYPE_OPENAI_COMPATIBLE,
            base_url,
            models_json,
            is_default as i32,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    secrets::store_provider_api_key(conn, &id, &api_key)?;

    Ok(Provider {
        id,
        name,
        api_type: API_TYPE_OPENAI_COMPATIBLE.to_string(),
        base_url,
        api_key,
        models,
        is_default,
        created_at: now,
    })
}

fn update_provider_db(
    conn: &Connection,
    id: String,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    models: Option<Vec<String>>,
) -> Result<(), String> {
    let mut assignments: Vec<&str> = Vec::new();
    let mut values: Vec<Value> = Vec::new();

    if let Some(name) = name {
        assignments.push("name = ?");
        values.push(Value::Text(name));
    }
    if let Some(base_url) = base_url {
        assignments.push("base_url = ?");
        values.push(Value::Text(base_url));
    }
    if let Some(models) = models {
        let models_json = serde_json::to_string(&models).map_err(|e| e.to_string())?;
        assignments.push("models = ?");
        values.push(Value::Text(models_json));
    }

    if !assignments.is_empty() {
        let sql = format!(
            "UPDATE providers SET {} WHERE id = ?",
            assignments.join(", ")
        );
        values.push(Value::Text(id.clone()));

        conn.execute(&sql, rusqlite::params_from_iter(values))
            .map_err(|e| e.to_string())?;
    }

    if let Some(api_key) = api_key {
        secrets::store_provider_api_key(conn, &id, &api_key)?;
    }
    Ok(())
}

fn delete_provider_db(conn: &Connection, id: String) -> Result<(), String> {
    // Best-effort: even if the keychain delete fails (e.g. item already gone),
    // we still drop the DB row so the provider disappears from the UI.
    let _ = secrets::delete_provider_api_key(conn, &id);
    conn.execute("DELETE FROM providers WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn set_default_provider_db(conn: &Connection, id: String) -> Result<(), String> {
    conn.execute("UPDATE providers SET is_default = 0", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE providers SET is_default = 1 WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Tauri command shims (thin wrappers around DB helpers) ----------

#[tauri::command]
pub fn list_providers(db: State<DbState>) -> Result<Vec<Provider>, String> {
    let conn = db.lock()?;
    list_providers_db(&conn)
}

#[tauri::command]
pub fn create_provider(
    db: State<DbState>,
    name: String,
    base_url: String,
    api_key: String,
    models: Vec<String>,
) -> Result<Provider, String> {
    let conn = db.lock()?;
    create_provider_db(&conn, name, base_url, api_key, models)
}

#[tauri::command]
pub fn update_provider(
    db: State<DbState>,
    id: String,
    name: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    models: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = db.lock()?;
    update_provider_db(&conn, id, name, base_url, api_key, models)
}

#[tauri::command]
pub fn delete_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    delete_provider_db(&conn, id)
}

#[tauri::command]
pub fn set_default_provider(db: State<DbState>, id: String) -> Result<(), String> {
    let conn = db.lock()?;
    set_default_provider_db(&conn, id)
}

#[cfg(test)]
mod tests {
    use super::{
        create_provider_db, delete_provider_db, list_providers_db, set_default_provider_db,
        update_provider_db,
    };
    use crate::db::schema::init_db;
    use rusqlite::Connection;

    fn fresh() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_db(&c).unwrap();
        c
    }

    #[test]
    fn create_provider_marks_first_provider_as_default() {
        let conn = fresh();
        let p1 = create_provider_db(
            &conn,
            "OpenAI".into(),
            "https://api.openai.com/v1".into(),
            "sk-1".into(),
            vec!["gpt-4o".into()],
        )
        .unwrap();
        assert!(p1.is_default, "first provider must be default");
        assert_eq!(p1.api_type, "openai-compatible");
        assert_eq!(p1.models, vec!["gpt-4o".to_string()]);
    }

    #[test]
    fn create_provider_does_not_steal_default_from_existing() {
        let conn = fresh();
        let _first = create_provider_db(
            &conn,
            "OpenAI".into(),
            "https://api.openai.com/v1".into(),
            "sk-1".into(),
            vec!["gpt-4o".into()],
        )
        .unwrap();
        let second = create_provider_db(
            &conn,
            "xAI".into(),
            "https://api.x.ai/v1".into(),
            "sk-2".into(),
            vec!["grok-4".into()],
        )
        .unwrap();
        assert!(!second.is_default, "subsequent providers must not steal default");

        let list = list_providers_db(&conn).unwrap();
        assert_eq!(list.iter().filter(|p| p.is_default).count(), 1);
    }

    #[test]
    fn update_provider_only_touches_provided_fields() {
        let conn = fresh();
        let p = create_provider_db(
            &conn,
            "OpenAI".into(),
            "https://api.openai.com/v1".into(),
            "sk-old".into(),
            vec!["gpt-4o".into()],
        )
        .unwrap();

        // Only update api_key; name / base_url / models must stay.
        update_provider_db(
            &conn,
            p.id.clone(),
            None,
            None,
            Some("sk-new".into()),
            None,
        )
        .unwrap();

        let after = &list_providers_db(&conn).unwrap()[0];
        assert_eq!(after.name, "OpenAI");
        assert_eq!(after.base_url, "https://api.openai.com/v1");
        assert_eq!(after.api_key, "sk-new");
        assert_eq!(after.models, vec!["gpt-4o".to_string()]);
    }

    #[test]
    fn update_provider_with_all_none_is_a_noop() {
        let conn = fresh();
        let p = create_provider_db(
            &conn,
            "OpenAI".into(),
            "https://api.openai.com/v1".into(),
            "sk-old".into(),
            vec!["gpt-4o".into()],
        )
        .unwrap();

        update_provider_db(&conn, p.id.clone(), None, None, None, None).unwrap();

        let after = &list_providers_db(&conn).unwrap()[0];
        assert_eq!(after.name, "OpenAI");
        assert_eq!(after.api_key, "sk-old");
    }

    #[test]
    fn set_default_provider_makes_exactly_one_provider_default() {
        let conn = fresh();
        let p1 = create_provider_db(
            &conn,
            "OpenAI".into(),
            "u1".into(),
            "k1".into(),
            vec![],
        )
        .unwrap();
        let p2 = create_provider_db(
            &conn,
            "xAI".into(),
            "u2".into(),
            "k2".into(),
            vec![],
        )
        .unwrap();

        // Initially p1 is default; flip to p2.
        set_default_provider_db(&conn, p2.id.clone()).unwrap();

        let list = list_providers_db(&conn).unwrap();
        let defaults: Vec<&str> = list
            .iter()
            .filter(|p| p.is_default)
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(defaults, vec![p2.id.as_str()]);
        // p1 has been demoted.
        assert!(
            list.iter().find(|p| p.id == p1.id).unwrap().is_default == false
        );
    }

    #[test]
    fn delete_provider_removes_only_the_targeted_row() {
        let conn = fresh();
        let p1 = create_provider_db(
            &conn,
            "OpenAI".into(),
            "u1".into(),
            "k1".into(),
            vec![],
        )
        .unwrap();
        let _p2 = create_provider_db(
            &conn,
            "xAI".into(),
            "u2".into(),
            "k2".into(),
            vec![],
        )
        .unwrap();

        delete_provider_db(&conn, p1.id.clone()).unwrap();

        let list = list_providers_db(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_ne!(list[0].id, p1.id);
    }

    #[test]
    fn list_providers_orders_by_created_at_ascending() {
        let conn = fresh();
        let p1 = create_provider_db(&conn, "A".into(), "u1".into(), "k1".into(), vec![]).unwrap();
        let p2 = create_provider_db(&conn, "B".into(), "u2".into(), "k2".into(), vec![]).unwrap();

        let ids: Vec<String> = list_providers_db(&conn)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(ids, vec![p1.id, p2.id]);
    }
}
