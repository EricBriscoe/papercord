import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { coinGeckoService } from '../services/coinGeckoService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { userDb } from '../database/operations';
import { formatCurrency, formatCryptoPrice } from '../utils/formatters';

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
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
        await interaction.deferReply();
        
        try {
            const userId = interaction.user.id;
            const coinQuery = interaction.options.getString('coin', true);
            const amountUsd = interaction.options.getNumber('amount');
            const quantity = interaction.options.getNumber('quantity');
            
            // Input validation
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
            
            const searchResults = await coinGeckoService.searchCoins(coinQuery);
            
            if (searchResults.length === 0) {
                await interaction.editReply(`Could not find any cryptocurrency matching "${coinQuery}". Please try another search term.`);
                return;
            }
            
            // Skip selection menu if only one result found
            if (searchResults.length === 1) {
                await handleCoinSelection(interaction, searchResults[0], amountUsd, quantity);
                return;
            }
            
            // Create selection menu for multiple matches (limited to 25 for Discord UI)
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
            
            // Set up interactive menu with timeout
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 3 * 60 * 1000 // 3 minute timeout
            });
            
            collector.on('collect', async (i) => {
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
                
                await handleCoinSelection(interaction, selectedCoin, amountUsd, quantity);
                collector.stop();
            });
            
            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.editReply({
                        content: 'Cryptocurrency selection timed out. Please try again.',
                        components: []
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
 * Processes a selected cryptocurrency purchase
 * 
 * This function handles:
 * 1. Fetching current price from CoinGecko
 * 2. Calculating the purchase amount and quantity
 * 3. Checking if user has sufficient funds
 * 4. Displaying purchase confirmation UI
 * 5. Processing the transaction if confirmed
 */
async function handleCoinSelection(
    interaction: ChatInputCommandInteraction, 
    coin: { id: string; symbol: string; name: string }, 
    amountUsd: number | null, 
    quantity: number | null
): Promise<void> {
    try {
        const priceData = await coinGeckoService.getCoinPrice(coin.id);
        
        if (!priceData.price) {
            await interaction.editReply(`Could not fetch current price for ${coin.name} (${coin.symbol.toUpperCase()}). Please try again later.`);
            return;
        }
        
        const currentPrice = priceData.price;
        
        // Calculate purchase details based on provided parameters
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
        
        // Verify sufficient funds
        const userId = interaction.user.id;
        const cashBalance = userDb.getCashBalance(userId);
        
        if (totalCost! > cashBalance) {
            await interaction.editReply(`You don't have enough cash for this purchase. Required: ${formatCurrency(totalCost!)}, Available: ${formatCurrency(cashBalance)}`);
            return;
        }
        
        // Display purchase confirmation
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
                    value: formatCryptoPrice(currentPrice),
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
        
        // Create confirmation UI
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
            content: null,
            embeds: [confirmEmbed],
            components: [row]
        });
        
        // Handle user's decision with a timeout
        const collector = confirmMessage.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 60000 // 1 minute timeout
        });
        
        collector.on('collect', async (i) => {
            if (i.user.id !== userId) {
                await i.reply({ content: 'These buttons are not for you.', ephemeral: true });
                return;
            }
            
            await i.deferUpdate();
            
            if (i.customId === 'confirm_purchase') {
                // Calculate final purchase amount if needed
                let buyAmountUsd = amountUsd;
                if (!buyAmountUsd && buyQuantity) {
                    buyAmountUsd = buyQuantity * currentPrice;
                }
                
                // Process the transaction
                const result = await cryptoTradingService.buyCrypto(userId, coin.id, buyAmountUsd!);
                
                if (!result.success) {
                    await interaction.editReply({
                        content: `Failed to buy cryptocurrency: ${result.message}`,
                        components: []
                    });
                    return;
                }
                
                // Show transaction success details
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
                            value: formatCryptoPrice(result.price || currentPrice),
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
                
                await interaction.editReply({ 
                    content: null, 
                    embeds: [embed], 
                    components: [] 
                });
            } else {
                // Handle cancellation
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