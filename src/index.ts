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
import { closeOptionCommand } from './commands/close_option';
import { leaderboardCommand } from './commands/leaderboard';
import { cryptoBuyCommand } from './commands/crypto_buy';
import { cryptoSellCommand } from './commands/crypto_sell';
import { cryptoPriceCommand } from './commands/crypto_price';
import { marginCommand } from './commands/margin';
import { sudoCommand } from './commands/sudo';
import { subscribeCommand } from './commands/subscribe';
import { Command } from './models/command';
import { optionsService } from './services/optionsService';
import { cryptoTradingService } from './services/cryptoTradingService';
import { optionsDb } from './database/operations';
import type { CryptoPosition } from './database/operations';
import { setDiscordClient as setOptionsDiscordClient } from './services/optionsService';
import { setDiscordClient as setCryptoDiscordClient } from './services/cryptoTradingService';

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
    priceOptionCommand, tradeOptionCommand, closeOptionCommand,
    // Crypto trading
    cryptoBuyCommand, cryptoSellCommand, cryptoPriceCommand,
    // Other commands
    marginCommand, leaderboardCommand, sudoCommand,
    // Subscription command
    subscribeCommand
].forEach(command => {
    commands.set(command.name, command);
});

// Bot initialization and scheduled task setup
client.once(Events.ClientReady, async (readyClient) => {
    setOptionsDiscordClient(client);
    setCryptoDiscordClient(client);
    console.log(`Logged in as ${readyClient.user.tag}!`);
    
    // Register slash commands with Discord API
    try {
        await registerCommands(readyClient);
        
        // Setup scheduled tasks
        setupDailyOptionsExpiryCheck();
        setupMarginMonitoringTask();
        setupLiquidationTask();
        setupInactiveUserCleanupTask();  // Add the new user cleanup task
        
        // Run crypto management tasks
        await initializeCryptoManagement();
    } catch (error) {
        console.error('[Bot Initialization Error]:', error);
    }
});

/**
 * Register all slash commands with Discord API
 */
async function registerCommands(readyClient: Client) {
    console.log('Started refreshing application (/) commands.');
    
    const commandData = Array.from(commands.values()).map(command => ({
        name: command.name,
        description: command.description,
        options: command.options
    }));
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || '');
    
    try {
        await rest.put(
            Routes.applicationCommands(readyClient.user!.id),
            { body: commandData }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering Discord commands:', error);
        throw error; // Re-throw to handle in the main initialization block
    }
}

/**
 * Setup check for expired options contracts - runs at startup and every 4 hours
 */
function setupDailyOptionsExpiryCheck() {
    // Run immediately at startup
    (async () => {
        try {
            console.log('[Startup] Checking for expired options...');
            const result = await optionsService.processExpiredOptions();
            if (result.processed > 0) {
                console.log(`[Startup] Processed ${result.processed} expired options, created ${result.marginCalls} margin calls.`);
            } else {
                console.log('[Startup] No expired options found.');
            }
        } catch (error) {
            console.error('[Startup Error] Error processing expired options:', error);
        }
    })();
    
    // Then set up interval to run every 4 hours
    setInterval(async () => {
        try {
            console.log('[Scheduled Task] Checking for expired options...');
            const result = await optionsService.processExpiredOptions();
            if (result.processed > 0) {
                console.log(`Processed ${result.processed} expired options, created ${result.marginCalls} margin calls.`);
            }
        } catch (error) {
            console.error('[Scheduled Task Error] Error processing expired options:', error);
        }
    }, 14400000); // 4 hours (reduced from 24 hours)
}

/**
 * Setup monitoring task for margin status
 */
function setupMarginMonitoringTask() {
    setInterval(async () => {
        try {
            console.log('[Scheduled Task] Checking margin warnings and notifications...');
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
            console.error('[Scheduled Task Error] Error processing margin checks:', error);
        }
    }, 14400000); // 4 hours
}

/**
 * Setup task for automatic liquidation of severe margin violations
 */
function setupLiquidationTask() {
    setInterval(async () => {
        try {
            console.log('[Scheduled Task] Processing liquidations for severe margin violations...');
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
            console.error('[Scheduled Task Error] Error processing liquidations:', error);
        }
    }, 3600000); // 1 hour
}

/**
 * Setup task for cleaning up inactive users
 * This will find and remove users that still have exactly the starting $100,000
 * and have no other assets (stocks, options, crypto)
 */
