//! Real-time notification hub: WebSocket clients subscribe to account IDs and
//! receive `new_mail`, `sync_complete`, `send_failed` and `background_sync_progress` messages.

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

struct Client {
    account_ids: HashSet<String>,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Clone, Default)]
pub struct Realtime {
    clients: Arc<Mutex<HashMap<u64, Client>>>,
    next_id: Arc<std::sync::atomic::AtomicU64>,
}

impl Realtime {
    pub async fn handle_socket(self, socket: WebSocket) {
        let id = self.next_id.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        self.clients.lock().unwrap().insert(
            id,
            Client {
                account_ids: HashSet::new(),
                tx,
            },
        );
        tracing::debug!(id, "WebSocket client connected");

        let (mut sink, mut stream) = socket.split();
        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sink.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
        });

        while let Some(Ok(msg)) = stream.next().await {
            if let Message::Text(text) = msg {
                // Ignore invalid messages
                if let Ok(data) = serde_json::from_str::<Value>(&text) {
                    if data["type"] == "subscribe" {
                        if let Some(account_id) = data["accountId"].as_str() {
                            if let Some(c) = self.clients.lock().unwrap().get_mut(&id) {
                                c.account_ids.insert(account_id.to_string());
                            }
                        }
                    }
                }
            }
        }

        self.clients.lock().unwrap().remove(&id);
        writer.abort();
        tracing::debug!(id, "WebSocket client disconnected");
    }

    fn broadcast(&self, account_id: &str, message: Value) {
        let text = message.to_string();
        let mut clients = self.clients.lock().unwrap();
        clients.retain(|_, c| {
            if c.account_ids.is_empty() || c.account_ids.contains(account_id) {
                c.tx.send(text.clone()).is_ok()
            } else {
                true
            }
        });
    }

    #[allow(dead_code)]
    pub fn notify_new_mail(&self, account_id: &str, email: Option<Value>) {
        self.broadcast(
            account_id,
            json!({ "type": "new_mail", "accountId": account_id, "email": email }),
        );
    }

    pub fn notify_send_failed(&self, account_id: &str, subject: &str, error: &str, draft_id: &str) {
        self.broadcast(
            account_id,
            json!({ "type": "send_failed", "accountId": account_id, "subject": subject, "error": error, "draftId": draft_id }),
        );
    }

    pub fn notify_sync_complete(&self, account_id: &str, count: i64) {
        self.broadcast(
            account_id,
            json!({ "type": "sync_complete", "accountId": account_id, "count": count }),
        );
    }

    #[allow(dead_code)]
    pub fn notify_background_sync_progress(&self, account_id: &str, synced: i64, total: i64) {
        let percentage = if total > 0 {
            ((synced as f64 / total as f64) * 100.0).round() as i64
        } else {
            0
        };
        self.broadcast(
            account_id,
            json!({ "type": "background_sync_progress", "accountId": account_id, "synced": synced, "total": total, "percentage": percentage }),
        );
    }
}
