#!/usr/bin/env python3
"""
Yahoo Finance Service

This module provides a Flask-based API for fetching data from Yahoo Finance 
using the yfinance library. It includes caching, rate limiting, and request batching
to minimize API calls and avoid rate limiting.
"""

import os
import json
import logging
import time
import threading
import functools
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Callable, TypeVar, Tuple
from flask import Flask, request, jsonify
import yfinance as yf
from cachetools import TTLCache, cached
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Cache settings with tiered expiration times
CACHE_SETTINGS = {
    'QUOTE': 5 * 60,           # 5 minutes for quotes
    'HISTORICAL': 24 * 60 * 60, # 24 hours for historical data
    'OPTIONS': 6 * 60 * 60,     # 6 hours for options data
    'DIVIDENDS': 7 * 24 * 60 * 60, # 7 days for dividend data
    'SEARCH': 24 * 60 * 60      # 24 hours for search results
}

# Create caches for different data types
quote_cache = TTLCache(maxsize=1000, ttl=CACHE_SETTINGS['QUOTE'])
historical_cache = TTLCache(maxsize=500, ttl=CACHE_SETTINGS['HISTORICAL'])
options_cache = TTLCache(maxsize=500, ttl=CACHE_SETTINGS['OPTIONS'])
dividends_cache = TTLCache(maxsize=500, ttl=CACHE_SETTINGS['DIVIDENDS'])
search_cache = TTLCache(maxsize=1000, ttl=CACHE_SETTINGS['SEARCH'])

# Rate limiting settings
MAX_REQUESTS_PER_MINUTE = 100
REQUEST_WINDOW_SECONDS = 60
request_timestamps = []
request_lock = threading.Lock()

# Batch processing settings
BATCH_SIZE = 10  # Maximum number of symbols to process in a single batch
batch_queue = {}
batch_results = {}
batch_lock = threading.Lock()

# Configure requests with retry logic
def create_session():
    """Create a requests session with retry logic"""
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"]
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session

# Create a session for yfinance to use
yf_session = create_session()
yf.set_tz_session_object(yf_session)

# Type variable for generic function
T = TypeVar('T')

