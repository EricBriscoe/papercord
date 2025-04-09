import { stockService } from './stockService';
import { optionsDb, userDb, marginDb } from '../database/operations';
import { Option, OptionType, calculateTimeToExpiry, DEFAULT_RISK_FREE_RATE, getHistoricalVolatility } from '../utils/blackScholes';

/**
 * Interface for option contract
 */
export interface OptionContract {
    symbol: string;
    optionType: 'call' | 'put';
    strikePrice: number;
    expirationDate: string;
    position: 'long' | 'short';
    price: number;
    quantity: number;
    currentPrice?: number;
    timeToExpiry?: number;
    intrinsicValue?: number;
    moneyness?: 'ITM' | 'ATM' | 'OTM';
    formattedExpiration?: string;
    id?: number;
    purchasePrice?: number;
    status?: 'open' | 'closed' | 'expired' | 'exercised';
    marketValue?: number;
    profitLoss?: number;
    percentChange?: number;
}

/**
 * Options trading service
 */
export const optionsService = {
    /**
     * Calculate option price using Black-Scholes model
     */
    async calculateOptionPrice(
        symbol: string,
        optionType: 'call' | 'put',
        strikePrice: number,
        expirationDate: string
    ): Promise<{ price: number | null; error?: string }> {
        try {
            // Get current stock price
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                return { 
                    price: null, 
                    error: stockData.error || `Unable to find price for ${symbol}` 
                };
            }

            // Calculate time to expiry in years
            const expiry = new Date(expirationDate);
            const timeToExpiry = calculateTimeToExpiry(expiry);
            
            if (timeToExpiry <= 0) {
                return { 
                    price: null, 
                    error: 'Expiration date must be in the future'
                };
            }

            // Get volatility estimate
            const volatility = getHistoricalVolatility(symbol);

            // Calculate option price using Black-Scholes
            const type = optionType === 'call' ? OptionType.CALL : OptionType.PUT;
            const optionPrice = Option.price(
                type,
                stockData.price,
                strikePrice,
                timeToExpiry,
                DEFAULT_RISK_FREE_RATE,
                volatility
            );

            // Options are typically priced per share but contracts are for 100 shares
            // We're returning price per share, not per contract
            return { price: optionPrice };
        } catch (error) {
            console.error('Option price calculation error:', error);
            return { 
                price: null, 
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },

    /**
     * Buy or write options
     */
    async tradeOption(
        userId: string,
        symbol: string,
        optionType: 'call' | 'put',
        position: 'long' | 'short',
        strikePrice: number,
        expirationDate: string,
        quantity: number
    ): Promise<{ success: boolean; message: string; contract?: OptionContract }> {
        try {
            // Validate input
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }
            
            // Standard contract size is 100 shares per contract
            const contractSize = 100;

            // Calculate option price
            const { price: optionPricePerShare, error } = await this.calculateOptionPrice(
                symbol,
                optionType,
                strikePrice,
                expirationDate
            );

            if (!optionPricePerShare || error) {
                return { success: false, message: error || 'Failed to calculate option price' };
            }

            // Total cost per contract (100 shares)
            const contractPrice = optionPricePerShare * contractSize;
            const totalCost = contractPrice * quantity;

            // Get user's cash balance
            const user = userDb.getOrCreateUser(userId);
            
            // Check if user can afford the trade
            if (position === 'long') {
                // Buying options requires cash
                if (user.cashBalance < totalCost) {
                    return { 
                        success: false, 
                        message: `Insufficient funds to buy options. You need $${totalCost.toFixed(2)} but have $${user.cashBalance.toFixed(2)}` 
                    };
                }
                
                // Update cash balance
                userDb.updateCashBalance(userId, user.cashBalance - totalCost);
                
                // Create a new position or update existing one
                const existingPosition = optionsDb.getMatchingPosition(
                    userId,
                    symbol,
                    optionType,
                    strikePrice,
                    expirationDate,
                    'long'
                );
                
                if (existingPosition) {
                    // Calculate new average price
                    const totalQuantity = existingPosition.quantity + quantity;
                    const newAveragePrice = (
                        (existingPosition.quantity * existingPosition.purchasePrice) + 
                        (quantity * optionPricePerShare)
                    ) / totalQuantity;
                    
                    // Update existing position
                    optionsDb.updatePosition(existingPosition.id!, totalQuantity, newAveragePrice);
                } else {
                    // Create new position
                    optionsDb.createPosition(
                        userId,
                        symbol,
                        optionType,
                        quantity,
                        strikePrice,
                        expirationDate,
                        optionPricePerShare,
                        'long'
                    );
                }
                
                // Record transaction
                optionsDb.addTransaction(
                    userId,
                    symbol,
                    optionType,
                    quantity,
                    strikePrice,
                    expirationDate,
                    optionPricePerShare,
                    'long',
                    'open'
                );
                
                // Return success message
                return { 
                    success: true, 
                    message: `Successfully bought ${quantity} ${optionType} option contract(s) for ${symbol} at $${contractPrice.toFixed(2)} per contract`,
                    contract: {
                        symbol,
                        optionType,
                        strikePrice,
                        expirationDate,
                        position: 'long',
                        price: optionPricePerShare,
                        quantity
                    }
                };
            } else {
                // Shorting options (writing options)
                // Check margin requirements (typically 20% of underlying + option premium)
                const stockData = await stockService.getStockPrice(symbol);
                if (!stockData.price) {
                    return { 
                        success: false, 
                        message: `Unable to get price for ${symbol}` 
                    };
                }
                
                // Calculate margin requirement (simplified)
                // In real trading, this would be much more complex
                const marginPerContract = contractPrice + (stockData.price * contractSize * 0.2);
                const totalMarginRequired = marginPerContract * quantity;
                
                // Check if user has enough available margin
                const { marginBalance, marginUsed } = userDb.getMarginBalance(userId);
                const availableMargin = marginBalance - marginUsed;
                
                if (availableMargin < totalMarginRequired) {
                    return {
                        success: false,
                        message: `Insufficient margin to write options. You need $${totalMarginRequired.toFixed(2)} but have $${availableMargin.toFixed(2)} available`
                    };
                }
                
                // Update margin used
                userDb.increaseMarginUsed(userId, totalMarginRequired);
                
                // Update cash balance (writer receives premium)
                userDb.updateCashBalance(userId, user.cashBalance + totalCost);
                
                // Create a new position or update existing one
                const existingPosition = optionsDb.getMatchingPosition(
                    userId,
                    symbol,
                    optionType,
                    strikePrice,
                    expirationDate,
                    'short'
                );
                
                if (existingPosition) {
                    // Calculate new average price
                    const totalQuantity = existingPosition.quantity + quantity;
                    const newAveragePrice = (
                        (existingPosition.quantity * existingPosition.purchasePrice) + 
                        (quantity * optionPricePerShare)
                    ) / totalQuantity;
                    
                    // Update existing position
                    optionsDb.updatePosition(existingPosition.id!, totalQuantity, newAveragePrice);
                } else {
                    // Create new position
                    optionsDb.createPosition(
                        userId,
                        symbol,
                        optionType,
                        quantity,
                        strikePrice,
                        expirationDate,
                        optionPricePerShare,
                        'short'
                    );
                }
                
                // Record transaction
                optionsDb.addTransaction(
                    userId,
                    symbol,
                    optionType,
                    quantity,
                    strikePrice,
                    expirationDate,
                    optionPricePerShare,
                    'short',
                    'open'
                );
                
                // Return success message
                return { 
                    success: true, 
                    message: `Successfully wrote ${quantity} ${optionType} option contract(s) for ${symbol} at $${contractPrice.toFixed(2)} per contract`,
                    contract: {
                        symbol,
                        optionType,
                        strikePrice,
                        expirationDate,
                        position: 'short',
                        price: optionPricePerShare,
                        quantity
                    }
                };
            }
        } catch (error) {
            console.error('Option trade error:', error);
            return { 
                success: false, 
                message: error instanceof Error ? error.message : 'Unknown error occurred while trading options' 
            };
        }
    },
    
    /**
     * Close an options position
     */
    async closePosition(
        userId: string,
        positionId: number,
        quantity: number
    ): Promise<{ success: boolean; message: string }> {
        try {
            // Validate input
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }
            
            // Get position
            const position = optionsDb.getPositionById(positionId);
            if (!position) {
                return { success: false, message: 'Position not found' };
            }
            
            // Check if position belongs to user
            if (position.userId !== userId) {
                return { success: false, message: 'You do not own this position' };
            }
            
            // Check if position is still open
            if (position.status !== 'open') {
                return { success: false, message: `This position is already ${position.status}` };
            }
            
            // Check if user has enough contracts
            if (position.quantity < quantity) {
                return { 
                    success: false, 
                    message: `You only have ${position.quantity} contract(s) in this position` 
                };
            }
            
            // Get current option price
            const { price: currentPricePerShare } = await this.calculateOptionPrice(
                position.symbol,
                position.optionType,
                position.strikePrice,
                position.expirationDate
            );
            
            if (!currentPricePerShare) {
                return { success: false, message: 'Failed to get current option price' };
            }
            
            // Calculate contract price (100 shares per contract)
            const contractSize = 100;
            const contractPrice = currentPricePerShare * contractSize;
            const totalValue = contractPrice * quantity;
            
            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);
            
            // Process based on position type
            if (position.position === 'long') {
                // Selling options you own
                // Update cash balance (add proceeds)
                userDb.updateCashBalance(userId, cashBalance + totalValue);
                
                // Calculate profit/loss
                const purchasePrice = position.purchasePrice * contractSize * quantity;
                const pl = totalValue - purchasePrice;
                const plText = pl >= 0 ? `profit of $${pl.toFixed(2)}` : `loss of $${Math.abs(pl).toFixed(2)}`;
                
                // Update position
                if (position.quantity === quantity) {
                    // Close entire position
                    optionsDb.updatePositionStatus(positionId, 'closed');
                } else {
                    // Reduce position size
                    optionsDb.updatePosition(positionId, position.quantity - quantity, position.purchasePrice);
                }
                
                // Record transaction
                optionsDb.addTransaction(
                    userId,
                    position.symbol,
                    position.optionType,
                    quantity,
                    position.strikePrice,
                    position.expirationDate,
                    currentPricePerShare,
                    'long',
                    'close'
                );
                
                return { 
                    success: true, 
                    message: `Successfully sold ${quantity} ${position.optionType} option contract(s) for ${position.symbol} at $${contractPrice.toFixed(2)} per contract with a ${plText}`
                };
            } else {
                // Buying to close a short position
                // Check if user has enough cash
                if (cashBalance < totalValue) {
                    return { 
                        success: false, 
                        message: `Insufficient funds to close position. You need $${totalValue.toFixed(2)} but have $${cashBalance.toFixed(2)}`
                    };
                }
                
                // Update cash balance (subtract cost)
                userDb.updateCashBalance(userId, cashBalance - totalValue);
                
                // Calculate margin to release
                const stockPrice = (await stockService.getStockPrice(position.symbol)).price || 0;
                const marginPerContract = (position.purchasePrice * contractSize) + (stockPrice * contractSize * 0.2);
                const marginToRelease = marginPerContract * quantity;
                
                // Release margin
                userDb.decreaseMarginUsed(userId, marginToRelease);
                
                // Calculate profit/loss
                const originalPremium = position.purchasePrice * contractSize * quantity;
                const pl = originalPremium - totalValue;
                const plText = pl >= 0 ? `profit of $${pl.toFixed(2)}` : `loss of $${Math.abs(pl).toFixed(2)}`;
                
                // Update position
                if (position.quantity === quantity) {
                    // Close entire position
                    optionsDb.updatePositionStatus(positionId, 'closed');
                } else {
                    // Reduce position size
                    optionsDb.updatePosition(positionId, position.quantity - quantity, position.purchasePrice);
                }
                
                // Record transaction
                optionsDb.addTransaction(
                    userId,
                    position.symbol,
                    position.optionType,
                    quantity,
                    position.strikePrice,
                    position.expirationDate,
                    currentPricePerShare,
                    'short',
                    'close'
                );
                
                return { 
                    success: true, 
                    message: `Successfully closed ${quantity} ${position.optionType} option contract(s) for ${position.symbol} at $${contractPrice.toFixed(2)} per contract with a ${plText}`
                };
            }
        } catch (error) {
            console.error('Close position error:', error);
            return { 
                success: false, 
                message: error instanceof Error ? error.message : 'Unknown error occurred while closing position'
            };
        }
    },
    
    /**
     * Get user's options portfolio with current valuations
     */
    async getOptionsPortfolio(userId: string): Promise<{
        positions: OptionContract[];
        totalValue: number;
    }> {
        try {
            // Get user's open positions
            const positions = optionsDb.getOpenPositions(userId);
            
            if (positions.length === 0) {
                return {
                    positions: [],
                    totalValue: 0
                };
            }
            
            // Calculate current values
            const contractSize = 100;
            let totalValue = 0;
            
            const enrichedPositions = await Promise.all(positions.map(async (pos) => {
                // Get current option price
                const { price: currentPricePerShare } = await this.calculateOptionPrice(
                    pos.symbol,
                    pos.optionType,
                    pos.strikePrice,
                    pos.expirationDate
                );
                
                // Get underlying stock price
                const stockData = await stockService.getStockPrice(pos.symbol);
                const stockPrice = stockData.price || 0;
                
                // Calculate time to expiry
                const expiry = new Date(pos.expirationDate);
                const timeToExpiry = calculateTimeToExpiry(expiry);
                
                // Calculate intrinsic value and moneyness
                const type = pos.optionType === 'call' ? OptionType.CALL : OptionType.PUT;
                const intrinsicValue = Option.intrinsicValue(type, stockPrice, pos.strikePrice);
                const moneyness = Option.moneyness(type, stockPrice, pos.strikePrice);
                
                // Format expiration date
                const formattedExpiration = new Date(pos.expirationDate).toLocaleDateString();
                
                // Calculate position value
                let positionValue = (currentPricePerShare || 0) * contractSize * pos.quantity;
                
                // For short positions, value is negative (it's a liability)
                // but we track the absolute value for totals
                if (pos.position === 'short') {
                    positionValue = -positionValue;
                }
                
                // Add to total portfolio value
                totalValue += Math.abs(positionValue);
                
                // Calculate profit/loss
                const costBasis = pos.purchasePrice * contractSize * pos.quantity;
                let profitLoss = (currentPricePerShare || 0) * contractSize * pos.quantity - costBasis;
                
                // For short positions, profit is reversed
                if (pos.position === 'short') {
                    profitLoss = costBasis - (currentPricePerShare || 0) * contractSize * pos.quantity;
                }
                
                // Calculate percent change
                const percentChange = (profitLoss / costBasis) * 100;
                
                return {
                    id: pos.id,
                    symbol: pos.symbol,
                    optionType: pos.optionType,
                    strikePrice: pos.strikePrice,
                    expirationDate: pos.expirationDate,
                    formattedExpiration,
                    position: pos.position,
                    price: pos.purchasePrice,
                    purchasePrice: pos.purchasePrice,
                    currentPrice: currentPricePerShare || 0,
                    quantity: pos.quantity,
                    status: pos.status,
                    timeToExpiry,
                    intrinsicValue,
                    moneyness,
                    marketValue: Math.abs(positionValue),
                    profitLoss,
                    percentChange
                };
            }));
            
            return {
                positions: enrichedPositions,
                totalValue
            };
        } catch (error) {
            console.error('Get options portfolio error:', error);
            throw error;
        }
    },
    
    /**
     * Get options transaction history for a user
     */
    getTransactionHistory(userId: string, limit = 10): any[] {
        return optionsDb.getUserTransactions(userId, limit);
    },
    
    /**
     * Process expired options
     * This should be run daily to check for options that have expired
     */
    async processExpiredOptions(): Promise<{
        processed: number;
        marginCalls: number;
    }> {
        try {
            // Get expired options that are still open
            const expiredOptions = optionsDb.getExpiredPositions();
            
            if (expiredOptions.length === 0) {
                return { processed: 0, marginCalls: 0 };
            }
            
            let marginCallsCreated = 0;
            const contractSize = 100;
            
            // Process each expired option
            for (const option of expiredOptions) {
                // Get current stock price
                const { price: stockPrice } = await stockService.getStockPrice(option.symbol);
                
                if (!stockPrice) {
                    console.error(`Could not get price for ${option.symbol} to process expired option`);
                    continue;
                }
                
                const type = option.optionType === 'call' ? OptionType.CALL : OptionType.PUT;
                const intrinsicValue = Option.intrinsicValue(type, stockPrice, option.strikePrice);
                
                // Option is in the money if intrinsic value > 0
                const isInTheMoney = intrinsicValue > 0;
                
                // Process based on position type and moneyness
                if (option.position === 'long') {
                    // Long position
                    if (isInTheMoney) {
                        // Option is in the money, exercise it
                        const exerciseValue = intrinsicValue * contractSize * option.quantity;
                        const user = userDb.getOrCreateUser(option.userId);
                        
                        // Add exercise value to user's cash balance
                        userDb.updateCashBalance(option.userId, user.cashBalance + exerciseValue);
                        
                        // Mark option as exercised
                        optionsDb.updatePositionStatus(option.id!, 'exercised');
                        
                        // Record transaction
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            intrinsicValue,
                            'long',
                            'exercise'
                        );
                    } else {
                        // Option is out of the money, let it expire worthless
                        optionsDb.updatePositionStatus(option.id!, 'expired');
                        
                        // Record transaction
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            0,
                            'long',
                            'expire'
                        );
                    }
                } else {
                    // Short position
                    if (isInTheMoney) {
                        // Option is in the money, assigned
                        const assignmentValue = intrinsicValue * contractSize * option.quantity;
                        const user = userDb.getOrCreateUser(option.userId);
                        
                        // Subtract assignment value from user's cash balance
                        const newBalance = user.cashBalance - assignmentValue;
                        
                        if (newBalance < 0) {
                            // Not enough cash, trigger margin call
                            marginCallsCreated++;
                            marginDb.createMarginCall(
                                option.userId,
                                Math.abs(newBalance),
                                `Assignment on ${option.quantity} ${option.symbol} ${option.optionType} options`
                            );
                            
                            // Set balance to 0 - user will need to deposit funds
                            userDb.updateCashBalance(option.userId, 0);
                        } else {
                            // Enough cash to cover assignment
                            userDb.updateCashBalance(option.userId, newBalance);
                        }
                        
                        // Release margin that was held for this position
                        const marginPerContract = (option.purchasePrice * contractSize) + (stockPrice * contractSize * 0.2);
                        const marginToRelease = marginPerContract * option.quantity;
                        userDb.decreaseMarginUsed(option.userId, marginToRelease);
                        
                        // Mark option as exercised
                        optionsDb.updatePositionStatus(option.id!, 'exercised');
                        
                        // Record transaction
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            intrinsicValue,
                            'short',
                            'exercise'
                        );
                    } else {
                        // Option is out of the money, expires worthless
                        // Release margin that was held for this position
                        const marginPerContract = (option.purchasePrice * contractSize) + (stockPrice * contractSize * 0.2);
                        const marginToRelease = marginPerContract * option.quantity;
                        userDb.decreaseMarginUsed(option.userId, marginToRelease);
                        
                        // Mark option as expired
                        optionsDb.updatePositionStatus(option.id!, 'expired');
                        
                        // Record transaction
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            0,
                            'short',
                            'expire'
                        );
                    }
                }
            }
            
            return {
                processed: expiredOptions.length,
                marginCalls: marginCallsCreated
            };
        } catch (error) {
            console.error('Process expired options error:', error);
            throw error;
        }
    },
    
    /**
     * Process margin calls
     * This should be run regularly to check if any margin calls need to be liquidated
     */
    async processMarginCalls(): Promise<{
        processed: number;
        liquidated: number;
    }> {
        try {
            // Get all pending margin calls
            const marginCalls = marginDb.getAllPendingMarginCalls();
            
            if (marginCalls.length === 0) {
                return { processed: 0, liquidated: 0 };
            }
            
            let liquidated = 0;
            
            // Process each margin call
            for (const call of marginCalls) {
                // Get user's cash balance
                const cashBalance = userDb.getCashBalance(call.userId);
                
                // If user has enough cash, satisfy margin call
                if (cashBalance >= call.amount) {
                    // Subtract margin call amount from cash balance
                    userDb.updateCashBalance(call.userId, cashBalance - call.amount);
                    
                    // Mark margin call as satisfied
                    marginDb.resolveMarginCall(call.id!, 'satisfied');
                } else {
                    // Liquidate positions to satisfy margin call
                    // In a real system, this would be more complex with position prioritization
                    liquidated++;
                    
                    // Mark margin call as liquidated
                    marginDb.resolveMarginCall(call.id!, 'liquidated');
                    
                    // TODO: Add liquidation logic to sell positions if needed
                    // For now, we just mark it as liquidated
                }
            }
            
            return {
                processed: marginCalls.length,
                liquidated
            };
        } catch (error) {
            console.error('Process margin calls error:', error);
            throw error;
        }
    },
    
    /**
     * Format option symbol in standard format (e.g., AAPL220121C00150000)
     */
    formatOptionSymbol(symbol: string, expirationDate: string, optionType: string, strikePrice: number): string {
        const expDate = new Date(expirationDate);
        const year = expDate.getFullYear().toString().substring(2); // Last 2 digits
        const month = (expDate.getMonth() + 1).toString().padStart(2, '0');
        const day = expDate.getDate().toString().padStart(2, '0');
        
        const optionTypeChar = optionType.toLowerCase() === 'call' ? 'C' : 'P';
        
        // Format strike price with 8 digits (including cents)
        const formattedStrike = (strikePrice * 1000).toFixed(0).padStart(8, '0');
        
        return `${symbol}${year}${month}${day}${optionTypeChar}${formattedStrike}`;
    }
};