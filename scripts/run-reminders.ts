import { loadConfig } from "../src/config.js";
import { Database } from "../src/database.js";
import { checkReminders } from "../src/reminders.js";

process.umask(0o077);
const config = loadConfig();
const db = new Database(config.DATABASE_PATH);
try { await checkReminders({ ...config, DB: db }); }
catch { console.error("Reminder job failed"); process.exitCode = 1; }
finally { db.close(); }
