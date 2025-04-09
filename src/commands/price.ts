import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { stockService } from '../services/stockService';
import { formatCurrency } from '../utils/formatters';

export const priceCommand: Command = {
    name: 'price',
    description: 'Check the current price of a stock',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const symbol = interaction.options.getString('symbol', true);
        
        try {
            const stockData = await stockService.getStockPrice(symbol);
            const companyInfo = await stockService.getCompanyInfo(symbol);
            
            if (!stockData.price) {
                await interaction.editReply(`Could not find price for ${symbol}. ${stockData.error || 'Please check the symbol and try again.'}`);
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`${symbol.toUpperCase()} - ${companyInfo?.name || 'Stock'} Price`)
                .setDescription(`Current price: ${formatCurrency(stockData.price)}`)
                .setColor('#0099ff')
                .setTimestamp();
                
            if (companyInfo?.logo) {
                embed.setThumbnail(companyInfo.logo);
            }
            
            if (companyInfo?.weburl) {
                embed.setURL(companyInfo.weburl);
            }
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Price command error:', error);
            await interaction.editReply(`An error occurred while fetching the price for ${symbol}. Please try again later.`);
        }
    }
};