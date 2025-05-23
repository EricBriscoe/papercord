import db from './database';

// Core data structures for portfolio management
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

// Options trading data structures
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

// Cryptocurrency data structures
export interface CryptoPosition {
    id?: number;
    userId: string;
    coinId: string;
    symbol: string;
    name: string;
    quantity: number;
    averagePurchasePrice: number;
}

export interface CryptoTransaction {
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
 * User account management operations
 */
export const userDb = {
    /**
     * Retrieves user or creates a new account if none exists
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
     * Retrieves user's current cash balance
     */
    getCashBalance(userId: string): number {
        const stmt = db.prepare('SELECT cashBalance FROM users WHERE userId = ?');
        const result = stmt.get(userId) as CashResult | undefined;
        return result ? result.cashBalance : 0;
    },
    
    /**
     * Updates user's available cash balance
     */
    updateCashBalance(userId: string, newBalance: number): void {
        const stmt = db.prepare('UPDATE users SET cashBalance = ? WHERE userId = ?');
        stmt.run(newBalance, userId);
    },
    
    /**
     * Retrieves user's margin account status
     */
    getMarginBalance(userId: string): { marginBalance: number, marginUsed: number } {
        const stmt = db.prepare('SELECT marginBalance, marginUsed FROM users WHERE userId = ?');
        const result = stmt.get(userId) as { marginBalance: number, marginUsed: number } | undefined;
        return result || { marginBalance: 0, marginUsed: 0 };
    },
    
    /**
     * Sets user's margin account values directly
     */
    updateMarginBalance(userId: string, marginBalance: number, marginUsed: number): void {
        const stmt = db.prepare('UPDATE users SET marginBalance = ?, marginUsed = ? WHERE userId = ?');
        stmt.run(marginBalance, marginUsed, userId);
    },
    
    /**
     * Adds to user's available margin
     */
    increaseMarginBalance(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginBalance = marginBalance + ? WHERE userId = ?');
        stmt.run(amount, userId);
    },
    
    /**
     * Reserves margin for new positions
     */
    increaseMarginUsed(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginUsed = marginUsed + ? WHERE userId = ?');
        stmt.run(amount, userId);
    },
    
    /**
     * Releases margin when positions are closed
     */
    decreaseMarginUsed(userId: string, amount: number): void {
        const stmt = db.prepare('UPDATE users SET marginUsed = MAX(0, marginUsed - ?) WHERE userId = ?');
        stmt.run(amount, userId);
    },

    /**
     * Finds all users who have cryptocurrency holdings
     */
    getUsersWithCryptoPositions(): string[] {
        const stmt = db.prepare(`
            SELECT DISTINCT userId FROM crypto_portfolio
            WHERE quantity > 0
        `);
        const results = stmt.all() as {userId: string}[];
        return results.map(row => row.userId);
    },
    
    /**
     * Finds and deletes inactive users who still have the default $100,000 balance
     * and no assets across stocks, options, or crypto
     * 
     * @returns Information about deleted users
     */
    cleanupInactiveUsers(): { deletedCount: number, userIds: string[] } {
        try {
            // Find users with exactly $100,000 who might be inactive
            const potentialInactiveUsers = db.prepare(`
                SELECT userId FROM users 
                WHERE cashBalance = 100000.00 
                AND marginBalance = 0 
                AND marginUsed = 0
            `).all() as { userId: string }[];
            
            if (potentialInactiveUsers.length === 0) {
                return { deletedCount: 0, userIds: [] };
            }
            
            const usersToDelete: string[] = [];
            
            // For each potential user, check if they have any assets anywhere
            for (const user of potentialInactiveUsers) {
                const userId = user.userId;
                
                // Check if they have stock positions
                const hasStocks = db.prepare(`
                    SELECT 1 FROM portfolio 
                    WHERE userId = ? AND quantity > 0 
                    LIMIT 1
                `).get(userId);
                
                // Check if they have option positions
                const hasOptions = db.prepare(`
                    SELECT 1 FROM options_positions 
                    WHERE userId = ? AND status = 'open' 
                    LIMIT 1
                `).get(userId);
                
                // Check if they have crypto positions
                const hasCrypto = db.prepare(`
                    SELECT 1 FROM crypto_portfolio 
                    WHERE userId = ? AND quantity > 0 
                    LIMIT 1
                `).get(userId);
                
                // Check if they have pending margin calls
                const hasMarginCalls = db.prepare(`
                    SELECT 1 FROM margin_calls 
                    WHERE userId = ? AND status = 'pending' 
                    LIMIT 1
                `).get(userId);
                
                // If they have no assets anywhere, add to delete list
                if (!hasStocks && !hasOptions && !hasCrypto && !hasMarginCalls) {
                    usersToDelete.push(userId);
                }
            }
            
            if (usersToDelete.length === 0) {
                return { deletedCount: 0, userIds: [] };
            }
            
            console.log(`Found ${usersToDelete.length} inactive users to delete from database`);
            
            // Begin transaction to delete users
            const transaction = db.transaction((userIds: string[]) => {
                for (const userId of userIds) {
                    // Delete user from all tables
                    db.prepare('DELETE FROM users WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM portfolio WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM transactions WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM options_positions WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM options_transactions WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM crypto_portfolio WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM crypto_transactions WHERE userId = ?').run(userId);
                    db.prepare('DELETE FROM margin_calls WHERE userId = ?').run(userId);
                    
                    console.log(`Deleted inactive user: ${userId}`);
                }
            });
            
            // Execute transaction
            transaction(usersToDelete);
            
            return {
                deletedCount: usersToDelete.length,
                userIds: usersToDelete
            };
        } catch (error) {
            console.error('Error cleaning up inactive users:', error);
            return { deletedCount: 0, userIds: [] };
        }
    }
};

/**
 * Stock portfolio management operations
 */
export const portfolioDb = {
    /**
     * Retrieves all stock positions for a user
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
     * Retrieves a specific stock position
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
     * Creates or updates a stock position
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
 * Stock transaction history operations
 */
export const transactionDb = {
    /**
     * Records a stock transaction
     */
    addTransaction(userId: string, symbol: string, quantity: number, price: number, type: 'buy' | 'sell'): void {
        const stmt = db.prepare(`
            INSERT INTO transactions (userId, symbol, quantity, price, type)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userId, symbol.toUpperCase(), quantity, price, type);
    },
    
    /**
     * Retrieves stock transaction history
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
 * Options position management operations
 */
export const optionsDb = {
    /**
     * Retrieves all open options positions for a user
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
     * Retrieves a specific options position by ID
     */
    getPositionById(id: number): OptionsPosition | undefined {
        const stmt = db.prepare('SELECT * FROM options_positions WHERE id = ?');
        return stmt.get(id) as OptionsPosition | undefined;
    },
    
    /**
     * Finds existing options position with matching attributes
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
     * Creates a new options position
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
     * Updates quantity and pricing for an existing options position
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
     * Updates the status of an options position
     */
    updatePositionStatus(positionId: number, status: 'open' | 'closed' | 'expired' | 'exercised' | 'liquidated'): void {
        const stmt = db.prepare('UPDATE options_positions SET status = ? WHERE id = ?');
        stmt.run(status, positionId);
    },
    
    /**
     * Updates whether an options position is covered/secured
     */
    updatePositionSecuredStatus(positionId: number, isSecured: boolean): void {
        const stmt = db.prepare('UPDATE options_positions SET isSecured = ? WHERE id = ?');
        stmt.run(isSecured ? 1 : 0, positionId);
    },
    
    /**
     * Finds options positions nearing expiration
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
     * Finds options positions that have expired and need processing
     */
    getExpiredPositions(): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE status = 'open' AND date(expirationDate) <= date('now')
        `);
        return stmt.all() as OptionsPosition[];
    },
    
    /**
     * Calculates total margin requirements for a user
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
     * Finds all options positions for a specific underlying symbol
     */
    getPositionsBySymbol(userId: string, symbol: string): OptionsPosition[] {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND symbol = ? AND status = 'open'
        `);
        return stmt.all(userId, symbol.toUpperCase()) as OptionsPosition[];
    },
    
    /**
     * Records an options transaction
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
     * Retrieves options transaction history
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
     * Retrieves all active short options positions for a user
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
     * Finds all users with open options positions
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
 * Margin call management operations
 */
export const marginDb = {
    /**
     * Creates a margin call for a user
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
     * Retrieves unresolved margin calls for a user
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
     * Marks a margin call as resolved
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
     * Retrieves all unresolved margin calls in the system
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
     * Retrieves margin call history for a user
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
 * Price caching system for historical and current prices
 */
export interface PriceCache {
    id?: number;
    symbol: string;
    price: number;
    timestamp: string;
    source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
    interval: string;
}

export const priceCacheDb = {
    /**
     * Stores a price data point in the cache
     */
    storePrice(
        symbol: string,
        price: number,
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
        timestamp: Date = new Date(),
        interval: string = '1m'
    ): void {
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
     * Efficiently stores multiple price entries in a single transaction
     */
    storePriceBatch(prices: Array<{
        symbol: string;
        price: number;
        timestamp: Date;
        source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
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
     * Normalizes timestamps to consistent intervals for better data alignment
     */
    roundTimestampByInterval(timestamp: Date, interval: string): Date {
        const date = new Date(timestamp);
        
        switch (interval) {
            case '1m':
                date.setSeconds(0, 0);
                break;
            case '5m':
                const minutes5 = Math.floor(date.getMinutes() / 5) * 5;
                date.setMinutes(minutes5, 0, 0);
                break;
            case '15m':
                const minutes15 = Math.floor(date.getMinutes() / 15) * 15;
                date.setMinutes(minutes15, 0, 0);
                break;
            case '30m':
                const minutes30 = Math.floor(date.getMinutes() / 30) * 30;
                date.setMinutes(minutes30, 0, 0);
                break;
            case '1h':
                date.setMinutes(0, 0, 0);
                break;
            case '1d':
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
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
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
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
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
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
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
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
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
        source: 'yahoo' | 'coingecko', // Removed 'finnhub'
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
        source: 'yahoo' | 'coingecko' // Removed 'finnhub'
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

// --- Subscription Management ---

/**
 * Add a channel to the subscriptions table (subscribe)
 */
export function subscribeChannel(channelId: string): boolean {
    try {
        db.prepare('INSERT OR IGNORE INTO subscriptions (channelId) VALUES (?)').run(channelId);
        return true;
    } catch (error) {
        console.error('Error subscribing channel:', error);
        return false;
    }
}

/**
 * Remove a channel from the subscriptions table (unsubscribe)
 */
export function unsubscribeChannel(channelId: string): boolean {
    try {
        const result = db.prepare('DELETE FROM subscriptions WHERE channelId = ?').run(channelId);
        return result.changes > 0;
    } catch (error) {
        console.error('Error unsubscribing channel:', error);
        return false;
    }
}

/**
 * Check if a channel is subscribed
 */
export function isChannelSubscribed(channelId: string): boolean {
    try {
        const row = db.prepare('SELECT 1 FROM subscriptions WHERE channelId = ?').get(channelId);
        return !!row;
    } catch (error) {
        console.error('Error checking channel subscription:', error);
        return false;
    }
}

/**
 * Get all subscribed channel IDs
 */
export function getAllSubscribedChannels(): string[] {
    try {
        const rows = db.prepare('SELECT channelId FROM subscriptions').all();
        return rows.map((row: any) => row.channelId);
    } catch (error) {
        console.error('Error fetching subscribed channels:', error);
        return [];
    }
}