def rate_limited(func: Callable[..., T]) -> Callable[..., T]:
    """Decorator to apply rate limiting to a function"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        with request_lock:
            current_time = time.time()
            # Remove timestamps older than the window
            global request_timestamps
            request_timestamps = [ts for ts in request_timestamps 
                                if current_time - ts < REQUEST_WINDOW_SECONDS]
            
            # Check if we've hit the rate limit
            if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
                oldest = min(request_timestamps)
                sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
                if sleep_time > 0:
                    logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                    time.sleep(sleep_time)
            
            # Add current timestamp
            request_timestamps.append(time.time())
        
        # Call the original function
        return func(*args, **kwargs)
    return wrapper

@app.route('/health', methods=['GET'])
def health_check():
    """Basic health check endpoint."""
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})

def get_ticker_quote(symbol: str) -> Dict[str, Any]:
    """Get quote data for a single ticker with caching"""
    # Check cache first
    cache_key = f"quote:{symbol.upper()}"
    if cache_key in quote_cache:
        logger.debug(f"Cache hit for quote:{symbol}")
        return quote_cache[cache_key]
    
    # Apply rate limiting
    with request_lock:
        current_time = time.time()
        # Remove timestamps older than the window
        global request_timestamps
        request_timestamps = [ts for ts in request_timestamps 
                            if current_time - ts < REQUEST_WINDOW_SECONDS]
        
        # Check if we've hit the rate limit
        if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            oldest = min(request_timestamps)
            sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
            if sleep_time > 0:
                logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                time.sleep(sleep_time)
        
        # Add current timestamp
        request_timestamps.append(time.time())
    
    # Fetch from Yahoo Finance
    try:
        ticker = yf.Ticker(symbol)
        quote_data = ticker.info
        
        # Format the response
        result = {
            "symbol": symbol,
            "regularMarketPrice": quote_data.get("regularMarketPrice"),
            "regularMarketTime": quote_data.get("regularMarketTime"),
            "previousClose": quote_data.get("previousClose"),
            "marketCap": quote_data.get("marketCap"),
            "currency": quote_data.get("currency")
        }
        
        # Cache the result
        quote_cache[cache_key] = result
        return result
    except Exception as e:
        logger.error(f"Error fetching quote for {symbol}: {e}")
        raise

@app.route('/quote', methods=['GET'])
def get_quote():
    """Get current stock quote information."""
    symbol = request.args.get('symbol')
    symbols = request.args.get('symbols')  # Support for batch requests
    
    if not symbol and not symbols:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Handle single symbol request
        if symbol:
            result = get_ticker_quote(symbol)
            return jsonify(result)
        
        # Handle batch request
        if symbols:
            symbol_list = symbols.split(',')
            results = {}
            
            # Process symbols in batches to avoid rate limiting
            for i in range(0, len(symbol_list), BATCH_SIZE):
                batch = symbol_list[i:i+BATCH_SIZE]
                for s in batch:
                    try:
                        results[s] = get_ticker_quote(s)
                    except Exception as e:
                        results[s] = {"error": str(e)}
            
            return jsonify({"quotes": results})
    except Exception as e:
        logger.error(f"Error in quote endpoint: {e}")
        return jsonify({"error": str(e)}), 500

def get_ticker_historical(symbol: str, period: str, interval: str) -> Dict[str, Any]:
    """Get historical data for a single ticker with caching"""
    # Check cache first
    cache_key = f"historical:{symbol.upper()}:{period}:{interval}"
    if cache_key in historical_cache:
        logger.debug(f"Cache hit for {cache_key}")
        return historical_cache[cache_key]
    
    # Apply rate limiting
    with request_lock:
        current_time = time.time()
        # Remove timestamps older than the window
        global request_timestamps
        request_timestamps = [ts for ts in request_timestamps 
                            if current_time - ts < REQUEST_WINDOW_SECONDS]
        
        # Check if we've hit the rate limit
        if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            oldest = min(request_timestamps)
            sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
            if sleep_time > 0:
                logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                time.sleep(sleep_time)
        
        # Add current timestamp
        request_timestamps.append(time.time())
    
    # Fetch from Yahoo Finance
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        
        # Format the response to match the expected structure
        timestamps = hist.index.astype('int64') // 10**9  # Convert to Unix timestamp
        
        result = {
            "chart": {
                "result": [{
                    "meta": {
                        "currency": ticker.info.get("currency", "USD"),
                        "symbol": symbol,
                        "regularMarketPrice": ticker.info.get("regularMarketPrice"),
                        "previousClose": ticker.info.get("previousClose")
                    },
                    "timestamp": timestamps.tolist(),
                    "indicators": {
                        "quote": [{
                            "close": hist['Close'].tolist(),
                            "open": hist['Open'].tolist(),
                            "high": hist['High'].tolist(),
                            "low": hist['Low'].tolist(),
                            "volume": hist['Volume'].tolist()
                        }]
                    }
                }]
            }
        }
        
        # Cache the result
        historical_cache[cache_key] = result
        return result
    except Exception as e:
        logger.error(f"Error fetching historical data for {symbol}: {e}")
        raise

@app.route('/historical', methods=['GET'])
def get_historical():
    """Get historical price data."""
    symbol = request.args.get('symbol')
    symbols = request.args.get('symbols')  # Support for batch requests
    period = request.args.get('period', '30d')
    interval = request.args.get('interval', '1d')
    
    if not symbol and not symbols:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Handle single symbol request
        if symbol:
            result = get_ticker_historical(symbol, period, interval)
            return jsonify(result)
        
        # Handle batch request
        if symbols:
            symbol_list = symbols.split(',')
            results = {}
            
            # Process symbols in batches to avoid rate limiting
            for i in range(0, len(symbol_list), BATCH_SIZE):
                batch = symbol_list[i:i+BATCH_SIZE]
                for s in batch:
                    try:
                        results[s] = get_ticker_historical(s, period, interval)
                    except Exception as e:
                        results[s] = {"error": str(e)}
            
            return jsonify({"charts": results})
    except Exception as e:
        logger.error(f"Error in historical endpoint: {e}")
        return jsonify({"error": str(e)}), 500

def search_for_symbols(query: str) -> List[Dict[str, Any]]:
    """Search for symbols based on a query with caching"""
    # Check cache first
    cache_key = f"search:{query.lower()}"
    if cache_key in search_cache:
        logger.debug(f"Cache hit for {cache_key}")
        return search_cache[cache_key]
    
    # Apply rate limiting
    with request_lock:
        current_time = time.time()
        # Remove timestamps older than the window
        global request_timestamps
        request_timestamps = [ts for ts in request_timestamps 
                            if current_time - ts < REQUEST_WINDOW_SECONDS]
        
        # Check if we've hit the rate limit
        if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            oldest = min(request_timestamps)
            sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
            if sleep_time > 0:
                logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                time.sleep(sleep_time)
        
        # Add current timestamp
        request_timestamps.append(time.time())
    
    # Fetch from Yahoo Finance
    try:
        tickers = yf.Tickers(query)
        results = []
        
        # For each ticker that was successfully fetched, add to results
        for symbol, ticker in tickers.tickers.items():
            try:
                info = ticker.info
                if info and 'shortName' in info:
                    results.append({
                        "symbol": symbol,
                        "shortname": info.get('shortName'),
                        "longname": info.get('longName'),
                        "exchange": info.get('exchange'),
                        "quoteType": info.get('quoteType')
                    })
            except:
                # Skip tickers that cause errors
                pass
        
        # Cache the result
        search_cache[cache_key] = results
        return results
    except Exception as e:
        logger.error(f"Error searching for symbols with query '{query}': {e}")
        raise

@app.route('/search', methods=['GET'])
def search_symbols():
    """Search for symbols based on a query."""
    query = request.args.get('query')
    
    if not query:
        return jsonify({"error": "Query parameter is required"}), 400
    
    try:
        results = search_for_symbols(query)
        return jsonify({"quotes": results})
    except Exception as e:
        logger.error(f"Error in search endpoint: {e}")
        return jsonify({"error": str(e)}), 500

def get_ticker_options(symbol: str, expiration: Optional[str] = None) -> Dict[str, Any]:
    """Get options data for a single ticker with caching"""
    # Check cache first
    cache_key = f"options:{symbol.upper()}:{expiration or 'first'}"
    if cache_key in options_cache:
        logger.debug(f"Cache hit for {cache_key}")
        return options_cache[cache_key]
    
    # Apply rate limiting
    with request_lock:
        current_time = time.time()
        # Remove timestamps older than the window
        global request_timestamps
        request_timestamps = [ts for ts in request_timestamps 
                            if current_time - ts < REQUEST_WINDOW_SECONDS]
        
        # Check if we've hit the rate limit
        if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            oldest = min(request_timestamps)
            sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
            if sleep_time > 0:
                logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                time.sleep(sleep_time)
        
        # Add current timestamp
        request_timestamps.append(time.time())
    
    # Fetch from Yahoo Finance
    try:
        ticker = yf.Ticker(symbol)
        
        # Get option expiration dates
        expirations = ticker.options
        
        if not expirations:
            raise ValueError(f"No options available for {symbol}")
        
        # Use specified expiration or default to first available
        exp_date = expiration if expiration and expiration in expirations else expirations[0]
        
        # Get option chain for the selected expiration date
        option_chain = ticker.option_chain(exp_date)
        calls = option_chain.calls
        puts = option_chain.puts
        
        # Format to match the expected structure
        result = {
            "optionChain": {
                "result": [{
                    "expirationDates": [int(datetime.strptime(exp, "%Y-%m-%d").timestamp()) for exp in expirations],
                    "strikes": sorted(set(calls['strike'].tolist() + puts['strike'].tolist())),
                    "calls": calls.to_dict(orient='records'),
                    "puts": puts.to_dict(orient='records')
                }]
            }
        }
        
        # Cache the result
        options_cache[cache_key] = result
        return result
    except Exception as e:
        logger.error(f"Error fetching options for {symbol}: {e}")
        raise

@app.route('/options', methods=['GET'])
def get_options():
    """Get option chain data for a symbol."""
    symbol = request.args.get('symbol')
    expiration = request.args.get('expiration')  # Optional expiration date
    
    if not symbol:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        result = get_ticker_options(symbol, expiration)
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        logger.error(f"Error in options endpoint: {e}")
        return jsonify({"error": str(e)}), 500

def get_ticker_dividends(symbol: str, period: str = '5y') -> Dict[str, Any]:
    """Get dividend data for a single ticker with caching"""
    # Check cache first
    cache_key = f"dividends:{symbol.upper()}:{period}"
    if cache_key in dividends_cache:
        logger.debug(f"Cache hit for {cache_key}")
        return dividends_cache[cache_key]
    
    # Apply rate limiting
    with request_lock:
        current_time = time.time()
        # Remove timestamps older than the window
        global request_timestamps
        request_timestamps = [ts for ts in request_timestamps 
                            if current_time - ts < REQUEST_WINDOW_SECONDS]
        
        # Check if we've hit the rate limit
        if len(request_timestamps) >= MAX_REQUESTS_PER_MINUTE:
            oldest = min(request_timestamps)
            sleep_time = REQUEST_WINDOW_SECONDS - (current_time - oldest)
            if sleep_time > 0:
                logger.warning(f"Rate limit reached, sleeping for {sleep_time:.2f} seconds")
                time.sleep(sleep_time)
        
        # Add current timestamp
        request_timestamps.append(time.time())
    
    # Fetch from Yahoo Finance
    try:
        ticker = yf.Ticker(symbol)
        dividends = ticker.dividends
        
        # Get basic dividend info from the ticker info
        dividend_info = {
            "symbol": symbol,
            "dividendRate": ticker.info.get("dividendRate"),
            "dividendYield": ticker.info.get("dividendYield"),
            "exDividendDate": ticker.info.get("exDividendDate"),
            "payoutRatio": ticker.info.get("payoutRatio"),
            "fiveYearAvgDividendYield": ticker.info.get("fiveYearAvgDividendYield")
        }
        
        # Format dividend history
        dividend_history = []
        if not dividends.empty:
            for date, amount in dividends.items():
                dividend_history.append({
                    "date": date.strftime('%Y-%m-%d'),
                    "timestamp": int(date.timestamp()),
                    "amount": float(amount)
                })
            
            # Sort by date (newest first)
            dividend_history.sort(key=lambda x: x["timestamp"], reverse=True)
        
        result = {
            "info": dividend_info,
            "history": dividend_history
        }
        
        if not dividends.empty:
            result["message"] = f"Found {len(dividend_history)} dividend records"
        else:
            result["message"] = "No dividend history found for this symbol"
        
        # Cache the result
        dividends_cache[cache_key] = result
        return result
    except Exception as e:
        logger.error(f"Error fetching dividend data for {symbol}: {e}")
        raise

@app.route('/dividends', methods=['GET'])
def get_dividends():
    """Get dividend history for a symbol."""
    symbol = request.args.get('symbol')
    symbols = request.args.get('symbols')  # Support for batch requests
    period = request.args.get('period', '5y')  # Default to 5 years of history
    
    if not symbol and not symbols:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Handle single symbol request
        if symbol:
            result = get_ticker_dividends(symbol, period)
            return jsonify(result)
        
        # Handle batch request
        if symbols:
            symbol_list = symbols.split(',')
            results = {}
            
            # Process symbols in batches to avoid rate limiting
            for i in range(0, len(symbol_list), BATCH_SIZE):
                batch = symbol_list[i:i+BATCH_SIZE]
                for s in batch:
                    try:
                        results[s] = get_ticker_dividends(s, period)
                    except Exception as e:
                        results[s] = {"error": str(e)}
            
            return jsonify({"dividends": results})
    except Exception as e:
        logger.error(f"Error in dividends endpoint: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    app.run(host='0.0.0.0', port=port, debug=True)
