import { userDb, portfolioDb, transactionDb } from '../database/operations';
import { stockService } from './stockService';
import { optionsService } from './optionsService';

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
     * Buy stock
     */
    async buyStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            // Validate input
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }

            // Get stock price
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { success: false, message: stockData.error || `Unable to find price for ${symbol}` };
            }

            // Calculate total cost
            const totalCost = stockData.price * quantity;

            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);

            // Check if user has enough cash
            if (cashBalance < totalCost) {
                return { success: false, message: `Insufficient funds to buy ${quantity} shares of ${symbol}. You need $${totalCost.toFixed(2)} but have $${cashBalance.toFixed(2)}` };
            }

            // Update cash balance
            userDb.updateCashBalance(userId, cashBalance - totalCost);

            // Get current position
            const position = portfolioDb.getUserPosition(userId, symbol);

            if (position) {
                // Calculate new average price
                const newTotalQuantity = position.quantity + quantity;
                const newTotalCost = position.quantity * position.averagePurchasePrice + quantity * stockData.price;
                const newAveragePrice = newTotalCost / newTotalQuantity;

                // Update position
                portfolioDb.updatePosition(userId, symbol, newTotalQuantity, newAveragePrice);
            } else {
                // Create new position
                portfolioDb.updatePosition(userId, symbol, quantity, stockData.price);
            }

            // Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'buy');
            
            // Update secured status for options positions
            await optionsService.updateSecuredStatus(userId);
            
            // Check if spending cash has created a margin call situation (if cash was securing puts)
            const marginStatus = await optionsService.calculateMarginStatus(userId);
            if (marginStatus.utilizationPercentage > 95) {
                // Process potential margin call
                await optionsService.processMarginCalls(userId);
            }

            return {
                success: true,
                message: `Successfully bought ${quantity} shares of ${symbol} at $${stockData.price.toFixed(2)} per share for a total of $${totalCost.toFixed(2)}`
            };
        } catch (error) {
            console.error('Buy stock error:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred while buying stock'
            };
        }
    },

    /**
     * Sell stock
     */
    async sellStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            // Validate input
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }

            // Get current position
            const position = portfolioDb.getUserPosition(userId, symbol);

            // Check if user owns the stock
            if (!position || position.quantity <= 0) {
                return { success: false, message: `You don't own any shares of ${symbol}` };
            }

            // Check if user has enough shares
            if (position.quantity < quantity) {
                return { success: false, message: `You don't have enough shares of ${symbol}. You have ${position.quantity} but are trying to sell ${quantity}` };
            }

            // Get stock price
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { success: false, message: stockData.error || `Unable to find price for ${symbol}` };
            }

            // Calculate total proceeds
            const totalProceeds = stockData.price * quantity;

            // Update cash balance
            const cashBalance = userDb.getCashBalance(userId);
            userDb.updateCashBalance(userId, cashBalance + totalProceeds);

            // Update position
            const newQuantity = position.quantity - quantity;
            if (newQuantity > 0) {
                // Keep position with reduced quantity
                portfolioDb.updatePosition(userId, symbol, newQuantity, position.averagePurchasePrice);
            } else {
                // Remove position altogether
                portfolioDb.updatePosition(userId, symbol, 0, 0);
            }

            // Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'sell');
            
            // Update secured status for options positions
            await optionsService.updateSecuredStatus(userId);
            
            // Check if the user now has a margin call situation after selling shares
            const marginStatus = await optionsService.calculateMarginStatus(userId);
            if (marginStatus.utilizationPercentage > 95) {
                // Process potential margin call
                await optionsService.processMarginCalls(userId);
            }

            // Calculate profit/loss
            const costBasis = position.averagePurchasePrice * quantity;
            const profitLoss = totalProceeds - costBasis;
            const plText = profitLoss >= 0 
                ? `profit of $${profitLoss.toFixed(2)}` 
                : `loss of $${Math.abs(profitLoss).toFixed(2)}`;

            return {
                success: true,
                message: `Successfully sold ${quantity} shares of ${symbol} at $${stockData.price.toFixed(2)} per share for a total of $${totalProceeds.toFixed(2)} with a ${plText}`
            };
        } catch (error) {
            console.error('Sell stock error:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred while selling stock'
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