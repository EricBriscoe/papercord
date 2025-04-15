import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { portfolioDb } from '../database/operations';

export const sellCommand: Command = {
    name: 'sell',
    description: 'Sell shares of a stock',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'quantity',
            description: 'Number of shares to sell or "all" to sell entire position',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const symbol = interaction.options.getString('symbol', true);
        const quantityInput = interaction.options.getString('quantity', true);
        
        let quantity: number;
        let isFullPosition = false;
        
        if (quantityInput.toLowerCase() === 'all') {
            // Get user's position for this symbol
            const position = portfolioDb.getUserPosition(interaction.user.id, symbol);
            
            if (!position || position.quantity <= 0) {
                await interaction.editReply({
                    content: `You don't own any shares of ${symbol.toUpperCase()}`
                });
                return;
            }
            
            // Set quantity to sell the entire position
            quantity = position.quantity;
            isFullPosition = true;
        } else {
            // Convert string input to number
            quantity = parseFloat(quantityInput);
            
            // Validate input
            if (isNaN(quantity) || quantity <= 0) {
                await interaction.editReply({
                    content: 'Please provide a positive number or "all" for quantity'
                });
                return;
            }
        }
        
        const result = await tradingService.sellStock(
            interaction.user.id,
            symbol,
            quantity
        );
        
        const embed = new EmbedBuilder()
            .setTitle(`Sell Order: ${symbol.toUpperCase()}`)
            .setDescription(isFullPosition ? `Full position liquidated: ${result.message}` : result.message)
            .setColor(result.success ? '#00FF00' : '#FF0000')
            .setFooter({ 
                text: `Transaction time: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    }
};