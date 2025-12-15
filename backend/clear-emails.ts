import { Database } from "bun:sqlite";

const db = new Database("hamba.db");

console.log("Clearing emails and attachments...");

const emailCount = db.query("SELECT COUNT(*) as count FROM emails").get() as { count: number };
const attachmentCount = db.query("SELECT COUNT(*) as count FROM attachments").get() as { count: number };

db.run("DELETE FROM attachments");
db.run("DELETE FROM emails");

console.log(`Deleted ${emailCount.count} emails and ${attachmentCount.count} attachments`);
console.log("Accounts preserved. Restart the backend and press Shift+R to re-sync.");
