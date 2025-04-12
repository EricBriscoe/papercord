import db from './database';

interface User {
    userId: string;
    cashBalance: number;
    marginBalance: number;
    marginUsed: number;
    createdAt: string;
}

interface CashResult {
    cashBalance: number;
}

interface Position {
    id?: number;
    userId: string;
    symbol: string;
    quantity: number;
    averagePurchasePrice: number;
}

interface Transaction {
    id?: number;
    userId: string;
    symbol: string;
    quantity: number;
    price: number;
    type: 'buy' | 'sell';
    timestamp?: string;
}

interface OptionsPosition {
    id?: number;
    userId: string;
    symbol: string;
    optionType: 'call' | 'put';
    quantity: number;
    strikePrice: number;
    expirationDate: string;
    purchasePrice: number;
    position: 'long' | 'short';
    marginRequired: number;
    isSecured: boolean;
    status: 'open' | 'closed' | 'expired' | 'exercised' | 'liquidated';
}

interface OptionsTransaction {
    id?: number;
    userId: string;
    symbol: string;
    optionType: 'call' | 'put';
    quantity: number;
    strikePrice: number;
    expirationDate: string;
    price: number;
    position: 'long' | 'short';
    type: 'open' | 'close' | 'exercise' | 'expire' | 'liquidate';
    profit?: number;
    marginRequired: number;
    isSecured: boolean;
    timestamp?: string;
}

interface MarginCall {
    id?: number;
    userId: string;
    amount: number;
    reason: string;
    status: 'pending' | 'satisfied' | 'liquidated';
    createdAt: string;
    resolvedAt?: string;
}

interface CryptoPosition {
    id?: number;
    userId: string;
    coinId: string;
    symbol: string;
    name: string;
    quantity: number;
    averagePurchasePrice: number;
}

interface CryptoTransaction {
    id?: number;
    userId: string;
    coinId: string;
    symbol: string;
    name: string;
    quantity: number;
    price: number;
    type: 'buy' | 'sell';
    timestamp?: string;
}

/**
 * User database operations
 */
