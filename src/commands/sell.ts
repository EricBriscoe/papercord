import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

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
            description: 'Number of shares to sell',
            type: ApplicationCommandOptionType.Number,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const symbol = interaction.options.getString('symbol', true);
        const quantity = interaction.options.getNumber('quantity', true);
        
        const result = await tradingService.sellStock(
            interaction.user.id,
            symbol,
            quantity
        );
        
        const embed = new EmbedBuilder()
            .setTitle(`Sell Order: ${symbol.toUpperCase()}`)
            .setDescription(result.message)
            .setColor(result.success ? '#00FF00' : '#FF0000')
            .setFooter({ 
                text: `Transaction time: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    }
};