function setupInactiveUserCleanupTask() {
    // Run immediately at startup
    (async () => {
        try {
            console.log('[Startup] Running initial inactive user cleanup...');
            const { userDb } = await import('./database/operations');
            const result = userDb.cleanupInactiveUsers();
            if (result.deletedCount > 0) {
                console.log(`[Startup] Removed ${result.deletedCount} inactive users from the database`);
            } else {
                console.log('[Startup] No inactive users found for cleanup');
            }
        } catch (error) {
            console.error('[Startup Error] Error cleaning up inactive users:', error);
        }
    })();
    
    // Then set up interval to run weekly
    setInterval(async () => {
        try {
            console.log('[Scheduled Task] Running weekly inactive user cleanup...');
            const { userDb } = await import('./database/operations');
            const result = userDb.cleanupInactiveUsers();
            if (result.deletedCount > 0) {
                console.log(`[Scheduled Task] Removed ${result.deletedCount} inactive users from the database`);
                console.log(`[Scheduled Task] User IDs removed: ${result.userIds.join(', ')}`);
            } else {
                console.log('[Scheduled Task] No inactive users found for cleanup');
            }
        } catch (error) {
            console.error('[Scheduled Task Error] Error cleaning up inactive users:', error);
        }
    }, 604800000); // 7 days (weekly)
}

/**
 * Function to clean up small-value "dust" crypto positions and delisted cryptos
 * Processes all users with crypto holdings to maintain clean portfolios
 */
const cleanupCryptoPositions = async () => {
    try {
        console.log('Cleaning up worthless crypto positions...');
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

/**
 * Initialize crypto management tasks
 */
async function initializeCryptoManagement() {
    try {
        console.log('[Initialization] Starting crypto management services...');
        
        // Run crypto cleanup at startup and then daily
        await cleanupCryptoPositions();
        setInterval(cleanupCryptoPositions, 86400000); // 24 hours
        
        // Run delisted crypto check at startup and then every 12 hours
        await checkForDelistedCryptos();
        setInterval(checkForDelistedCryptos, 43200000); // 12 hours
        
        console.log('[Initialization] Crypto management services initialized successfully');
    } catch (error) {
        console.error('[Initialization Error] Failed to initialize crypto management:', error);
    }
}

/**
 * Discord interaction handler for slash commands
 * Processes incoming commands and handles execution errors
 * With improved error handling and logging
 */
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    const command = commands.get(interaction.commandName);
    if (!command) return;
    
    // Record start time for diagnostics
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
        
    // Immediately acknowledge the interaction to extend processing time
    try {
        await interaction.deferReply();
        
        // Ensure user exists in the database (auto-create if not)
        const { userDb } = await import('./database/operations');
        userDb.getOrCreateUser(interaction.user.id);

        // Log the interaction received
        console.log(`[${timestamp}] Interaction received: ${interaction.commandName} (ID: ${interaction.id})`);
        console.log(`[${new Date().toISOString()}] Acknowledged interaction: ${interaction.commandName} in ${Date.now() - startTime}ms`);
    } catch (error) {
        // Handle expired interactions
        if (error instanceof DiscordAPIError && error.code === 10062) {
            console.log(`[${new Date().toISOString()}] Interaction ${interaction.id} expired before acknowledgment (${Date.now() - startTime}ms)`);
            return; // Stop processing, the interaction is already invalid
        }
        
        console.error(`[${new Date().toISOString()}] Error acknowledging interaction:`, error);
        return; // Cannot proceed without acknowledgment
    }
    
    // Execute the command with our extended time window
    try {
        await command.execute(interaction);
        console.log(`[${new Date().toISOString()}] Completed command: ${interaction.commandName} in ${Date.now() - startTime}ms`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error executing command ${interaction.commandName}:`, error);
        
        // Send error message to user
        const errorMessage = 'There was an error executing this command!';
        
        try {
            if (interaction.replied) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.editReply({ content: errorMessage });
            }
        } catch (responseError) {
            // Handle errors during error response
            if (responseError instanceof DiscordAPIError && responseError.code === 10062) {
                console.log(`[${new Date().toISOString()}] Failed to send error message - interaction expired`);
            } else {
                console.error(`[${new Date().toISOString()}] Error responding to command error:`, responseError);
            }
        }
    }
});

// Start the Discord bot
client.login(process.env.DISCORD_TOKEN);