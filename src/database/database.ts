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
        marginBalance REAL DEFAULT 0.00,
        marginUsed REAL DEFAULT 0.00,
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
    
    CREATE TABLE IF NOT EXISTS options_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        symbol TEXT,
        optionType TEXT CHECK(optionType IN ('call', 'put')),
        quantity INTEGER,
        strikePrice REAL,
        expirationDate TEXT,
        purchasePrice REAL,
        position TEXT CHECK(position IN ('long', 'short')),
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'expired', 'exercised')),
        FOREIGN KEY (userId) REFERENCES users(userId)
    );
    
    CREATE TABLE IF NOT EXISTS options_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        symbol TEXT,
        optionType TEXT CHECK(optionType IN ('call', 'put')),
        quantity INTEGER,
        strikePrice REAL,
        expirationDate TEXT,
        price REAL,
        position TEXT CHECK(position IN ('long', 'short')),
        type TEXT CHECK(type IN ('open', 'close', 'exercise', 'expire')),
        timestamp TEXT DEFAULT (datetime('now', 'utc')),
        FOREIGN KEY (userId) REFERENCES users(userId)
    );
    
    CREATE TABLE IF NOT EXISTS margin_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        amount REAL,
        reason TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'satisfied', 'liquidated')),
        createdAt TEXT DEFAULT (datetime('now', 'utc')),
        resolvedAt TEXT,
        FOREIGN KEY (userId) REFERENCES users(userId)
    );
`);

export default db;