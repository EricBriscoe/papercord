/**
 * Black-Scholes Option Pricing Model
 * 
 * This module implements the Black-Scholes formula for pricing European call and put options.
 * It includes functions for calculating option prices, Greeks, and implied volatility.
 */

/**
 * Calculate cumulative distribution function of the standard normal distribution
 */
function normCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate standard normal probability density function
 */
function normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Option type enum
 */
export enum OptionType {
    CALL = 'call',
    PUT = 'put'
}

/**
 * Option class
 */
export class Option {
    // Static methods
    
    /**
     * Calculate d1 parameter for Black-Scholes formula
     */
    static d1(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        return (
            Math.log(stockPrice / strikePrice) + 
            ((riskFreeRate - dividendYield) + 0.5 * volatility * volatility) * timeToExpiry
        ) / (volatility * Math.sqrt(timeToExpiry));
    }

    /**
     * Calculate d2 parameter for Black-Scholes formula
     */
    static d2(
        d1: number,
        volatility: number,
        timeToExpiry: number
    ): number {
        return d1 - volatility * Math.sqrt(timeToExpiry);
    }

    /**
     * Calculate call option price
     */
    static callPrice(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) {
            return Math.max(0, stockPrice - strikePrice);
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        // With dividend yield adjustment: Se^(-qT)N(d1) - Ke^(-rT)N(d2)
        return stockPrice * Math.exp(-dividendYield * timeToExpiry) * normCDF(d1) 
            - strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(d2);
    }

    /**
     * Calculate put option price
     */
    static putPrice(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) {
            return Math.max(0, strikePrice - stockPrice);
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        // With dividend yield adjustment: Ke^(-rT)N(-d2) - Se^(-qT)N(-d1)
        return strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(-d2) 
            - stockPrice * Math.exp(-dividendYield * timeToExpiry) * normCDF(-d1);
    }

