import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const file = path.resolve(process.env.DATABASE_PATH ?? "./data/seo-health.db");
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = drizzle(new Database(file));
migrate(db, { migrationsFolder: path.resolve("drizzle") });
console.log(`Migrations applied to ${file}`);
