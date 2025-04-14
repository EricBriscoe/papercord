#!/usr/bin/env python3
"""
Yahoo Finance Service

This module provides a Flask-based API for fetching data from Yahoo Finance 
using the yfinance library. It replaces the TypeScript implementation with
a more reliable and simpler Python solution.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
import yfinance as yf

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Set default cache timeout (same as in TypeScript implementation)
CACHE_MAX_AGE_MINUTES = 15

@app.route('/health', methods=['GET'])
def health_check():
    """Basic health check endpoint."""
    return jsonify({"status": "ok", "timestamp": datetime.now().isoformat()})

@app.route('/quote', methods=['GET'])
def get_quote():
    """Get current stock quote information."""
    symbol = request.args.get('symbol')
    if not symbol:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Use yfinance to fetch the ticker data
        ticker = yf.Ticker(symbol)
        quote_data = ticker.info
        
        # Return the essential quote information
        return jsonify({
            "symbol": symbol,
            "regularMarketPrice": quote_data.get("regularMarketPrice"),
            "regularMarketTime": quote_data.get("regularMarketTime"),
            "previousClose": quote_data.get("previousClose"),
            "marketCap": quote_data.get("marketCap"),
            "currency": quote_data.get("currency")
        })
    except Exception as e:
        logger.error(f"Error fetching quote for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/historical', methods=['GET'])
def get_historical():
    """Get historical price data."""
    symbol = request.args.get('symbol')
    period = request.args.get('period', '30d')
    interval = request.args.get('interval', '1d')
    
    if not symbol:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Use yfinance to fetch historical data
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
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error fetching historical data for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/search', methods=['GET'])
def search_symbols():
    """Search for symbols based on a query."""
    query = request.args.get('query')
    
    if not query:
        return jsonify({"error": "Query parameter is required"}), 400
    
    try:
        # This is a simple approach - yfinance doesn't have a direct search API
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
                
        return jsonify({"quotes": results})
    except Exception as e:
        logger.error(f"Error searching for symbols with query '{query}': {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/options', methods=['GET'])
def get_options():
    """Get option chain data for a symbol."""
    symbol = request.args.get('symbol')
    
    if not symbol:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Use yfinance to fetch option chain data
        ticker = yf.Ticker(symbol)
        
        # Get option expiration dates
        expirations = ticker.options
        
        if not expirations:
            return jsonify({"error": "No options available for this symbol"}), 404
        
        # Get option chain for the first expiration date
        # You could modify this to handle specific dates
        expiration = expirations[0]
        calls = ticker.option_chain(expiration).calls
        puts = ticker.option_chain(expiration).puts
        
        # Format to match the expected structure
        return jsonify({
            "optionChain": {
                "result": [{
                    "expirationDates": [int(datetime.strptime(exp, "%Y-%m-%d").timestamp()) for exp in expirations],
                    "strikes": sorted(set(calls['strike'].tolist() + puts['strike'].tolist())),
                    "calls": calls.to_dict(orient='records'),
                    "puts": puts.to_dict(orient='records')
                }]
            }
        })
    except Exception as e:
        logger.error(f"Error fetching options for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/dividends', methods=['GET'])
def get_dividends():
    """Get dividend history for a symbol."""
    symbol = request.args.get('symbol')
    period = request.args.get('period', '5y')  # Default to 5 years of history
    
    if not symbol:
        return jsonify({"error": "Symbol parameter is required"}), 400
    
    try:
        # Use yfinance to fetch dividend data
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
        if not dividends.empty:
            dividend_history = []
            for date, amount in dividends.items():
                dividend_history.append({
                    "date": date.strftime('%Y-%m-%d'),
                    "timestamp": int(date.timestamp()),
                    "amount": float(amount)
                })
            
            # Sort by date (newest first)
            dividend_history.sort(key=lambda x: x["timestamp"], reverse=True)
            
            return jsonify({
                "info": dividend_info,
                "history": dividend_history
            })
        else:
            return jsonify({
                "info": dividend_info,
                "history": [],
                "message": "No dividend history found for this symbol"
            })
            
    except Exception as e:
        logger.error(f"Error fetching dividend data for {symbol}: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    app.run(host='0.0.0.0', port=port, debug=True)