export const userDb = {
    /**
     * Get user from database, create if not exists
     */
    getOrCreateUser(userId: string): User {
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO users (userId) VALUES (?)
        `);
        stmt.run(userId);
        
        const userStmt = db.prepare('SELECT * FROM users WHERE userId = ?');
        return userStmt.get(userId) as User;
    },
    
    /**
     * Get user's cash balance
     */
    getCashBalance(userId: string): number {
        const stmt = db.prepare('SELECT cashBalance FROM users WHERE userId = ?');
        const result = stmt.get(userId) as CashResult | undefined;
        return result ? result.cashBalance : 0;
    },
    
    /**
     * Update user's cash balance
     */
    updateCashBalance(userId: string, newBalance: number): void {
        const stmt = db.prepare('UPDATE users SET cashBalance = ? WHERE userId = ?');
        stmt.run(newBalance, userId);
    },
    
    /**
     * Get user's margin balance
     */
    getMarginBalance(userId: string): { marginBalance: number, marginUsed: number } {
        const stmt = db.prepare('SELECT marginBalance, marginUsed FROM users WHERE userId = ?');
        const result = stmt.get(userId) as { marginBalance: number, marginUsed: number } | undefined;
        return result || { marginBalance: 0, marginUsed: 0 };
    },
    
    /**
     * Update user's margin balance
     */
    updateMarginBalance(userId: string, marginBalance: number, marginUsed: number): void {
        const stmt = db.prepare('UPDATE users SET marginBalance = ?, marginUsed = ? WHERE userId = ?');
        stmt.run(marginBalance, marginUsed, userId);
    },
    
    /**
     * Increase user's margin balance
     */
    increaseMarginBalance(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginBalance = marginBalance + ? WHERE userId = ?');
        stmt.run(amount, userId);
    },
    
    /**
     * Increase user's margin used
     */
    increaseMarginUsed(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginUsed = marginUsed + ? WHERE userId = ?');
        stmt.run(amount, userId);
    },
    
    /**
     * Decrease user's margin used
     */
    decreaseMarginUsed(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginUsed = MAX(0, marginUsed - ?) WHERE userId = ?');
        stmt.run(amount, userId);
    }
};

/**
 * Portfolio database operations
 */
export const portfolioDb = {
    /**
     * Get user's portfolio
     */
    getUserPortfolio(userId: string): Position[] {
        const stmt = db.prepare(`
            SELECT symbol, quantity, averagePurchasePrice 
            FROM portfolio 
            WHERE userId = ? AND quantity > 0
        `);
        return stmt.all(userId) as Position[];
    },
    
    /**
     * Get user's position for a specific symbol
     */
    getUserPosition(userId: string, symbol: string): Position | undefined {
        const stmt = db.prepare(`
            SELECT symbol, quantity, averagePurchasePrice 
            FROM portfolio 
            WHERE userId = ? AND symbol = ?
        `);
        return stmt.get(userId, symbol.toUpperCase()) as Position | undefined;
    },
    
    /**
     * Add or update a position in user's portfolio
     */
    updatePosition(userId: string, symbol: string, quantity: number, averagePrice: number): void {
        const stmt = db.prepare(`
            INSERT INTO portfolio (userId, symbol, quantity, averagePurchasePrice)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(userId, symbol) DO UPDATE
            SET quantity = ?, averagePurchasePrice = ?
        `);
        stmt.run(userId, symbol.toUpperCase(), quantity, averagePrice, quantity, averagePrice);
    }
};

/**
 * Transaction database operations
 */
export const transactionDb = {
    /**
     * Add a buy/sell transaction to history
     */
    addTransaction(userId: string, symbol: string, quantity: number, price: number, type: 'buy' | 'sell'): void {
        const stmt = db.prepare(`
            INSERT INTO transactions (userId, symbol, quantity, price, type)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, symbol.toUpperCase(), quantity, price, type);
    },
    
    /**
     * Get transaction history for a user
     */
    getUserTransactions(userId: string, limit = 10): Transaction[] {
        const stmt = db.prepare(`
            SELECT * FROM transactions
            WHERE userId = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit) as Transaction[];
    }
};

/**
 * Options positions database operations
 */
export const optionsDb = {
    /**
     * Get all open options positions for a user
     */
    getOpenPositions(userId: string): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND status = 'open'
            ORDER BY expirationDate ASC
        `);
        return stmt.all(userId) as OptionsPosition[];
    },
    
    /**
     * Get specific options position by ID
     */
    getPositionById(id: number): OptionsPosition | undefined {
        const stmt = db.prepare('SELECT * FROM options_positions WHERE id = ?');
        return stmt.get(id) as OptionsPosition | undefined;
    },
    
    /**
     * Get matching open options position
     */
    getMatchingPosition(
        userId: string, 
        symbol: string, 
        optionType: 'call' | 'put', 
        strikePrice: number, 
        expirationDate: string,
        position: 'long' | 'short',
        isSecured: boolean
    ): OptionsPosition | undefined {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND symbol = ? AND optionType = ? AND strikePrice = ? 
            AND expirationDate = ? AND position = ? AND isSecured = ? AND status = 'open'
        `);
        return stmt.get(
            userId, 
            symbol.toUpperCase(), 
            optionType, 
            strikePrice, 
            expirationDate,
            position,
            isSecured ? 1 : 0
        ) as OptionsPosition | undefined;
    },
    
    /**
     * Create a new options position
     */
    createPosition(
        userId: string, 
        symbol: string, 
        optionType: 'call' | 'put', 
        quantity: number,
        strikePrice: number, 
        expirationDate: string,
        purchasePrice: number,
        position: 'long' | 'short',
        marginRequired: number,
        isSecured: boolean
    ): number {
        const stmt = db.prepare(`
            INSERT INTO options_positions (
                userId, symbol, optionType, quantity, strikePrice, 
                expirationDate, purchasePrice, position, marginRequired, isSecured
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            userId, 
            symbol.toUpperCase(), 
            optionType, 
            quantity,
            strikePrice, 
            expirationDate,
            purchasePrice,
            position,
            marginRequired,
            isSecured ? 1 : 0
        );
        return result.lastInsertRowid as number;
    },
    
    /**
     * Update an existing options position
     */
    updatePosition(
        positionId: number,
        quantity: number,
        purchasePrice: number,
        marginRequired: number
    ): void {
        const stmt = db.prepare(`
            UPDATE options_positions
            SET quantity = ?, purchasePrice = ?, marginRequired = ?
            WHERE id = ?
        `);
        stmt.run(quantity, purchasePrice, marginRequired, positionId);
    },
    
    /**
     * Update position status
     */
    updatePositionStatus(positionId: number, status: 'open' | 'closed' | 'expired' | 'exercised' | 'liquidated'): void {
        const stmt = db.prepare('UPDATE options_positions SET status = ? WHERE id = ?');
        stmt.run(status, positionId);
    },
    
    /**
     * Update position secured status
     */
    updatePositionSecuredStatus(positionId: number, isSecured: boolean): void {
        const stmt = db.prepare('UPDATE options_positions SET isSecured = ? WHERE id = ?');
        stmt.run(isSecured ? 1 : 0, positionId);
    },
    
    /**
     * Get soon-to-expire options
     */
    getExpiringPositions(daysToExpiration = 1): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE status = 'open' AND date(expirationDate) <= date('now', '+' || ? || ' days')
            ORDER BY expirationDate ASC
        `);
        return stmt.all(daysToExpiration) as OptionsPosition[];
    },
    
    /**
     * Get expired options that need processing
     */
    getExpiredPositions(): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE status = 'open' AND date(expirationDate) < date('now')
        `);
        return stmt.all() as OptionsPosition[];
    },
    
    /**
     * Get total margin requirements for a user's options positions
     */
    getTotalMarginRequirements(userId: string): number {
        const stmt = db.prepare(`
            SELECT COALESCE(SUM(marginRequired), 0) as totalMargin
            FROM options_positions
            WHERE userId = ? AND status = 'open'
        `);
        const result = stmt.get(userId) as { totalMargin: number };
        return result ? result.totalMargin : 0;
    },
    
    /**
     * Get options positions for a specific symbol
     * Used for checking covered calls and cash-secured puts
     */
    getPositionsBySymbol(userId: string, symbol: string): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND symbol = ? AND status = 'open'
        `);
        return stmt.all(userId, symbol.toUpperCase()) as OptionsPosition[];
    },
    
    /**
     * Add an options transaction
     */
    addTransaction(
        userId: string, 
        symbol: string, 
        optionType: 'call' | 'put', 
        quantity: number,
        strikePrice: number, 
        expirationDate: string,
        price: number,
        position: 'long' | 'short',
        type: 'open' | 'close' | 'exercise' | 'expire' | 'liquidate',
        profit: number = 0,
        marginRequired: number = 0,
        isSecured: boolean = false
    ): void {
        const stmt = db.prepare(`
            INSERT INTO options_transactions (
                userId, symbol, optionType, quantity, strikePrice, 
                expirationDate, price, position, type, profit, marginRequired, isSecured
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            userId, 
            symbol.toUpperCase(), 
            optionType, 
            quantity,
            strikePrice, 
            expirationDate,
            price,
            position,
            type,
            profit,
            marginRequired,
            isSecured ? 1 : 0
        );
    },
    
    /**
     * Get transaction history for a user
     */
    getUserTransactions(userId: string, limit = 10): OptionsTransaction[] {
        const stmt = db.prepare(`
            SELECT * FROM options_transactions
            WHERE userId = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit) as OptionsTransaction[];
    },
    
    /**
     * Get all active short positions for a user
     * Used for margin calculations and liquidation
     */
    getActiveShortPositions(userId: string): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND position = 'short' AND status = 'open'
            ORDER BY marginRequired DESC
        `);
        return stmt.all(userId) as OptionsPosition[];
    },
    
    /**
     * Get all unique userIds that have open option positions
     * Used for batch processing margin calls
     */
    getUsersWithOpenPositions(): string[] {
        const stmt = db.prepare(`
            SELECT DISTINCT userId FROM options_positions
            WHERE status = 'open'
        `);
        const results = stmt.all() as {userId: string}[];
        return results.map(row => row.userId);
    }
};

