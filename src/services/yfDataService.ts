/**
 * Yahoo Finance Data Service
 * 
 * This module provides functionality to fetch data from Yahoo Finance APIs
 * with proper cookie and crumb handling for authenticated requests.
 * 
 * Ported from Python yfinance library to TypeScript.
 */

import fetch, { Response } from 'node-fetch';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { URL, URLSearchParams } from 'url';
import * as cheerio from 'cheerio';
import { priceCacheDb } from '../database/operations';

// Load environment variables
dotenv.config();

// Define cache settings
const CACHE_MAX_AGE_MINUTES = 15; // Maximum age of cache in minutes
const DEFAULT_RESOLUTION = '1m'; // Default resolution for current price data
const HISTORICAL_RESOLUTION = '1d'; // Resolution for historical data

// Define user agents to rotate through
const USER_AGENTS = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.109 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:100.0) Gecko/20100101 Firefox/100.0'
];

// Define types for cookies and cache
interface Cookie {
    name: string;
    value: string;
    expires?: Date;
}

interface CachedCookie {
    cookie: Cookie | object;
    timestamp: Date;
    age?: number;
}

interface CookieCache {
    [key: string]: CachedCookie;
}

// Custom error class for rate limiting
class YFRateLimitError extends Error {
    constructor(message: string = "Yahoo Finance rate limit exceeded") {
        super(message);
        this.name = "YFRateLimitError";
    }
}

/**
 * YfData class provides functionality for Yahoo Finance API access
 * Singleton pattern ensures one instance is reused across the application
 */
class YfData {
    private static instance: YfData;
    private userAgentHeaders: { 'User-Agent': string };
    private cookieCache: CookieCache = {};
    private _crumb: string | null = null;
    private _cookie: Cookie | null | boolean = null;  // Updated to allow boolean for CSRF sessions
    private _cookieStrategy: 'basic' | 'csrf' = 'basic';
    private _cookieLockActive: boolean = false;
    private cacheDir: string;

