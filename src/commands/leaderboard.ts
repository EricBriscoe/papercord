import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { optionsService } from '../services/optionsService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import db from '../database/database';

interface LeaderboardEntry {
    userId: string;
    username: string;
    totalValue: number;
    stockValue: number;
    cryptoValue: number;
    optionsValue: number;
    cashBalance: number;
}

export const leaderboardCommand: Command = {
    name: 'leaderboard',
    description: 'View a ranked list of users in your server by total account value',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        try {
            // Get all members of the current guild
            const guild = interaction.guild;
            if (!guild) {
                await interaction.editReply('This command can only be used in a server.');
                return;
            }

            await interaction.editReply('Generating leaderboard... This may take a moment.');

            // Fetch all guild members (we need to make sure we have the members cached)
            const members = await guild.members.fetch();
            
            // Find all users in the database that are also in this guild
            const stmt = db.prepare('SELECT DISTINCT userId FROM users');
            const dbUsers = stmt.all() as { userId: string }[];
            
            // Filter out users who aren't in this guild
            const guildDbUsers = dbUsers.filter(user => members.has(user.userId));
            
            if (guildDbUsers.length === 0) {
                await interaction.editReply('No users in this server have trading accounts yet.');
                return;
            }

            // Get portfolio values for each user
            const leaderboardEntries: LeaderboardEntry[] = [];
            
            // For each user, collect their total portfolio value
            for (const userId of guildDbUsers.map(user => user.userId)) {
                try {
                    // Get portfolio data from different services
                    const stockPortfolio = await tradingService.getPortfolio(userId);
                    const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(userId);
                    const cryptoTotalValue = await cryptoTradingService.getTotalPortfolioValue(userId);
                    const optionsPortfolio = await optionsService.getOptionsPortfolio(userId);
                    
                    // Get cash balance from the stock portfolio (which already includes it)
                    const cashBalance = stockPortfolio.cashBalance;
                    
                    // Calculate total value across all services
                    const totalValue = stockPortfolio.totalValue + 
                                     (cryptoTotalValue.success ? cryptoTotalValue.totalValue : 0) + 
                                     optionsPortfolio.totalValue;
                    
                    // Get user info from Discord
                    const user = await interaction.client.users.fetch(userId).catch(() => null);
                    if (!user) continue; // Skip if user not found
                    
                    leaderboardEntries.push({
                        userId,
                        username: user.username,
                        totalValue: totalValue,
                        stockValue: stockPortfolio.totalValue - cashBalance, // Subtract cash from total stock portfolio value
                        cryptoValue: cryptoTotalValue.success ? cryptoTotalValue.totalValue : 0,
                        optionsValue: optionsPortfolio.totalValue,
                        cashBalance: cashBalance
                    });
                } catch (error) {
                    console.error(`Error getting portfolio value for ${userId}:`, error);
                }
            }
            
            // Sort by total value (highest first)
            leaderboardEntries.sort((a, b) => b.totalValue - a.totalValue);
            
            // Create leaderboard embed
            const embed = new EmbedBuilder()
                .setTitle(`${guild.name} Trading Leaderboard`)
                .setColor('#FFD700') // Gold color
                .setDescription('Top traders ranked by total portfolio value')
                .setFooter({ 
                    text: `Last updated: ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
            
            // Add users to the leaderboard
            if (leaderboardEntries.length === 0) {
                embed.setDescription('No users with trading accounts found in this server.');
            } else {
                // Add medal emoji for top 3
                const medals = ['🥇', '🥈', '🥉'];
                
                leaderboardEntries.forEach((entry, index) => {
                    // Create a ranking label with medal for top 3
                    const rankLabel = index < 3 ? `${medals[index]} ${index + 1}` : `${index + 1}`;
                    
                    // Create breakdown of assets
                    const breakdownParts: string[] = [];
                    if (entry.cashBalance > 0) breakdownParts.push(`Cash: ${formatCurrency(entry.cashBalance)}`);
                    if (entry.stockValue > 0) breakdownParts.push(`Stocks: ${formatCurrency(entry.stockValue)}`);
                    if (entry.cryptoValue > 0) breakdownParts.push(`Crypto: ${formatCurrency(entry.cryptoValue)}`);
                    if (entry.optionsValue > 0) breakdownParts.push(`Options: ${formatCurrency(entry.optionsValue)}`);
                    
                    const breakdown = breakdownParts.join(' | ');
                    
                    embed.addFields({
                        name: `${rankLabel}. ${entry.username}`,
                        value: `Total Value: ${formatCurrency(entry.totalValue)}\n${breakdown}`,
                        inline: false
                    });
                });
                
                // Add note about how the value is calculated
                embed.setDescription('Top traders ranked by total portfolio value (cash + stocks + crypto + options)');
            }
            
            // Reply with the leaderboard
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Leaderboard command error:', error);
            await interaction.editReply('An error occurred while generating the leaderboard. Please try again later.');
        }
    }
};