/**
 * Margin call database operations
 */
export const marginDb = {
    /**
     * Create a margin call for a user
     */
    createMarginCall(userId: string, amount: number, reason: string): number {
        const stmt = db.prepare(`
            INSERT INTO margin_calls (userId, amount, reason)
            VALUES (?, ?, ?)
        `);
        const result = stmt.run(userId, amount, reason);
        return result.lastInsertRowid as number;
    },
    
    /**
     * Get pending margin calls for a user
     */
    getPendingMarginCalls(userId: string): MarginCall[] {
        const stmt = db.prepare(`
            SELECT * FROM margin_calls
            WHERE userId = ? AND status = 'pending'
            ORDER BY createdAt ASC
        `);
        return stmt.all(userId) as MarginCall[];
    },
    
    /**
     * Resolve a margin call
     */
    resolveMarginCall(marginCallId: number, status: 'satisfied' | 'liquidated'): void {
        const stmt = db.prepare(`
            UPDATE margin_calls
            SET status = ?, resolvedAt = datetime('now', 'utc')
            WHERE id = ?
        `);
        stmt.run(status, marginCallId);
    },
    
    /**
     * Get all pending margin calls
     */
    getAllPendingMarginCalls(): MarginCall[] {
        const stmt = db.prepare(`
            SELECT * FROM margin_calls
            WHERE status = 'pending'
            ORDER BY createdAt ASC
        `);
        return stmt.all() as MarginCall[];
    },
    
    /**
     * Get margin call history for a user
     */
    getMarginCallHistory(userId: string, limit = 10): MarginCall[] {
        const stmt = db.prepare(`
            SELECT * FROM margin_calls
            WHERE userId = ?
            ORDER BY createdAt DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit) as MarginCall[];
    }
};

/**
 * Price cache database operations
 */
export interface PriceCache {
    id?: number;
    symbol: string;
    price: number;
    timestamp: string;
    source: 'finnhub' | 'yahoo' | 'coingecko';
    interval: string;
}

export const priceCacheDb = {
    /**
     * Store price data in cache
     */
    storePrice(
        symbol: string,
        price: number,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        timestamp: Date = new Date(),
        interval: string = '1m'
    ): void {
        // Round timestamp based on the interval
        const roundedTimestamp = this.roundTimestampByInterval(timestamp, interval);
        const timestampString = roundedTimestamp.toISOString();
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO price_cache (symbol, price, timestamp, source, interval)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            symbol.toUpperCase(),
            price,
            timestampString,
            source,
            interval
        );
    },

    /**
     * Store multiple price entries at once (batch insert)
     */
    storePriceBatch(prices: Array<{
        symbol: string;
        price: number;
        timestamp: Date;
        source: 'finnhub' | 'yahoo' | 'coingecko';
        interval: string;
    }>): void {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO price_cache (symbol, price, timestamp, source, interval)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const insertMany = db.transaction((priceEntries) => {
            for (const entry of priceEntries) {
                const roundedTimestamp = this.roundTimestampByInterval(
                    entry.timestamp,
                    entry.interval
                );
                stmt.run(
                    entry.symbol.toUpperCase(),
                    entry.price,
                    roundedTimestamp.toISOString(),
                    entry.source,
                    entry.interval
                );
            }
        });
        
        insertMany(prices);
    },
    
    /**
     * Round a timestamp based on the interval
     */
    roundTimestampByInterval(timestamp: Date, interval: string): Date {
        const date = new Date(timestamp);
        
        switch (interval) {
            case '1m':
                // Round to the minute
                date.setSeconds(0, 0);
                break;
            case '5m':
                // Round to the nearest 5 minutes
                const minutes5 = Math.floor(date.getMinutes() / 5) * 5;
                date.setMinutes(minutes5, 0, 0);
                break;
            case '15m':
                // Round to the nearest 15 minutes
                const minutes15 = Math.floor(date.getMinutes() / 15) * 15;
                date.setMinutes(minutes15, 0, 0);
                break;
            case '30m':
                // Round to the nearest 30 minutes
                const minutes30 = Math.floor(date.getMinutes() / 30) * 30;
                date.setMinutes(minutes30, 0, 0);
                break;
            case '1h':
                // Round to the hour
                date.setMinutes(0, 0, 0);
                break;
            case '1d':
                // Round to the day
                date.setHours(0, 0, 0, 0);
                break;
        }
        
        return date;
    },
    
    /**
     * Get the latest cached price for a symbol
     */
    getLatestPrice(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        maxAgeMinutes: number = 15
    ): PriceCache | undefined {
        const stmt = db.prepare(`
            SELECT * FROM price_cache
            WHERE symbol = ? AND source = ? AND interval = '1m'
            AND datetime(timestamp) > datetime('now', '-' || ? || ' minutes')
            ORDER BY timestamp DESC
            LIMIT 1
        `);
        
        return stmt.get(
            symbol.toUpperCase(),
            source,
            maxAgeMinutes
        ) as PriceCache | undefined;
    },
    
    /**
     * Get a time series of prices for a symbol
     */
    getTimeSeries(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        interval: string = '1d',
        limit: number = 30,
        startDate?: Date,
        endDate?: Date
    ): PriceCache[] {
        let query = `
            SELECT * FROM price_cache
            WHERE symbol = ? AND source = ? AND interval = ?
        `;
        
        const queryParams: any[] = [
            symbol.toUpperCase(),
            source,
            interval
        ];
        
        if (startDate) {
            query += ` AND datetime(timestamp) >= datetime(?)`;
            queryParams.push(startDate.toISOString());
        }
        
        if (endDate) {
            query += ` AND datetime(timestamp) <= datetime(?)`;
            queryParams.push(endDate.toISOString());
        }
        
        query += ` ORDER BY timestamp ASC LIMIT ?`;
        queryParams.push(limit);
        
        const stmt = db.prepare(query);
        return stmt.all(...queryParams) as PriceCache[];
    },
    
    /**
     * Check if we have enough historical data for a symbol
     */
    hasAdequateHistoricalData(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        interval: string = '1d', 
        minDataPoints: number = 20,
        maxAgeInDays: number = 30
    ): boolean {
        const stmt = db.prepare(`
            SELECT COUNT(*) as count 
            FROM price_cache
            WHERE symbol = ? AND source = ? AND interval = ?
            AND datetime(timestamp) > datetime('now', '-' || ? || ' days')
        `);
        
        const result = stmt.get(
            symbol.toUpperCase(),
            source,
            interval,
            maxAgeInDays
        ) as { count: number };
        
        return result.count >= minDataPoints;
    },
    
    /**
     * Check if we have complete data coverage with at least one price point in each interval
     * @param symbol Stock ticker symbol
     * @param source Data source ('yahoo' or 'finnhub')
     * @param intervalMinutes Interval size in minutes (e.g., 1440 for daily data)
     * @param durationMinutes How far back to check in minutes (e.g., 43200 for 30 days)
     * @returns Whether complete coverage exists
     */
    hasCompleteCoverage(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        intervalMinutes: number = 1440, // Default to daily (24 hours * 60 minutes)
        durationMinutes: number = 43200 // Default to 30 days
    ): boolean {
        // Use SQLite's recursive CTE to generate a series of time intervals
        // and check if each interval has at least one data point
        const stmt = db.prepare(`
            WITH RECURSIVE
            -- Generate time intervals going back from current time
            time_intervals(interval_start, interval_end, interval_num) AS (
                -- Base case: start with the most recent interval
                SELECT 
                    datetime('now', '-' || ? || ' minutes'),
                    datetime('now'),
                    1
                UNION ALL
                -- Recursive case: generate previous intervals
                SELECT
                    datetime(interval_start, '-' || ? || ' minutes'),
                    interval_start,
                    interval_num + 1
                FROM time_intervals
                WHERE interval_num < ? -- Number of intervals to check (duration/interval)
            ),
            -- Count data points in each interval
            interval_counts AS (
                SELECT 
                    t.interval_start,
                    t.interval_end,
                    t.interval_num,
                    (
                        SELECT COUNT(*) 
                        FROM price_cache p
                        WHERE p.symbol = ?
                        AND p.source = ?
                        AND datetime(p.timestamp) >= datetime(t.interval_start)
                        AND datetime(p.timestamp) < datetime(t.interval_end)
                    ) as point_count
                FROM time_intervals t
            )
            -- Check if any interval has zero points
            SELECT COUNT(*) as missing_intervals
            FROM interval_counts
            WHERE point_count = 0
        `);
        
        // Calculate number of intervals
        const numIntervals = Math.ceil(durationMinutes / intervalMinutes);
        
        const result = stmt.get(
            intervalMinutes,
            intervalMinutes,
            numIntervals,
            symbol.toUpperCase(),
            source
        ) as { missing_intervals: number };
        
        // If missing_intervals is 0, we have complete coverage
        return result.missing_intervals === 0;
    },
    
    /**
     * Delete expired cache entries to keep the database size manageable
     * @param maxAgeDays Maximum age of cached data in days
     * @returns The number of deleted entries
     */
    cleanupCache(maxAgeDays: number = 30): number {
        const stmt = db.prepare(`
            DELETE FROM price_cache
            WHERE datetime(timestamp) < datetime('now', '-' || ? || ' days')
        `);
        
        const result = stmt.run(maxAgeDays);
        return result.changes;
    },
    
    /**
     * Get the last timestamp for a symbol in the cache
     */
    getLastTimestamp(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko',
        interval: string = '1d'
    ): string | null {
        const stmt = db.prepare(`
            SELECT timestamp FROM price_cache
            WHERE symbol = ? AND source = ? AND interval = ?
            ORDER BY timestamp DESC
            LIMIT 1
        `);
        
        const result = stmt.get(
            symbol.toUpperCase(),
            source,
            interval
        ) as { timestamp: string } | undefined;
        
        return result ? result.timestamp : null;
    },
    
    /**
     * Get all unique intervals available for a symbol
     */
    getAvailableIntervals(
        symbol: string,
        source: 'finnhub' | 'yahoo' | 'coingecko'
    ): string[] {
        const stmt = db.prepare(`
            SELECT DISTINCT interval FROM price_cache
            WHERE symbol = ? AND source = ?
            ORDER BY interval
        `);
        
        const results = stmt.all(
            symbol.toUpperCase(),
            source
        ) as Array<{ interval: string }>;
        
        return results.map(row => row.interval);
    }
};

/**
 * Cryptocurrency portfolio database operations
 */
export const cryptoPortfolioDb = {
    /**
     * Get user's cryptocurrency portfolio
     */
    getUserPortfolio(userId: string): CryptoPosition[] {
        const stmt = db.prepare(`
            SELECT id, userId, coinId, symbol, name, quantity, averagePurchasePrice 
            FROM crypto_portfolio 
            WHERE userId = ? AND quantity > 0
        `);
        return stmt.all(userId) as CryptoPosition[];
    },
    
    /**
     * Get user's position for a specific cryptocurrency
     */
    getUserPosition(userId: string, coinId: string): CryptoPosition | undefined {
        const stmt = db.prepare(`
            SELECT id, userId, coinId, symbol, name, quantity, averagePurchasePrice 
            FROM crypto_portfolio 
            WHERE userId = ? AND coinId = ?
        `);
        return stmt.get(userId, coinId) as CryptoPosition | undefined;
    },
    
    /**
     * Add or update a position in user's crypto portfolio
     */
    updatePosition(userId: string, coinId: string, symbol: string, name: string, quantity: number, averagePrice: number): void {
        const stmt = db.prepare(`
            INSERT INTO crypto_portfolio (userId, coinId, symbol, name, quantity, averagePurchasePrice)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(userId, coinId) DO UPDATE
            SET quantity = ?, averagePurchasePrice = ?, symbol = ?, name = ?
        `);
        stmt.run(
            userId, 
            coinId, 
            symbol.toUpperCase(), 
            name, 
            quantity, 
            averagePrice, 
            quantity, 
            averagePrice,
            symbol.toUpperCase(),
            name
        );
    }
};

/**
 * Cryptocurrency transaction database operations
 */
export const cryptoTransactionDb = {
    /**
     * Add a buy/sell transaction to history
     */
    addTransaction(userId: string, coinId: string, symbol: string, name: string, quantity: number, price: number, type: 'buy' | 'sell'): void {
        const stmt = db.prepare(`
            INSERT INTO crypto_transactions (userId, coinId, symbol, name, quantity, price, type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(userId, coinId, symbol.toUpperCase(), name, quantity, price, type);
    },
    
    /**
     * Get transaction history for a user
     */
    getUserTransactions(userId: string, limit = 10): CryptoTransaction[] {
        const stmt = db.prepare(`
            SELECT * FROM crypto_transactions
            WHERE userId = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `);
        return stmt.all(userId, limit) as CryptoTransaction[];
    }
};