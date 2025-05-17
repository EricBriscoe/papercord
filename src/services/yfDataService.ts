/**
 * Yahoo Finance Data Service
 * 
 * This module provides functionality to fetch data from Yahoo Finance APIs
 * through a Python service using the yfinance library.
 */

import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { priceCacheDb } from '../database/operations';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

// Define cache settings with tiered expiration times
const CACHE_SETTINGS = {
    QUOTE_MAX_AGE_MINUTES: 5,        // Real-time quotes expire quickly
    HISTORICAL_MAX_AGE_HOURS: 24,    // Historical data can be cached longer
    OPTIONS_MAX_AGE_HOURS: 6,        // Options data refreshed a few times per day
    DIVIDEND_MAX_AGE_DAYS: 7,        // Dividend data rarely changes
    VOLATILITY_MAX_AGE_HOURS: 24     // Volatility calculations can be reused
};
const DEFAULT_RESOLUTION = '1m';     // Default resolution for current price data
const HISTORICAL_RESOLUTION = '1d';  // Resolution for historical data

// In-memory request cache to prevent duplicate requests in short time windows
const pendingRequests: Map<string, Promise<any>> = new Map();

// Service URLs
const PYTHON_SERVICE_URL = 'http://127.0.0.1:3001';
const SERVICE_STARTUP_TIMEOUT = 30000; // 30 seconds timeout for service startup

// Type definitions for API responses
interface QuoteResponse {
    symbol: string;
    shortName?: string;
    longName?: string;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    previousClose?: number;
    marketCap?: number;
    currency?: string;
    logo_url?: string;
    website?: string;
    [key: string]: any; // Allow other fields from ticker.info
}

interface HistoricalDataResult {
    chart?: {
        result?: Array<{
            meta?: any;
            timestamp?: number[];
            indicators?: {
                quote?: Array<{
                    close?: number[];
                    open?: number[];
                    high?: number[];
                    low?: number[];
                    volume?: number[];
                }>;
            };
        }>;
    };
}

interface SearchResponse {
    quotes?: Array<{
        symbol: string;
        shortname?: string;
        longname?: string;
        exchange?: string;
        quoteType?: string;
    }>;
}

interface OptionsResponse {
    optionChain?: {
        result?: Array<any>;
    };
}

/**
 * Interface for dividend information
 */
export interface DividendInfo {
    symbol: string;
    dividendRate: number | null;
    dividendYield: number | null;
    exDividendDate: number | null;
    payoutRatio: number | null;
    fiveYearAvgDividendYield: number | null;
}

/**
 * Interface for dividend history entry
 */
export interface DividendHistoryEntry {
    date: string;
    timestamp: number;
    amount: number;
}

/**
 * Interface for dividend data response
 */
export interface DividendResponse {
    info: DividendInfo;
    history: DividendHistoryEntry[];
    message?: string;
}

// Custom error class for service errors
class YFServiceError extends Error {
    constructor(message: string = "Yahoo Finance service error") {
        super(message);
        this.name = "YFServiceError";
    }
}

// Custom error class for rate limiting
class YFRateLimitError extends Error {
    constructor(message: string = "Yahoo Finance rate limit exceeded") {
        super(message);
        this.name = "YFRateLimitError";
    }
}

/**
 * YfData class provides functionality for Yahoo Finance API access through Python service
 * Singleton pattern ensures one instance is reused across the application
 */
class YfData {
    private static instance: YfData;
    private serviceProcess: ChildProcess | null = null;
    private serviceReady: boolean = false;
    private serviceStarting: boolean = false;
    private serviceStartPromise: Promise<boolean> | null = null;

    private constructor() {
        console.log('Initializing Yahoo Finance Data Service with Python backend');
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): YfData {
        if (!YfData.instance) {
            YfData.instance = new YfData();
        }
        return YfData.instance;
    }

