import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

export const buyCommand: Command = {
    name: 'buy',
    description: 'Buy shares of a stock',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'quantity',
            description: 'Number of shares to buy',
            type: ApplicationCommandOptionType.Number,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const symbol = interaction.options.getString('symbol', true);
        const quantity = interaction.options.getNumber('quantity', true);
        
        const result = await tradingService.buyStock(
            interaction.user.id,
            symbol,
            quantity
        );
        
        const embed = new EmbedBuilder()
            .setTitle(`Buy Order: ${symbol.toUpperCase()}`)
            .setDescription(result.message)
            .setColor(result.success ? '#00FF00' : '#FF0000')
            .setFooter({ 
                text: `Transaction time: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    }
};