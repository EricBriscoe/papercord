import { userDb, portfolioDb, transactionDb } from '../database/operations';
import { stockService } from './stockService';

// Define types for our portfolio data
interface Position {
    symbol: string;
    quantity: number;
    averagePurchasePrice: number;
}

interface PositionWithValue extends Position {
    currentPrice: number;
    marketValue: number;
    profitLoss: number;
    percentChange: number;
}

interface Portfolio {
    cashBalance: number;
    positions: PositionWithValue[];
    totalValue: number;
    portfolioValue?: number;
    message?: string;
}

interface Transaction {
    id: number;
    userId: string;
    symbol: string;
    quantity: number;
    price: number;
    type: 'buy' | 'sell';
    timestamp: string;
}

/**
 * Trading service
 */
export const tradingService = {
    /**
     * Buy a stock
     */
    async buyStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            // Validate input
            if (quantity <= 0) {
                return { success: false, message: 'Quantity must be greater than 0' };
            }
            
            // Get user account - create if doesn't exist
            const user = userDb.getOrCreateUser(userId);
            
            // Get current stock price
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { 
                    success: false, 
                    message: stockData.error || `Unable to find price for ${symbol}` 
                };
            }
            
            // Calculate cost
            const totalCost = stockData.price * quantity;
            
            // Check minimum transaction value
            if (totalCost < 0.01) {
                return {
                    success: false,
                    message: `Transaction value ($${totalCost.toFixed(6)}) is too small. Minimum transaction value is $0.01.`
                };
            }
            
            // Check if user has enough cash
            if (user.cashBalance < totalCost) {
                return { 
                    success: false, 
                    message: `Insufficient funds. You need $${totalCost.toFixed(2)} but have $${user.cashBalance.toFixed(2)}` 
                };
            }
            
            // Get current position
            const existingPosition = portfolioDb.getUserPosition(userId, symbol);
            
            // Update position with new average price and quantity
            let newQuantity = quantity;
            let newAveragePrice = stockData.price;
            
            if (existingPosition) {
                newQuantity = existingPosition.quantity + quantity;
                // Calculate new average price
                newAveragePrice = (
                    (existingPosition.quantity * existingPosition.averagePurchasePrice) + 
                    (quantity * stockData.price)
                ) / newQuantity;
            }
            
            // Execute transaction
            // 1. Update portfolio
            portfolioDb.updatePosition(userId, symbol, newQuantity, newAveragePrice);
            
            // 2. Deduct cash
            userDb.updateCashBalance(userId, user.cashBalance - totalCost);
            
            // 3. Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'buy');
            
            return { 
                success: true, 
                message: `Successfully purchased ${quantity} share(s) of ${symbol} at $${stockData.price.toFixed(2)}` 
            };
        } catch (error) {
            console.error('Buy stock error:', error);
            return { 
                success: false, 
                message: error instanceof Error ? error.message : 'An unknown error occurred' 
            };
        }
    },
    
    /**
     * Sell a stock
     */
    async sellStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            // Validate input
            if (quantity <= 0) {
                return { success: false, message: 'Quantity must be greater than 0' };
            }
            
            // Check if user has the position
            const position = portfolioDb.getUserPosition(userId, symbol);
            if (!position) {
                return { success: false, message: `You don't own any shares of ${symbol}` };
            }
            
            // Check if user has enough shares
            if (position.quantity < quantity) {
                return { 
                    success: false, 
                    message: `You only have ${position.quantity} share(s) of ${symbol}` 
                };
            }
            
            // Get current stock price
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { 
                    success: false, 
                    message: stockData.error || `Unable to find price for ${symbol}` 
                };
            }
            
            // Calculate sale proceeds
            const saleProceeds = stockData.price * quantity;
            
            // Get user's current cash balance
            const currentBalance = userDb.getCashBalance(userId);
            
            // Execute transaction
            // 1. Update portfolio
            const newQuantity = position.quantity - quantity;
            portfolioDb.updatePosition(userId, symbol, newQuantity, position.averagePurchasePrice);
            
            // 2. Add cash
            userDb.updateCashBalance(userId, currentBalance + saleProceeds);
            
            // 3. Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'sell');
            
            // Calculate profit/loss
            const profitLoss = (stockData.price - position.averagePurchasePrice) * quantity;
            const profitLossText = profitLoss >= 0 
                ? `profit of $${profitLoss.toFixed(2)}` 
                : `loss of $${Math.abs(profitLoss).toFixed(2)}`;
            
            return { 
                success: true, 
                message: `Successfully sold ${quantity} share(s) of ${symbol} at $${stockData.price.toFixed(2)} with a ${profitLossText}` 
            };
        } catch (error) {
            console.error('Sell stock error:', error);
            return { 
                success: false, 
                message: error instanceof Error ? error.message : 'An unknown error occurred' 
            };
        }
    },
    
    /**
     * Get user's portfolio with current market values
     */
    async getPortfolio(userId: string): Promise<Portfolio> {
        try {
            // Make sure user exists
            userDb.getOrCreateUser(userId);
            
            // Get user's positions
            const positions = portfolioDb.getUserPortfolio(userId) as Position[];
            
            // Get cash balance
            const cashBalance = userDb.getCashBalance(userId);
            
            if (positions.length === 0) {
                return {
                    cashBalance,
                    positions: [],
                    totalValue: cashBalance,
                    message: 'Your portfolio is empty'
                };
            }
            
            // Get current prices for all positions
            const pricePromises = positions.map((pos: Position) => stockService.getStockPrice(pos.symbol));
            const prices = await Promise.all(pricePromises);
            
            // Calculate portfolio value
            let portfolioValue = 0;
            
            const positionsWithValues = positions.map((pos: Position) => {
                const priceData = prices.find(p => p.symbol.toUpperCase() === pos.symbol.toUpperCase());
                const currentPrice = priceData?.price || 0;
                const marketValue = currentPrice * pos.quantity;
                const costBasis = pos.averagePurchasePrice * pos.quantity;
                const profitLoss = marketValue - costBasis;
                const percentChange = ((currentPrice / pos.averagePurchasePrice) - 1) * 100;
                
                portfolioValue += marketValue;
                
                return {
                    ...pos,
                    currentPrice,
                    marketValue,
                    profitLoss,
                    percentChange
                };
            });
            
            const totalValue = portfolioValue + cashBalance;
            
            return {
                cashBalance,
                positions: positionsWithValues,
                totalValue,
                portfolioValue
            };
        } catch (error) {
            console.error('Get portfolio error:', error);
            throw error;
        }
    },
    
    /**
     * Get transaction history for a user
     */
    getTransactionHistory(userId: string, limit = 10): Transaction[] {
        // Make sure user exists
        userDb.getOrCreateUser(userId);
        
        // Get transaction history
        return transactionDb.getUserTransactions(userId, limit) as Transaction[];
    }
};