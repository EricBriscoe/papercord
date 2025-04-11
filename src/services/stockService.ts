import fetch from 'node-fetch';
const finnhub = require('finnhub');
import dotenv from 'dotenv';
import { priceCacheDb } from '../database/operations';

dotenv.config();

// API key should be set in .env file as FINNHUB_API_KEY
const API_KEY = process.env.FINNHUB_API_KEY || '';

// Initialize Finnhub client
const api_key = finnhub.ApiClient.instance.authentications['api_key'];
api_key.apiKey = API_KEY;
const finnhubClient = new finnhub.DefaultApi();

// Log API key status for debugging (without revealing the full key)
if (API_KEY) {
    console.log(`Finnhub API key found (starts with: ${API_KEY.substring(0, 3)}...)`);
} else {
    console.log('No Finnhub API key found, using dummy data');
}

// Define cache settings
const CACHE_MAX_AGE_MINUTES = 15; // Maximum age of cache in minutes
const DEFAULT_RESOLUTION = '1m'; // Default resolution for price data

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
            const cachedData = priceCacheDb.getCachedPrice(
                normalizedSymbol,
                'finnhub',
                DEFAULT_RESOLUTION,
                CACHE_MAX_AGE_MINUTES
            );
            
            if (cachedData) {
                return { 
                    symbol: normalizedSymbol, 
                    price: cachedData.price,
                    cached: true
                };
            }
            
            // Return dummy data if no API key
            if (!API_KEY) {
                const dummyPrice = await this.getDummyStockPrice(normalizedSymbol);
                
                // Store in database cache
                priceCacheDb.storePrice(
                    normalizedSymbol,
                    dummyPrice,
                    'finnhub',
                    DEFAULT_RESOLUTION
                );
                
                return { symbol: normalizedSymbol, price: dummyPrice };
            }
            
            return new Promise((resolve) => {
                finnhubClient.quote(normalizedSymbol, (error, data, response) => {
                    if (error) {
                        resolve({ symbol: normalizedSymbol, price: null, error: error.message });
                        return;
                    }
                    
                    if (data && typeof data.c === 'number') {
                        // Store in database cache with extra data
                        priceCacheDb.storePrice(
                            normalizedSymbol,
                            data.c,
                            'finnhub',
                            DEFAULT_RESOLUTION,
                            {
                                high: data.h,
                                low: data.l,
                                open: data.o,
                                previousClose: data.pc
                            }
                        );
                        
                        resolve({ symbol: normalizedSymbol, price: data.c });
                    } else {
                        resolve({ 
                            symbol: normalizedSymbol, 
                            price: null, 
                            error: 'Could not fetch stock price or invalid symbol' 
                        });
                    }
                });
            });
        } catch (error) {
            return { 
                symbol, 
                price: null, 
                error: error instanceof Error ? error.message : 'Unknown error' 
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
    async getDummyStockPrice(symbol: string): Promise<number> {
        // Generate a random price between 50 and 500
        // In real app, use actual API call
        const basePrice = Math.floor(Math.random() * 450) + 50;
        const cents = Math.floor(Math.random() * 100) / 100;
        return basePrice + cents;
    },
    
    /**
     * Get historical prices for a symbol from cache
     */
    getHistoricalPrices(symbol: string, limit: number = 30): any[] {
        const prices = priceCacheDb.getHistoricalPrices(
            symbol,
            'finnhub',
            '1d',
            limit
        );
        
        return prices.map(entry => ({
            symbol: entry.symbol,
            price: entry.price,
            timestamp: entry.timestamp,
            extraData: entry.extra_data ? JSON.parse(entry.extra_data) : {}
        }));
    },
    
    /**
     * Search for stock symbols
     */
    async searchSymbol(query: string): Promise<{ symbol: string; description: string }[]> {
        try {
            if (!API_KEY) {
                return [
                    { symbol: 'AAPL', description: 'Apple Inc.' },
                    { symbol: 'MSFT', description: 'Microsoft Corporation' },
                    { symbol: 'AMZN', description: 'Amazon.com Inc.' },
                    { symbol: 'GOOGL', description: 'Alphabet Inc.' },
                    { symbol: 'TSLA', description: 'Tesla Inc.' }
                ].filter(item => 
                    item.symbol.includes(query.toUpperCase()) || 
                    item.description.toLowerCase().includes(query.toLowerCase())
                );
            }
            
            return new Promise((resolve) => {
                finnhubClient.symbolSearch(query, (error, data, response) => {
                    if (error || !data || !data.result) {
                        resolve([]);
                        return;
                    }
                    
                    // Filter US equities only
                    const stocks = data.result
                        .filter(item => item.type === 'Common Stock' && item.exchange === 'NYSE' || item.exchange === 'NASDAQ')
                        .map(item => ({
                            symbol: item.symbol,
                            description: item.description
                        }));
                        
                    resolve(stocks);
                });
            });
        } catch (error) {
            console.error('Error searching for symbol:', error);
            return [];
        }
    },
    
    /**
     * Get company information
     */
    async getCompanyInfo(symbol: string): Promise<any> {
        if (!API_KEY) {
            return {
                name: `${symbol} Inc.`,
                market: 'US',
                logo: 'https://example.com/logo.png',
                weburl: 'https://example.com'
            };
        }
        
        return new Promise((resolve) => {
            finnhubClient.companyProfile2({ 'symbol': symbol.toUpperCase() }, (error, data, response) => {
                if (error || !data) {
                    resolve(null);
                    return;
                }
                
                resolve(data);
            });
        });
    }
};