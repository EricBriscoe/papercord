import { coinGeckoService } from './coinGeckoService';
import { cryptoPortfolioDb, cryptoTransactionDb, userDb } from '../database/operations';
import { formatCurrency } from '../utils/formatters';

// Constants for safety limits
const MAX_TRANSACTION_VALUE_USD = 1000000; // $1 million max transaction
const MIN_COIN_PRICE_USD = 0.0001; // Minimum price to consider valid (prevent division by zero issues)
const MAX_COIN_QUANTITY = 1000000000000; // 1 trillion units max in a single transaction
const MIN_POSITION_VALUE_USD = 0.01; // Positions worth less than 1 cent are considered dust

export const cryptoTradingService = {
  /**
   * Get the current price of a cryptocurrency.
   */
  async getPrice(coinId: string): Promise<number> {
    try {
      const result = await coinGeckoService.getCoinPrice(coinId);
      if (result.price === null || result.error) {
        throw new Error(`Failed to get price for ${coinId}: ${result.error || 'Unknown error'}`);
      }
      return result.price;
    } catch (error) {
      console.error(`Error fetching crypto price for ${coinId}:`, error);
      throw error;
    }
  },

  /**
   * Get prices for multiple cryptocurrencies at once.
   */
  async getMultiplePrices(coinIds: string[]): Promise<{ [id: string]: number }> {
    try {
      const results = await coinGeckoService.getMultipleCoinsPrice(coinIds);
      const validPrices: { [id: string]: number } = {};
      
      for (const [coinId, price] of Object.entries(results)) {
        if (price !== null) {
          validPrices[coinId] = price;
        } else {
          console.warn(`No price found for ${coinId}`);
        }
      }
      
      return validPrices;
    } catch (error) {
      console.error(`Error fetching multiple crypto prices:`, error);
      throw error;
    }
  },

  /**
   * Buy a cryptocurrency using paper trading.
   */
  async buyCrypto(userId: string, coinId: string, amountUsd: number): Promise<{ success: boolean; message: string; amount?: number; price?: number }> {
    try {
      // Check if amount is valid
      if (amountUsd <= 0) {
        return { success: false, message: 'Amount must be greater than 0' };
      }

      // Enforce maximum transaction value
      if (amountUsd > MAX_TRANSACTION_VALUE_USD) {
        return { 
          success: false, 
          message: `Transaction amount exceeds the maximum allowed (${formatCurrency(MAX_TRANSACTION_VALUE_USD)})`
        };
      }

      // Get the current price
      const price = await this.getPrice(coinId);
      
      // Validate price
      if (!price) {
        return { success: false, message: `Couldn't get a valid price for ${coinId}` };
      }
      
      if (price <= MIN_COIN_PRICE_USD) {
        return { 
          success: false, 
          message: `Price of ${coinId} is too low (${price}). Minimum price threshold is ${MIN_COIN_PRICE_USD}` 
        };
      }

      // Calculate the amount of crypto to buy
      const amount = amountUsd / price;
      
      // Check for unreasonable quantity due to very low price
      if (amount > MAX_COIN_QUANTITY) {
        return { 
          success: false, 
          message: `This would result in an unreasonably large quantity (${amount.toExponential(2)} units). Maximum allowed is ${MAX_COIN_QUANTITY.toExponential(2)}`
        };
      }
      
      // Get current user balance
      const cashBalance = userDb.getCashBalance(userId);
      
      // Check if user has enough cash
      if (cashBalance < amountUsd) {
        return { success: false, message: `Insufficient funds. You have $${cashBalance.toFixed(2)}` };
      }
      
      // Get coin details - we'll try to find the full name, or default to the coinId
      let symbol = coinId;
      let name = coinId;
      
      try {
        const coinInfo = await coinGeckoService.getCoinDetails(coinId);
        if (coinInfo) {
          symbol = coinInfo.symbol || coinId;
          name = coinInfo.name || coinId;
        }
      } catch (error) {
        console.warn(`Failed to get coin details for ${coinId}, using ID as name`);
      }

      // Get existing position or create new one
      const position = cryptoPortfolioDb.getUserPosition(userId, coinId);
      
      let newQuantity, newAvgPrice;
      
      if (position) {
        // Update existing position with weighted average price
        const totalValue = position.quantity * position.averagePurchasePrice + amount * price;
        newQuantity = position.quantity + amount;
        newAvgPrice = totalValue / newQuantity;
      } else {
        newQuantity = amount;
        newAvgPrice = price;
      }
      
      // Update position
      cryptoPortfolioDb.updatePosition(
        userId,
        coinId,
        symbol,
        name,
        newQuantity,
        newAvgPrice
      );
      
      // Record transaction
      cryptoTransactionDb.addTransaction(
        userId,
        coinId,
        symbol,
        name,
        amount,
        price,
        'buy'
      );
      
      // Deduct cash
      userDb.updateCashBalance(userId, cashBalance - amountUsd);

      return {
        success: true,
        message: `Successfully bought ${amount.toFixed(8)} ${name} (${symbol}) at $${price.toFixed(2)}`,
        amount,
        price,
      };
    } catch (error) {
      console.error(`Error buying crypto ${coinId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  /**
   * Sell a cryptocurrency using paper trading.
   */
  async sellCrypto(userId: string, coinId: string, amount?: number): Promise<{ success: boolean; message: string; proceeds?: number; price?: number }> {
    try {
      // Get user's holdings
      const position = cryptoPortfolioDb.getUserPosition(userId, coinId);

      if (!position || position.quantity <= 0) {
        return { success: false, message: `You don't own any ${coinId}` };
      }

      // If no amount specified, sell all
      const amountToSell = amount !== undefined ? amount : position.quantity;

      // Validate amount
      if (amountToSell <= 0) {
        return { success: false, message: 'Amount must be greater than 0' };
      }

      if (amountToSell > position.quantity) {
        return { success: false, message: `You only have ${position.quantity} ${coinId}` };
      }

      // Get current price
      const price = await this.getPrice(coinId);
      
      // Validate price
      if (price <= MIN_COIN_PRICE_USD) {
        // For extremely low-value coins, liquidate the entire position at a minimum price
        // This prevents positions getting "stuck" due to price being too low
        const liquidationPrice = MIN_COIN_PRICE_USD;
        const liquidationProceeds = position.quantity * liquidationPrice;
        
        console.log(`Liquidating worthless position of ${coinId} (${position.quantity} units) at minimum price ${liquidationPrice}`);
        
        // Remove the position entirely
        cryptoPortfolioDb.updatePosition(
          userId,
          coinId,
          position.symbol,
          position.name,
          0,
          0
        );
        
        // Record the liquidation transaction
        cryptoTransactionDb.addTransaction(
          userId,
          coinId,
          position.symbol,
          position.name,
          position.quantity,
          liquidationPrice,
          'sell'
        );
        
        // Add liquidation proceeds to user's cash
        const cashBalance = userDb.getCashBalance(userId);
        userDb.updateCashBalance(userId, cashBalance + liquidationProceeds);
        
        return {
          success: true,
          message: `Position in ${position.name || coinId} was liquidated at minimum price due to extremely low value. Received ${formatCurrency(liquidationProceeds)}.`,
          proceeds: liquidationProceeds,
          price: liquidationPrice
        };
      }

      // Calculate proceeds
      const proceeds = amountToSell * price;
      
      // Prevent extremely large transactions in value
      if (proceeds > MAX_TRANSACTION_VALUE_USD) {
        return { 
          success: false, 
          message: `Transaction value (${formatCurrency(proceeds)}) exceeds the maximum allowed (${formatCurrency(MAX_TRANSACTION_VALUE_USD)}). Please sell a smaller amount.`
        };
      }

      // Update user's position
      const newQuantity = position.quantity - amountToSell;
      const newAvgPrice = position.quantity !== amountToSell ? position.averagePurchasePrice : 0;
      
      cryptoPortfolioDb.updatePosition(
        userId,
        coinId,
        position.symbol,
        position.name,
        newQuantity,
        newAvgPrice
      );
      
      // Record the transaction
      cryptoTransactionDb.addTransaction(
        userId,
        coinId,
        position.symbol,
        position.name,
        amountToSell,
        price,
        'sell'
      );
      
      // Update cash balance
      const cashBalance = userDb.getCashBalance(userId);
      userDb.updateCashBalance(userId, cashBalance + proceeds);

      return {
        success: true,
        message: `Successfully sold ${amountToSell.toFixed(8)} ${position.name || coinId} at ${formatCurrency(price)} for ${formatCurrency(proceeds)}`,
        proceeds,
        price,
      };
    } catch (error) {
      console.error(`Error selling crypto ${coinId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  /**
   * Get all cryptocurrency holdings for a user.
   */
  async getCryptoPortfolio(userId: string): Promise<any[]> {
    try {
      // Get all holdings
      const holdings = await cryptoPortfolioDb.getUserPortfolio(userId);

      if (holdings.length === 0) {
        return [];
      }

      // Get current prices for all holdings at once
      const coinIds = holdings.map(h => h.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
      // Calculate current values
      return holdings.map(holding => {
        const price = prices[holding.coinId] || 0;
        const currentValue = holding.quantity * price;
        const costBasis = holding.quantity * holding.averagePurchasePrice;
        const profitLoss = currentValue - costBasis;
        const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

        return {
          coinId: holding.coinId,
          symbol: holding.symbol,
          name: holding.name,
          quantity: holding.quantity,
          currentPrice: price,
          currentValue,
          costBasis,
          profitLoss,
          profitLossPercent,
        };
      });
    } catch (error) {
      console.error('Error getting crypto portfolio:', error);
      throw error;
    }
  },

  /**
   * Get cryptocurrency transaction history for a user.
   */
  async getCryptoTransactionHistory(userId: string): Promise<any[]> {
    try {
      return await cryptoTransactionDb.getUserTransactions(userId);
    } catch (error) {
      console.error('Error getting crypto transaction history:', error);
      throw error;
    }
  },

  /**
   * Get the total value of a user's crypto portfolio
   */
  async getTotalPortfolioValue(userId: string): Promise<{ success: boolean; totalValue: number; message?: string }> {
    try {
      // Get user's crypto holdings
      const positions = cryptoPortfolioDb.getUserPortfolio(userId);

      if (!positions || positions.length === 0) {
        return { success: true, totalValue: 0, message: 'No crypto holdings found' };
      }

      // Get the current prices for all cryptocurrencies
      const coinIds = positions.map(pos => pos.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
      // Calculate total portfolio value
      let totalValue = 0;
      
      for (const position of positions) {
        const currentPrice = prices[position.coinId];
        if (currentPrice !== undefined) {
          totalValue += position.quantity * currentPrice;
        }
      }

      return { 
        success: true, 
        totalValue, 
        message: `Total crypto portfolio value: ${totalValue}`
      };
    } catch (error) {
      console.error(`Error calculating total crypto portfolio value:`, error);
      return { success: false, totalValue: 0, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  /**
   * Search for cryptocurrencies by name or symbol
   */
  async searchCryptos(query: string): Promise<any[]> {
    try {
      return await coinGeckoService.searchCoins(query);
    } catch (error) {
      console.error('Error searching cryptocurrencies:', error);
      return [];
    }
  },

  /**
   * Get top cryptocurrencies by market cap
   */
  async getTopCryptos(limit: number = 20): Promise<any[]> {
    try {
      return await coinGeckoService.getTopCoins(limit);
    } catch (error) {
      console.error('Error getting top cryptocurrencies:', error);
      return [];
    }
  },

  /**
   * Get historical price data for a cryptocurrency
   * @param symbol The cryptocurrency symbol (e.g., "bitcoin")
   * @param days Number of days of historical data to retrieve
   * @returns Array of historical price points or null if an error occurs
   */
  async getHistoricalPrices(symbol: string, days: number = 7): Promise<any[] | null> {
    try {
      // Use coinGeckoService to get historical price data
      const historicalData = await coinGeckoService.getHistoricalPrices(symbol, days);
      
      if (!historicalData || !historicalData.prices) {
        console.error(`No historical data received for ${symbol}`);
        return null;
      }
      
      // Transform the data into the required format
      // Each item in prices is an array where the first element is timestamp and second is price
      const formattedData = historicalData.prices.map((item: [number, number]) => {
        return {
          timestamp: new Date(item[0]).toISOString(),
          price: item[1]
        };
      });
      
      return formattedData;
    } catch (error) {
      console.error(`Error fetching historical prices for ${symbol}:`, error);
      return null;
    }
  },

  /**
   * Clean up worthless positions (dust).
   * This method looks for positions with negligible value and liquidates them.
   * 
   * @param userId User ID whose portfolio to clean
   * @returns Object containing number of positions cleaned and total credited value
   */
  async cleanupWorthlessPositions(userId: string): Promise<{ 
    success: boolean; 
    positionsLiquidated: number; 
    totalCredited: number;
    message: string;
  }> {
    try {
      // Get user's crypto holdings
      const positions = cryptoPortfolioDb.getUserPortfolio(userId);

      if (!positions || positions.length === 0) {
        return { 
          success: true, 
          positionsLiquidated: 0, 
          totalCredited: 0,
          message: 'No positions to clean up' 
        };
      }

      // Get current prices for all positions
      const coinIds = positions.map(pos => pos.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
      let positionsLiquidated = 0;
      let totalCredited = 0;
      const liquidationDetails: string[] = [];
      
      // Check each position
      for (const position of positions) {
        // If no price found, liquidate at minimum price
        const price = prices[position.coinId] || MIN_COIN_PRICE_USD;
        const positionValue = position.quantity * price;
        
        // If position value is very small or quantity is absurdly large
        if (positionValue < MIN_POSITION_VALUE_USD || position.quantity > MAX_COIN_QUANTITY) {
          const liquidationPrice = Math.max(price, MIN_COIN_PRICE_USD);
          const liquidationValue = position.quantity * liquidationPrice;
          
          // Record the reason for liquidation
          const reason = positionValue < MIN_POSITION_VALUE_USD 
            ? 'dust position (below minimum value threshold)'
            : 'excessive quantity';
            
          console.log(`Liquidating ${position.coinId} position for user ${userId}: ${position.quantity} units worth ${positionValue}. Reason: ${reason}`);
          
          // Record the transaction
          cryptoTransactionDb.addTransaction(
            userId,
            position.coinId,
            position.symbol,
            position.name,
            position.quantity,
            liquidationPrice,
            'sell'
          );
          
          // Remove the position entirely
          cryptoPortfolioDb.updatePosition(
            userId,
            position.coinId,
            position.symbol,
            position.name,
            0,
            0
          );
          
          // Track for summary
          positionsLiquidated++;
          totalCredited += liquidationValue;
          liquidationDetails.push(`${position.name} (${position.symbol}): ${position.quantity.toExponential(2)} units for ${formatCurrency(liquidationValue)} - Reason: ${reason}`);
        }
      }
      
      // If any positions were liquidated, update the user's cash balance
      if (positionsLiquidated > 0) {
        const cashBalance = userDb.getCashBalance(userId);
        userDb.updateCashBalance(userId, cashBalance + totalCredited);
        
        return {
          success: true,
          positionsLiquidated,
          totalCredited,
          message: `Liquidated ${positionsLiquidated} positions with total value of ${formatCurrency(totalCredited)}.\nDetails:\n${liquidationDetails.join('\n')}`
        };
      }
      
      return { 
        success: true, 
        positionsLiquidated: 0, 
        totalCredited: 0,
        message: 'No positions required cleanup' 
      };
    } catch (error) {
      console.error(`Error cleaning up worthless positions:`, error);
      return { 
        success: false, 
        positionsLiquidated: 0, 
        totalCredited: 0,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  },
};