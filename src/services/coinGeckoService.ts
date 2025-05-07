import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { priceCacheDb } from '../database/operations';
import fs from 'fs';
import path from 'path';

dotenv.config();

// API key should be set in .env file as COINGECKO_API_KEY
const API_KEY = process.env.COINGECKO_API_KEY || 'CG-UPYXQ5GgW2gga94YsbVXqEnc'; // Default to demo key

// Define base URL for CoinGecko API
const BASE_URL = 'https://api.coingecko.com/api/v3';

// Define cache settings
const CACHE_MAX_AGE_MINUTES = 60; // Increased from 15 to 60 minutes to reduce update frequency
// Using the same value for both the database cache and global cache
const TOP_COINS_TO_CACHE = 100; // Reduced from 250 to 100 coins to reduce API calls

// Global in-memory cache
interface GlobalCacheData {
    lastUpdated: Date;
    prices: { [id: string]: number };
    nextUpdateTime: Date;
    callCount: number;
    dailyCallCount: number;
    dailyCountResetDate: Date;
}

// Initialize global cache
const globalCache: GlobalCacheData = {
    lastUpdated: new Date(0), // Set to epoch time initially
    prices: {},
    nextUpdateTime: new Date(0),
    callCount: 0,
    dailyCallCount: 0,
    dailyCountResetDate: new Date()
};

// Cache file paths
const CACHE_DIR = path.join(__dirname, '../../data/cache');
const CACHE_FILE = path.join(CACHE_DIR, 'coingecko-cache.json');

// Log API key status for debugging (without revealing the full key)
if (API_KEY) {
    console.log(`CoinGecko API key found (starts with: ${API_KEY.substring(0, 3)}...)`);
} else {
    console.log('No CoinGecko API key found, using dummy data');
}

// Define types for coin data
interface Coin {
    id: string;
    symbol: string;
    name: string;
}

interface CoinMarketData {
    id: string;
    symbol: string;
    name: string;
    current_price: number;
    market_cap: number;
    total_volume: number;
    price_change_percentage_24h: number;
    image: string;
    last_updated: string;
}

// Ensure the cache directory exists
try {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
} catch (err) {
    console.error('Error creating cache directory:', err);
}

// Load the cache from disk if it exists
try {
    if (fs.existsSync(CACHE_FILE)) {
        const cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        
        globalCache.lastUpdated = new Date(cacheData.lastUpdated || 0);
        globalCache.prices = cacheData.prices || {};
        globalCache.nextUpdateTime = new Date(cacheData.nextUpdateTime || 0);
        globalCache.callCount = cacheData.callCount || 0;
        globalCache.dailyCallCount = cacheData.dailyCallCount || 0;
        globalCache.dailyCountResetDate = new Date(cacheData.dailyCountResetDate || new Date());
        
        console.log(`Loaded CoinGecko cache with ${Object.keys(globalCache.prices).length} coins. Last updated: ${globalCache.lastUpdated}`);
    }
} catch (err) {
    console.error('Error loading CoinGecko cache file:', err);
}

// Function to save the cache to disk
function saveGlobalCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({
            lastUpdated: globalCache.lastUpdated,
            prices: globalCache.prices,
            nextUpdateTime: globalCache.nextUpdateTime,
            callCount: globalCache.callCount,
            dailyCallCount: globalCache.dailyCallCount,
            dailyCountResetDate: globalCache.dailyCountResetDate
        }, null, 2));
    } catch (err) {
        console.error('Error saving CoinGecko cache file:', err);
    }
}

// Function to update API call counts
function updateApiCallCount() {
    // Reset daily count if it's a new day
    const now = new Date();
    if (now.getDate() !== globalCache.dailyCountResetDate.getDate() ||
        now.getMonth() !== globalCache.dailyCountResetDate.getMonth() ||
        now.getFullYear() !== globalCache.dailyCountResetDate.getFullYear()) {
        globalCache.dailyCallCount = 0;
        globalCache.dailyCountResetDate = now;
    }
    
    globalCache.callCount++;
    globalCache.dailyCallCount++;
    
    // Save updated counts
    saveGlobalCache();
    
    // Log warning if approaching API limit
    if (globalCache.dailyCallCount > 300) {
        console.warn(`CoinGecko API daily call count: ${globalCache.dailyCallCount} - approaching monthly limit of 10,000`);
    }
}

/**
 * CoinGecko service for cryptocurrency data
 */
