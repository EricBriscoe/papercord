import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ButtonBuilder, ButtonStyle } from 'discord.js';
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
            
            // If there's only one result, proceed directly to confirmation
            if (searchResults.length === 1) {
                await handleCoinSelection(interaction, searchResults[0], amountUsd, quantity, maxPrice);
                return;
            }
            
            // Multiple matches found - show selection menu
            // Limit to top 25 matches to ensure it fits in a Discord menu
            const coinOptions = searchResults.slice(0, 25).map(coin => {
                return new StringSelectMenuOptionBuilder()
                    .setLabel(`${coin.name} (${coin.symbol.toUpperCase()})`)
                    .setDescription(`Unique ID: ${coin.id}`)
                    .setValue(coin.id);
            });
            
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('coin_selection')
                .setPlaceholder('Select a cryptocurrency')
                .addOptions(coinOptions);
            
            const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(selectMenu);
            
            const response = await interaction.editReply({
                content: `Multiple cryptocurrencies match "${coinQuery}". Please select the specific one you want to purchase:`,
                components: [row]
            });
            
            // Create collector for the select menu interaction
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 3 * 60 * 1000, // 3 minute timeout
            });
            
            collector.on('collect', async (i) => {
                // Make sure it's the same user who initiated the command
                if (i.user.id !== userId) {
                    await i.reply({ content: 'This selection menu is not for you.', ephemeral: true });
                    return;
                }
                
                await i.deferUpdate();
                
                const selectedCoinId = i.values[0];
                const selectedCoin = searchResults.find(coin => coin.id === selectedCoinId);
                
                if (!selectedCoin) {
                    await interaction.editReply('An error occurred while selecting the cryptocurrency. Please try again.');
                    return;
                }
                
                // Handle the selected coin
                await handleCoinSelection(interaction, selectedCoin, amountUsd, quantity, maxPrice);
                
                // End the collector since we've handled the selection
                collector.stop();
            });
            
            collector.on('end', async (collected, reason) => {
                // If the collector ended due to timeout and no selection was made
                if (reason === 'time' && collected.size === 0) {
                    await interaction.editReply({
                        content: 'Cryptocurrency selection timed out. Please try again.',
                        components: [] // Remove the components
                    });
                }
            });
            
        } catch (error) {
            console.error('Error in crypto_buy command:', error);
            await interaction.editReply('An error occurred while processing your cryptocurrency purchase. Please try again later.');
        }
    }
};

/**
 * Handle coin selection and proceed to confirmation or execution
 */
async function handleCoinSelection(
    interaction: ChatInputCommandInteraction, 
    coin: { id: string; symbol: string; name: string }, 
    amountUsd: number | null, 
    quantity: number | null,
    maxPrice: number | null
): Promise<void> {
    try {
        // Get current price
        const priceData = await coinGeckoService.getCoinPrice(coin.id);
        
        if (!priceData.price) {
            await interaction.editReply(`Could not fetch current price for ${coin.name} (${coin.symbol.toUpperCase()}). Please try again later.`);
            return;
        }
        
        const currentPrice = priceData.price;
        
        // Check max price if specified
        if (maxPrice && currentPrice > maxPrice) {
            await interaction.editReply(`Current price (${formatCurrency(currentPrice)}) is higher than your maximum price (${formatCurrency(maxPrice)}). Transaction not executed.`);
            return;
        }
        
        // Calculate quantity based on amount if amount is provided
        let buyQuantity = quantity;
        let totalCost: number;
        
        if (amountUsd) {
            buyQuantity = amountUsd / currentPrice;
            totalCost = amountUsd;
        } else if (quantity) {
            totalCost = quantity * currentPrice;
        } else {
            await interaction.editReply('Invalid inputs. Please specify either amount or quantity.');
            return;
        }
        
        if (!buyQuantity || buyQuantity <= 0) {
            await interaction.editReply('Invalid quantity calculated. Please check your inputs and try again.');
            return;
        }
        
        // Get user's cash balance
        const userId = interaction.user.id;
        const cashBalance = userDb.getCashBalance(userId);
        
        if (totalCost! > cashBalance) {
            await interaction.editReply(`You don't have enough cash for this purchase. Required: ${formatCurrency(totalCost!)}, Available: ${formatCurrency(cashBalance)}`);
            return;
        }
        
        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle('Confirm Cryptocurrency Purchase')
            .setColor('#0099ff')
            .addFields([
                {
                    name: 'Cryptocurrency',
                    value: `${coin.name} (${coin.symbol.toUpperCase()})`,
                    inline: true
                },
                {
                    name: 'Coin ID',
                    value: coin.id,
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
                    value: formatCurrency(totalCost!),
                    inline: true
                },
                {
                    name: 'Cash Balance After Purchase',
                    value: formatCurrency(cashBalance - totalCost!),
                    inline: true
                }
            ])
            .setFooter({ text: 'Please confirm or cancel this transaction.' })
            .setTimestamp();
        
        // Create confirm/cancel buttons
        const confirmButton = new ButtonBuilder()
            .setCustomId('confirm_purchase')
            .setLabel('Confirm Purchase')
            .setStyle(ButtonStyle.Success);
            
        const cancelButton = new ButtonBuilder()
            .setCustomId('cancel_purchase')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger);
            
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(confirmButton, cancelButton);
        
        const confirmMessage = await interaction.editReply({
            embeds: [confirmEmbed],
            components: [row]
        });
        
        // Create collector for button interaction
        const collector = confirmMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000, // 1 minute timeout
        });
        
        collector.on('collect', async (i) => {
            // Make sure it's the same user who initiated the command
            if (i.user.id !== userId) {
                await i.reply({ content: 'These buttons are not for you.', ephemeral: true });
                return;
            }
            
            await i.deferUpdate();
            
            if (i.customId === 'confirm_purchase') {
                // Execute buy operation
                let buyAmountUsd = amountUsd;
                if (!buyAmountUsd && buyQuantity) {
                    // If quantity is provided instead of amount, calculate the amount
                    buyAmountUsd = buyQuantity * currentPrice;
                }
                
                // Execute buy operation
                const result = await cryptoTradingService.buyCrypto(userId, coin.id, buyAmountUsd!);
                
                if (!result.success) {
                    await interaction.editReply({
                        content: `Failed to buy cryptocurrency: ${result.message}`,
                        components: []
                    });
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
                            name: 'Coin ID',
                            value: coin.id,
                            inline: true
                        },
                        {
                            name: 'Quantity',
                            value: result.amount ? result.amount.toFixed(8) : buyQuantity!.toFixed(8),
                            inline: true
                        },
                        {
                            name: 'Price Per Coin',
                            value: formatCurrency(result.price || currentPrice),
                            inline: true
                        },
                        {
                            name: 'Total Cost',
                            value: formatCurrency(buyAmountUsd!),
                            inline: true
                        },
                        {
                            name: 'Remaining Cash Balance',
                            value: formatCurrency(cashBalance - buyAmountUsd!),
                            inline: true
                        }
                    ])
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                // Cancel the transaction
                await interaction.editReply({
                    content: 'Cryptocurrency purchase cancelled.',
                    embeds: [],
                    components: []
                });
            }
        });
        
        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await interaction.editReply({
                    content: 'Purchase confirmation timed out. Transaction cancelled.',
                    embeds: [],
                    components: []
                });
            }
        });
    } catch (error) {
        console.error('Error handling coin selection:', error);
        await interaction.editReply('An error occurred while processing your cryptocurrency purchase. Please try again later.');
    }
}