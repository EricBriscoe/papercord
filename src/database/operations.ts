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
    status: 'open' | 'closed' | 'expired' | 'exercised';
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
    type: 'open' | 'close' | 'exercise' | 'expire';
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
        position: 'long' | 'short'
    ): OptionsPosition | undefined {
        const stmt = db.prepare(`
            SELECT * FROM options_positions
            WHERE userId = ? AND symbol = ? AND optionType = ? AND strikePrice = ? AND expirationDate = ? AND position = ? AND status = 'open'
        `);
        return stmt.get(
            userId, 
            symbol.toUpperCase(), 
            optionType, 
            strikePrice, 
            expirationDate,
            position
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
        position: 'long' | 'short'
    ): number {
        const stmt = db.prepare(`
            INSERT INTO options_positions (userId, symbol, optionType, quantity, strikePrice, expirationDate, purchasePrice, position)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(
            userId, 
            symbol.toUpperCase(), 
            optionType, 
            quantity,
            strikePrice, 
            expirationDate,
            purchasePrice,
            position
        );
        return result.lastInsertRowid as number;
    },
    
    /**
     * Update an existing options position
     */
    updatePosition(
        positionId: number,
        quantity: number,
        purchasePrice: number
    ): void {
        const stmt = db.prepare(`
            UPDATE options_positions
            SET quantity = ?, purchasePrice = ?
            WHERE id = ?
        `);
        stmt.run(quantity, purchasePrice, positionId);
    },
    
    /**
     * Update position status
     */
    updatePositionStatus(positionId: number, status: 'open' | 'closed' | 'expired' | 'exercised'): void {
        const stmt = db.prepare('UPDATE options_positions SET status = ? WHERE id = ?');
        stmt.run(status, positionId);
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
        type: 'open' | 'close' | 'exercise' | 'expire'
    ): void {
        const stmt = db.prepare(`
            INSERT INTO options_transactions (
                userId, symbol, optionType, quantity, strikePrice, 
                expirationDate, price, position, type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            type
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