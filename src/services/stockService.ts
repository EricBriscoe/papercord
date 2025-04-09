import fetch from 'node-fetch';
const finnhub = require('finnhub');
import dotenv from 'dotenv';

dotenv.config();

// API key should be set in .env file as FINNHUB_API_KEY
const API_KEY = process.env.FINNHUB_API_KEY || '';
// Default cache expiration time in milliseconds (1 minute)
const DEFAULT_CACHE_EXPIRATION_MS = 60000;
// Allow overriding cache expiration time via environment variable (in seconds)
const CACHE_EXPIRATION_SECONDS = process.env.PRICE_CACHE_EXPIRATION_SECONDS 
    ? parseInt(process.env.PRICE_CACHE_EXPIRATION_SECONDS, 10) 
    : DEFAULT_CACHE_EXPIRATION_MS / 1000;

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

// Define interfaces for our cache
interface CachedPrice {
    price: number;
    timestamp: number; // Unix timestamp in ms when this price was cached
}

interface PriceCache {
    [symbol: string]: CachedPrice;
}

/**
 * Stock market service
 */
export const stockService = {
    // Price cache with timestamps
    priceCache: {} as PriceCache,
    
    // Cache expiration time in milliseconds
    cacheExpirationMs: CACHE_EXPIRATION_SECONDS * 1000,

    /**
     * Set cache expiration time
     */
    setCacheExpiration(milliseconds: number): void {
        if (milliseconds < 0) {
            throw new Error('Cache expiration time cannot be negative');
        }
        this.cacheExpirationMs = milliseconds;
    },

    /**
     * Check if a cached price is still valid
     */
    isCacheValid(cachedPrice: CachedPrice): boolean {
        const now = Date.now();
        return (now - cachedPrice.timestamp) < this.cacheExpirationMs;
    },

    /**
     * Get current stock price with caching
     */
    async getStockPrice(symbol: string): Promise<{ symbol: string; price: number | null; error?: string; cached?: boolean }> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Check cache first
            const cachedData = this.priceCache[normalizedSymbol];
            if (cachedData && this.isCacheValid(cachedData)) {
                return { 
                    symbol: normalizedSymbol, 
                    price: cachedData.price,
                    cached: true
                };
            }
            
            // Return dummy data if no API key
            if (!API_KEY) {
                const dummyPrice = await this.getDummyStockPrice(normalizedSymbol);
                
                // Cache the dummy price too
                this.priceCache[normalizedSymbol] = {
                    price: dummyPrice,
                    timestamp: Date.now()
                };
                
                return { symbol: normalizedSymbol, price: dummyPrice };
            }
            
            return new Promise((resolve) => {
                finnhubClient.quote(normalizedSymbol, (error, data, response) => {
                    if (error) {
                        resolve({ symbol: normalizedSymbol, price: null, error: error.message });
                        return;
                    }
                    
                    if (data && typeof data.c === 'number') {
                        // Cache the result
                        this.priceCache[normalizedSymbol] = {
                            price: data.c,
                            timestamp: Date.now()
                        };
                        
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
            delete this.priceCache[symbol.toUpperCase()];
        } else {
            this.priceCache = {};
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