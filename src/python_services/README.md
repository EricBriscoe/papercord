# Yahoo Finance Service Optimization

This document outlines the optimizations implemented to minimize Yahoo Finance API usage and avoid rate limiting.

## Overview

The Yahoo Finance service provides stock price data, historical data, options chains, and dividend information through the `yfinance` Python library. To minimize API calls and avoid rate limiting, we've implemented several optimization strategies:

## Optimization Strategies

### 1. Multi-level Caching

#### Python Service Caching
- **Tiered TTL Caching**: Different data types have different cache expiration times:
  - Quotes: 5 minutes
  - Historical data: 24 hours
  - Options data: 6 hours
  - Dividend data: 7 days
  - Search results: 24 hours

#### TypeScript Service Caching
- **In-memory Request Deduplication**: Prevents duplicate requests for the same data within short time windows
- **Database Caching**: Stores historical price data in SQLite for reuse
- **Volatility Caching**: Caches calculated volatility values for 24 hours
- **Dividend Yield Caching**: Caches dividend yield data for 7 days

### 2. Rate Limiting and Request Management

- **Rate Limiting**: Limits requests to 100 per minute
- **Request Throttling**: Automatically sleeps when approaching rate limits
- **Exponential Backoff**: Retries failed requests with increasing delays
- **Request Batching**: Processes multiple symbols in a single batch

### 3. Batch Processing

- **Multi-Symbol Endpoints**: All endpoints support fetching data for multiple symbols in a single request
- **Batch Size Control**: Processes symbols in configurable batch sizes (default: 10)

### 4. Optimized Data Retrieval

- **Minimal Data Fetching**: Only fetches the data needed for specific calculations
- **Incremental Updates**: Only fetches new data points since the last update
- **Data Reuse**: Reuses data across different calculations when possible

## API Endpoints

The service provides the following endpoints:

- `/quote`: Get current stock quote information
- `/historical`: Get historical price data
- `/options`: Get option chain data
- `/dividends`: Get dividend history and yield information
- `/search`: Search for symbols based on a query
- `/health`: Basic health check endpoint

## Usage Examples

### Batch Requests

Fetch quotes for multiple symbols in a single request:

```
GET /quote?symbols=AAPL,MSFT,GOOG
```

### Historical Data with Caching

```
GET /historical?symbol=AAPL&period=1mo&interval=1d
```

## Dependencies

- Flask: Web framework
- yfinance: Yahoo Finance API wrapper
- cachetools: TTL cache implementation
- requests: HTTP client with retry capabilities

## Maintenance

The service includes automatic cache cleanup to prevent excessive memory usage. The database cache is also periodically pruned to remove old data.
