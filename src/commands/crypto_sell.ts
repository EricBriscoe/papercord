import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { coinGeckoService } from '../services/coinGeckoService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { cryptoPortfolioDb } from '../database/operations';
import { formatCurrency } from '../utils/formatters';

export const cryptoSellCommand: Command = {
    name: 'crypto_sell',
    description: 'Sell cryptocurrency from your portfolio',
    options: [
        {
            name: 'coin',
            description: 'The name or symbol of the cryptocurrency to sell (e.g., bitcoin, eth)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'quantity',
            description: 'Quantity of cryptocurrency to sell (e.g., 0.5) or "all" to sell entire position',
            type: ApplicationCommandOptionType.String,
            required: false
        },
        {
            name: 'all',
            description: 'Sell your entire position in this cryptocurrency',
            type: ApplicationCommandOptionType.Boolean,
            required: false
        },
        {
            name: 'min_price',
            description: 'Minimum price per coin you are willing to accept (limit order)',
            type: ApplicationCommandOptionType.Number,
            required: false
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
        await interaction.deferReply();
        
        try {
            const userId = interaction.user.id;
            const coinQuery = interaction.options.getString('coin', true);
            const quantityInput = interaction.options.getString('quantity');
            const sellAllFlag = interaction.options.getBoolean('all') || false;
            const minPrice = interaction.options.getNumber('min_price');
            
            let sellAll = sellAllFlag;
            let quantity: number | undefined = undefined;
            
            // Handle quantity input - could be a number or "all"
            if (quantityInput) {
                if (quantityInput.toLowerCase() === 'all') {
                    sellAll = true;
                } else {
                    quantity = parseFloat(quantityInput);
                    if (isNaN(quantity) || quantity <= 0) {
                        await interaction.editReply('Quantity must be a positive number or "all".');
                        return;
                    }
                }
            }
            
            // Validate inputs
            if (!quantity && !sellAll) {
                await interaction.editReply('Please specify either a quantity to sell or use "all" to sell your entire position.');
                return;
            }
            
            if (quantity && sellAll) {
                await interaction.editReply('Please specify either a quantity to sell or use "all", not both.');
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
            
            // Check if user owns this cryptocurrency
            const position = cryptoPortfolioDb.getUserPosition(userId, coin.id);
            
            if (!position || position.quantity <= 0) {
                await interaction.editReply(`You don't own any ${coin.name} (${coin.symbol.toUpperCase()}) to sell.`);
                return;
            }
            
            // Get current price
            const priceData = await coinGeckoService.getCoinPrice(coin.id);
            
            if (!priceData.price) {
                await interaction.editReply(`Could not fetch current price for ${coin.name} (${coin.symbol.toUpperCase()}). Please try again later.`);
                return;
            }
            
            const currentPrice = priceData.price;
            
            // If selling specific quantity, make sure user has enough
            if (quantity && quantity > position.quantity) {
                await interaction.editReply(`You only have ${position.quantity.toFixed(8)} ${coin.symbol.toUpperCase()} available to sell.`);
                return;
            }
            
            // Calculate proceeds estimate for display
            const displayQuantity = sellAll ? position.quantity : quantity!;
            const estimatedProceeds = displayQuantity * currentPrice;
            
            // Execute sell operation
            const result = await cryptoTradingService.sellCrypto(userId, coin.id, sellAll ? undefined : quantity);
            
            if (!result.success) {
                await interaction.editReply(`Failed to sell cryptocurrency: ${result.message}`);
                return;
            }
            
            // Create success embed
            const embed = new EmbedBuilder()
                .setTitle('Cryptocurrency Sale Successful')
                .setColor('#00ff00')
                .addFields([
                    {
                        name: 'Cryptocurrency',
                        value: `${coin.name} (${coin.symbol.toUpperCase()})`,
                        inline: true
                    },
                    {
                        name: 'Quantity Sold',
                        value: sellAll ? `${position.quantity.toFixed(8)} (Full Position)` : quantity!.toFixed(8),
                        inline: true
                    },
                    {
                        name: 'Price Per Coin',
                        value: formatCurrency(currentPrice),
                        inline: true
                    },
                    {
                        name: 'Total Proceeds',
                        value: formatCurrency(result.proceeds || 0),
                        inline: true
                    }
                ])
                .setTimestamp();
            
            // Add profit/loss information if available
            const avgPurchasePrice = position.averagePurchasePrice;
            if (avgPurchasePrice > 0) {
                const profitLossPerCoin = currentPrice - avgPurchasePrice;
                const soldQuantity = sellAll ? position.quantity : quantity!;
                const totalProfitLoss = profitLossPerCoin * soldQuantity;
                const profitLossPercent = (profitLossPerCoin / avgPurchasePrice) * 100;
                
                embed.addFields([
                    {
                        name: 'Average Purchase Price',
                        value: formatCurrency(avgPurchasePrice),
                        inline: true
                    },
                    {
                        name: 'Profit/Loss',
                        value: `${formatCurrency(totalProfitLoss)} (${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`,
                        inline: true
                    }
                ]);
            }
            
            // Show remaining position if not selling all
            if (!sellAll && quantity) {
                const remainingQuantity = position.quantity - quantity;
                if (remainingQuantity > 0) {
                    embed.addFields({
                        name: 'Remaining Position',
                        value: `${remainingQuantity.toFixed(8)} ${coin.symbol.toUpperCase()}`,
                        inline: true
                    });
                }
            }
            
            await interaction.editReply({ embeds: [embed] });
            
        } catch (error) {
            console.error('Error in crypto_sell command:', error);
            await interaction.editReply('An error occurred while processing your cryptocurrency sale. Please try again later.');
        }
    }
};