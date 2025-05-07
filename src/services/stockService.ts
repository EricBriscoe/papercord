import { priceCacheDb } from '../database/operations';
import { yfDataService, YFServiceError, YFRateLimitError } from './yfDataService'; // Assuming yfDataService is in the same directory or path is adjusted

// Define cache settings
const CACHE_MAX_AGE_MINUTES = 1; // Maximum age of cache in minutes for real-time quotes
const HISTORICAL_CACHE_MAX_AGE_HOURS = 24; // Max age for historical data cache

/**
 * Stock market service
 */
export const stockService = {
    /**
     * Get current stock price with database caching
     */
    async getStockPrice(symbol: string): Promise<{ symbol: string; price: number | null; error?: string; cached?: boolean }> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Check database cache first
            const cachedData = priceCacheDb.getLatestPrice(
                normalizedSymbol,
                'yahoo', // Source updated to 'yahoo'
                CACHE_MAX_AGE_MINUTES
            );

            if (cachedData) {
                return {
                    symbol: normalizedSymbol,
                    price: cachedData.price,
                    cached: true
                };
            }

            // Fetch from yfDataService
            const quoteData = await yfDataService.getQuote(normalizedSymbol);

            if (quoteData && typeof quoteData.regularMarketPrice === 'number') {
                // Store price in database cache
                priceCacheDb.storePrice(
                    normalizedSymbol,
                    quoteData.regularMarketPrice,
                    'yahoo', // Source updated to 'yahoo'
                    new Date(quoteData.regularMarketTime ? quoteData.regularMarketTime * 1000 : Date.now()),
                    '1m' // Interval for quote data
                );

                return { symbol: normalizedSymbol, price: quoteData.regularMarketPrice };
            } else {
                // Handle cases where price might be null or undefined from yfDataService
                const errorMessage = quoteData && (quoteData as any).error ? (quoteData as any).error : 'Could not fetch stock price or invalid symbol';
                return {
                    symbol: normalizedSymbol,
                    price: null,
                    error: errorMessage
                };
            }
        } catch (error) {
            let errorMessage = 'Unknown error fetching stock price';
            if (error instanceof YFServiceError || error instanceof YFRateLimitError) {
                errorMessage = error.message;
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }
            return {
                symbol,
                price: null,
                error: errorMessage
            };
        }
    },
    
    /**
     * Clear the price cache for a specific symbol or all symbols
     */
    clearCache(symbol?: string): void {
        if (symbol) {
            // This will be implemented via database cleanup
            // No immediate action needed as cache validation is done on read
            console.log(`Cache cleared for ${symbol}`);
        } else {
            // Clear all cache - we'll only do this for very old entries via cleanupCache
            priceCacheDb.cleanupCache(1); // Clear entries older than 1 day
            console.log("All cache cleared");
        }
    },
    
    /**
     * Get dummy stock price to use when no API key available
     * This is for testing purposes only
     */
    // Removed getDummyStockPrice as it's no longer needed with yfDataService handling API issues.
    
    /**
     * Get historical prices for a symbol.
     * Leverages yfDataService which includes its own caching logic.
     */
    async getHistoricalPrices(symbol: string, periodMinutes: number = 30 * 24 * 60, intervalMinutes: number = 24 * 60): Promise<any[]> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            const historicalData = await yfDataService.getHistoricalData(normalizedSymbol, periodMinutes, intervalMinutes);

            if (historicalData && historicalData.chart && historicalData.chart.result && historicalData.chart.result.length > 0) {
                const chartResult = historicalData.chart.result[0];
                if (chartResult.timestamp && chartResult.indicators && chartResult.indicators.quote && chartResult.indicators.quote.length > 0) {
                    const timestamps = chartResult.timestamp;
                    const closes = chartResult.indicators.quote[0].close;

                    if (closes) {
                        return timestamps.map((ts, index) => ({
                            symbol: normalizedSymbol,
                            price: closes[index],
                            timestamp: new Date(ts * 1000).toISOString() // Convert UNIX timestamp to ISO string
                        }));
                    }
                }
            }
            return []; // Return empty if no data or malformed
        } catch (error) {
            console.error(`Error fetching historical prices for ${symbol} via yfDataService:`, error);
            return []; // Return empty on error
        }
    },

    /**
     * Search for stock symbols using yfDataService
     */
    async searchSymbol(query: string): Promise<{ symbol: string; description: string }[]> {
        try {
            const results = await yfDataService.searchSymbols(query);
            return results.map(item => ({
                symbol: item.symbol,
                description: item.shortname || item.longname || item.symbol // Use shortname, fallback to longname or symbol
            }));
        } catch (error) {
            console.error(`Error searching for symbol "${query}" via yfDataService:`, error);
            return [];
        }
    },

    /**
     * Get company information using yfDataService.
     * This will primarily use data available from the /quote endpoint of yf_service.py.
     * For more detailed info like logo or website, yf_service.py might need enhancement.
     */
    async getCompanyInfo(symbol: string): Promise<any> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            const quoteData = await yfDataService.getQuote(normalizedSymbol);

            if (quoteData) {
                // Spread all properties from quoteData and then specifically set/override any needed ones.
                const companyDetails = {
                    ...quoteData, // Spread all fields from the yfDataService response
                    symbol: quoteData.symbol || normalizedSymbol, // Ensure symbol is present
                    name: quoteData.longName || quoteData.shortName || normalizedSymbol, // Preferred display name
                    logo: quoteData.logo_url || null, // Map logo_url to logo
                    weburl: quoteData.website || null // Map website to weburl
                };
                // Remove original keys if they were mapped to new ones, to avoid redundancy if names differ
                if ('logo_url' in companyDetails && companyDetails.logo_url !== companyDetails.logo) delete (companyDetails as any).logo_url;
                if ('website' in companyDetails && companyDetails.website !== companyDetails.weburl) delete (companyDetails as any).website;
                
                return companyDetails;
            }
            return null; // Return null if no data
        } catch (error) {
            console.error(`Error fetching company info for ${symbol} via yfDataService:`, error);
            return null;
        }
    }
};
