import { stockService } from './stockService';
import { optionsDb, userDb, marginDb, portfolioDb } from '../database/operations';
import { Option, OptionType, calculateTimeToExpiry, DEFAULT_RISK_FREE_RATE, getHistoricalVolatility } from '../utils/blackScholes';
import { tradingService } from './tradingService';

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
    status?: 'open' | 'closed' | 'expired' | 'exercised' | 'liquidated';
    marketValue?: number;
    profitLoss?: number;
    percentChange?: number;
    marginRequired?: number;
    isSecured?: boolean;
}

/**
 * Interface for option position
 */
export interface OptionPosition {
    id?: number;
    userId: string;
    symbol: string;
    optionType: 'call' | 'put';
    position: 'long' | 'short';
    strikePrice: number;
    expirationDate: string;
    quantity: number;
    purchasePrice: number;
    marginRequired: number;
    isSecured: boolean;
    status: 'open' | 'closed' | 'expired' | 'exercised' | 'liquidated';
}

/**
 * Interface for margin info
 */
export interface MarginInfo {
    marginUsed: number;
    marginAvailable: number;
    marginUsagePercent: number;
}

/**
 * Interface for margin status
 */
export interface MarginStatus {
    marginUsed: number;
    availableMargin: number;
    utilizationPercentage: number;
    portfolioValue: number;
}

