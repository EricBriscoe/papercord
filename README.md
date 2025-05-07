# 🚀 PaperCord - Stock Market Trading Simulator for Discord

**Trade stocks and options with ZERO financial risk!** PaperCord lets you experience the thrill of stock market trading without risking real money. Compete with friends, learn investing strategies, and have fun - all within your Discord server!

## ✨ Why You Need This Bot

- 💰 Start with $100,000 virtual cash
- 📈 Buy and sell real stocks with live market data
- 🏆 Compete on a server-wide leaderboard
- 📊 Track your portfolio performance in real-time
- 🔄 Practice trading strategies risk-free
- 🎓 Learn how options trading works
- 🎮 Make finance fun and competitive!

## 🔗 Add to Your Server Now!

[**Click Here to Add PaperCord to Your Server**](https://discord.com/oauth2/authorize?client_id=784799291268136980&permissions=2147862592&integration_type=0&scope=bot+applications.commands)

## 💼 Available Commands

### Stock Trading
- `/buy symbol: AAPL quantity: 10` - Buy shares of a stock
- `/sell symbol: AAPL quantity: 5` - Sell shares of a stock
- `/price symbol: AAPL` - Check the current price of a stock
- `/portfolio` - View your current stocks with profits/losses
- `/history limit: 10` - View your transaction history

### Options Trading
- `/trade_option` - Buy or sell option contracts
- `/price_option` - Calculate the price of an options contract
- `/options_portfolio` - View your options positions
- `/close_option` - Close an existing options position
- `/margin` - Check your available margin for options trading

### Account Management
- `/reset confirm: confirm` - Reset your account back to $100,000
- `/leaderboard` - See who has the highest portfolio value in your server

## 🎮 Quick Start Guide

1. Add the bot to your server using the link above
2. Check a stock price with `/price symbol: QQQ`
3. Buy your first shares with `/buy symbol: QQQ quantity: 10`
4. Track your portfolio with `/portfolio`
5. Compete with friends and check the `/leaderboard`

## Self Hostable!

### Local Installation

#### Prerequisites

- Node.js (v16 or higher)
- Python 3.8+ (for Yahoo Finance data)
- Discord Bot Token
- Finnhub API Key (optional, but recommended)

#### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a Python virtual environment and install requirements:
   ```
   python3 -m venv venv
   source venv/bin/activate
   pip install yfinance flask
   ```
4. Create a `.env` file in the root directory with:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   FINNHUB_API_KEY=your_finnhub_api_key_here
   YF_PYTHON_SERVICE_URL=http://localhost:3001
   ```
5. Build the project:
   ```
   npm run build
   ```
6. Start the Yahoo Finance Python service:
   ```
   npm run start-yf-service-bg
   ```
7. Start the bot:
   ```
   npm start
   ```

### Docker Deployment

You can also run the bot using Docker:

```bash
docker pull ghcr.io/ericbriscoe/papercord:latest

# Run the container
docker run -d \
  --name papercord \
  -e DISCORD_TOKEN=your_discord_bot_token \
  -e FINNHUB_API_KEY=your_finnhub_api_key \
  -e YF_PYTHON_SERVICE_URL=http://localhost:3001 \
  -v /path/to/data:/app/data \
  ghcr.io/ericbriscoe/papercord:latest
```

Or use Docker Compose (see the `docker-compose.yml` file in the repository).

### Getting API Keys

- **Discord Bot Token**: 
  1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
  2. Create a new application
  3. Go to the Bot tab and click "Add Bot"
  4. Copy the token

- **Finnhub API Key**:
  1. Register at [Finnhub](https://finnhub.io/)
  2. Get your API key from the dashboard

## Development

- Run in development mode: `npm run dev`
- Start Yahoo Finance service: `npm run start-yf-service`
- Start Yahoo Finance service in background: `npm run start-yf-service-bg` 
- Install Yahoo Finance service as systemd service: `npm run install-yf-service`
- Stop Yahoo Finance service: `npm run stop-yf-service`
- Build: `npm run build`
- Build Docker image: `docker build -t papercord .`

## Yahoo Finance API Optimization

To prevent rate limiting and ensure reliable data access, PaperCord implements several optimizations:

- **Multi-level Caching**: Tiered caching system with different TTLs for different data types
- **Rate Limiting**: Automatic request throttling to stay within API limits
- **Request Batching**: Process multiple symbols in a single request
- **Database Caching**: Persistent storage of historical price data
- **Request Deduplication**: Prevents duplicate API calls for the same data
- **Exponential Backoff**: Smart retry logic for failed requests

For more details, see the [Yahoo Finance Service Optimization](src/python_services/README.md) documentation.

## Tech Stack

- TypeScript
- Discord.js
- SQLite (better-sqlite3)
- Finnhub API
- Python / yfinance (for Yahoo Finance data)
- Flask (Python web framework)
- Docker
- cachetools (for TTL caching)

## License

ISC