    /**
     * Calculate option price based on type
     */
    static price(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        return type === OptionType.CALL
            ? this.callPrice(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield)
            : this.putPrice(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
    }

    /**
     * Calculate delta (sensitivity of option price to changes in underlying asset price)
     */
    static delta(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) {
            if (type === OptionType.CALL) {
                return stockPrice > strikePrice ? 1 : 0;
            } else {
                return stockPrice < strikePrice ? -1 : 0;
            }
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        
        // With dividend yield adjustment
        const discountFactor = Math.exp(-dividendYield * timeToExpiry);
        
        return type === OptionType.CALL 
            ? discountFactor * normCDF(d1) 
            : discountFactor * (normCDF(d1) - 1);
    }

    /**
     * Calculate gamma (second derivative of option value with respect to underlying price)
     */
    static gamma(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        
        // With dividend yield adjustment
        const discountFactor = Math.exp(-dividendYield * timeToExpiry);
        return discountFactor * normPDF(d1) / (stockPrice * volatility * Math.sqrt(timeToExpiry));
    }

    /**
     * Calculate theta (sensitivity of option price to time decay)
     */
    static theta(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        // With dividend yield adjustment
        const discountFactorStock = Math.exp(-dividendYield * timeToExpiry);
        const discountFactorStrike = Math.exp(-riskFreeRate * timeToExpiry);
        
        if (type === OptionType.CALL) {
            return -stockPrice * discountFactorStock * normPDF(d1) * volatility / (2 * Math.sqrt(timeToExpiry))
                + dividendYield * stockPrice * discountFactorStock * normCDF(d1)
                - riskFreeRate * strikePrice * discountFactorStrike * normCDF(d2);
        } else {
            return -stockPrice * discountFactorStock * normPDF(d1) * volatility / (2 * Math.sqrt(timeToExpiry))
                - dividendYield * stockPrice * discountFactorStock * normCDF(-d1)
                + riskFreeRate * strikePrice * discountFactorStrike * normCDF(-d2);
        }
    }

    /**
     * Calculate vega (sensitivity of option price to volatility)
     */
    static vega(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number,
        dividendYield: number = 0
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
        
        // With dividend yield adjustment
        const discountFactor = Math.exp(-dividendYield * timeToExpiry);
        return stockPrice * discountFactor * Math.sqrt(timeToExpiry) * normPDF(d1);
    }

    /**
     * Calculate implied volatility using Newton-Raphson method
     */
    static impliedVolatility(
        type: OptionType,
        marketPrice: number,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        dividendYield: number = 0,
        maxIterations: number = 100,
        precision: number = 0.0001
    ): number {
        // Initial guess for volatility
        let volatility = 0.3;
        let i = 0;
        
        while (i++ < maxIterations) {
            const price = this.price(type, stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
            const diff = marketPrice - price;
            
            if (Math.abs(diff) < precision) {
                return volatility;
            }
            
            const vega = this.vega(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility, dividendYield);
            
            // Avoid division by zero
            if (Math.abs(vega) < 1e-10) {
                break;
            }
            
            volatility = volatility + diff / vega;
            
            // Make sure volatility stays within reasonable bounds
            if (volatility < 0.001) volatility = 0.001;
            if (volatility > 5) volatility = 5;
        }
        
        // If we can't converge, return the best estimate
        return volatility;
    }

    /**
     * Calculate intrinsic value of an option
     */
    static intrinsicValue(
        type: OptionType,
        stockPrice: number,
        strikePrice: number
    ): number {
        return type === OptionType.CALL
            ? Math.max(0, stockPrice - strikePrice)
            : Math.max(0, strikePrice - stockPrice);
    }

    /**
     * Determine if option is in the money (ITM), at the money (ATM), or out of the money (OTM)
     */
    static moneyness(
        type: OptionType,
        stockPrice: number,
        strikePrice: number
    ): 'ITM' | 'ATM' | 'OTM' {
        const diff = stockPrice - strikePrice;
        const epsilon = 0.0001; // Small value to determine "at the money"
        
        if (Math.abs(diff) < epsilon) {
            return 'ATM';
        }
        
        if (type === OptionType.CALL) {
            return diff > 0 ? 'ITM' : 'OTM';
        } else {
            return diff < 0 ? 'ITM' : 'OTM';
        }
    }
}

/**
 * Default risk-free interest rate (used as fallback)
 * This is an approximation of the 1-year US Treasury yield
 */
export const DEFAULT_RISK_FREE_RATE = 0.05;  // 5% as of April 2025 (hypothetical)

/**
 * Get the current risk-free rate based on treasury yields
 * @param daysToExpiry Time to expiry in days
 * @returns Promise resolving to the appropriate risk-free rate for the given time horizon
 */
export async function getCurrentRiskFreeRate(daysToExpiry: number): Promise<number> {
    try {
        // Dynamically import to avoid circular dependencies
        const { getRiskFreeRate } = await import('./riskFreeRate');
        return await getRiskFreeRate(daysToExpiry);
    } catch (error) {
        console.error('Error getting current risk-free rate:', error);
        // Fall back to the default rate if there's an error
        return DEFAULT_RISK_FREE_RATE;
    }
}

/**
 * Default volatility by sector
 * These are approximations and would need to be updated regularly in a production system
 */
export const DEFAULT_VOLATILITY: { [sector: string]: number } = {
    TECHNOLOGY: 0.35,
    HEALTHCARE: 0.30,
    FINANCE: 0.25,
    ENERGY: 0.40,
    CONSUMER: 0.20,
    DEFAULT: 0.30  // Default volatility when sector is unknown
};

/**
 * Helper function to calculate time to expiry in days
 * @param expirationDate Date of option expiration
 * @returns Time to expiry in days
 */
export function calculateTimeToExpiry(expirationDate: Date): number {
    const now = new Date();
    const diffMs = expirationDate.getTime() - now.getTime();
    return diffMs / (1000 * 60 * 60 * 24); // Return days
}

// In-memory volatility cache to avoid recalculating frequently
interface VolatilityCache {
    volatility: number;
    timestamp: number;
    lookbackDays: number;
}
const volatilityCache: Map<string, VolatilityCache> = new Map();

/**
 * Get historical volatility for a symbol using actual historical price data with caching
 * @param symbol Stock ticker symbol
 * @param lookbackDays Number of trading days to look back for calculation (default: 30)
 * @returns Annualized volatility as a decimal (e.g., 0.30 = 30%)
 */
export async function getHistoricalVolatility(
    symbol: string, 
    lookbackDays: number = 30
): Promise<number> {
    try {
        // Import services dynamically to avoid circular dependencies
        const { yfDataService } = await import('../services/yfDataService');
        const { priceCacheDb } = await import('../database/operations');
        
        const normalizedSymbol = symbol.toUpperCase();
        
        // Create a cache key that includes the lookback period
        const cacheKey = `${normalizedSymbol}:${lookbackDays}`;
        
        // Check in-memory volatility cache first
        const cachedVolatility = volatilityCache.get(cacheKey);
        const cacheMaxAgeHours = 24; // Cache volatility for 24 hours
        const cacheMaxAgeMs = cacheMaxAgeHours * 60 * 60 * 1000;
        
        if (cachedVolatility && (Date.now() - cachedVolatility.timestamp) < cacheMaxAgeMs) {
            console.debug(`Using cached volatility for ${normalizedSymbol}: ${(cachedVolatility.volatility * 100).toFixed(2)}%`);
            return cachedVolatility.volatility;
        }
        
        // Calculate interval and duration in minutes
        const intervalMinutes = 1440; // Daily data (24 * 60)
        const durationMinutes = lookbackDays * 1440; // Convert days to minutes
        
        // Set a minimum data points threshold (trading days in a month minus weekends)
        const minRequiredDataPoints = lookbackDays > 30 ? lookbackDays * 0.7 : 15; // Require about 70% coverage for volatility
        
        // Calculate date range for historical data
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - durationMinutes * 60 * 1000);
        
        let closePrices: number[] = [];
        
        // First check if we have adequate historical data in the cache
        // instead of using hasCompleteCoverage which is too strict
        const priceData = priceCacheDb.getTimeSeries(
            normalizedSymbol,
            'yahoo',
            '1d',
            lookbackDays * 2, // Get more than needed to ensure we have enough
            startDate,
            endDate
        );
        
        // Check if we have enough data points already in cache
        if (priceData && priceData.length >= minRequiredDataPoints) {
            console.debug(`Using cached ${priceData.length} historical prices for volatility calculation of ${normalizedSymbol}`);
            closePrices = priceData.map(entry => entry.price);
        } else {
            // If we don't have enough data in cache, fetch from API
            console.debug(`Fetching historical data for volatility calculation of ${normalizedSymbol} (found ${priceData.length || 0} cached points, need ${minRequiredDataPoints})`);
            
            const periodMinutes = lookbackDays <= 30 ? 43200 :  // ~30 days
                                lookbackDays <= 90 ? 129600 : // ~90 days
                                259200;                       // ~180 days (6 months)
                                
            const historyResponse = await yfDataService.getHistoricalData(
                normalizedSymbol, 
                periodMinutes,
                intervalMinutes
            );
            
            if (!historyResponse || 
                !historyResponse.chart || 
                !historyResponse.chart.result || 
                historyResponse.chart.result.length === 0) {
                console.warn(`Failed to get historical data for ${normalizedSymbol}, using default volatility`);
                return DEFAULT_VOLATILITY.DEFAULT;
            }
            
            // Extract close prices from the response
            const result = historyResponse.chart.result[0];
            
            // Fix: Add proper null checks and use optional chaining with default empty array
            if (result.indicators?.quote?.[0]?.close) {
                closePrices = result.indicators.quote[0].close.filter(
                    (price): price is number => price !== null && price !== undefined
                );
            } else {
                console.warn(`Missing price data in API response for ${normalizedSymbol}, using default volatility`);
                return DEFAULT_VOLATILITY.DEFAULT;
            }
        }
        
        if (!closePrices || closePrices.length < minRequiredDataPoints) {
            console.warn(`Insufficient price data for ${normalizedSymbol} (found ${closePrices?.length || 0}, need ${minRequiredDataPoints}), using default volatility`);
            return DEFAULT_VOLATILITY.DEFAULT;
        }
        
        // Calculate daily returns: (price_t / price_t-1) - 1
        const returns: number[] = [];
        for (let i = 1; i < closePrices.length; i++) {
            const dailyReturn = (closePrices[i] / closePrices[i-1]) - 1;
            returns.push(dailyReturn);
        }
        
        if (returns.length === 0) {
            console.warn(`Could not calculate returns for ${normalizedSymbol}, using default volatility`);
            return DEFAULT_VOLATILITY.DEFAULT;
        }
        
        // Calculate average return
        const avgReturn = returns.reduce((sum, val) => sum + val, 0) / returns.length;
        
        // Calculate sum of squared deviations
        const squaredDeviations = returns.map(ret => Math.pow(ret - avgReturn, 2));
        const sumSquaredDeviations = squaredDeviations.reduce((sum, val) => sum + val, 0);
        
        // Calculate standard deviation
        const stdDev = Math.sqrt(sumSquaredDeviations / (returns.length - 1));
        
        // Annualize the volatility (assuming 252 trading days per year)
        const annualizedVol = stdDev * Math.sqrt(252);
        
        // Cap volatility at reasonable bounds
        let finalVolatility = annualizedVol;
        if (finalVolatility < 0.05) finalVolatility = 0.05;  // Minimum 5%
        if (finalVolatility > 2.0) finalVolatility = 2.0;    // Maximum 200%
        
        // Store in volatility cache
        volatilityCache.set(cacheKey, {
            volatility: finalVolatility,
            timestamp: Date.now(),
            lookbackDays
        });
        
        console.debug(`Calculated volatility for ${normalizedSymbol}: ${(finalVolatility * 100).toFixed(2)}%`);
        return finalVolatility;
    } catch (error) {
        console.error(`Error calculating volatility for ${symbol}:`, error);
        return DEFAULT_VOLATILITY.DEFAULT;
    }
}

// In-memory dividend yield cache
interface DividendYieldCache {
    yield: number;
    timestamp: number;
}
const dividendYieldCache: Map<string, DividendYieldCache> = new Map();

/**
 * Get the annualized dividend yield for a symbol with caching
 * @param symbol Stock ticker symbol
 * @returns Promise resolving to the annualized dividend yield as a decimal (e.g., 0.03 = 3%)
 */
export async function getDividendYield(symbol: string): Promise<number> {
    try {
        const normalizedSymbol = symbol.toUpperCase();
        
        // Check in-memory dividend yield cache first
        const cachedYield = dividendYieldCache.get(normalizedSymbol);
        const cacheMaxAgeDays = 7; // Cache dividend yield for 7 days since it rarely changes
        const cacheMaxAgeMs = cacheMaxAgeDays * 24 * 60 * 60 * 1000;
        
        if (cachedYield && (Date.now() - cachedYield.timestamp) < cacheMaxAgeMs) {
            console.debug(`Using cached dividend yield for ${normalizedSymbol}: ${(cachedYield.yield * 100).toFixed(2)}%`);
            return cachedYield.yield;
        }
        
        // Import the yfDataService dynamically to avoid circular dependencies
        const { yfDataService } = await import('../services/yfDataService');
        
        // Get dividend data from Yahoo Finance
        const dividendData = await yfDataService.getDividendData(symbol);
        
        let finalYield = 0;
        
        // If we have dividend info and it includes yield, use it
        if (dividendData?.info?.dividendYield) {
            const rawYield = dividendData.info.dividendYield;
            
            // Yahoo Finance sometimes returns yield as a percentage (e.g., 1.28 for 1.28%)
            // and sometimes as a decimal (e.g., 0.0128 for 1.28%)
            // We need to ensure we're always working with a decimal format (0.0x)
            
            // If the yield is > 1, it's likely a percentage and needs conversion
            if (rawYield > 1) {
                console.debug(`Converting dividend yield for ${normalizedSymbol} from percentage (${rawYield}) to decimal (${rawYield / 100})`);
                finalYield = rawYield / 100;
            } else {
                finalYield = rawYield;
            }
            
            // Validate the yield is in a reasonable range (0-20%)
            if (finalYield > 0.2) {
                console.warn(`Unusually high dividend yield detected for ${normalizedSymbol}: ${finalYield * 100}%, capping at 20%`);
                finalYield = 0.2; // Cap at 20% which is already extremely high for a dividend yield
            }
        }
        // If we have dividend history but no explicit yield, calculate it
        else if (dividendData?.history && dividendData.history.length > 0) {
            // Get the current stock quote
            const quote = await yfDataService.getQuote(normalizedSymbol);
            const currentPrice = quote.regularMarketPrice || 0;
            
            if (currentPrice > 0) {
                // For a simple calculation, find the sum of dividends in the past year
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
                
                let annualDividend = 0;
                
                // Look for the most recent 4 quarterly dividends or 12 monthly dividends
                const recentDividends = dividendData.history
                    .filter(d => new Date(d.date) >= oneYearAgo)
                    .slice(0, 4); // Most stocks pay quarterly, so use up to 4 payments
                    
                if (recentDividends.length > 0) {
                    // Sum up the dividends
                    annualDividend = recentDividends.reduce((sum, div) => sum + div.amount, 0);
                    
                    // If we have fewer than 4 dividends (e.g., 1-3), extrapolate to a full year
                    if (recentDividends.length < 4) {
                        annualDividend = annualDividend * (4 / recentDividends.length);
                    }
                    
                    // Calculate yield
                    finalYield = annualDividend / currentPrice;
                    
                    // Validate the calculated yield is reasonable
                    if (finalYield > 0.2) {
                        console.warn(`Calculated dividend yield for ${normalizedSymbol} is unusually high: ${(finalYield * 100).toFixed(2)}%, capping at 20%`);
                        finalYield = 0.2;
                    }
                }
            }
        }
        
        // Store in dividend yield cache
        dividendYieldCache.set(normalizedSymbol, {
            yield: finalYield,
            timestamp: Date.now()
        });
        
        console.debug(`Calculated dividend yield for ${normalizedSymbol}: ${(finalYield * 100).toFixed(2)}%`);
        return finalYield;
    } catch (error) {
        console.error(`Failed to get dividend yield for ${symbol}:`, error);
        return 0; // Default to no dividends
    }
}
