import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import db from '../database/database';

interface LeaderboardEntry {
    userId: string;
    username: string;
    totalValue: number;
}

export const leaderboardCommand: Command = {
    name: 'leaderboard',
    description: 'View a ranked list of users in your server by total account value',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
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
            
            for (const user of guildDbUsers) {
                try {
                    // Get member from the guild
                    const member = members.get(user.userId);
                    if (!member) continue;
                    
                    // Get stock portfolio
                    const stockPortfolio = await tradingService.getPortfolio(user.userId);
                    
                    // Get options portfolio value
                    let optionsValue = 0;
                    try {
                        const optionsPortfolio = await optionsService.getOptionsPortfolio(user.userId);
                        optionsValue = optionsPortfolio.totalValue;
                    } catch (err) {
                        console.error(`Error getting options portfolio for user ${user.userId}:`, err);
                        // Just continue with 0 for options value
                    }
                    
                    // Calculate total account value (stocks + options + cash)
                    const totalValue = stockPortfolio.totalValue + optionsValue;
                    
                    leaderboardEntries.push({
                        userId: user.userId,
                        username: member.user.username,
                        totalValue
                    });
                } catch (err) {
                    console.error(`Error processing user ${user.userId} for leaderboard:`, err);
                    // Continue with the next user
                }
            }
            
            // Sort by total value (highest first)
            leaderboardEntries.sort((a, b) => b.totalValue - a.totalValue);
            
            // Create leaderboard embed
            const embed = new EmbedBuilder()
                .setTitle(`${guild.name} Trading Leaderboard`)
                .setColor('#FFD700') // Gold color
                .setDescription('Top traders ranked by total account value')
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
                    
                    embed.addFields({
                        name: `${rankLabel}. ${entry.username}`,
                        value: `Total Value: ${formatCurrency(entry.totalValue)}`,
                        inline: false
                    });
                });
                
                // Add note about how the value is calculated
                embed.setDescription('Top traders ranked by total account value (cash + stocks + options)');
            }
            
            // Reply with the leaderboard
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Leaderboard command error:', error);
            await interaction.editReply('An error occurred while generating the leaderboard. Please try again later.');
        }
    }
};