    /**
     * Start the Python service if not already running
     */
    private async ensureServiceRunning(): Promise<boolean> {
        if (this.serviceReady) {
            return true;
        }

        // If service is starting, wait for it
if (this.serviceStarting && this.serviceStartPromise) {
    return this.serviceStartPromise;
}

// Prevent multiple service spawns if already started
if (this.serviceProcess) {
    console.log('Python service already spawned, skipping start');
    this.serviceReady = true;
    return true;
}

        this.serviceStarting = true;
        this.serviceStartPromise = new Promise<boolean>((resolve) => {
            // First, try to connect to the service in case it's already running
            this.checkServiceHealth()
                .then(isRunning => {
                    if (isRunning) {
                        console.log('Yahoo Finance Python service is already running');
                        this.serviceReady = true;
                        this.serviceStarting = false;
                        resolve(true);
                        return;
                    }

                    console.log('Starting Yahoo Finance Python service...');
                    
                    // Start the Python service
                    const scriptPath = path.join(process.cwd(), 'src', 'python_services', 'start_service.sh');
                    
                    if (!fs.existsSync(scriptPath)) {
                        console.error(`Service script not found at ${scriptPath}`);
                        this.serviceStarting = false;
                        resolve(false);
                        return;
                    }
                    
                    this.serviceProcess = spawn(scriptPath, [], {
                        stdio: 'pipe',
                        shell: true
                    });

                    if (!this.serviceProcess) {
                        console.error('Failed to start Yahoo Finance Python service');
                        this.serviceStarting = false;
                        resolve(false);
                        return;
                    }

                    this.serviceProcess.stdout?.on('data', (data) => {
                        console.log(`YF Python Service: ${data.toString()}`);
                    });

                    this.serviceProcess.stderr?.on('data', (data) => {
                        console.error(`YF Python Service Error: ${data.toString()}`);
                    });

                    this.serviceProcess.on('close', (code) => {
                        console.log(`YF Python Service exited with code ${code}`);
                        this.serviceReady = false;
                        this.serviceProcess = null;
                    });

                    // Poll for service health
                    let attempts = 0;
                    const maxAttempts = 10;
                    const pollInterval = SERVICE_STARTUP_TIMEOUT / maxAttempts;

                    const checkInterval = setInterval(async () => {
                        attempts++;
                        try {
                            const isHealthy = await this.checkServiceHealth();
                            if (isHealthy) {
                                console.log('Yahoo Finance Python service is ready');
                                this.serviceReady = true;
                                this.serviceStarting = false;
                                clearInterval(checkInterval);
                                resolve(true);
                                return;
                            }
                        } catch (error) {
                            console.log(`Service health check failed (attempt ${attempts}/${maxAttempts})`);
                        }

                        if (attempts >= maxAttempts) {
                            console.error('Failed to start Yahoo Finance Python service');
                            this.serviceStarting = false;
                            clearInterval(checkInterval);
                            resolve(false);
                        }
                    }, pollInterval);
                })
                .catch(() => {
                    console.error('Failed to check Yahoo Finance Python service health');
                    this.serviceStarting = false;
                    resolve(false);
                });
        });

        return this.serviceStartPromise;
    }

    /**
     * Check if the Python service is healthy
     */
    private async checkServiceHealth(): Promise<boolean> {
        try {
            const response = await fetch(`${PYTHON_SERVICE_URL}/health`, {
                timeout: 2000
            });
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    /**
     * Make a request to the Python service with deduplication
     */
    public async makeServiceRequest<T>(
        endpoint: string,
        params: Record<string, any> = {}
    ): Promise<T> {
        // Ensure service is running
        const isRunning = await this.ensureServiceRunning();
        if (!isRunning) {
            throw new YFServiceError('Yahoo Finance service is not available');
        }

        // Build URL with query parameters
        const url = new URL(`${PYTHON_SERVICE_URL}${endpoint}`);
        Object.keys(params).forEach(key => {
            url.searchParams.append(key, params[key]);
        });

        // Create a request key for deduplication
        const requestKey = `${endpoint}:${url.searchParams.toString()}`;
        
        // Check if this exact request is already in progress
        const pendingRequest = pendingRequests.get(requestKey);
        if (pendingRequest) {
            console.debug(`Reusing in-flight request for ${requestKey}`);
            return pendingRequest as Promise<T>;
        }
        
        // Create a new request and store it in the pending requests map
        const requestPromise = (async () => {
            try {
                const response = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });

                if (response.status === 429) {
                    throw new YFRateLimitError();
                }

                if (!response.ok) {
                    throw new YFServiceError(`HTTP error ${response.status}`);
                }

                return await response.json() as T;
            } catch (error) {
                if (error instanceof YFRateLimitError) {
                    throw error;
                }
                console.error('Error making service request:', error);
                throw new YFServiceError(`Failed to fetch data from Yahoo Finance service: ${error}`);
            } finally {
                // Remove from pending requests map after completion
                pendingRequests.delete(requestKey);
            }
        })();
        
        // Store the promise in the pending requests map
        pendingRequests.set(requestKey, requestPromise);
        
        return requestPromise;
    }
}

