import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

export const historyCommand: Command = {
    name: 'history',
    description: 'View your transaction history',
    options: [
        {
            name: 'limit',
            description: 'Number of transactions to show (default: 10, max: 25)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 25
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const limit = interaction.options.getInteger('limit') || 10;
            
            const transactions = tradingService.getTransactionHistory(interaction.user.id, limit);
            
            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username}'s Transaction History`)
                .setColor('#0099ff')
                .setTimestamp();
            
            if (transactions.length === 0) {
                embed.setDescription('You have not made any transactions yet.');
            } else {
                let transactionsText = '';
                
                transactions.forEach((tx: any) => {
                    const formattedDate = formatTimestamp(tx.timestamp);
                    const typeEmoji = tx.type === 'buy' ? '🟢' : '🔴';
                    const typeColor = tx.type === 'buy' ? 'Buy' : 'Sell';
                    
                    transactionsText += `**${typeEmoji} ${typeColor}:** ${tx.symbol} | `;
                    transactionsText += `${tx.quantity} shares @ ${formatCurrency(tx.price)} | `;
                    transactionsText += `Total: ${formatCurrency(tx.quantity * tx.price)} | `;
                    transactionsText += `${formattedDate}\n\n`;
                });
                
                embed.setDescription(transactionsText);
            }
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('History command error:', error);
            await interaction.editReply('An error occurred while fetching your transaction history. Please try again later.');
        }
    }
};