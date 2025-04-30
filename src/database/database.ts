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

// Function to update existing schemas when needed
function updateDatabaseSchema() {
    console.log('Checking for schema updates...');
    
    try {
        // Check if marginBalance column exists in users table
        const userTableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
        const hasMarginBalance = userTableInfo.some(column => column.name === 'marginBalance');
        
        if (!hasMarginBalance) {
            console.log('Adding marginBalance column to users table...');
            
            // Add marginBalance column with default value of 0
            db.exec('ALTER TABLE users ADD COLUMN marginBalance REAL DEFAULT 0');
            
            console.log('Successfully added marginBalance column to users table.');
        }
        
        // Check if marginUsed column exists in users table
        const hasMarginUsed = userTableInfo.some(column => column.name === 'marginUsed');
        
        if (!hasMarginUsed) {
            console.log('Adding marginUsed column to users table...');
            
            // Add marginUsed column with default value of 0
            db.exec('ALTER TABLE users ADD COLUMN marginUsed REAL DEFAULT 0');
            
            console.log('Successfully added marginUsed column to users table.');
        }

        // Check if we need to update the price_cache table's source constraint
        const sourceConstraint = db.prepare(`
            SELECT sql FROM sqlite_master 
            WHERE type='table' AND name='price_cache'
        `).get() as { sql: string } | undefined;
        
        if (sourceConstraint && sourceConstraint.sql && 
            sourceConstraint.sql.includes("source IN ('finnhub', 'yahoo')") && 
            !sourceConstraint.sql.includes("'coingecko'")) {
            
            console.log('Updating price_cache table to include coingecko source...');
            
            // We need to recreate the table with the updated constraint
            // SQLite doesn't allow direct ALTER of CHECK constraints
            
            // 1. First rename the existing table
            db.exec('ALTER TABLE price_cache RENAME TO price_cache_old');
            
            // 2. Create new table with updated constraint
            db.exec(`
                CREATE TABLE price_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    price REAL NOT NULL,
                    timestamp TEXT NOT NULL,
                    source TEXT CHECK(source IN ('finnhub', 'yahoo', 'coingecko')) NOT NULL,
                    interval TEXT DEFAULT '1m' NOT NULL,
                    UNIQUE(symbol, source, interval, timestamp)
                )
            `);
            
            // 3. Copy data from old table to new one
            db.exec('INSERT INTO price_cache SELECT * FROM price_cache_old');
            
            // 4. Drop the old table
            db.exec('DROP TABLE price_cache_old');
            
            // 5. Recreate the index
            db.exec('CREATE INDEX idx_price_lookup ON price_cache(symbol, source, interval, timestamp)');
            
            console.log('Successfully updated price_cache table schema.');
        }
    } catch (error) {
        console.error('Error updating database schema:', error);
    }
}

// Run schema updates before creating tables
updateDatabaseSchema();

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        cashBalance REAL DEFAULT 100000.00,
        marginBalance REAL DEFAULT 0,
        marginUsed REAL DEFAULT 0,
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
    
    CREATE TABLE IF NOT EXISTS crypto_portfolio (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        coinId TEXT,
        symbol TEXT,
        name TEXT,
        quantity REAL,
        averagePurchasePrice REAL,
        FOREIGN KEY (userId) REFERENCES users(userId),
        UNIQUE(userId, coinId)
    );

    CREATE TABLE IF NOT EXISTS crypto_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        coinId TEXT,
        symbol TEXT,
        name TEXT,
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
        marginRequired REAL DEFAULT 0.0,
        isSecured BOOLEAN DEFAULT 0,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed', 'expired', 'exercised', 'liquidated')),
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
        type TEXT CHECK(type IN ('open', 'close', 'exercise', 'expire', 'liquidate')),
        profit REAL,
        marginRequired REAL DEFAULT 0.0,
        isSecured BOOLEAN DEFAULT 0,
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
    
    CREATE TABLE IF NOT EXISTS price_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        timestamp TEXT NOT NULL,
        source TEXT CHECK(source IN ('finnhub', 'yahoo', 'coingecko')) NOT NULL,
        interval TEXT DEFAULT '1m' NOT NULL,
        UNIQUE(symbol, source, interval, timestamp)
    );
    
    CREATE INDEX IF NOT EXISTS idx_price_lookup ON price_cache(symbol, source, interval, timestamp);
    CREATE INDEX IF NOT EXISTS idx_crypto_portfolio_lookup ON crypto_portfolio(userId, coinId);
    CREATE INDEX IF NOT EXISTS idx_crypto_transactions_lookup ON crypto_transactions(userId, timestamp);
    
    CREATE TABLE IF NOT EXISTS subscriptions (
        channelId TEXT PRIMARY KEY,
        subscribedAt TEXT DEFAULT (datetime('now', 'utc'))
    );
`);

export default db;