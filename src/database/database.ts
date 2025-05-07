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
    let currentUserVersion = (db.pragma('user_version', { simple: true }) as number) || 0;
    console.log(`Current database user_version: ${currentUserVersion}`);

    try {
        if (currentUserVersion < 1) {
            console.log('Running migration for user_version < 1 (margin columns)...');
            // Check if users table exists before trying to get its info
            const usersTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
            if (usersTableExists) {
                const userTableInfo = db.prepare("PRAGMA table_info(users)").all() as any[];
                const hasMarginBalance = userTableInfo.some(column => column.name === 'marginBalance');
                if (!hasMarginBalance) {
                    console.log('Adding marginBalance column to users table...');
                    db.exec('ALTER TABLE users ADD COLUMN marginBalance REAL DEFAULT 0');
                    console.log('Successfully added marginBalance column.');
                }
                const hasMarginUsed = userTableInfo.some(column => column.name === 'marginUsed');
                if (!hasMarginUsed) {
                    console.log('Adding marginUsed column to users table...');
                    db.exec('ALTER TABLE users ADD COLUMN marginUsed REAL DEFAULT 0');
                    console.log('Successfully added marginUsed column.');
                }
            } else {
                console.log('Users table does not exist yet, skipping margin column additions for now.');
            }
            db.pragma(`user_version = 1`);
            currentUserVersion = 1; // Update for next check
            console.log('Migrations for user_version < 1 completed. Set user_version = 1.');
        }

        if (currentUserVersion < 2) {
            console.log('Running migration for user_version < 2 (price_cache Finnhub removal)...');
            const priceCacheTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='price_cache'").get() as { sql: string } | undefined;

            let needsPriceCacheMigration = false;
            if (priceCacheTableInfo && priceCacheTableInfo.sql) {
                // Check if 'finnhub' is part of the source constraint
                if (priceCacheTableInfo.sql.includes("'finnhub'")) {
                    needsPriceCacheMigration = true;
                }
            }

            if (needsPriceCacheMigration) {
                console.log('price_cache table needs migration to remove Finnhub.');
                db.exec('PRAGMA foreign_keys=OFF;'); // Disable foreign keys for schema changes
                const transaction = db.transaction(() => {
                    console.log("Updating 'finnhub' source to 'yahoo' in price_cache data...");
                    db.exec("UPDATE price_cache SET source = 'yahoo' WHERE source = 'finnhub';");

                    console.log('Recreating price_cache table with updated source constraint (yahoo, coingecko)...');
                    db.exec('ALTER TABLE price_cache RENAME TO price_cache_old_v2_migration');
                    db.exec(`
                        CREATE TABLE price_cache (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            symbol TEXT NOT NULL,
                            price REAL NOT NULL,
                            timestamp TEXT NOT NULL,
                            source TEXT CHECK(source IN ('yahoo', 'coingecko')) NOT NULL,
                            interval TEXT DEFAULT '1m' NOT NULL,
                            UNIQUE(symbol, source, interval, timestamp)
                        )
                    `);
                    // Copy data from the old table to the new one
                    db.exec('INSERT INTO price_cache (id, symbol, price, timestamp, source, interval) SELECT id, symbol, price, timestamp, source, interval FROM price_cache_old_v2_migration;');
                    db.exec('DROP TABLE price_cache_old_v2_migration;');
                    // Recreate the index if it existed or is desired
                    db.exec('CREATE INDEX IF NOT EXISTS idx_price_lookup ON price_cache(symbol, source, interval, timestamp)');
                    console.log('Successfully migrated price_cache table.');
                });
                
                try {
                    transaction(); // Execute the transaction
                } finally {
                    db.exec('PRAGMA foreign_keys=ON;'); // Re-enable foreign keys
                }
            } else {
                console.log('price_cache table does not require Finnhub removal migration (e.g., schema already updated or table does not exist yet).');
            }
            db.pragma(`user_version = 2`);
            // currentUserVersion = 2; // No need to update here as it's the last migration step in this function
            console.log('Migrations for user_version < 2 completed. Set user_version = 2.');
        }
        // The old block that specifically checked for adding 'coingecko' if 'finnhub' and 'yahoo' were present
        // is now superseded by the user_version = 2 migration logic above.
    } catch (error) {
        console.error('Error updating database schema:', error);
        // Depending on the error, you might want to re-throw or handle it to prevent app startup
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
        source TEXT CHECK(source IN ('yahoo', 'coingecko')) NOT NULL,
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
