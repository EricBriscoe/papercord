# PaperCord Trading Bot

A Discord bot for paper trading US equities. Users can buy and sell stocks with virtual money, track their portfolio performance, and compete with friends - all within Discord.

## Add to your server:

https://discord.com/oauth2/authorize?client_id=784799291268136980&permissions=2147862592&integration_type=0&scope=bot+applications.commands

## Features

- **Paper Trading**: Buy and sell US stocks with virtual money ($100,000 starting balance)
- **Real-time Data**: Get real-time or delayed stock prices from Finnhub API
- **Portfolio Tracking**: View your current positions, profits/losses, and cash balance
- **Transaction History**: Check your past trades
- **Stock Price Check**: Look up current stock prices
- **Account Reset**: Reset your account back to the starting balance
- **Caching**: Stock price caching system to reduce API calls with configurable expiration time
- **Advanced Sorting**: Sort your portfolio by symbol, market value, profit/loss, or percent change

## Commands

The bot uses Discord slash commands:

- `/buy symbol: AAPL quantity: 10` - Buy shares of a stock
- `/sell symbol: AAPL quantity: 5` - Sell shares of a stock
- `/price symbol: AAPL` - Check the current price of a stock
- `/portfolio` - View your current portfolio with profits/losses and sorting options
- `/history limit: 10` - View your transaction history (default 10 transactions, max 25)
- `/reset confirm: confirm` - Reset your account back to $100,000 (Must type "confirm")

## Setup Options

### Local Installation

#### Prerequisites

- Node.js (v16 or higher)
- Discord Bot Token
- Finnhub API Key (optional, but recommended)

#### Installation

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file in the root directory with:
   ```
   DISCORD_TOKEN=your_discord_bot_token_here
   FINNHUB_API_KEY=your_finnhub_api_key_here
   PRICE_CACHE_EXPIRATION_SECONDS=60
   ```
4. Build the project:
   ```
   npm run build
   ```
5. Start the bot:
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
  -e PRICE_CACHE_EXPIRATION_SECONDS=60 \
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
- Build: `npm run build`
- Build Docker image: `docker build -t papercord .`

## Tech Stack

- TypeScript
- Discord.js
- SQLite (better-sqlite3)
- Finnhub API
- Docker

## License

ISC