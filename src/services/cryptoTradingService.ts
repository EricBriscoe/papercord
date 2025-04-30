import { coinGeckoService } from './coinGeckoService';
import { cryptoPortfolioDb, cryptoTransactionDb, userDb } from '../database/operations';
import { formatCurrency, formatCryptoAmount, formatCryptoPrice, broadcastToSubscribedChannels } from '../utils/formatters';
import { Client } from 'discord.js';

// Safety limits to prevent unreasonable transactions
const MAX_TRANSACTION_VALUE_USD = 100000000000; // $100 billion max transaction
const MIN_COIN_PRICE_USD = 0.000001; // Prevents division by zero and unreasonable quantities
const MAX_COIN_QUANTITY = 1000000000000; // 1 trillion units max in a single transaction
const MIN_POSITION_VALUE_USD = 0.01; // Threshold for dust position cleanup
// Precision for cryptocurrency calculations
const CRYPTO_PRECISION = 12;

export const cryptoTradingService = {
  /**
   * Fetches current market price for a cryptocurrency
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
   * Efficiently fetches prices for multiple cryptocurrencies in a single API call
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
   * Executes cryptocurrency purchase with high-precision calculations
   * Handles weighted average position pricing and validates against safety limits
   */
  async buyCrypto(userId: string, coinId: string, amountUsd: number): Promise<{ success: boolean; message: string; amount?: number; price?: number }> {
    try {
      // Safety validations
      if (amountUsd <= 0) {
        return { success: false, message: 'Amount must be greater than 0' };
      }

      if (amountUsd > MAX_TRANSACTION_VALUE_USD) {
        return { 
          success: false, 
          message: `Transaction amount exceeds the maximum allowed (${formatCurrency(MAX_TRANSACTION_VALUE_USD)})`
        };
      }

      const price = await this.getPrice(coinId);
      
      if (!price) {
        return { success: false, message: `Couldn't get a valid price for ${coinId}` };
      }
      
      if (price <= MIN_COIN_PRICE_USD) {
        return { 
          success: false, 
          message: `Price of ${coinId} is too low (${price}). Minimum price threshold is ${MIN_COIN_PRICE_USD}` 
        };
      }

      // Calculate quantity with high precision
      const amount = amountUsd / price;
      
      if (amount > MAX_COIN_QUANTITY) {
        return { 
          success: false, 
          message: `This would result in an unreasonably large quantity (${amount.toExponential(2)} units). Maximum allowed is ${MAX_COIN_QUANTITY.toExponential(2)}`
        };
      }
      
      const cashBalance = userDb.getCashBalance(userId);
      
      if (cashBalance < amountUsd) {
        return { success: false, message: `Insufficient funds. You have $${cashBalance.toFixed(2)}` };
      }
      
      // Retrieve token metadata
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

      // Update position with weighted average pricing
      const position = cryptoPortfolioDb.getUserPosition(userId, coinId);
      let newQuantity, newAvgPrice;
      
      if (position) {
        // Use high-precision calculations for existing positions
        const positionQuantity = Number(position.quantity.toFixed(CRYPTO_PRECISION));
        const positionAvgPrice = Number(position.averagePurchasePrice.toFixed(CRYPTO_PRECISION));
        const purchaseAmount = Number(amount.toFixed(CRYPTO_PRECISION));
        const purchasePrice = Number(price.toFixed(CRYPTO_PRECISION));
        
        const totalValue = (positionQuantity * positionAvgPrice) + (purchaseAmount * purchasePrice);
        newQuantity = positionQuantity + purchaseAmount;
        
        if (newQuantity > 0) {
          newAvgPrice = totalValue / newQuantity;
          // Handle floating point precision issues
          if (isNaN(newAvgPrice) || !isFinite(newAvgPrice)) {
            console.warn(`Got invalid average price (${newAvgPrice}) for ${coinId}, using current price instead`);
            newAvgPrice = purchasePrice;
          }
        } else {
          newAvgPrice = purchasePrice;
        }
      } else {
        // New position initialization
        newQuantity = Number(amount.toFixed(CRYPTO_PRECISION));
        newAvgPrice = Number(price.toFixed(CRYPTO_PRECISION));
      }
      
      // Persist changes and record the transaction
      cryptoPortfolioDb.updatePosition(userId, coinId, symbol, name, newQuantity, newAvgPrice);
      cryptoTransactionDb.addTransaction(userId, coinId, symbol, name, amount, price, 'buy');
      userDb.updateCashBalance(userId, cashBalance - amountUsd);

      return {
        success: true,
        message: `Successfully bought ${formatCryptoAmount(amount)} ${name} (${symbol}) at ${formatCryptoPrice(price)}`,
        amount,
        price,
      };
    } catch (error) {
      console.error(`Error buying crypto ${coinId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  /**
   * Executes cryptocurrency sales with support for quantity-based, USD-based,
   * or entire position liquidation
   */
  async sellCrypto(
    userId: string, 
    coinId: string, 
    amount?: number, 
    amountUsd?: number
  ): Promise<{ success: boolean; message: string; proceeds?: number; price?: number }> {
    try {
      const position = cryptoPortfolioDb.getUserPosition(userId, coinId);

      if (!position || position.quantity <= 0) {
        return { success: false, message: `You don't own any ${coinId}` };
      }

      const price = await this.getPrice(coinId);
      
      // Determine sell quantity based on input parameters
      let amountToSell: number;
      
      if (amount !== undefined) {
        // Sell specific quantity
        amountToSell = Number(amount.toFixed(CRYPTO_PRECISION));
      } else if (amountUsd !== undefined && amountUsd > 0) {
        // Sell specific USD value
        amountToSell = Number((amountUsd / price).toFixed(CRYPTO_PRECISION));
        
        if (amountToSell > position.quantity) {
          amountToSell = Number(position.quantity.toFixed(CRYPTO_PRECISION));
        }
      } else {
        // Sell entire position
        amountToSell = Number(position.quantity.toFixed(CRYPTO_PRECISION));
      }

      // Validate sale parameters
      if (amountToSell <= 0) {
        return { success: false, message: 'Amount must be greater than 0' };
      }

      if (amountToSell > position.quantity) {
        return { success: false, message: `You only have ${formatCryptoAmount(position.quantity)} ${coinId}` };
      }

      // Handle extremely low-value tokens specially
      if (price <= MIN_COIN_PRICE_USD) {
        // Liquidate worthless position at floor price
        const liquidationPrice = MIN_COIN_PRICE_USD;
        const liquidationProceeds = position.quantity * liquidationPrice;
        
        console.log(`Liquidating worthless position of ${coinId} (${position.quantity} units) at minimum price ${liquidationPrice}`);
        
        cryptoPortfolioDb.updatePosition(userId, coinId, position.symbol, position.name, 0, 0);
        cryptoTransactionDb.addTransaction(userId, coinId, position.symbol, position.name, position.quantity, liquidationPrice, 'sell');
        
        const cashBalance = userDb.getCashBalance(userId);
        userDb.updateCashBalance(userId, cashBalance + liquidationProceeds);
        
        return {
          success: true,
          message: `Position in ${position.name || coinId} was liquidated at minimum price due to extremely low value. Received ${formatCurrency(liquidationProceeds)}.`,
          proceeds: liquidationProceeds,
          price: liquidationPrice
        };
      }

      // Calculate sale proceeds with high precision
      const proceeds = Number((amountToSell * price).toFixed(CRYPTO_PRECISION));
      
      if (proceeds > MAX_TRANSACTION_VALUE_USD) {
        return { 
          success: false, 
          message: `Transaction value (${formatCurrency(proceeds)}) exceeds the maximum allowed (${formatCurrency(MAX_TRANSACTION_VALUE_USD)}). Please sell a smaller amount.`
        };
      }

      // Update position or remove if fully sold
      const newQuantity = Number((position.quantity - amountToSell).toFixed(CRYPTO_PRECISION));
      const newAvgPrice = newQuantity > 0 ? position.averagePurchasePrice : 0;
      
      cryptoPortfolioDb.updatePosition(userId, coinId, position.symbol, position.name, newQuantity, newAvgPrice);
      cryptoTransactionDb.addTransaction(userId, coinId, position.symbol, position.name, amountToSell, price, 'sell');
      
      const cashBalance = userDb.getCashBalance(userId);
      userDb.updateCashBalance(userId, cashBalance + proceeds);

      return {
        success: true,
        message: `Successfully sold ${formatCryptoAmount(amountToSell)} ${position.name || coinId} at ${formatCryptoPrice(price)} for ${formatCurrency(proceeds)}`,
        proceeds,
        price,
      };
    } catch (error) {
      console.error(`Error selling crypto ${coinId}:`, error);
      return { success: false, message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  },

  /**
   * Retrieves complete cryptocurrency portfolio with current market values
   * and performance metrics
   */
  async getCryptoPortfolio(userId: string): Promise<any[]> {
    try {
      const holdings = await cryptoPortfolioDb.getUserPortfolio(userId);

      if (holdings.length === 0) {
        return [];
      }

      // Fetch all prices in a single API call for efficiency
      const coinIds = holdings.map(h => h.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
      // Calculate portfolio metrics with high precision
      return holdings.map(holding => {
        const price = prices[holding.coinId] || 0;
        
        const quantity = Number(holding.quantity.toFixed(CRYPTO_PRECISION));
        const avgPrice = Number(holding.averagePurchasePrice.toFixed(CRYPTO_PRECISION));
        const currentPrice = Number(price.toFixed(CRYPTO_PRECISION));
        
        const currentValue = quantity * currentPrice;
        const costBasis = quantity * avgPrice;
        const profitLoss = currentValue - costBasis;
        const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

        return {
          coinId: holding.coinId,
          symbol: holding.symbol,
          name: holding.name,
          quantity: quantity,
          averagePurchasePrice: avgPrice,
          currentPrice: currentPrice,
          currentValue: currentValue,
          costBasis: costBasis,
          profitLoss: profitLoss,
          profitLossPercent: profitLossPercent,
        };
      });
    } catch (error) {
      console.error('Error getting crypto portfolio:', error);
      throw error;
    }
  },

  /**
   * Retrieves cryptocurrency transaction history
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
   * Calculates total value of all cryptocurrency holdings
   */
  async getTotalPortfolioValue(userId: string): Promise<{ success: boolean; totalValue: number; message?: string }> {
    try {
      const positions = cryptoPortfolioDb.getUserPortfolio(userId);

      if (!positions || positions.length === 0) {
        return { success: true, totalValue: 0, message: 'No crypto holdings found' };
      }

      const coinIds = positions.map(pos => pos.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
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
   * Searches for cryptocurrencies by name or symbol
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
   * Retrieves top cryptocurrencies by market capitalization
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
   * Retrieves historical price data for charting and analysis
   */
  async getHistoricalPrices(symbol: string, days: number = 7): Promise<any[] | null> {
    try {
      const historicalData = await coinGeckoService.getHistoricalPrices(symbol, days);
      
      if (!historicalData || !historicalData.prices) {
        console.error(`No historical data received for ${symbol}`);
        return null;
      }
      
      // Format timestamp-price pairs for charting
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
   * Checks if a cryptocurrency has been delisted from CoinGecko
   * 
   * @param coinId The ID of the coin to check
   * @returns Object indicating if the coin is delisted with details
   */
  async isDelistedCoin(coinId: string): Promise<{ delisted: boolean; message: string }> {
    try {
      const result = await coinGeckoService.getCoinPrice(coinId);
      
      // Case 1: Error message that explicitly mentions inactivity or deactivation
      if (result.error) {
        const errorLower = result.error.toLowerCase();
        if (
          errorLower.includes('inactive') || 
          errorLower.includes('deactivated') || 
          errorLower.includes('delisted')
        ) {
          console.log(`Coin ${coinId} is explicitly reported as delisted/inactive: ${result.error}`);
          return { 
            delisted: true, 
            message: `Cryptocurrency ${coinId} has been delisted: ${result.error}` 
          };
        }
      }
      
      // Case 2: API returns null price but no specific error message
      if (result.price === null) {
        console.log(`Coin ${coinId} returned null price without specific error message`);
        return { 
          delisted: true, 
          message: `Cryptocurrency ${coinId} appears to be delisted (no price data available)` 
        };
      }

      // Case 3: Price is zero, which is effectively worthless
      if (result.price === 0) {
        console.log(`Coin ${coinId} has zero price`);
        return { 
          delisted: true, 
          message: `Cryptocurrency ${coinId} has zero value (likely delisted)` 
        };
      }
      
      return { delisted: false, message: 'Coin is active' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for API errors that indicate delisting
      if (
        errorMessage.toLowerCase().includes('inactive') || 
        errorMessage.toLowerCase().includes('deactivated') || 
        errorMessage.toLowerCase().includes('delisted')
      ) {
        console.log(`Exception indicates coin ${coinId} is delisted: ${errorMessage}`);
        return { 
          delisted: true, 
          message: `Cryptocurrency ${coinId} has been delisted: ${errorMessage}` 
        };
      }
      
      // For other errors, log but don't assume delisted
      console.error(`Error checking if ${coinId} is delisted:`, error);
      return { delisted: false, message: `Error checking status: ${errorMessage}` };
    }
  },

  /**
   * Liquidates a cryptocurrency position at 100% loss because it's delisted
   * 
   * @param userId The user ID who holds the position
   * @param coinId The delisted coin ID
   * @param position The user's position details
   * @returns Result of the liquidation operation
   */
  async liquidateDelistedPosition(userId: string, coinId: string, position: any): Promise<{
    success: boolean;
    liquidationValue: number;
    message: string;
  }> {
    try {
      console.log(`Liquidating delisted cryptocurrency ${coinId} for user ${userId}: ${position.quantity} units`);
      
      // Liquidate at 100% loss (price = 0)
      const liquidationPrice = 0;
      const liquidationValue = 0; // Total loss
      
      // Record the transaction with zero value price
      cryptoTransactionDb.addTransaction(
        userId,
        position.coinId,
        position.symbol,
        position.name,
        position.quantity,
        liquidationPrice,
        'sell'
      );
      
      // Remove the position
      cryptoPortfolioDb.updatePosition(
        userId,
        position.coinId,
        position.symbol,
        position.name,
        0,
        0
      );
      
      // No need to update cash balance as liquidation value is 0
      
      return {
        success: true,
        liquidationValue,
        message: `Position in ${position.name || coinId} (${position.symbol}) was liquidated at 100% loss due to delisting. Position closed with zero value.`
      };
    } catch (error) {
      console.error(`Error liquidating delisted position:`, error);
      return { 
        success: false, 
        liquidationValue: 0,
        message: `Error liquidating delisted position: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  },

  /**
   * Automatically liquidates tiny value "dust" positions, those with 
   * excessive quantities, and delisted cryptocurrencies to prevent portfolio pollution
   */
  async cleanupWorthlessPositions(userId: string): Promise<{ 
    success: boolean; 
    positionsLiquidated: number; 
    totalCredited: number;
    message: string;
  }> {
    try {
      const positions = cryptoPortfolioDb.getUserPortfolio(userId);

      if (!positions || positions.length === 0) {
        return { 
          success: true, 
          positionsLiquidated: 0, 
          totalCredited: 0,
          message: 'No positions to clean up' 
        };
      }

      const coinIds = positions.map(pos => pos.coinId);
      const prices = await this.getMultiplePrices(coinIds);
      
      let positionsLiquidated = 0;
      let totalCredited = 0;
      const liquidationDetails: string[] = [];
      
      // Process each position to identify delisted coins and worthless positions
      for (const position of positions) {
        // First, check if the coin has been delisted
        const delistedCheck = await this.isDelistedCoin(position.coinId);
        
        if (delistedCheck.delisted) {
          // Handle delisted coin (liquidate at 100% loss)
          const result = await this.liquidateDelistedPosition(userId, position.coinId, position);
          
          if (result.success) {
            positionsLiquidated++;
            liquidationDetails.push(`${position.name} (${position.symbol}): ${position.quantity.toExponential(2)} units liquidated at 100% loss - Reason: delisted cryptocurrency`);
          }

          if (discordClient) {
            await broadcastToSubscribedChannels(
              discordClient,
              {
                title: '💀 Cryptocurrency Delisting Notification',
                description: `Your ${position.name} (${position.symbol}) position has been liquidated at 100% loss due to the cryptocurrency being delisted from exchanges. The position has been closed.`,
                type: 'crypto_delisted'
              },
              userId,
              -position.quantity * position.averagePurchasePrice // Pass the loss value
            );
          }
          continue; // Skip to next position
        }
        
        // Continue with regular dust/worthless position logic
        const price = prices[position.coinId] || MIN_COIN_PRICE_USD;
        const positionValue = position.quantity * price;
        
        if (positionValue < MIN_POSITION_VALUE_USD || position.quantity > MAX_COIN_QUANTITY) {
          const liquidationPrice = Math.max(price, MIN_COIN_PRICE_USD);
          const liquidationValue = position.quantity * liquidationPrice;
          
          const reason = positionValue < MIN_POSITION_VALUE_USD 
            ? 'dust position (below minimum value threshold)'
            : 'excessive quantity';
            
          console.log(`Liquidating ${position.coinId} position for user ${userId}: ${position.quantity} units worth ${positionValue}. Reason: ${reason}`);
          
          cryptoTransactionDb.addTransaction(
            userId,
            position.coinId,
            position.symbol,
            position.name,
            position.quantity,
            liquidationPrice,
            'sell'
          );
          
          cryptoPortfolioDb.updatePosition(
            userId,
            position.coinId,
            position.symbol,
            position.name,
            0,
            0
          );
          
          positionsLiquidated++;
          totalCredited += liquidationValue;
          liquidationDetails.push(`${position.name} (${position.symbol}): ${position.quantity.toExponential(2)} units for ${formatCurrency(liquidationValue)} - Reason: ${reason}`);

          if (discordClient) {
            await broadcastToSubscribedChannels(
              discordClient,
              {
                title: '🧹 Small Position Cleanup',
                description: `Your ${position.name} (${position.symbol}) position has been automatically liquidated ${reason === 'dust position (below minimum value threshold)' ? 'due to its minimal value' : 'due to excessive quantity'} to optimize your portfolio.`,
                type: 'crypto_dust'
              },
              userId,
              liquidationValue - (position.quantity * position.averagePurchasePrice) // Calculate profit/loss
            );
          }
        }
      }
      
      // Credit user with liquidation proceeds
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

let discordClient: Client | undefined;
export function setDiscordClient(client: Client) {
    discordClient = client;
}