import { userDb, portfolioDb, transactionDb } from '../database/operations';
import { stockService } from './stockService';
import { optionsService } from './optionsService';

// Data structure definitions for portfolio management
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

export const tradingService = {
    /**
     * Execute stock purchase for user
     * Validates funds, updates positions with weighted average pricing,
     * and handles margin implications of the transaction
     */
    async buyStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }

            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { success: false, message: stockData.error || `Unable to find price for ${symbol}` };
            }

            const totalCost = stockData.price * quantity;
            const cashBalance = userDb.getCashBalance(userId);

            if (cashBalance < totalCost) {
                return { success: false, message: `Insufficient funds to buy ${quantity} shares of ${symbol}. You need $${totalCost.toFixed(2)} but have $${cashBalance.toFixed(2)}` };
            }

            // Update cash balance
            userDb.updateCashBalance(userId, cashBalance - totalCost);

            // Update position with weighted average pricing
            const position = portfolioDb.getUserPosition(userId, symbol);

            if (position) {
                const newTotalQuantity = position.quantity + quantity;
                const newTotalCost = position.quantity * position.averagePurchasePrice + quantity * stockData.price;
                const newAveragePrice = newTotalCost / newTotalQuantity;

                portfolioDb.updatePosition(userId, symbol, newTotalQuantity, newAveragePrice);
            } else {
                portfolioDb.updatePosition(userId, symbol, quantity, stockData.price);
            }

            // Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'buy');
            
            // Update covered call and cash-secured put status
            await optionsService.updateSecuredStatus(userId);
            
            // Check if spending cash has created a margin call situation
            const marginStatus = await optionsService.calculateMarginStatus(userId);
            if (marginStatus.utilizationPercentage > 95) {
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
     * Execute stock sale for user
     * Verifies position ownership, calculates profit/loss,
     * and handles potential margin implications
     */
    async sellStock(userId: string, symbol: string, quantity: number): Promise<{ success: boolean; message: string }> {
        try {
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }

            const position = portfolioDb.getUserPosition(userId, symbol);

            if (!position || position.quantity <= 0) {
                return { success: false, message: `You don't own any shares of ${symbol}` };
            }

            if (position.quantity < quantity) {
                return { success: false, message: `You don't have enough shares of ${symbol}. You have ${position.quantity} but are trying to sell ${quantity}` };
            }

            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { success: false, message: stockData.error || `Unable to find price for ${symbol}` };
            }

            const totalProceeds = stockData.price * quantity;
            const cashBalance = userDb.getCashBalance(userId);
            userDb.updateCashBalance(userId, cashBalance + totalProceeds);

            // Update or remove position
            const newQuantity = position.quantity - quantity;
            if (newQuantity > 0) {
                portfolioDb.updatePosition(userId, symbol, newQuantity, position.averagePurchasePrice);
            } else {
                portfolioDb.updatePosition(userId, symbol, 0, 0);
            }

            // Record transaction
            transactionDb.addTransaction(userId, symbol, quantity, stockData.price, 'sell');
            
            // Update covered call status after selling shares
            await optionsService.updateSecuredStatus(userId);
            
            // Check if selling shares that were covering options created a margin call
            const marginStatus = await optionsService.calculateMarginStatus(userId);
            if (marginStatus.utilizationPercentage > 95) {
                await optionsService.processMarginCalls(userId);
            }

            // Calculate and report P/L
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
     * Retrieves user's complete portfolio with current market values
     * Fetches current prices for all positions to calculate real-time
     * portfolio value, profit/loss, and percentage changes
     */
    async getPortfolio(userId: string): Promise<Portfolio> {
        try {
            userDb.getOrCreateUser(userId);
            const positions = portfolioDb.getUserPortfolio(userId) as Position[];
            const cashBalance = userDb.getCashBalance(userId);
            
            if (positions.length === 0) {
                return {
                    cashBalance,
                    positions: [],
                    totalValue: cashBalance,
                    message: 'Your portfolio is empty'
                };
            }
            
            // Get current prices for all positions in parallel
            const pricePromises = positions.map((pos: Position) => stockService.getStockPrice(pos.symbol));
            const prices = await Promise.all(pricePromises);
            
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
     * Retrieves transaction history for a user
     */
    getTransactionHistory(userId: string, limit = 10): Transaction[] {
        userDb.getOrCreateUser(userId);
        return transactionDb.getUserTransactions(userId, limit) as Transaction[];
    }
};