/**
 * Export a singleton instance
 */
export const yfDataService = {
    instance: YfData.getInstance(),
    
    /**
     * Get stock historical data with optimized caching
     * @param symbol Stock ticker symbol
     * @param periodMinutes Duration to fetch in minutes (e.g., 43200 for 30 days)
     * @param intervalMinutes Interval between data points in minutes (e.g., 1440 for daily data)
     */
    async getHistoricalData(symbol: string, periodMinutes: number = 1440, intervalMinutes: number = 1440): Promise<HistoricalDataResult> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Create a request key for in-memory cache
            const requestKey = `historical:${normalizedSymbol}:${periodMinutes}:${intervalMinutes}`;
            const pendingRequest = pendingRequests.get(requestKey);
            
            if (pendingRequest) {
                console.debug(`Reusing in-flight historical data request for ${normalizedSymbol}`);
                return pendingRequest as Promise<HistoricalDataResult>;
            }
            
            // Create a new request and store it in the pending requests map
            const requestPromise = (async () => {
                try {
                    // Determine appropriate cache interval based on the interval minutes
                    let cacheInterval: string;
                    if (intervalMinutes <= 1) cacheInterval = '1m';
                    else if (intervalMinutes <= 5) cacheInterval = '5m';
                    else if (intervalMinutes <= 15) cacheInterval = '15m';
                    else if (intervalMinutes <= 30) cacheInterval = '30m';
                    else if (intervalMinutes <= 60) cacheInterval = '1h';
                    else cacheInterval = '1d';
                    
                    // Convert intervalMinutes and periodMinutes to period and interval strings
                    let interval: string, period: string;
                    
                    // Set interval string based on minutes
                    if (intervalMinutes <= 1) interval = '1m';
                    else if (intervalMinutes <= 5) interval = '5m';
                    else if (intervalMinutes <= 15) interval = '15m';
                    else if (intervalMinutes <= 30) interval = '30m';
                    else if (intervalMinutes <= 60) interval = '1h';
                    else interval = '1d';
                    
                    // Set period string based on minutes
                    if (periodMinutes <= 1440) period = '1d';
                    else if (periodMinutes <= 7200) period = '5d';
                    else if (periodMinutes <= 43200) period = '1mo';
                    else if (periodMinutes <= 129600) period = '3mo';
                    else if (periodMinutes <= 259200) period = '6mo';
                    else if (periodMinutes <= 525600) period = '1y';
                    else if (periodMinutes <= 1051200) period = '2y';
                    else period = '5y';
                    
                    // Calculate date range for the request
                    const endDate = new Date();
                    const startDate = new Date(endDate.getTime() - periodMinutes * 60 * 1000);
                    
                    // Get existing data from cache
                    const timeSeriesData = priceCacheDb.getTimeSeries(
                        normalizedSymbol,
                        'yahoo',
                        cacheInterval,
                        Math.ceil(periodMinutes / intervalMinutes) * 2, // Get more than needed
                        startDate,
                        endDate
                    );
                    
                    // Calculate the expected number of data points based on period and interval
                    const expectedDataPoints = Math.ceil(periodMinutes / intervalMinutes);
                    
                    // Check if we have enough data points (at least 80% coverage)
                    const sufficientCoverage = timeSeriesData.length >= expectedDataPoints * 0.8;
                    
                    // Check if the data is fresh enough (within the historical max age)
                    const maxAgeHours = CACHE_SETTINGS.HISTORICAL_MAX_AGE_HOURS;
                    const oldestAllowedTimestamp = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
                    
                    // Check if the most recent data point is fresh enough
                    let dataIsFresh = false;
                    if (timeSeriesData.length > 0) {
                        const mostRecentTimestamp = new Date(timeSeriesData[timeSeriesData.length - 1].timestamp);
                        dataIsFresh = mostRecentTimestamp >= oldestAllowedTimestamp;
                    }
                    
                    // Use cached data if we have sufficient coverage and it's fresh
                    if (sufficientCoverage && dataIsFresh) {
                        console.debug(`Using cached historical data for ${normalizedSymbol} (${timeSeriesData.length}/${expectedDataPoints} data points)`);
                        
                        // Format data for API response compatibility
                        const timestamps = timeSeriesData.map(entry => new Date(entry.timestamp).getTime() / 1000);
                        const prices = timeSeriesData.map(entry => entry.price);
                        
                        // Create response that matches Yahoo Finance API format
                        return {
                            chart: {
                                result: [
                                    {
                                        meta: {
                                            currency: 'USD',
                                            symbol: normalizedSymbol,
                                            regularMarketPrice: prices[prices.length - 1],
                                            previousClose: prices.length > 1 ? prices[prices.length - 2] : prices[0],
                                        },
                                        timestamp: timestamps,
                                        indicators: {
                                            quote: [
                                                {
                                                    close: prices,
                                                    open: prices.map((p, i) => i > 0 ? prices[i - 1] : p),
                                                    high: prices.map(p => p * 1.005), // Approximate
                                                    low: prices.map(p => p * 0.995),  // Approximate
                                                    volume: prices.map(() => 0)  // No volume data in cache
                                                }
                                            ]
                                        }
                                    }
                                ]
                            }
                        };
                    }
                    
                    console.debug(`Insufficient historical data for ${normalizedSymbol}, fetching from Python service`);
                    
                    // No adequate cache data, fetch from Python service
                    const result = await YfData.getInstance().makeServiceRequest<HistoricalDataResult>('/historical', {
                        symbol: normalizedSymbol,
                        period: period,
                        interval: interval
                    });
                    
                    // Store historical data points in database cache
                    if (result &&
                        result.chart &&
                        result.chart.result && 
                        result.chart.result.length > 0) {
                        
                        const data = result.chart.result[0];
                        if (data.timestamp && data.indicators?.quote?.[0]?.close) {
                            const timestamps = data.timestamp;
                            const prices = data.indicators.quote[0].close;
                            
                            // Create batch of price entries to insert
                            const priceEntries: Array<{
                                symbol: string;
                                price: number;
                                timestamp: Date;
                                source: 'yahoo'; // Removed 'finnhub'
                                interval: string;
                            }> = [];
                            
                            for (let i = 0; i < timestamps.length; i++) {
                                // Skip null prices
                                if (prices[i] === null) continue;
                                
                                priceEntries.push({
                                    symbol: normalizedSymbol,
                                    price: prices[i],
                                    timestamp: new Date(timestamps[i] * 1000),
                                    source: 'yahoo' as 'yahoo',
                                    interval: cacheInterval
                                });
                            }
                            
                            // Store all price points in a batch operation
                            if (priceEntries.length > 0) {
                                priceCacheDb.storePriceBatch(priceEntries);
                                console.debug(`Cached ${priceEntries.length} historical prices for ${normalizedSymbol}`);
                            }
                        }
                    }
                    
                    return result;
                } finally {
                    // Remove from pending requests map after completion
                    pendingRequests.delete(requestKey);
                }
            })();
            
            // Store the promise in the pending requests map
            pendingRequests.set(requestKey, requestPromise);
            
            return requestPromise;
        } catch (error) {
            console.error(`Failed to get historical data for ${symbol}:`, error);
            throw error;
        }
    },
    
    /**
     * Get stock quote data with optimized caching
     */
    async getQuote(symbol: string): Promise<QuoteResponse> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // First check the database cache with the configured max age
            const cachedData = priceCacheDb.getLatestPrice(
                normalizedSymbol,
                'yahoo',
                CACHE_SETTINGS.QUOTE_MAX_AGE_MINUTES
            );
            
            // Create a request key for in-memory cache
            const requestKey = `quote:${normalizedSymbol}`;
            const pendingRequest = pendingRequests.get(requestKey);
            
            if (pendingRequest) {
                console.debug(`Reusing in-flight quote request for ${normalizedSymbol}`);
                return pendingRequest as Promise<QuoteResponse>;
            }
            
            // Create a new request and store it in the pending requests map
            const requestPromise = (async () => {
                try {
                    // Fetch from Python service
                    const quoteData = await YfData.getInstance().makeServiceRequest<QuoteResponse>('/quote', {
                        symbol: normalizedSymbol
                    });
                    
                    // If we have cached price data, use it to update the regularMarketPrice
                    // This ensures we're not making unnecessary API calls for price data
                    if (cachedData && quoteData) {
                        console.debug(`Using cached price for ${normalizedSymbol} from database (age: ${CACHE_SETTINGS.QUOTE_MAX_AGE_MINUTES}m)`);
                        quoteData.regularMarketPrice = cachedData.price;
                        quoteData.regularMarketTime = new Date(cachedData.timestamp).getTime() / 1000;
                    }
                    
                    // Store in database cache if we got a valid response
                    if (quoteData.regularMarketPrice) {
                        priceCacheDb.storePrice(
                            normalizedSymbol,
                            quoteData.regularMarketPrice,
                            'yahoo',
                            new Date(quoteData.regularMarketTime ? quoteData.regularMarketTime * 1000 : Date.now()),
                            '1m'
                        );
                        
                        console.debug(`Cached quote for ${normalizedSymbol}`);
                    }
                    
                    return quoteData;
                } finally {
                    // Remove from pending requests map after completion
                    pendingRequests.delete(requestKey);
                }
            })();
            
            // Store the promise in the pending requests map
            pendingRequests.set(requestKey, requestPromise);
            
            return requestPromise;
        } catch (error) {
            console.error(`Failed to get quote for ${symbol}:`, error);
            throw error;
        }
    },
    
    /**
     * Search for symbols
     */
    async searchSymbols(query: string): Promise<any[]> {
        try {
            // Search results don't need to be cached at the database level
            const response = await YfData.getInstance().makeServiceRequest<SearchResponse>('/search', {
                query: encodeURIComponent(query)
            });
            return response.quotes || [];
        } catch (error) {
            console.error(`Failed to search symbols for "${query}":`, error);
            throw error;
        }
    },
    
    /**
     * Get option chain data with caching
     */
    async getOptionChain(symbol: string): Promise<OptionsResponse> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Create a request key for in-memory cache
            const requestKey = `options:${normalizedSymbol}`;
            const pendingRequest = pendingRequests.get(requestKey);
            
            if (pendingRequest) {
                console.debug(`Reusing in-flight options chain request for ${normalizedSymbol}`);
                return pendingRequest as Promise<OptionsResponse>;
            }
            
            // Create a new request and store it in the pending requests map
            const requestPromise = (async () => {
                try {
                    // Fetch from Python service
                    return await YfData.getInstance().makeServiceRequest<OptionsResponse>('/options', {
                        symbol: encodeURIComponent(normalizedSymbol)
                    });
                } finally {
                    // Remove from pending requests map after completion
                    pendingRequests.delete(requestKey);
                }
            })();
            
            // Store the promise in the pending requests map
            pendingRequests.set(requestKey, requestPromise);
            
            return requestPromise;
        } catch (error) {
            console.error(`Failed to get option chain for ${symbol}:`, error);
            throw error;
        }
    },
    
    /**
     * Get cached historical prices for a symbol
     */
    getHistoricalPrices(symbol: string, limit: number = 30): any[] {
        try {
            // Use the getTimeSeries method
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days back
            
            const prices = priceCacheDb.getTimeSeries(
                symbol,
                'yahoo',
                HISTORICAL_RESOLUTION,
                limit,
                startDate,
                endDate
            );
            
            return prices.map(entry => ({
                symbol: entry.symbol,
                price: entry.price,
                timestamp: entry.timestamp
            }));
        } catch (error) {
            console.error(`Failed to get historical prices for ${symbol}:`, error);
            return [];
        }
    },
    
    /**
     * Get dividend data for a symbol with caching
     * @param symbol Stock ticker symbol
     * @returns Dividend data including rate, yield, and history
     */
    async getDividendData(symbol: string): Promise<DividendResponse | null> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Create a request key for in-memory cache
            const requestKey = `dividends:${normalizedSymbol}`;
            const pendingRequest = pendingRequests.get(requestKey);
            
            if (pendingRequest) {
                console.debug(`Reusing in-flight dividend data request for ${normalizedSymbol}`);
                return pendingRequest as Promise<DividendResponse>;
            }
            
            // Create a new request and store it in the pending requests map
            const requestPromise = (async () => {
                try {
                    // Request dividend data from the Python service
                    const result = await YfData.getInstance().makeServiceRequest<DividendResponse>('/dividends', {
                        symbol: normalizedSymbol
                    });
                    
                    if (!result) {
                        throw new Error(`Failed to get dividend data for ${normalizedSymbol}`);
                    }
                    
                    return result;
                } finally {
                    // Remove from pending requests map after completion
                    pendingRequests.delete(requestKey);
                }
            })();
            
            // Store the promise in the pending requests map
            pendingRequests.set(requestKey, requestPromise);
            
            return requestPromise;
        } catch (error) {
            console.error(`Failed to get dividend data for ${symbol}:`, error);
            return null;
        }
    },
    
    /**
     * Clear Yahoo Finance cache
     */
    clearCache(): void {
        console.log("Clearing Yahoo Finance cache older than 1 day");
        priceCacheDb.cleanupCache(1);
    }
};

// Export the error classes for use in try-catch blocks
export { YFServiceError, YFRateLimitError };
