import { Client, Events, GatewayIntentBits, REST, Routes, Collection, DiscordAPIError } from 'discord.js';
import dotenv from 'dotenv';
import { buyCommand } from './commands/buy';
import { sellCommand } from './commands/sell';
import { portfolioCommand } from './commands/portfolio';
import { priceCommand } from './commands/price';
import { historyCommand } from './commands/history';
import { resetCommand } from './commands/reset';
import { priceOptionCommand } from './commands/price_option';
import { tradeOptionCommand } from './commands/trade_option';
import { optionsPortfolioCommand } from './commands/options_portfolio';
import { closeOptionCommand } from './commands/close_option';
import { leaderboardCommand } from './commands/leaderboard';
import { cryptoBuyCommand } from './commands/crypto_buy';
import { cryptoSellCommand } from './commands/crypto_sell';
import { cryptoPriceCommand } from './commands/crypto_price';
import { marginCommand } from './commands/margin';
import { sudoCommand } from './commands/sudo';
import { Command } from './models/command';
import { optionsService } from './services/optionsService';
import { optionsDb } from './database/operations';
import type { CryptoPosition } from './database/operations';

// Load environment variables
dotenv.config();

/**
 * Global error handler for unhandled promise rejections
 * Specially handles Discord API interaction errors which can occur when
 * interactions expire or are handled multiple times
 */
process.on('unhandledRejection', (error) => {
  if (error instanceof DiscordAPIError && error.code === 10062) {
    console.log('An interaction expired or was already handled. This is expected sometimes:');
    console.log(`Error details: ${error.message}`);
    return;
  }
  
  console.error('Unhandled promise rejection:', error);
});

// Initialize Discord client with required gateway intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// Command registry collection
const commands = new Collection<string, Command>();

/**
 * Register all available commands, grouped by category:
 * - Basic trading commands (buy, sell, portfolio, etc.)
 * - Options trading commands (price options, trade options, etc.)
 * - Crypto trading commands (crypto buy/sell/price)
 * - Margin and administrative commands
 */
[
    // Basic trading
    buyCommand, sellCommand, portfolioCommand, priceCommand, 
    historyCommand, resetCommand,
    // Options trading
    priceOptionCommand, tradeOptionCommand, 
    optionsPortfolioCommand, closeOptionCommand,
    // Crypto trading
    cryptoBuyCommand, cryptoSellCommand, cryptoPriceCommand,
    // Other commands
    marginCommand, leaderboardCommand, sudoCommand
].forEach(command => {
    commands.set(command.name, command);
});

