import db from './database';

interface User {
    userId: string;
    cashBalance: number;
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