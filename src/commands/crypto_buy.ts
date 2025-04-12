import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { coinGeckoService } from '../services/coinGeckoService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { userDb } from '../database/operations';
import { formatCurrency } from '../utils/formatters';

export const cryptoBuyCommand: Command = {
    name: 'crypto_buy',
    description: 'Buy cryptocurrency with your available cash',
    options: [
        {
            name: 'coin',
            description: 'The name or symbol of the cryptocurrency to buy (e.g., bitcoin, eth)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'amount',
            description: 'Amount in USD to spend on the purchase (e.g., 1000)',
            type: ApplicationCommandOptionType.Number,
            required: false
        },
        {
            name: 'quantity',
            description: 'Quantity of cryptocurrency to buy (e.g., 0.5)',
            type: ApplicationCommandOptionType.Number,
            required: false
        },
        {
            name: 'max_price',
            description: 'Maximum price per coin you are willing to pay (limit order)',
            type: ApplicationCommandOptionType.Number,
            required: false
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
        await interaction.deferReply();
        
        try {
            const userId = interaction.user.id;
            const coinQuery = interaction.options.getString('coin', true);
            const amountUsd = interaction.options.getNumber('amount');
            const quantity = interaction.options.getNumber('quantity');
            const maxPrice = interaction.options.getNumber('max_price');
            
            // Validate inputs - need either amount or quantity
            if (!amountUsd && !quantity) {
                await interaction.editReply('Please specify either the amount in USD or the quantity of cryptocurrency to buy.');
                return;
            }
            
            if (amountUsd && quantity) {
                await interaction.editReply('Please specify either the amount in USD or the quantity, not both.');
                return;
            }
            
            if ((amountUsd && amountUsd <= 0) || (quantity && quantity <= 0)) {
                await interaction.editReply('Amount or quantity must be greater than zero.');
                return;
            }
            
            // Search for the cryptocurrency
            const searchResults = await coinGeckoService.searchCoins(coinQuery);
            
            if (searchResults.length === 0) {
                await interaction.editReply(`Could not find any cryptocurrency matching "${coinQuery}". Please try another search term.`);
                return;
            }
            
            // Use the first (best) match
            const coin = searchResults[0];
            
            // Get current price
            const priceData = await coinGeckoService.getCoinPrice(coin.id);
            
            if (!priceData.price) {
                await interaction.editReply(`Could not fetch current price for ${coin.name} (${coin.symbol.toUpperCase()}). Please try again later.`);
                return;
            }
            
            const currentPrice = priceData.price;
            
            // Calculate quantity based on amount if amount is provided
            let buyQuantity = quantity;
            if (amountUsd) {
                buyQuantity = amountUsd / currentPrice;
            }
            
            if (!buyQuantity || buyQuantity <= 0) {
                await interaction.editReply('Invalid quantity calculated. Please check your inputs and try again.');
                return;
            }
            
            // Get user's cash balance
            const cashBalance = userDb.getCashBalance(userId);
            const totalCost = buyQuantity * currentPrice;
            
            if (totalCost > cashBalance) {
                await interaction.editReply(`You don't have enough cash for this purchase. Required: ${formatCurrency(totalCost)}, Available: ${formatCurrency(cashBalance)}`);
                return;
            }
            
            // Execute buy operation
            let buyAmountUsd = amountUsd;
            if (!buyAmountUsd && buyQuantity) {
                // If quantity is provided instead of amount, calculate the amount
                buyAmountUsd = buyQuantity * currentPrice;
            }
            
            // Execute buy operation
            const result = await cryptoTradingService.buyCrypto(userId, coin.id, buyAmountUsd!);
            
            if (!result.success) {
                await interaction.editReply(`Failed to buy cryptocurrency: ${result.message}`);
                return;
            }
            
            // Create success embed
            const embed = new EmbedBuilder()
                .setTitle('Cryptocurrency Purchase Successful')
                .setColor('#00ff00')
                .addFields([
                    {
                        name: 'Cryptocurrency',
                        value: `${coin.name} (${coin.symbol.toUpperCase()})`,
                        inline: true
                    },
                    {
                        name: 'Quantity',
                        value: buyQuantity.toFixed(8),
                        inline: true
                    },
                    {
                        name: 'Price Per Coin',
                        value: formatCurrency(currentPrice),
                        inline: true
                    },
                    {
                        name: 'Total Cost',
                        value: formatCurrency(totalCost),
                        inline: true
                    },
                    {
                        name: 'Remaining Cash Balance',
                        value: formatCurrency(cashBalance - totalCost),
                        inline: true
                    }
                ])
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error in crypto_buy command:', error);
            await interaction.editReply('An error occurred while processing your cryptocurrency purchase. Please try again later.');
        }
    }
};