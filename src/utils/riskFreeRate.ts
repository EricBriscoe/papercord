/**
 * Risk-Free Rate Calculator
 * 
 * This module provides functionality to calculate the risk-free rate
 * for options pricing by fetching treasury yield data from Yahoo Finance.
 */

import { yfDataService } from '../services/yfDataService';

// Treasury yield symbols for different durations
const TREASURY_SYMBOLS = {
    '30D': '^IRX', // 13-week (3-month) Treasury Bill
    '90D': '^IRX', // 13-week (3-month) Treasury Bill
    '180D': '^IRX', // 13-week (3-month) Treasury Bill (closest we have)
    '365D': '^FVX', // 5-Year Treasury Note (closest for 1Y)
    '730D': '^FVX', // 5-Year Treasury Note (closest for 2Y)
    '1825D': '^FVX', // 5-Year Treasury Note
    '3650D': '^TNX', // 10-Year Treasury Note
    '10950D': '^TYX', // 30-Year Treasury Bond
};

// Default to 3-month T-bill if we can't find a better match
const DEFAULT_TREASURY_SYMBOL = '^IRX';

// Cache the rates for 15 minutes to avoid excessive API calls
interface RateCache {
    [symbol: string]: {
        rate: number;
        timestamp: number;
    };
}

const rateCache: RateCache = {};
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch the current yield for a treasury security
 * 
 * @param symbol Yahoo Finance symbol for the treasury yield
 * @returns The current yield as a decimal (e.g., 0.05 for 5%)
 */
async function fetchTreasuryYield(symbol: string): Promise<number> {
    try {
        // Check cache first
        const now = Date.now();
        if (rateCache[symbol] && now - rateCache[symbol].timestamp < CACHE_DURATION_MS) {
            console.debug(`Using cached treasury yield for ${symbol}: ${rateCache[symbol].rate}`);
            return rateCache[symbol].rate;
        }

        // Fetch current quote from Yahoo Finance
        const quote = await yfDataService.getQuote(symbol);
        
        if (!quote || quote.regularMarketPrice === undefined) {
            throw new Error(`Failed to get treasury yield data for ${symbol}`);
        }

        // Yahoo Finance returns yields in percentage form, convert to decimal
        const rate = quote.regularMarketPrice / 100;
        
        // Cache the result
        rateCache[symbol] = {
            rate,
            timestamp: now
        };
        
        console.debug(`Fetched treasury yield for ${symbol}: ${rate}`);
        return rate;
    } catch (error) {
        console.error(`Error fetching treasury yield for ${symbol}:`, error);
        throw error;
    }
}

/**
 * Get the best treasury symbol based on time to expiration
 * 
 * @param daysToExpiry Time to expiry in days
 * @returns The best matching treasury symbol for the given duration
 */
function getTreasurySymbolForDuration(daysToExpiry: number): string {
    if (daysToExpiry <= 30) return TREASURY_SYMBOLS['30D'];
    if (daysToExpiry <= 90) return TREASURY_SYMBOLS['90D'];
    if (daysToExpiry <= 180) return TREASURY_SYMBOLS['180D'];
    if (daysToExpiry <= 365) return TREASURY_SYMBOLS['365D'];
    if (daysToExpiry <= 730) return TREASURY_SYMBOLS['730D'];
    if (daysToExpiry <= 1825) return TREASURY_SYMBOLS['1825D'];
    if (daysToExpiry <= 3650) return TREASURY_SYMBOLS['3650D'];
    return TREASURY_SYMBOLS['10950D'];
}

/**
 * Get the risk-free rate for options pricing based on time to expiration
 * 
 * @param daysToExpiry Time to expiry in days
 * @returns Promise resolving to the risk-free rate as a decimal
 */
export async function getRiskFreeRate(daysToExpiry: number): Promise<number> {
    try {
        // Get the most appropriate treasury symbol for this duration
        const treasurySymbol = getTreasurySymbolForDuration(daysToExpiry);
        
        // Fetch the treasury yield
        const yield_ = await fetchTreasuryYield(treasurySymbol);
        return yield_;
    } catch (error) {
        console.error('Error getting risk-free rate:', error);
        // Fallback to the default risk-free rate from blackScholes.ts
        const { DEFAULT_RISK_FREE_RATE } = await import('./blackScholes');
        console.debug(`Using default risk-free rate: ${DEFAULT_RISK_FREE_RATE}`);
        return DEFAULT_RISK_FREE_RATE;
    }
}

/**
 * Clear the rate cache
 */
export function clearRateCache(): void {
    for (const key in rateCache) {
        delete rateCache[key];
    }
    console.debug('Treasury yield cache cleared');
}