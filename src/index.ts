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
import { Command } from './models/command';
import { optionsService } from './services/optionsService';

// Load environment variables
dotenv.config();

// Initialize Discord client with all needed intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// Collection to store commands
const commands = new Collection<string, Command>();

// Register commands
[
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
    closeOptionCommand
].forEach(command => {
    commands.set(command.name, command);
});

// Client ready event
client.once(Events.ClientReady, async (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}!`);
    
    try {
        const commandData = Array.from(commands.values()).map(command => ({
            name: command.name,
            description: command.description,
            options: command.options
        }));
        
        // Register commands with Discord
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN || '');
        
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commandData }
        );
        
        console.log('Successfully reloaded application (/) commands.');
        
        // Set up a periodic job to process expired options
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
        }, 86400000); // Run once per day (milliseconds)
        
        // Set up a periodic job to process margin calls
        setInterval(async () => {
            try {
                console.log('Processing margin calls...');
                const result = await optionsService.processMarginCalls();
                if (result.processed > 0) {
                    console.log(`Processed ${result.processed} margin calls, liquidated ${result.liquidated}.`);
                }
            } catch (error) {
                console.error('Error processing margin calls:', error);
            }
        }, 3600000); // Run once per hour (milliseconds)
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Handle interaction events (slash commands)
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