export const coinGeckoService = {
    /**
     * Get the list of all coins from CoinGecko
     */
    async getCoinsList(): Promise<Coin[]> {
        try {
            const response = await fetch(`${BASE_URL}/coins/list`, {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'x-cg-demo-api-key': API_KEY
                }
            });

            if (!response.ok) {
                throw new Error(`Error fetching coins list: ${response.status} ${response.statusText}`);
            }

            updateApiCallCount();
            const data = await response.json() as Coin[];
            return data;
        } catch (error) {
            console.error('Failed to fetch coins list:', error);
            return [];
        }
    },

    /**
     * Fetch and update the global price cache with top cryptocurrencies
     */
    async updateGlobalPriceCache(): Promise<void> {
        const now = new Date();
        
        // Skip update if we've updated recently
        if (globalCache.nextUpdateTime > now) {
            return;
        }
        
        console.log('Updating global CoinGecko price cache...');
        
        try {
            // Get a larger number of coins in a single request instead of multiple small pages
            // This reduces the number of API calls needed
            const response = await fetch(
                `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_COINS_TO_CACHE}&page=1&sparkline=false`,
                {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'x-cg-demo-api-key': API_KEY
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Error fetching top coins: ${response.status} ${response.statusText}`);
            }

            // Just one API call for all coins instead of multiple calls
            updateApiCallCount();
            
            const allCoins = await response.json() as CoinMarketData[];
            
            // Update the cache with fetched prices
            const priceEntries: Array<{
                symbol: string;
                price: number;
                timestamp: Date;
                source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
                interval: string;
            }> = [];
            
            for (const coin of allCoins) {
                globalCache.prices[coin.id] = coin.current_price;
                
                // Add to batch for DB cache
                priceEntries.push({
                    symbol: coin.id,
                    price: coin.current_price,
                    source: 'coingecko',
                    timestamp: new Date(coin.last_updated || now),
                    interval: '1m'
                });
            }
            
            // Batch store all prices in the DB at once
            if (priceEntries.length > 0) {
                priceCacheDb.storePriceBatch(priceEntries);
            }
            
            // Update cache timestamps
            globalCache.lastUpdated = now;
            globalCache.nextUpdateTime = new Date(now.getTime() + CACHE_MAX_AGE_MINUTES * 60 * 1000);
            
            // Save to disk
            saveGlobalCache();
            
            console.log(`Updated global price cache with ${allCoins.length} coins`);
        } catch (error) {
            console.error('Error updating global price cache:', error);
            // On error, set a shorter retry interval
            globalCache.nextUpdateTime = new Date(now.getTime() + 15 * 60 * 1000); // Try again in 15 minutes
            saveGlobalCache();
        }
    },
    
    /**
     * Get current price for a cryptocurrency with efficient caching
     */
    async getCoinPrice(coinId: string): Promise<{ id: string; symbol: string; price: number | null; error?: string; cached?: boolean; source?: string; lastUpdated?: string }> {
        try {
            console.log(`[${new Date().toISOString()}] getCoinPrice called for coinId: ${coinId}`);
            
            // Add absolute maximum cache age check
            const now = new Date();
            const maxCacheAgeMs = 24 * 60 * 60 * 1000; // 24 hours max
            const cacheAge = now.getTime() - globalCache.lastUpdated.getTime();
            
            if (cacheAge > maxCacheAgeMs) {
                console.log(`[DEBUG] Global cache is too old (${cacheAge}ms). Maximum age is ${maxCacheAgeMs}ms. Forcing update.`);
                globalCache.nextUpdateTime = new Date(0); // Force update
            }
            
            // Check if global cache needs updating
            console.log(`[DEBUG] Checking if global cache needs updating. nextUpdateTime: ${globalCache.nextUpdateTime.toISOString()}, now: ${now.toISOString()}`);
            await this.updateGlobalPriceCache();
            
            // Check global memory cache first
            if (globalCache.prices[coinId] !== undefined) {
                console.log(`[DEBUG] Found price in global memory cache: ${globalCache.prices[coinId]}, lastUpdated: ${globalCache.lastUpdated.toISOString()}`);
                return { 
                    id: coinId, 
                    symbol: coinId,
                    price: globalCache.prices[coinId],
                    cached: true,
                    source: 'global_cache',
                    lastUpdated: globalCache.lastUpdated.toISOString()
                };
            }
            
            console.log(`[DEBUG] Price not found in global cache, checking database cache`);
            
            // Check database cache next
            const cachedData = priceCacheDb.getLatestPrice(
                coinId,
                'coingecko',
                CACHE_MAX_AGE_MINUTES
            );
            
            if (cachedData) {
                console.log(`[DEBUG] Found price in database cache: ${cachedData.price}, timestamp: ${cachedData.timestamp}`);
                // Update global cache with this value
                globalCache.prices[coinId] = cachedData.price;
                
                return { 
                    id: coinId, 
                    symbol: coinId,
                    price: cachedData.price,
                    cached: true,
                    source: 'db_cache',
                    lastUpdated: cachedData.timestamp
                };
            }
            
            console.log(`[DEBUG] Price not found in database cache, fetching from CoinGecko API`);
            
            // If not in global cache or DB, we need to fetch it specifically
            const response = await fetch(`${BASE_URL}/simple/price?ids=${coinId}&vs_currencies=usd`, {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'x-cg-demo-api-key': API_KEY
                }
            });

            updateApiCallCount();
            
            console.log(`[DEBUG] CoinGecko API response status: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                console.error(`[ERROR] Failed to fetch price from CoinGecko API: ${response.status} ${response.statusText}`);
                // Set a shorter next update time to try again sooner
                globalCache.nextUpdateTime = new Date(now.getTime() + 15 * 60 * 1000); // Try again in 15 minutes
                saveGlobalCache();
                
                return {
                    id: coinId,
                    symbol: coinId,
                    price: null,
                    error: `Error fetching price: ${response.status} ${response.statusText}`,
                    source: 'api_error'
                };
            }

            const data = await response.json();
            console.log(`[DEBUG] CoinGecko API response data:`, JSON.stringify(data));
            
            if (!data[coinId] || data[coinId].usd === undefined) {
                console.error(`[ERROR] No price data found for ${coinId} in API response`);
                return {
                    id: coinId,
                    symbol: coinId,
                    price: null,
                    error: 'No price data available',
                    source: 'api_no_data'
                };
            }
            
            const price = data[coinId].usd;
            console.log(`[DEBUG] Successfully retrieved price from API: ${price}`);
            
            // Update global cache
            globalCache.prices[coinId] = price;
            console.log(`[DEBUG] Updated global cache for ${coinId}`);
            saveGlobalCache();
            console.log(`[DEBUG] Saved global cache to disk`);
            
            // Store in database cache
            try {
                console.log(`[DEBUG] Storing price in database cache`);
                priceCacheDb.storePrice(
                    coinId,
                    price,
                    'coingecko',
                    now,
                    '1m'
                );
                console.log(`[DEBUG] Successfully stored price in database cache`);
            } catch (dbError) {
                console.error(`[ERROR] Failed to store price in database:`, dbError);
            }
            
            return { 
                id: coinId, 
                symbol: coinId, 
                price,
                source: 'api_fresh',
                lastUpdated: now.toISOString()
            };
        } catch (error) {
            console.error(`[ERROR] Exception in getCoinPrice for ${coinId}:`, error);
            return { 
                id: coinId, 
                symbol: coinId, 
                price: null, 
                error: error instanceof Error ? error.message : 'Unknown error',
                source: 'exception'
            };
        }
    },
    
    /**
     * Get current price for multiple cryptocurrencies at once with efficient caching
     */
    async getMultipleCoinsPrice(coinIds: string[]): Promise<{ [id: string]: number | null }> {
        try {
            // Check if global cache needs updating
            await this.updateGlobalPriceCache();
            
            // Initialize result with all nulls
            const result: { [id: string]: number | null } = {};
            coinIds.forEach(id => { result[id] = null; });
            
            // First look up all IDs in the global cache
            const missingIds: string[] = [];
            
            for (const coinId of coinIds) {
                if (globalCache.prices[coinId] !== undefined) {
                    result[coinId] = globalCache.prices[coinId];
                } else {
                    // Check DB cache next
                    const cachedData = priceCacheDb.getLatestPrice(
                        coinId,
                        'coingecko',
                        CACHE_MAX_AGE_MINUTES
                    );
                    
                    if (cachedData) {
                        result[coinId] = cachedData.price;
                        // Update global cache with this value
                        globalCache.prices[coinId] = cachedData.price;
                    } else {
                        missingIds.push(coinId);
                    }
                }
            }
            
            // If we found all coins in cache, return early
            if (missingIds.length === 0) {
                return result;
            }
            
            // Fetch the missing coins from CoinGecko
            const idsParam = missingIds.join(',');
            const response = await fetch(`${BASE_URL}/simple/price?ids=${idsParam}&vs_currencies=usd`, {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'x-cg-demo-api-key': API_KEY
                }
            });

            updateApiCallCount();

            if (!response.ok) {
                console.error(`Error fetching prices: ${response.status} ${response.statusText}`);
                return result; // Return what we have from cache
            }

            const data = await response.json();
            
            // Update results, global cache and DB cache
            const now = new Date();
            const priceEntries: Array<{
                symbol: string;
                price: number;
                timestamp: Date;
                source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
                interval: string;
            }> = [];
            
            for (const coinId of missingIds) {
                if (data[coinId] && data[coinId].usd !== undefined) {
                    const price = data[coinId].usd;
                    result[coinId] = price;
                    
                    // Update global cache
                    globalCache.prices[coinId] = price;
                    
                    // Add to batch for DB cache
                    priceEntries.push({
                        symbol: coinId,
                        price: price,
                        timestamp: now,
                        source: 'coingecko',
                        interval: '1m'
                    });
                }
            }
            
            // Save global cache to disk
            saveGlobalCache();
            
            // Store batch in database cache
            if (priceEntries.length > 0) {
                priceCacheDb.storePriceBatch(priceEntries);
            }
            
            return result;
        } catch (error) {
            console.error('Failed to fetch multiple coin prices:', error);
            return coinIds.reduce((acc, coinId) => {
                // Return any prices we may have from cache despite the error
                acc[coinId] = globalCache.prices[coinId] ?? null;
                return acc;
            }, {} as { [id: string]: number | null });
        }
    },
    
    /**
     * Get market data for top cryptocurrencies
     */
    async getTopCoins(limit: number = 50, page: number = 1): Promise<CoinMarketData[]> {
        try {
            // Check if global cache needs updating
            await this.updateGlobalPriceCache();
            
            const response = await fetch(
                `${BASE_URL}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=${page}&sparkline=false`,
                {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'x-cg-demo-api-key': API_KEY
                    }
                }
            );

            updateApiCallCount();

            if (!response.ok) {
                throw new Error(`Error fetching top coins: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as CoinMarketData[];
            
            // Update caches with this data
            const now = new Date();
            const priceEntries: Array<{
                symbol: string;
                price: number;
                timestamp: Date;
                source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
                interval: string;
            }> = [];
            
            for (const coin of data) {
                // Update global cache
                globalCache.prices[coin.id] = coin.current_price;
                
                // Add to batch for DB cache
                priceEntries.push({
                    symbol: coin.id,
                    price: coin.current_price,
                    timestamp: new Date(coin.last_updated || now),
                    source: 'coingecko',
                    interval: '1m'
                });
            }
            
            // Save global cache
            saveGlobalCache();
            
            // Store batch in database
            if (priceEntries.length > 0) {
                priceCacheDb.storePriceBatch(priceEntries);
            }
            
            return data;
        } catch (error) {
            console.error('Failed to fetch top coins:', error);
            return [];
        }
    },
    
    /**
     * Search for coins by name or symbol
     */
    async searchCoins(query: string): Promise<Coin[]> {
        try {
            // First get all coins
            const allCoins = await this.getCoinsList();
            
            // Filter by query
            const normalizedQuery = query.toLowerCase().trim();
            const filteredCoins = allCoins.filter(coin => 
                coin.id.toLowerCase().includes(normalizedQuery) || 
                coin.symbol.toLowerCase().includes(normalizedQuery) || 
                coin.name.toLowerCase().includes(normalizedQuery)
            );
            
            if (filteredCoins.length === 0) {
                return [];
            }
            
            // Get top coins by market cap (which we'll use to sort our results)
            // and to break ties for exact symbol matches
            const topCoins = await this.getTopCoins(250);
            const marketCapMap = new Map<string, number>();
            
            // Create a map of coin ids to their market caps
            for (const coin of topCoins) {
                marketCapMap.set(coin.id, coin.market_cap);
            }
            
            // Look for exact symbol matches (case insensitive)
            const exactSymbolMatches = filteredCoins.filter(
                coin => coin.symbol.toLowerCase() === normalizedQuery
            );
            
            // Handle exact symbol matches
            if (exactSymbolMatches.length > 0) {
                // If we have multiple exact matches, sort them by market cap
                if (exactSymbolMatches.length > 1) {
                    exactSymbolMatches.sort((a, b) => {
                        const marketCapA = marketCapMap.get(a.id) || 0;
                        const marketCapB = marketCapMap.get(b.id) || 0;
                        return marketCapB - marketCapA; // Descending order
                    });
                }
                
                // Put the best exact symbol match at the beginning of the results
                // and include the remaining coins
                const bestMatch = exactSymbolMatches[0];
                const remainingCoins = filteredCoins.filter(
                    coin => coin.id !== bestMatch.id
                );
                
                // Return with the best match first, followed by other matches
                return [bestMatch, ...remainingCoins].slice(0, 25);
            }
            
            try {
                // Sort the filtered coins by market cap (if available)
                const sortedCoins = [...filteredCoins].sort((a, b) => {
                    const marketCapA = marketCapMap.get(a.id) || 0;
                    const marketCapB = marketCapMap.get(b.id) || 0;
                    return marketCapB - marketCapA; // Descending order
                });
                
                // Limit to 25 results to avoid overwhelming the user
                return sortedCoins.slice(0, 25);
            } catch (error) {
                console.error('Error sorting by market cap:', error);
                // Fallback to unsorted if there was an error
                return filteredCoins.slice(0, 25);
            }
        } catch (error) {
            console.error('Error searching for coins:', error);
            return [];
        }
    },
    
    /**
     * Get historical price data for a coin
     */
    async getHistoricalPrices(coinId: string, days: number = 30): Promise<{prices: [number, number][]}> {
        try {
            const response = await fetch(
                `${BASE_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`,
                {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json',
                        'x-cg-demo-api-key': API_KEY
                    }
                }
            );

            updateApiCallCount();

            if (!response.ok) {
                throw new Error(`Error fetching historical data: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            // Store historical data in cache
            if (data.prices && Array.isArray(data.prices)) {
                const priceEntries: Array<{
                    symbol: string;
                    price: number;
                    timestamp: Date;
                    source: 'yahoo' | 'coingecko'; // Removed 'finnhub'
                    interval: string;
                }> = data.prices.map((entry: [number, number]) => ({
                    symbol: coinId,
                    price: entry[1],
                    timestamp: new Date(entry[0]),
                    source: 'coingecko',
                    interval: '1d'
                }));
                
                if (priceEntries.length > 0) {
                    priceCacheDb.storePriceBatch(priceEntries);
                }
            }
            
            return data;
        } catch (error) {
            console.error(`Failed to fetch historical prices for ${coinId}:`, error);
            return { prices: [] };
        }
    },
    
    /**
     * Get detailed information for a specific coin
     */
    async getCoinDetails(coinId: string): Promise<any> {
        try {
            const response = await fetch(`${BASE_URL}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`, {
                method: 'GET',
                headers: {
                    'accept': 'application/json',
                    'x-cg-demo-api-key': API_KEY
                }
            });

            updateApiCallCount();

            if (!response.ok) {
                throw new Error(`Error fetching coin details: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            
            // If the data includes current price, update the cache
            if (data.market_data?.current_price?.usd) {
                const price = data.market_data.current_price.usd;
                
                // Update global cache
                globalCache.prices[coinId] = price;
                saveGlobalCache();
                
                // Update DB cache
                priceCacheDb.storePrice(
                    coinId,
                    price,
                    'coingecko',
                    new Date(),
                    '1m'
                );
            }
            
            return data;
        } catch (error) {
            console.error(`Failed to fetch details for ${coinId}:`, error);
            throw error;
        }
    },
    
    /**
     * Get API call statistics
     */
    getApiCallStats(): { totalCalls: number; dailyCalls: number; dailyResetDate: Date } {
        return {
            totalCalls: globalCache.callCount,
            dailyCalls: globalCache.dailyCallCount,
            dailyResetDate: globalCache.dailyCountResetDate
        };
    },
    
    /**
     * Manually trigger a cache update
     */
    async forceUpdateCache(): Promise<void> {
        globalCache.nextUpdateTime = new Date(0); // Set to epoch time to force update
        await this.updateGlobalPriceCache();
    },
    
    /**
     * Clear the price cache for a specific coin or all coins
     */
    clearCache(coinId?: string): void {
        if (coinId) {
            // Clear specific coin from global cache
            delete globalCache.prices[coinId];
            saveGlobalCache();
            
            // No immediate action needed for DB cache as validation is done on read
            console.log(`Cache cleared for ${coinId}`);
        } else {
            // Clear all cache from memory
            globalCache.prices = {};
            globalCache.lastUpdated = new Date(0);
            globalCache.nextUpdateTime = new Date(0);
            saveGlobalCache();
            
            // Clear old DB entries
            priceCacheDb.cleanupCache(1); // Clear entries older than 1 day
            console.log("All CoinGecko cache cleared");
        }
    },
};

// Initialize the global cache when the module loads
coinGeckoService.updateGlobalPriceCache().catch(err => {
    console.error('Failed to initialize global cache:', err);
});
