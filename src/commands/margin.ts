import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

export const marginCommand: Command = {
    name: 'margin',
    description: 'View your margin status and available margin for options trading',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            // Get user's portfolio to calculate available margin
            const portfolio = await tradingService.getPortfolio(interaction.user.id);
            
            // Calculate available margin - 50% of total portfolio value
            const totalPortfolioValue = portfolio.totalValue; // Cash + equity value
            const marginAvailable = totalPortfolioValue * 0.5;
            
            // Get user's current margin usage from options positions
            const optionsPortfolio = await optionsService.getOptionsMarginUsage(interaction.user.id);
            
            const marginRemaining = marginAvailable - optionsPortfolio.marginUsed;
            const marginUsedPercent = optionsPortfolio.marginUsed / marginAvailable * 100;
            
            // Create response embed
            const embed = new EmbedBuilder()
                .setTitle('Margin Status')
                .setColor(marginUsedPercent > 75 ? '#FF0000' : '#00FF00')
                .setDescription('Your margin is calculated as 50% of your total portfolio value (cash + equity).')
                .addFields([
                    { 
                        name: 'Total Portfolio Value', 
                        value: formatCurrency(totalPortfolioValue), 
                        inline: true 
                    },
                    { 
                        name: 'Cash Balance', 
                        value: formatCurrency(portfolio.cashBalance), 
                        inline: true 
                    },
                    { 
                        name: 'Total Margin Available', 
                        value: formatCurrency(marginAvailable), 
                        inline: true 
                    },
                    { 
                        name: 'Margin Currently Used', 
                        value: formatCurrency(optionsPortfolio.marginUsed), 
                        inline: true 
                    },
                    { 
                        name: 'Margin Remaining', 
                        value: formatCurrency(marginRemaining), 
                        inline: true 
                    },
                    { 
                        name: 'Margin Usage', 
                        value: `${marginUsedPercent.toFixed(2)}%`, 
                        inline: true 
                    }
                ])
                .setFooter({ 
                    text: `Last updated: ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
                
            // Add warning if margin usage is high
            if (marginUsedPercent > 75) {
                embed.addFields([{
                    name: '⚠️ Warning ⚠️',
                    value: 'Your margin usage is high. If it reaches 100%, your positions may be liquidated automatically.',
                    inline: false
                }]);
            }
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Margin command error:', error);
            await interaction.editReply('An error occurred while fetching your margin status. Please try again later.');
        }
    }
};