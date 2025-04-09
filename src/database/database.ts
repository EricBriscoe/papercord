import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Create database directory if it doesn't exist
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database
const db = new Database(path.join(dbDir, 'paper-trading.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        cashBalance REAL DEFAULT 100000.00,
        createdAt TEXT DEFAULT (datetime('now', 'utc'))
    );

    CREATE TABLE IF NOT EXISTS portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        symbol TEXT,
        quantity REAL,
        averagePurchasePrice REAL,
        FOREIGN KEY (userId) REFERENCES users(userId),
        UNIQUE(userId, symbol)
    );

    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        symbol TEXT,
        quantity REAL,
        price REAL,
        type TEXT CHECK(type IN ('buy', 'sell')),
        timestamp TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (userId) REFERENCES users(userId)
    );
`);

export default db;