// Contract size is standard 100 shares
const CONTRACT_SIZE = 100;

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

            // Get volatility estimate - now async with real data
            const volatility = await getHistoricalVolatility(symbol);

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
     * Calculate margin requirement for an option position
     * Returns margin per contract
     */
    async calculateMarginRequirement(
        symbol: string,
        optionType: 'call' | 'put',
        strikePrice: number,
        position: 'long' | 'short',
        optionPricePerShare: number,
        isSecured: boolean
    ): Promise<number> {
        try {
            // Long positions don't require margin
            if (position === 'long') {
                return 0;
            }
            
            // Get stock price for margin calculation
            const stockData = await stockService.getStockPrice(symbol);
            if (!stockData.price) {
                throw new Error(`Unable to find price for ${symbol}`);
            }
            
            const stockPrice = stockData.price;
            const contractPrice = optionPricePerShare * CONTRACT_SIZE;
            
            // For secured options, no margin is required (cash secured put or covered call)
            if (isSecured) {
                return 0;
            }

            // Calculate margin requirement
            if (optionType === 'call') {
                // Short call margin = option premium + 20% of stock price
                return contractPrice + (stockPrice * CONTRACT_SIZE * 0.2);
            } else {
                // Short put margin = option premium + 20% of strike price
                return contractPrice + (strikePrice * CONTRACT_SIZE * 0.2);
            }
        } catch (error) {
            console.error('Margin calculation error:', error);
            throw error;
        }
    },
    
    /**
     * Check if a call is covered by existing shares
     */
    async isCoveredCall(
        userId: string,
        symbol: string,
        strikePrice: number,
        quantity: number
    ): Promise<boolean> {
        try {
            // Get user's position in the underlying stock
            const position = portfolioDb.getUserPosition(userId, symbol);
            
            // No position or not enough shares to cover the calls
            if (!position || position.quantity < quantity * CONTRACT_SIZE) {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Covered call check error:', error);
            return false;
        }
    },
    
    /**
     * Check if a put is cash secured
     */
    async isCashSecuredPut(
        userId: string,
        symbol: string,
        strikePrice: number,
        quantity: number
    ): Promise<boolean> {
        try {
            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);
            
            // Calculate required cash to secure the puts
            const requiredCash = strikePrice * CONTRACT_SIZE * quantity;
            
            // Not enough cash to secure the puts
            if (cashBalance < requiredCash) {
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Cash secured put check error:', error);
            return false;
        }
    },

    /**
     * Determine if an option position is secured (cash-secured put or covered call)
     * @param position The option position
     * @param currentStockPrice Current price of the underlying stock
     * @param stockHolding Current quantity of stocks held for the same symbol
     * @param cashBalance Available cash balance
     * @returns boolean indicating if the position is secured
     */
    isSecuredPosition(
        position: OptionPosition,
        currentStockPrice: number,
        stockHolding: number,
        cashBalance: number
    ): boolean {
        if (position.position !== 'short') return false; // Only short positions can be secured

        if (position.optionType === 'put') {
            // Cash-secured put: User needs cash to buy shares at strike price
            const cashNeeded = position.strikePrice * CONTRACT_SIZE * position.quantity;
            return cashBalance >= cashNeeded;
        } else {
            // Covered call: User needs to own the underlying shares
            const sharesNeeded = CONTRACT_SIZE * position.quantity;
            return stockHolding >= sharesNeeded;
        }
    },

    /**
     * Calculate margin requirement for naked short options
     */
    calculateShortOptionMargin(option: OptionPosition, currentStockPrice: number): number {
        const contractSize = CONTRACT_SIZE;
        
        if (option.optionType === 'call') {
            // Short call margin = 20% of stock price × contract size × number of contracts
            return currentStockPrice * 0.2 * contractSize * option.quantity;
        } else {
            // Short put margin = 20% of strike price × contract size × number of contracts
            return option.strikePrice * 0.2 * contractSize * option.quantity;
        }
    },

    /**
     * Calculate the current margin status based on positions and portfolio value
     * @param userId User ID to calculate margin for
     * @returns Margin status object with used margin, available margin, and utilization percentage
     */
    async calculateMarginStatus(userId: string): Promise<MarginStatus> {
        // Get user positions from the database
        const options = optionsDb.getOpenPositions(userId);
        const stocks = portfolioDb.getUserPortfolio(userId);
        const cash = userDb.getCashBalance(userId);
        
        let totalPortfolioValue = cash;
        let marginUsed = 0;
        
        // Add stock value to portfolio
        for (const stock of stocks) {
            const stockData = await stockService.getStockPrice(stock.symbol);
            if (stockData.price) {
                totalPortfolioValue += stockData.price * stock.quantity;
            }
        }
        
        // Calculate option premium values and margin requirements
        for (const option of options) {
            const stockData = await stockService.getStockPrice(option.symbol);
            const currentStockPrice = stockData.price || 0;
            const stockHolding = stocks.find(s => s.symbol === option.symbol)?.quantity || 0;
            
            // Check if this is a secured position (cash-secured put or covered call)
            const isSecured = this.isSecuredPosition(option, currentStockPrice, stockHolding, cash);
            
            if (option.position === 'long') {
                // Long options don't require margin
                const optionValue = await this.calculateOptionValue(option, currentStockPrice);
                totalPortfolioValue += optionValue;
            } else {
                // For short options
                if (isSecured) {
                    // Secured positions don't require additional margin
                    // The security (cash or stock) is already accounted for in portfolio value
                } else {
                    // Calculate margin requirement for naked short options
                    const marginRequirement = this.calculateShortOptionMargin(option, currentStockPrice);
                    marginUsed += marginRequirement;
                }
            }
        }
        
        // Available margin is a percentage of portfolio value minus margin used
        const marginPercentage = 0.5; // 50% of portfolio value can be used as margin
        const availableMargin = (totalPortfolioValue * marginPercentage) - marginUsed;
        const utilizationPercentage = marginUsed / (totalPortfolioValue * marginPercentage) * 100;
        
        return {
            marginUsed,
            availableMargin,
            utilizationPercentage,
            portfolioValue: totalPortfolioValue
        };
    },

    /**
     * Calculate the value of an option position based on current market conditions
     * @param option Option position to calculate value for
     * @param currentStockPrice Current price of the underlying stock
     * @returns The total market value of the option position
     */
    async calculateOptionValue(option: OptionPosition, currentStockPrice: number): Promise<number> {
        try {
            // Calculate time to expiry
            const expiry = new Date(option.expirationDate);
            const timeToExpiry = calculateTimeToExpiry(expiry);
            
            // If option has expired, its value is 0
            if (timeToExpiry <= 0) {
                return 0;
            }
            
            // Get volatility estimate - now async with real data
            const volatility = await getHistoricalVolatility(option.symbol);
            
            // Use Black-Scholes to calculate option price
            const type = option.optionType === 'call' ? OptionType.CALL : OptionType.PUT;
            const optionPrice = Option.price(
                type,
                currentStockPrice,
                option.strikePrice,
                timeToExpiry,
                DEFAULT_RISK_FREE_RATE,
                volatility
            );
            
            // Calculate total position value
            return optionPrice * CONTRACT_SIZE * option.quantity;
        } catch (error) {
            console.error('Option value calculation error:', error);
            return 0; // Default to 0 on error
        }
    },

    /**
     * Get user's options margin usage for display
     */
    async getOptionsMarginUsage(userId: string): Promise<{
        marginUsed: number;
        positions: OptionContract[];
    }> {
        try {
            const positions = optionsDb.getOpenPositions(userId);
            const totalMarginUsed = optionsDb.getTotalMarginRequirements(userId);
            
            return {
                marginUsed: totalMarginUsed,
                positions: positions as unknown as OptionContract[]
            };
        } catch (error) {
            console.error('Get options margin usage error:', error);
            throw error;
        }
    },

    /**
     * Check if a user has sufficient margin for a new option position
     */
    async hasSufficientMargin(
        userId: string,
        additionalMarginRequired: number
    ): Promise<{
        sufficient: boolean;
        marginStatus: MarginStatus;
    }> {
        try {
            const marginStatus = await this.calculateMarginStatus(userId);
            
            // Check if there's sufficient margin for the new position
            const sufficient = marginStatus.marginUsed + additionalMarginRequired <= marginStatus.availableMargin;
            
            return { sufficient, marginStatus };
        } catch (error) {
            console.error('Margin check error:', error);
            throw error;
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
        quantity: number,
        useSecured: boolean = false  // Whether to use cash-secured puts or covered calls
    ): Promise<{ success: boolean; message: string; contract?: OptionContract }> {
        try {
            // Validate input
            if (quantity <= 0 || !Number.isInteger(quantity)) {
                return { success: false, message: 'Quantity must be a positive integer' };
            }

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

            // Total cost per contract (100 shares per contract)
            const contractPrice = optionPricePerShare * CONTRACT_SIZE;
            const totalCost = contractPrice * quantity;

            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);
            
            let isSecured = false;
            let marginRequired = 0;
            
            // Check if user can afford the trade
            if (position === 'long') {
                // Buying options requires cash
                if (cashBalance < totalCost) {
                    return { 
                        success: false, 
                        message: `Insufficient funds to buy options. You need $${totalCost.toFixed(2)} but have $${cashBalance.toFixed(2)}` 
                    };
                }
                
                // Update cash balance
                userDb.updateCashBalance(userId, cashBalance - totalCost);
                
                // Create a new position or update existing one
                const existingPosition = optionsDb.getMatchingPosition(
                    userId,
                    symbol,
                    optionType,
                    strikePrice,
                    expirationDate,
                    'long',
                    false // Long positions aren't secured
                );
                
                if (existingPosition) {
                    // Calculate new average price
                    const totalQuantity = existingPosition.quantity + quantity;
                    const newAveragePrice = (
                        (existingPosition.quantity * existingPosition.purchasePrice) + 
                        (quantity * optionPricePerShare)
                    ) / totalQuantity;
                    
                    // Update existing position - no margin required for long positions
                    optionsDb.updatePosition(existingPosition.id!, totalQuantity, newAveragePrice, 0);
                } else {
                    // Create new position - no margin required for long positions
                    optionsDb.createPosition(
                        userId,
                        symbol,
                        optionType,
                        quantity,
                        strikePrice,
                        expirationDate,
                        optionPricePerShare,
                        'long',
                        0, // No margin required for long positions
                        false // Long positions aren't secured
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
                    'open',
                    0, // No profit/loss yet
                    0, // No margin required for long positions
                    false // Long positions aren't secured
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
                        quantity,
                        marginRequired: 0,
                        isSecured: false
                    }
                };
            } else {
                // Shorting options (writing options)
                // Check for covered call or cash secured put if requested
                if (useSecured) {
                    if (optionType === 'call') {
                        // Check if user has enough shares to cover the call
                        const isCovered = await this.isCoveredCall(userId, symbol, strikePrice, quantity);
                        if (!isCovered) {
                            return {
                                success: false,
                                message: `You don't have enough shares of ${symbol} to write covered calls. You need at least ${quantity * CONTRACT_SIZE} shares.`
                            };
                        }
                        isSecured = true;
                    } else {
                        // Check if user has enough cash to secure the put
                        const isCashSecured = await this.isCashSecuredPut(userId, symbol, strikePrice, quantity);
                        if (!isCashSecured) {
                            return {
                                success: false,
                                message: `You don't have enough cash to write cash-secured puts. You need $${(strikePrice * CONTRACT_SIZE * quantity).toFixed(2)}.`
                            };
                        }
                        isSecured = true;
                    }
                }

                // If not secured, calculate margin requirement
                if (!isSecured) {
                    marginRequired = await this.calculateMarginRequirement(
                        symbol,
                        optionType,
                        strikePrice,
                        'short',
                        optionPricePerShare,
                        false
                    );
                    
                    const totalMarginRequired = marginRequired * quantity;
                    
                    // Check if user has enough available margin
                    const { sufficient, marginStatus } = await this.hasSufficientMargin(userId, totalMarginRequired);
                    
                    if (!sufficient) {
                        return {
                            success: false,
                            message: `Insufficient margin to write options. You need $${totalMarginRequired.toFixed(2)} but have $${(marginStatus.availableMargin - marginStatus.marginUsed).toFixed(2)} available.`
                        };
                    }
                }
                
                // Update cash balance (writer receives premium)
                userDb.updateCashBalance(userId, cashBalance + totalCost);
                
                // Create a new position or update existing one
                const existingPosition = optionsDb.getMatchingPosition(
                    userId,
                    symbol,
                    optionType,
                    strikePrice,
                    expirationDate,
                    'short',
                    isSecured
                );
                
                const totalMarginForPosition = marginRequired * quantity;
                
                if (existingPosition) {
                    // Calculate new average price
                    const totalQuantity = existingPosition.quantity + quantity;
                    const newAveragePrice = (
                        (existingPosition.quantity * existingPosition.purchasePrice) + 
                        (quantity * optionPricePerShare)
                    ) / totalQuantity;
                    
                    // Calculate new total margin
                    const newTotalMargin = existingPosition.marginRequired + totalMarginForPosition;
                    
                    // Update existing position
                    optionsDb.updatePosition(existingPosition.id!, totalQuantity, newAveragePrice, newTotalMargin);
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
                        'short',
                        totalMarginForPosition,
                        isSecured
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
                    'open',
                    0, // No profit/loss yet
                    totalMarginForPosition,
                    isSecured
                );
                
                // Return success message
                const securedText = isSecured 
                    ? (optionType === 'call' ? 'covered call' : 'cash-secured put')
                    : optionType;
                
                return { 
                    success: true, 
                    message: `Successfully wrote ${quantity} ${securedText} option contract(s) for ${symbol} at $${contractPrice.toFixed(2)} per contract`,
                    contract: {
                        symbol,
                        optionType,
                        strikePrice,
                        expirationDate,
                        position: 'short',
                        price: optionPricePerShare,
                        quantity,
                        marginRequired: totalMarginForPosition,
                        isSecured
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
        quantity: number = 0  // If 0, close entire position
    ): Promise<{ success: boolean; message: string }> {
        try {
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
            
            // If quantity is 0 or greater than position quantity, close the entire position
            if (quantity <= 0 || quantity > position.quantity) {
                quantity = position.quantity;
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
            const contractPrice = currentPricePerShare * CONTRACT_SIZE;
            const totalValue = contractPrice * quantity;
            
            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);
            
            // Process based on position type
            if (position.position === 'long') {
                // Selling options you own
                // Update cash balance (add proceeds)
                userDb.updateCashBalance(userId, cashBalance + totalValue);
                
                // Calculate profit/loss
                const purchasePrice = position.purchasePrice * CONTRACT_SIZE * quantity;
                const pl = totalValue - purchasePrice;
                const plText = pl >= 0 ? `profit of $${pl.toFixed(2)}` : `loss of $${Math.abs(pl).toFixed(2)}`;
                
                // Update position
                if (position.quantity === quantity) {
                    // Close entire position
                    optionsDb.updatePositionStatus(positionId, 'closed');
                } else {
                    // Reduce position size - no margin impact for long positions
                    optionsDb.updatePosition(positionId, position.quantity - quantity, position.purchasePrice, 0);
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
                    'close',
                    pl,
                    0,
                    false
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
                
                // Calculate profit/loss
                const originalPremium = position.purchasePrice * CONTRACT_SIZE * quantity;
                const pl = originalPremium - totalValue;
                const plText = pl >= 0 ? `profit of $${pl.toFixed(2)}` : `loss of $${Math.abs(pl).toFixed(2)}`;
                
                // Calculate margin being freed
                const marginPerContract = position.marginRequired / position.quantity;
                const marginToRelease = marginPerContract * quantity;
                
                // Update position
                if (position.quantity === quantity) {
                    // Close entire position
                    optionsDb.updatePositionStatus(positionId, 'closed');
                } else {
                    // Reduce position size and margin requirement proportionally
                    const remainingMargin = position.marginRequired - marginToRelease;
                    optionsDb.updatePosition(
                        positionId, 
                        position.quantity - quantity, 
                        position.purchasePrice,
                        remainingMargin
                    );
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
                    'close',
                    pl,
                    marginToRelease,
                    position.isSecured
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
                let positionValue = (currentPricePerShare || 0) * CONTRACT_SIZE * pos.quantity;
                
                // For short positions, value is negative (it's a liability)
                // but we track the absolute value for totals
                if (pos.position === 'short') {
                    positionValue = -positionValue;
                }
                
                // Add to total portfolio value
                totalValue += Math.abs(positionValue);
                
                // Calculate profit/loss
                const costBasis = pos.purchasePrice * CONTRACT_SIZE * pos.quantity;
                let profitLoss = (currentPricePerShare || 0) * CONTRACT_SIZE * pos.quantity - costBasis;
                
                // For short positions, profit is reversed
                if (pos.position === 'short') {
                    profitLoss = costBasis - (currentPricePerShare || 0) * CONTRACT_SIZE * pos.quantity;
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
                    percentChange,
                    marginRequired: pos.marginRequired,
                    isSecured: pos.isSecured
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
                
                // Rest of method remains unchanged
                if (option.position === 'long') {
                    if (isInTheMoney) {
                        const exerciseValue = intrinsicValue * CONTRACT_SIZE * option.quantity;
                        const user = userDb.getOrCreateUser(option.userId);
                        userDb.updateCashBalance(option.userId, user.cashBalance + exerciseValue);
                        optionsDb.updatePositionStatus(option.id!, 'exercised');
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            intrinsicValue,
                            'long',
                            'exercise',
                            exerciseValue,
                            0,
                            false
                        );
                    } else {
                        optionsDb.updatePositionStatus(option.id!, 'expired');
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            0,
                            'long',
                            'expire',
                            -option.purchasePrice * CONTRACT_SIZE * option.quantity,
                            0,
                            false
                        );
                    }
                } else {
                    if (isInTheMoney) {
                        const assignmentValue = intrinsicValue * CONTRACT_SIZE * option.quantity;
                        const user = userDb.getOrCreateUser(option.userId);
                        if (option.isSecured) {
                            if (option.optionType === 'call') {
                                await tradingService.sellStock(
                                    option.userId, 
                                    option.symbol, 
                                    option.quantity * CONTRACT_SIZE
                                );
                            } else {
                                await tradingService.buyStock(
                                    option.userId, 
                                    option.symbol, 
                                    option.quantity * CONTRACT_SIZE
                                );
                            }
                            optionsDb.updatePositionStatus(option.id!, 'exercised');
                            optionsDb.addTransaction(
                                option.userId,
                                option.symbol,
                                option.optionType,
                                option.quantity,
                                option.strikePrice,
                                option.expirationDate,
                                intrinsicValue,
                                'short',
                                'exercise',
                                -assignmentValue + (option.purchasePrice * CONTRACT_SIZE * option.quantity),
                                0,
                                true
                            );
                        } else {
                            const newBalance = user.cashBalance - assignmentValue;
                            if (newBalance < 0) {
                                marginCallsCreated++;
                                marginDb.createMarginCall(
                                    option.userId,
                                    Math.abs(newBalance),
                                    `Assignment on ${option.quantity} ${option.symbol} ${option.optionType} options`
                                );
                                userDb.updateCashBalance(option.userId, 0);
                            } else {
                                userDb.updateCashBalance(option.userId, newBalance);
                            }
                            optionsDb.updatePositionStatus(option.id!, 'exercised');
                            optionsDb.addTransaction(
                                option.userId,
                                option.symbol,
                                option.optionType,
                                option.quantity,
                                option.strikePrice,
                                option.expirationDate,
                                intrinsicValue,
                                'short',
                                'exercise',
                                -assignmentValue + (option.purchasePrice * CONTRACT_SIZE * option.quantity),
                                option.marginRequired,
                                false
                            );
                        }
                    } else {
                        optionsDb.updatePositionStatus(option.id!, 'expired');
                        optionsDb.addTransaction(
                            option.userId,
                            option.symbol,
                            option.optionType,
                            option.quantity,
                            option.strikePrice,
                            option.expirationDate,
                            0,
                            'short',
                            'expire',
                            option.purchasePrice * CONTRACT_SIZE * option.quantity,
                            option.marginRequired,
                            option.isSecured
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
     * Process margin calls and auto-liquidate positions if necessary
     * @param userId User ID to process margin calls for
     * @returns Object containing liquidation results
     */
    async processMarginCalls(userId: string): Promise<{ 
        success: boolean; 
        message: string; 
        positionsLiquidated?: number;
        marginStatus?: any;
    }> {
        try {
            // Calculate current margin status
            const marginStatus = await this.calculateMarginStatus(userId);
            
            // If margin utilization is below threshold, no action needed
            if (marginStatus.utilizationPercentage < 95) {
                return {
                    success: true,
                    message: 'No margin call required',
                    marginStatus
                };
            }
            
            // Get all open option positions sorted by risk (most risky first)
            const positions = optionsDb.getOpenPositions(userId);
            
            // Filter to only include short positions (which use margin)
            const shortPositions = positions.filter(p => p.position === 'short');
            
            if (shortPositions.length === 0) {
                return {
                    success: true,
                    message: 'No short positions to liquidate',
                    marginStatus
                };
            }
            
            // Sort positions by priority for liquidation:
            // 1. Unsecured positions first (they use margin)
            // 2. Higher margin requirement positions first
            const positionsToLiquidate = shortPositions
                .filter(p => !p.isSecured) // Only consider unsecured positions first
                .sort((a, b) => b.marginRequired - a.marginRequired);
            
            if (positionsToLiquidate.length === 0) {
                // If there are no unsecured positions, we should not have a margin call
                return {
                    success: true,
                    message: 'All short positions are secured',
                    marginStatus
                };
            }
            
            let positionsLiquidated = 0;
            const liquidationResults: string[] = [];
            
            // Process positions until margin is back below threshold or no more positions to liquidate
            for (const position of positionsToLiquidate) {
                // Attempt to liquidate the position
                const result = await this.closePosition(userId, position.id as number);
                
                if (result.success) {
                    positionsLiquidated++;
                    liquidationResults.push(result.message);
                    
                    // Recalculate margin status
                    const newMarginStatus = await this.calculateMarginStatus(userId);
                    
                    // If margin is now below threshold, stop liquidating
                    if (newMarginStatus.utilizationPercentage < 80) {
                        break;
                    }
                }
            }
            
            // Final margin status after liquidations
            const finalMarginStatus = await this.calculateMarginStatus(userId);
            
            // Generate result message
            if (positionsLiquidated > 0) {
                return {
                    success: true,
                    message: `Liquidated ${positionsLiquidated} positions to meet margin requirements. New margin utilization: ${finalMarginStatus.utilizationPercentage.toFixed(2)}%`,
                    positionsLiquidated,
                    marginStatus: finalMarginStatus
                };
            } else {
                return {
                    success: false,
                    message: 'Failed to liquidate positions to meet margin requirements',
                    positionsLiquidated: 0,
                    marginStatus: finalMarginStatus
                };
            }
        } catch (error) {
            console.error('Process margin calls error:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error while processing margin calls',
                positionsLiquidated: 0
            };
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