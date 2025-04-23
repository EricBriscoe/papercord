import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { userDb } from '../database/operations'; 
import { stockService } from '../services/stockService';
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
            description: 'Number of shares to buy (or "max" to buy maximum possible)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        const symbol = interaction.options.getString('symbol', true);
        const quantityInput = interaction.options.getString('quantity', true);
        
        let quantity: number;
        let isMaxPurchase = false;
        
        if (quantityInput.toLowerCase() === 'max') {
            // Calculate maximum shares the user can buy
            isMaxPurchase = true;
            
            // Get the current price of the stock
            const priceData = await stockService.getStockPrice(symbol);
            if (!priceData.price) {
                await interaction.editReply({
                    content: priceData.error || `Unable to find price for ${symbol}`
                });
                return;
            }
            
            // Get user's cash balance
            const userId = interaction.user.id;
            const cashBalance = userDb.getCashBalance(userId);
            
            // Calculate max shares (floor to ensure they can afford it)
            quantity = Math.floor(cashBalance / priceData.price);
            
            if (quantity <= 0) {
                await interaction.editReply({
                    content: `You don't have enough cash to buy any shares of ${symbol} at the current price of $${priceData.price.toFixed(2)}`
                });
                return;
            }
        } else {
            // Convert string input to number
            quantity = parseFloat(quantityInput);
            
            // Validate input
            if (isNaN(quantity) || quantity <= 0) {
                await interaction.editReply({
                    content: 'Please provide a positive number or "max" for quantity'
                });
                return;
            }
        }
        
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
            
        if (isMaxPurchase && result.success) {
            embed.setDescription(`Maximum purchase: ${result.message}`);
        }
            
        await interaction.editReply({ embeds: [embed] });
    }
};