    private constructor() {
        // Select a random user agent
        this.userAgentHeaders = {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
        };
        
        // Create cache directory if it doesn't exist
        this.cacheDir = path.join(process.cwd(), 'data', 'cache');
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
        
        // Load cached cookies if available
        this.loadCookieCache();
        
        console.log(`YfData initialized with User-Agent: ${this.userAgentHeaders['User-Agent']}`);
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
     * Save cookies to disk
     */
    private saveCookieCache(): void {
        try {
            const cookieCachePath = path.join(this.cacheDir, 'cookie-cache.json');
            fs.writeFileSync(cookieCachePath, JSON.stringify(this.cookieCache), 'utf8');
        } catch (error) {
            console.error('Failed to save cookie cache:', error);
        }
    }

    /**
     * Load cookies from disk
     */
    private loadCookieCache(): void {
        try {
            const cookieCachePath = path.join(this.cacheDir, 'cookie-cache.json');
            if (fs.existsSync(cookieCachePath)) {
                const data = fs.readFileSync(cookieCachePath, 'utf8');
                this.cookieCache = JSON.parse(data);
                
                // Convert string dates back to Date objects
                for (const key in this.cookieCache) {
                    this.cookieCache[key].timestamp = new Date(this.cookieCache[key].timestamp);
                }
            }
        } catch (error) {
            console.error('Failed to load cookie cache:', error);
            this.cookieCache = {};
        }
    }

    /**
     * Set cookie strategy and reset cookies/crumbs
     */
    private setCookieStrategy(strategy: 'basic' | 'csrf'): void {
        if (strategy === this._cookieStrategy) {
            return;
        }

        try {
            if (this._cookieStrategy === 'csrf') {
                console.debug('toggling cookie strategy csrf -> basic');
                this._cookieStrategy = 'basic';
            } else {
                console.debug('toggling cookie strategy basic -> csrf');
                this._cookieStrategy = 'csrf';
            }
            this._cookie = null;
            this._crumb = null;
        } catch (error) {
            console.error('Error changing cookie strategy:', error);
        }
    }

    /**
     * Store a cookie in cache
     */
    private storeCookie(key: string, cookie: Cookie | object): boolean {
        try {
            this.cookieCache[key] = {
                cookie: cookie,
                timestamp: new Date()
            };
            this.saveCookieCache();
            return true;
        } catch (error) {
            console.error('Failed to store cookie:', error);
            return false;
        }
    }

    /**
     * Look up a cookie from cache
     */
    private lookupCookie(key: string): CachedCookie | null {
        const cachedData = this.cookieCache[key];
        if (!cachedData) {
            return null;
        }
        
        // Check if cookie is expired (older than 24 hours)
        const age = (new Date().getTime() - cachedData.timestamp.getTime()) / (1000 * 3600);
        if (age > 24) {
            return null;
        }
        
        // Add age property to cached data
        cachedData.age = age;
        return cachedData;
    }

    /**
     * Get basic cookie for Yahoo Finance
     */
    private async getBasicCookie(proxy?: string): Promise<Cookie | null> {
        if (this._cookie && typeof this._cookie !== 'boolean') {
            console.debug('reusing cookie');
            return this._cookie;
        }

        // Try to get from cache
        const cachedCookie = this.lookupCookie('basic');
        if (cachedCookie) {
            this._cookie = cachedCookie.cookie as Cookie;
            return this._cookie;
        }

        try {
            const fetchOptions: any = {
                method: 'GET',
                headers: this.userAgentHeaders,
                redirect: 'follow'
            };
            
            if (proxy) {
                fetchOptions.agent = new (require('https-proxy-agent'))(proxy);
            }
            
            const response = await fetch('https://fc.yahoo.com', fetchOptions);
            
            const cookies = this.extractCookies(response);
            if (!cookies || cookies.length === 0) {
                console.debug('response.cookies = None');
                return null;
            }
            
            this._cookie = cookies[0];
            this.storeCookie('basic', this._cookie);
            
            console.debug(`fetched basic cookie = ${this._cookie.name}=${this._cookie.value}`);
            return this._cookie;
        } catch (error) {
            console.error('Error getting basic cookie:', error);
            return null;
        }
    }

    /**
     * Extract cookies from a fetch response
     */
    private extractCookies(response: Response): Cookie[] {
        const cookies: Cookie[] = [];
        const cookieHeader = response.headers.get('set-cookie');
        
        if (!cookieHeader) return cookies;
        
        const cookieStrings = Array.isArray(cookieHeader) ? cookieHeader : [cookieHeader];
        
        for (const cookieString of cookieStrings) {
            const parts = cookieString.split(';');
            const [name, value] = parts[0].split('=');
            
            if (name && value) {
                const cookie: Cookie = { name, value };
                
                // Parse expiry date if present
                const expiresMatch = cookieString.match(/expires=([^;]+)/i);
                if (expiresMatch?.[1]) {
                    cookie.expires = new Date(expiresMatch[1]);
                }
                
                cookies.push(cookie);
            }
        }
        
        return cookies;
    }

    /**
     * Get crumb for authenticated requests
     */
    private async getBasicCrumb(proxy?: string): Promise<string | null> {
        if (this._crumb) {
            console.debug('reusing crumb');
            return this._crumb;
        }

        const cookie = await this.getBasicCookie(proxy);
        if (!cookie) {
            return null;
        }

        try {
            const fetchOptions: any = {
                method: 'GET',
                headers: {
                    ...this.userAgentHeaders,
                    Cookie: `${cookie.name}=${cookie.value}`
                },
                redirect: 'follow'
            };
            
            if (proxy) {
                fetchOptions.agent = new (require('https-proxy-agent'))(proxy);
            }
            
            const response = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', fetchOptions);
            
            this._crumb = await response.text();
            
            if (!this._crumb || this._crumb.includes('<html>')) {
                console.debug("Didn't receive crumb");
                return null;
            }
            
            console.debug(`crumb = '${this._crumb}'`);
            return this._crumb;
        } catch (error) {
            console.error('Error getting basic crumb:', error);
            return null;
        }
    }

    /**
     * Get cookie and crumb with cookie lock to prevent race conditions
     */
    private async getCookieAndCrumb(proxy?: string): Promise<[Cookie | null, string | null, 'basic' | 'csrf']> {
        console.debug(`cookie_mode = '${this._cookieStrategy}'`);
        
        // Simple lock mechanism to prevent concurrent cookie fetches
        while (this._cookieLockActive) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this._cookieLockActive = true;
        try {
            let cookie: Cookie | null = null;
            let crumb: string | null = null;
            
            if (this._cookieStrategy === 'csrf') {
                crumb = await this.getCsrfCrumb(proxy);
                if (!crumb) {
                    // Fail and switch to basic
                    this.setCookieStrategy('basic');
                    [cookie, crumb] = await this.getBasicCookieAndCrumb(proxy);
                }
            } else {
                // Basic strategy
                [cookie, crumb] = await this.getBasicCookieAndCrumb(proxy);
                if (!cookie || !crumb) {
                    // Fail and switch to CSRF
                    this.setCookieStrategy('csrf');
                    crumb = await this.getCsrfCrumb(proxy);
                }
            }
            
            return [cookie, crumb, this._cookieStrategy];
        } finally {
            this._cookieLockActive = false;
        }
    }

    /**
     * Get basic cookie and crumb together
     */
    private async getBasicCookieAndCrumb(proxy?: string): Promise<[Cookie | null, string | null]> {
        const cookie = await this.getBasicCookie(proxy);
        const crumb = await this.getBasicCrumb(proxy);
        return [cookie, crumb];
    }

    /**
     * Get CSRF token and cookies
     */
    private async getCsrfCrumb(proxy?: string): Promise<string | null> {
        if (this._crumb) {
            console.debug('reusing crumb');
            return this._crumb;
        }

        // Check if we already have a cookie from the session
        if (this._cookie === true) {
            console.debug('reusing CSRF session cookie');
        } else {
            // Need to get a new CSRF cookie
            const success = await this.getCsrfCookie(proxy);
            if (!success) {
                return null;
            }
        }

        try {
            const fetchOptions: any = {
                method: 'GET',
                headers: this.userAgentHeaders,
                redirect: 'follow'
            };
            
            if (proxy) {
                fetchOptions.agent = new (require('https-proxy-agent'))(proxy);
            }
            
            const response = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', fetchOptions);
            const crumb = await response.text();
            
            if (!crumb || crumb.includes('<html>') || crumb === '') {
                console.debug("Didn't receive crumb from CSRF method");
                return null;
            }
            
            this._crumb = crumb;
            console.debug(`CSRF crumb = '${this._crumb}'`);
            return this._crumb;
        } catch (error) {
            console.error('Error in CSRF crumb fetch:', error);
            return null;
        }
    }

    /**
     * Get CSRF cookie following the consent flow
     */
    private async getCsrfCookie(proxy?: string): Promise<boolean> {
        if (this._cookie === true) {
            console.debug('reusing CSRF cookie');
            return true;
        }

        // Try to load from cache
        if (await this.loadSessionCookies()) {
            console.debug('reusing persistent CSRF cookie');
            this._cookie = true;
            return true;
        }

        const baseArgs: any = {
            headers: this.userAgentHeaders,
            redirect: 'follow'
        };
        
        if (proxy) {
            baseArgs.agent = new (require('https-proxy-agent'))(proxy);
        }

        try {
            // First fetch the consent page
            const response = await fetch('https://guce.yahoo.com/consent', baseArgs);
            const html = await response.text();
            
            // Parse HTML for tokens
            const $ = cheerio.load(html);
            const csrfToken = $('input[name="csrfToken"]').val();
            const sessionId = $('input[name="sessionId"]').val();
            
            if (!csrfToken || !sessionId) {
                console.debug('Failed to find "csrfToken" or "sessionId" in response');
                return false;
            }
            
            console.debug(`csrfToken = ${csrfToken}`);
            console.debug(`sessionId = ${sessionId}`);

            // Prepare data for consent submission
            const originalDoneUrl = 'https://finance.yahoo.com/';
            const namespace = 'yahoo';
            const data = {
                agree: ['agree', 'agree'],
                consentUUID: 'default',
                sessionId: sessionId,
                csrfToken: csrfToken,
                originalDoneUrl: originalDoneUrl,
                namespace: namespace,
            };
            
            // Submit consent
            const postResponse = await fetch(
                `https://consent.yahoo.com/v2/collectConsent?sessionId=${sessionId}`,
                {
                    ...baseArgs,
                    method: 'POST',
                    headers: {
                        ...baseArgs.headers,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: new URLSearchParams(data as any).toString()
                }
            );
            
            // Copy consent
            const getResponse = await fetch(
                `https://guce.yahoo.com/copyConsent?sessionId=${sessionId}`,
                {
                    ...baseArgs,
                    method: 'GET'
                }
            );
            
            // Store the cookies from both responses
            this._cookie = true;
            this.saveSessionCookies();
            return true;
        } catch (error) {
            console.error('Error in CSRF cookie fetch:', error);
            return false;
        }
    }

    /**
     * Save session cookies to disk
     */
    private saveSessionCookies(): boolean {
        try {
            // We need to extract the cookies from the fetch API
            // For now, we'll just store the fact that we have a valid session
            this.storeCookie('csrf', { valid: true });
            return true;
        } catch (error) {
            console.error('Failed to save session cookies:', error);
            return false;
        }
    }

    /**
     * Load session cookies from disk
     */
    private async loadSessionCookies(): Promise<boolean> {
        const cookieData = this.lookupCookie('csrf');
        if (!cookieData) {
            return false;
        }
        
        // Check if cookie is valid and not expired
        // In a production implementation, we'd validate the actual cookies
        console.debug('loaded persistent CSRF cookie');
        return true;
    }

    /**
     * Setup proxy in the proper format
     */
    private getProxy(proxy?: string | Record<string, string>): string | undefined {
        if (!proxy) {
            return undefined;
        }
        
        // If it's already an object with https key, extract the https proxy
        if (typeof proxy === 'object' && 'https' in proxy) {
            return proxy.https;
        }
        
        return proxy as string;
    }

    /**
     * Make HTTP request with proper authentication
     */
    private async makeRequest(
        url: string, 
        params: Record<string, any> = {}, 
        method: 'GET' | 'POST' = 'GET',
        body?: any,
        proxy?: string
    ): Promise<Response> {
        if (url.length > 200) {
            console.debug(`url=${url.substring(0, 200)}...`);
        } else {
            console.debug(`url=${url}`);
        }
        console.debug(`params=${JSON.stringify(params)}`);
        proxy = this.getProxy(proxy);
        
        if ('crumb' in params) {
            throw new Error("Don't manually add 'crumb' to params dict, let yfDataService handle it");
        }

        // Get authentication details
        const [cookie, crumb, strategy] = await this.getCookieAndCrumb(proxy);
        
        // Add crumb to params if available
        const allParams = {...params};
        if (crumb) {
            allParams.crumb = crumb;
        }
        
        // Build URL with parameters
        const urlObj = new URL(url);
        Object.keys(allParams).forEach(key => {
            urlObj.searchParams.append(key, allParams[key]);
        });
        
        // Prepare fetch options
        const fetchOptions: any = {
            method,
            headers: { ...this.userAgentHeaders },
            redirect: 'follow'
        };
        
        // Add cookies for basic strategy
        if (strategy === 'basic' && cookie) {
            fetchOptions.headers.Cookie = `${cookie.name}=${cookie.value}`;
        }
        
        // Add body for POST requests
        if (method === 'POST' && body) {
            if (typeof body === 'object') {
                // Check if it's supposed to be form data
                if (body._isFormData) {
                    fetchOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                    fetchOptions.body = new URLSearchParams(body as any).toString();
                } else {
                    fetchOptions.headers['Content-Type'] = 'application/json';
                    fetchOptions.body = JSON.stringify(body);
                }
            } else {
                fetchOptions.body = body;
            }
        }
        
        // Add proxy if specified
        if (proxy) {
            fetchOptions.agent = new (require('https-proxy-agent'))(proxy);
        }
        
        let response = await fetch(urlObj.toString(), fetchOptions);
        console.debug(`response code=${response.status}`);
        
        // Retry with other cookie strategy if we get an error
        if (response.status >= 400) {
            // Switch strategies
            if (strategy === 'basic') {
                this.setCookieStrategy('csrf');
            } else {
                this.setCookieStrategy('basic');
            }
            
            // Try again with new strategy
            const [newCookie, newCrumb, newStrategy] = await this.getCookieAndCrumb(proxy);
            
            // Update URL with new crumb
            if (newCrumb) {
                urlObj.searchParams.set('crumb', newCrumb);
            }
            
            // Update cookies if using basic strategy
            if (newStrategy === 'basic' && newCookie) {
                fetchOptions.headers.Cookie = `${newCookie.name}=${newCookie.value}`;
            }
            
            response = await fetch(urlObj.toString(), fetchOptions);
            console.debug(`retry response code=${response.status}`);
            
            // Check for rate limiting
            if (response.status === 429) {
                throw new YFRateLimitError();
            }
        }
        
        return response;
    }

    /**
     * Perform GET request
     */
    async get(url: string, params: Record<string, any> = {}, proxy?: string): Promise<Response> {
        return this.makeRequest(url, params, 'GET', undefined, proxy);
    }
    
    /**
     * Perform POST request
     */
    async post(url: string, body: any, params: Record<string, any> = {}, proxy?: string): Promise<Response> {
        return this.makeRequest(url, params, 'POST', body, proxy);
    }
    
    /**
     * Get JSON response from a URL
     */
    async getJson<T = any>(url: string, params: Record<string, any> = {}, proxy?: string): Promise<T> {
        console.debug(`get_json(): ${url}`);
        const response = await this.get(url, params, proxy);
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        
        return await response.json() as T;
    }
    
    /**
     * Get JSON with database caching
     */
    async cachedGetJson<T = any>(
        url: string, 
        params: Record<string, any> = {}, 
        proxy?: string,
        symbol?: string,
        resolution: string = DEFAULT_RESOLUTION
    ): Promise<T> {
        // Extract symbol from URL if not provided
        if (!symbol && url.includes('/finance/')) {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/');
            const lastSegment = pathSegments[pathSegments.length - 1];
            if (lastSegment && !lastSegment.includes('search') && !lastSegment.includes('quote')) {
                symbol = decodeURIComponent(lastSegment);
            } else if (params.symbols) {
                symbol = decodeURIComponent(params.symbols);
            }
        }
        
        // Use database cache for quote and historical data requests
        if (symbol && (
            url.includes('/finance/quote') || 
            url.includes('/finance/chart')
        )) {
            // Check database cache first
            const cachedData = priceCacheDb.getLatestPrice(
                symbol,
                'yahoo',
                CACHE_MAX_AGE_MINUTES
            );
            
            if (cachedData) {
                console.debug(`Using cached data for ${symbol} from database`);
                // Since we're not storing extra_data anymore, we return a basic structure
                return {
                    symbol: symbol,
                    regularMarketPrice: cachedData.price,
                    timestamp: cachedData.timestamp
                } as any as T;
            }
        }
        
        // No cache hit, make actual request
        const result = await this.getJson<T>(url, params, proxy);
        
        // Store in database cache if this is quote or historical data and we have a symbol
        if (symbol && (
            url.includes('/finance/quote') || 
            url.includes('/finance/chart')
        )) {
            try {
                let price: number | null = null;
                const resultObj = result as Record<string, any>;
                
                // Extract price data based on response format
                if (resultObj && typeof resultObj === 'object' && 'quoteResponse' in resultObj) {
                    const quoteResponse = resultObj.quoteResponse as Record<string, any>;
                    if (quoteResponse.result && 
                        Array.isArray(quoteResponse.result) && 
                        quoteResponse.result.length > 0) {
                        price = quoteResponse.result[0].regularMarketPrice;
                    }
                } else if (resultObj && typeof resultObj === 'object' && 'chart' in resultObj) {
                    const chart = resultObj.chart as Record<string, any>;
                    if (chart.result && 
                        Array.isArray(chart.result) && 
                        chart.result.length > 0 &&
                        chart.result[0].meta) {
                        price = chart.result[0].meta.regularMarketPrice;
                    }
                }
                
                if (price !== null) {
                    // Store the price in our new cache format
                    priceCacheDb.storePrice(
                        symbol,
                        price,
                        'yahoo',
                        new Date(),
                        resolution
                    );
                }
            } catch (error) {
                console.error('Failed to cache Yahoo Finance data:', error);
                // Continue with the request even if caching fails
            }
        }
        
        return result;
    }
}

/**
 * Export a singleton instance
 */
export const yfDataService = {
    instance: YfData.getInstance(),
    
    /**
     * Get stock historical data
     * @param symbol Stock ticker symbol
     * @param periodMinutes Duration to fetch in minutes (e.g., 43200 for 30 days)
     * @param intervalMinutes Interval between data points in minutes (e.g., 1440 for daily data)
     */
    async getHistoricalData(symbol: string, periodMinutes: number = 1440, intervalMinutes: number = 1440): Promise<any> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // Determine appropriate cache interval based on the interval minutes
            let cacheInterval: string;
            if (intervalMinutes <= 1) cacheInterval = '1m';
            else if (intervalMinutes <= 5) cacheInterval = '5m';
            else if (intervalMinutes <= 15) cacheInterval = '15m';
            else if (intervalMinutes <= 30) cacheInterval = '30m';
            else if (intervalMinutes <= 60) cacheInterval = '1h';
            else cacheInterval = '1d';
            
            // Convert intervalMinutes and periodMinutes to Yahoo Finance API format strings
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
            
            // Check if we have complete coverage in the database for the requested timeframe
            const hasCompleteData = priceCacheDb.hasCompleteCoverage(
                normalizedSymbol,
                'yahoo',
                intervalMinutes,
                periodMinutes
            );
            
            if (hasCompleteData) {
                console.debug(`Using cached historical data with complete coverage for ${normalizedSymbol}`);
                
                // Get cached data from database
                const endDate = new Date();
                const startDate = new Date(endDate.getTime() - periodMinutes * 60 * 1000);
                
                // Get time series data with the appropriate interval
                const timeSeriesData = priceCacheDb.getTimeSeries(
                    normalizedSymbol,
                    'yahoo',
                    cacheInterval,
                    Math.ceil(periodMinutes / intervalMinutes) * 2, // Get more than needed
                    startDate,
                    endDate
                );
                
                // Format data for API response compatibility
                if (timeSeriesData && timeSeriesData.length > 0) {
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
            } else {
                console.debug(`Incomplete historical data for ${normalizedSymbol}, fetching from API`);
            }
            
            // No adequate cache data, fetch from API
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalizedSymbol)}`;
            const params = {
                period1: 0,
                period2: Math.floor(Date.now() / 1000),
                interval,
                range: period
            };
            
            const result = await this.instance.getJson(url, params);
            
            // Store historical data points in database cache
            if (result &&
                result.chart &&
                result.chart.result && 
                result.chart.result.length > 0) {
                
                const data = result.chart.result[0];
                if (data.timestamp && data.indicators.quote[0].close) {
                    const timestamps = data.timestamp;
                    const prices = data.indicators.quote[0].close;
                    
                    // Create batch of price entries to insert
                    const priceEntries: Array<{
                        symbol: string;
                        price: number;
                        timestamp: Date;
                        source: 'finnhub' | 'yahoo';
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
        } catch (error) {
            console.error(`Failed to get historical data for ${symbol}:`, error);
            throw error;
        }
    },
    
    /**
     * Get stock quote data
     */
    async getQuote(symbol: string): Promise<any> {
        try {
            const normalizedSymbol = symbol.toUpperCase();
            
            // First check the database cache
            const cachedData = priceCacheDb.getLatestPrice(
                normalizedSymbol,
                'yahoo',
                15 // 15 minutes max age
            );
            
            if (cachedData) {
                console.debug(`Using cached quote for ${normalizedSymbol} from database`);
                
                // Simulate a quote response with basic price data
                return {
                    symbol: normalizedSymbol,
                    regularMarketPrice: cachedData.price,
                    regularMarketTime: new Date(cachedData.timestamp).getTime() / 1000,
                    cached: true
                };
            }
            
            // No cache hit, fetch from API
            const url = `https://query1.finance.yahoo.com/v7/finance/quote`;
            const params = {
                symbols: encodeURIComponent(normalizedSymbol)
            };
            
            const response = await this.instance.getJson(url, params);
            
            // Store in database cache if we got a valid response
            if (response.quoteResponse?.result?.[0]?.regularMarketPrice) {
                const quoteData = response.quoteResponse.result[0];
                
                priceCacheDb.storePrice(
                    normalizedSymbol,
                    quoteData.regularMarketPrice,
                    'yahoo',
                    new Date(quoteData.regularMarketTime * 1000),
                    '1m'
                );
                
                console.debug(`Cached quote for ${normalizedSymbol}`);
            }
            
            return response.quoteResponse?.result?.[0] || null;
        } catch (error) {
            console.error(`Failed to get quote for ${symbol}:`, error);
            throw error;
        }
    },
    
    /**
     * Search for symbols
     */
    async searchSymbols(query: string): Promise<any> {
        try {
            const url = 'https://query1.finance.yahoo.com/v1/finance/search';
            const params = {
                q: encodeURIComponent(query),
                quotesCount: 10,
                newsCount: 0
            };
            
            // Search results don't need to be cached at the database level
            const response = await this.instance.cachedGetJson(url, params);
            return response.quotes || [];
        } catch (error) {
            console.error(`Failed to search symbols for "${query}":`, error);
            throw error;
        }
    },
    
    /**
     * Get option chain data
     */
    async getOptionChain(symbol: string): Promise<any> {
        try {
            const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
            // Option chain data is complex and changes frequently - use a shorter cache duration
            return await this.instance.cachedGetJson(url, {}, undefined, symbol, '5m');
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
            // Use the new getTimeSeries method instead of the old getHistoricalPrices
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
     * Clear Yahoo Finance cache
     */
    clearCache(): void {
        console.log("Clearing Yahoo Finance cache older than 1 day");
        priceCacheDb.cleanupCache(1);
    }
};

// Export the error class for use in try-catch blocks
export { YFRateLimitError };