// Bot initialization and scheduled task setup
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
    
    try {
        // Register slash commands with Discord API
        const commandData = Array.from(commands.values()).map(command => ({
            name: command.name,
            description: command.description,
            options: command.options
        }));
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || '');
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commandData }
        );
        
        console.log('Successfully reloaded application (/) commands.');
        
        /**
         * Schedule daily job (24h) to process expired options contracts
         * This ensures options that have passed their expiration date are properly
         * settled according to their final intrinsic value
         */
        setInterval(async () => {
            try {
                console.log('Checking for expired options...');
                const result = await optionsService.processExpiredOptions();
                if (result.processed > 0) {
                    console.log(`Processed ${result.processed} expired options, created ${result.marginCalls} margin calls.`);
                }
            } catch (error) {
                console.error('Error processing expired options:', error);
            }
        }, 86400000); // 24 hours
        
        /**
         * Schedule 4-hour job to monitor margin status and issue warnings
         * This provides users with notifications when their positions are at risk
         */
        setInterval(async () => {
            try {
                console.log('Checking margin warnings and notifications...');
                const usersWithOpenPositions = optionsDb.getUsersWithOpenPositions();
                let warningsIssued = 0;
                let callsIssued = 0;
                
                for (const userId of usersWithOpenPositions) {
                    const result = await optionsService.processMarginCalls(userId);
                    if (result.message.includes('Warning issued')) {
                        warningsIssued++;
                        console.log(`Margin warning for user ${userId}: ${result.message}`);
                    } else if (result.message.includes('Margin call issued')) {
                        callsIssued++;
                        console.log(`Margin call for user ${userId}: ${result.message}`);
                    }
                }
                
                if (warningsIssued > 0 || callsIssued > 0) {
                    console.log(`Issued ${warningsIssued} margin warnings and ${callsIssued} margin calls.`);
                }
            } catch (error) {
                console.error('Error processing margin checks:', error);
            }
        }, 14400000); // 4 hours
        
        /**
         * Schedule hourly job to automatically liquidate positions for severe margin violations
         * Positions are liquidated when equity ratio falls below 20%
         */
        setInterval(async () => {
            try {
                console.log('Processing liquidations for severe margin violations...');
                const usersWithOpenPositions = optionsDb.getUsersWithOpenPositions();
                let totalLiquidated = 0;
                
                for (const userId of usersWithOpenPositions) {
                    const marginStatus = await optionsService.calculateMarginStatus(userId);
                    const equityRatio = marginStatus.equityRatio || 
                        ((marginStatus.portfolioValue - marginStatus.marginUsed) / marginStatus.portfolioValue);
                    
                    if (equityRatio <= 0.2) {
                        const result = await optionsService.processMarginCalls(userId);
                        if (result.positionsLiquidated && result.positionsLiquidated > 0) {
                            console.log(`Liquidated ${result.positionsLiquidated} positions for user ${userId}. ${result.message}`);
                            totalLiquidated += result.positionsLiquidated;
                        }
                    }
                }
                
                if (totalLiquidated > 0) {
                    console.log(`Total positions liquidated: ${totalLiquidated}`);
                }
            } catch (error) {
                console.error('Error processing liquidations:', error);
            }
        }, 3600000); // 1 hour
        
        /**
         * Function to clean up small-value "dust" crypto positions and delisted cryptos
         * Processes all users with crypto holdings to maintain clean portfolios
         */
        const cleanupCryptoPositions = async () => {
            try {
                console.log('Cleaning up worthless crypto positions...');
                const { cryptoTradingService } = await import('./services/cryptoTradingService');
                const { userDb } = await import('./database/operations');
                
                const usersWithCrypto = userDb.getUsersWithCryptoPositions();
                let totalPositionsLiquidated = 0;
                let totalValueCredited = 0;
                let delistedPositionsLiquidated = 0;
                
                for (const userId of usersWithCrypto) {
                    const result = await cryptoTradingService.cleanupWorthlessPositions(userId);
                    
                    if (result.success && result.positionsLiquidated > 0) {
                        console.log(`Cleaned up ${result.positionsLiquidated} worthless crypto positions for user ${userId}`);
                        console.log(result.message);
                        
                        totalPositionsLiquidated += result.positionsLiquidated;
                        totalValueCredited += result.totalCredited;
                        
                        if (result.message.includes('delisted') || result.message.includes('100% loss')) {
                            delistedPositionsLiquidated++;
                        }
                    }
                }
                
                if (totalPositionsLiquidated > 0) {
                    console.log(`Total crypto positions liquidated: ${totalPositionsLiquidated}, total value credited: ${totalValueCredited.toFixed(2)} USD`);
                    if (delistedPositionsLiquidated > 0) {
                        console.log(`Included ${delistedPositionsLiquidated} delisted cryptocurrencies liquidated at 100% loss`);
                    }
                } else {
                    console.log('No worthless crypto positions were found that needed cleanup');
                }
            } catch (error) {
                console.error('Error cleaning up worthless crypto positions:', error);
            }
        };
        
        /**
         * Function to specifically check for and handle delisted cryptocurrencies
         * This prevents users from retaining value in cryptocurrencies that no longer exist
         */
        const checkForDelistedCryptos = async () => {
            try {
                console.log('Checking for delisted cryptocurrencies...');
                const { cryptoTradingService } = await import('./services/cryptoTradingService');
                const { cryptoPortfolioDb, userDb } = await import('./database/operations');
                
                // Collect all positions across all users
                const allPositions: CryptoPosition[] = [];
                const usersWithCrypto = userDb.getUsersWithCryptoPositions();
                
                for (const userId of usersWithCrypto) {
                    const userPositions = cryptoPortfolioDb.getUserPortfolio(userId);
                    allPositions.push(...userPositions);
                }
                
                // Get unique coin IDs for checking
                const uniqueCoinIds = [...new Set(allPositions.map(p => p.coinId))];
                console.log(`Checking ${uniqueCoinIds.length} unique cryptocurrencies for delisting status`);
                
                let delistedCoins = 0;
                
                for (const coinId of uniqueCoinIds) {
                    const delistedCheck = await cryptoTradingService.isDelistedCoin(coinId);
                    
                    if (delistedCheck.delisted) {
                        console.log(`Found delisted cryptocurrency: ${coinId} - ${delistedCheck.message}`);
                        delistedCoins++;
                        
                        // Find affected users and process their positions
                        const affectedUsers = [...new Set(allPositions
                            .filter(p => p.coinId === coinId)
                            .map(p => p.userId))];
                        
                        console.log(`${affectedUsers.length} users hold delisted cryptocurrency ${coinId}`);
                        
                        for (const userId of affectedUsers) {
                            await cryptoTradingService.cleanupWorthlessPositions(userId);
                        }
                    }
                }
                
                if (delistedCoins > 0) {
                    console.log(`Total delisted cryptocurrencies processed: ${delistedCoins}`);
                } else {
                    console.log('No delisted cryptocurrencies found');
                }
            } catch (error) {
                console.error('Error checking for delisted cryptocurrencies:', error);
            }
        };
        
        // Run crypto cleanup at startup and then daily
        cleanupCryptoPositions();
        setInterval(cleanupCryptoPositions, 86400000); // 24 hours
        
        // Run delisted crypto check at startup and then every 12 hours
        checkForDelistedCryptos();
        setInterval(checkForDelistedCryptos, 43200000); // 12 hours
        
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

/**
 * Discord interaction handler for slash commands
 * Processes incoming commands and handles execution errors
 */
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = commands.get(interaction.commandName);
    if (!command) return;
    
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error);
        
        try {
            const errorMessage = 'There was an error executing this command!';
            
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        } catch (e) {
            console.error('Error responding to command error:', e);
        }
    }
});

// Start the Discord bot
client.login(process.env.DISCORD_TOKEN);