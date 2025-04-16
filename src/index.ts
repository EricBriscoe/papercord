import { Client, Events, GatewayIntentBits, REST, Routes, Collection } from 'discord.js';
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

// Load environment variables
dotenv.config();

// Discord client with appropriate intents for guild interactions
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// Command registry
const commands = new Collection<string, Command>();

// Register all available commands grouped by category
[
    // Basic trading commands
    buyCommand, 
    sellCommand, 
    portfolioCommand, 
    priceCommand, 
    historyCommand, 
    resetCommand,
    // Options trading commands
    priceOptionCommand,
    tradeOptionCommand,
    optionsPortfolioCommand,
    closeOptionCommand,
    // Crypto trading commands
    cryptoBuyCommand,
    cryptoSellCommand,
    cryptoPriceCommand,
    // Margin and risk management commands
    marginCommand,
    // Community commands
    leaderboardCommand,
    // Admin commands
    sudoCommand
].forEach(command => {
    commands.set(command.name, command);
});

// Initialize bot and register slash commands with Discord API
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
    
    try {
        // Prepare command data for registration
        const commandData = Array.from(commands.values()).map(command => ({
            name: command.name,
            description: command.description,
            options: command.options
        }));
        
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || '');
        
        console.log('Started refreshing application (/) commands.');
        
        // Register global commands
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commandData }
        );
        
        console.log('Successfully reloaded application (/) commands.');
        
        // Daily job to process expired options contracts
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
        
        // 4-hour job to monitor margin status and issue warnings
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
        
        // Hourly job to automatically liquidate positions for severe margin violations
        setInterval(async () => {
            try {
                console.log('Processing liquidations for severe margin violations...');
                const usersWithOpenPositions = optionsDb.getUsersWithOpenPositions();
                let totalLiquidated = 0;
                
                for (const userId of usersWithOpenPositions) {
                    // Liquidate positions when equity ratio falls below 20%
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
        
        // Daily job to clean up "dust" crypto positions worth less than threshold
        const cleanupCryptoPositions = async () => {
            try {
                console.log('Cleaning up worthless crypto positions...');
                const { cryptoTradingService } = await import('./services/cryptoTradingService');
                const { userDb } = await import('./database/operations');
                
                const usersWithCrypto = userDb.getUsersWithCryptoPositions();
                let totalPositionsLiquidated = 0;
                let totalValueCredited = 0;
                
                for (const userId of usersWithCrypto) {
                    const result = await cryptoTradingService.cleanupWorthlessPositions(userId);
                    
                    if (result.success && result.positionsLiquidated > 0) {
                        console.log(`Cleaned up ${result.positionsLiquidated} worthless crypto positions for user ${userId}`);
                        console.log(result.message);
                        
                        totalPositionsLiquidated += result.positionsLiquidated;
                        totalValueCredited += result.totalCredited;
                    }
                }
                
                if (totalPositionsLiquidated > 0) {
                    console.log(`Total crypto positions liquidated: ${totalPositionsLiquidated}, total value credited: ${totalValueCredited.toFixed(2)} USD`);
                } else {
                    console.log('No worthless crypto positions were found that needed cleanup');
                }
            } catch (error) {
                console.error('Error cleaning up worthless crypto positions:', error);
            }
        };
        
        // Run crypto cleanup at startup and then daily
        cleanupCryptoPositions();
        setInterval(cleanupCryptoPositions, 86400000); // 24 hours
        
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Slash command handler
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

// Start the bot
client.login(process.env.DISCORD_TOKEN);