import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } from 'discord.js';
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
            name: 'quantity',
            description: 'Quantity of cryptocurrency to sell (e.g., 0.5) or leave blank to select from your portfolio',
            type: ApplicationCommandOptionType.String,
            required: false
        },
        {
            name: 'all',
            description: 'Sell your entire position in the selected cryptocurrency',
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
            
            // Get user's cryptocurrency portfolio
            const portfolio = cryptoPortfolioDb.getUserPortfolio(userId);
            
            if (!portfolio || portfolio.length === 0) {
                await interaction.editReply("You don't own any cryptocurrencies to sell. Use `/crypto_buy` to purchase some first.");
                return;
            }
            
            // Load current prices for user's cryptocurrencies
            const coinIds = portfolio.map(position => position.coinId);
            const prices = await cryptoTradingService.getMultiplePrices(coinIds);
            
            // Create portfolio items with current value
            const portfolioItems = portfolio.map(position => {
                const currentPrice = prices[position.coinId] || 0;
                const currentValue = position.quantity * currentPrice;
                return {
                    ...position,
                    currentPrice,
                    currentValue
                };
            });
            
            // Sort by value (highest first)
            portfolioItems.sort((a, b) => b.currentValue - a.currentValue);
            
            // Create selection menu options
            const coinOptions = portfolioItems.map(position => {
                return new StringSelectMenuOptionBuilder()
                    .setLabel(`${position.name} (${position.symbol.toUpperCase()})`)
                    .setDescription(`${position.quantity.toFixed(4)} coins, worth ~${formatCurrency(position.currentValue)}`)
                    .setValue(position.coinId);
            });
            
            // Show the selection menu
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('coin_selection')
                .setPlaceholder('Select a cryptocurrency from your portfolio')
                .addOptions(coinOptions);
            
            const row = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(selectMenu);
            
            const response = await interaction.editReply({
                content: 'Please select which cryptocurrency you want to sell:',
                components: [row]
            });
            
            // Create collector for the selection menu
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                time: 3 * 60 * 1000 // 3 minute timeout
            });
            
            collector.on('collect', async (i) => {
                // Make sure it's the same user who initiated the command
                if (i.user.id !== userId) {
                    await i.reply({ content: 'This selection menu is not for you.', ephemeral: true });
                    return;
                }
                
                await i.deferUpdate();
                
                const selectedCoinId = i.values[0];
                const position = portfolioItems.find(p => p.coinId === selectedCoinId);
                
                if (!position) {
                    await interaction.editReply('An error occurred while selecting the cryptocurrency. Please try again.');
                    return;
                }
                
                // Handle the selected cryptocurrency
                await handleCoinSelection(interaction, position, quantity, sellAll, minPrice);
                
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
            console.error('Error in crypto_sell command:', error);
            await interaction.editReply('An error occurred while processing your cryptocurrency sale. Please try again later.');
        }
    }
};

/**
 * Handle coin selection and proceed to confirmation or execution
 */
async function handleCoinSelection(
    interaction: ChatInputCommandInteraction,
    position: any,
    quantity: number | undefined,
    sellAll: boolean,
    minPrice: number | null
): Promise<void> {
    try {
        const userId = interaction.user.id;
        
        // If neither quantity nor sellAll is specified, ask for quantity now
        if (!quantity && !sellAll) {
            // Create a new menu with quantity options
            const quantityMenu = new ActionRowBuilder<any>()
                .addComponents(
                    { 
                        type: 2, 
                        style: 1, 
                        label: 'Sell 25%', 
                        customId: 'sell_25_percent' 
                    },
                    { 
                        type: 2, 
                        style: 1, 
                        label: 'Sell 50%', 
                        customId: 'sell_50_percent' 
                    },
                    { 
                        type: 2, 
                        style: 1, 
                        label: 'Sell 75%', 
                        customId: 'sell_75_percent' 
                    },
                    { 
                        type: 2, 
                        style: 3, 
                        label: 'Sell 100%', 
                        customId: 'sell_100_percent' 
                    },
                    { 
                        type: 2, 
                        style: 4, 
                        label: 'Cancel', 
                        customId: 'cancel_sell' 
                    }
                );
            
            const quantityMessage = await interaction.editReply({
                content: `How much ${position.name} (${position.symbol.toUpperCase()}) would you like to sell? You currently have ${position.quantity.toFixed(8)} coins.`,
                components: [quantityMenu]
            });
            
            // Create collector for the quantity buttons
            const quantityCollector = quantityMessage.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60 * 1000 // 1 minute timeout
            });
            
            quantityCollector.on('collect', async (i) => {
                // Make sure it's the same user who initiated the command
                if (i.user.id !== userId) {
                    await i.reply({ content: 'These buttons are not for you.', ephemeral: true });
                    return;
                }
                
                await i.deferUpdate();
                
                if (i.customId === 'cancel_sell') {
                    await interaction.editReply({
                        content: 'Cryptocurrency sale cancelled.',
                        components: []
                    });
                    return;
                }
                
                // Calculate quantity based on percentage
                let sellQuantity: number;
                let isSellAll = false;
                
                switch(i.customId) {
                    case 'sell_25_percent':
                        sellQuantity = position.quantity * 0.25;
                        break;
                    case 'sell_50_percent':
                        sellQuantity = position.quantity * 0.5;
                        break;
                    case 'sell_75_percent':
                        sellQuantity = position.quantity * 0.75;
                        break;
                    case 'sell_100_percent':
                        sellQuantity = position.quantity;
                        isSellAll = true;
                        break;
                    default:
                        await interaction.editReply('Invalid selection. Please try again.');
                        return;
                }
                
                // Process the sale with confirmation
                await confirmAndSell(interaction, position, sellQuantity, isSellAll, minPrice);
                
                // End the collector since we've handled the selection
                quantityCollector.stop();
            });
            
            quantityCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.editReply({
                        content: 'Quantity selection timed out. Please try again.',
                        components: []
                    });
                }
            });
            
            return;
        }
        
        // If we have a quantity or sellAll flag, proceed to confirmation
        const sellQuantity = sellAll ? position.quantity : quantity;
        
        if (sellQuantity && sellQuantity > position.quantity) {
            await interaction.editReply(`You only have ${position.quantity.toFixed(8)} ${position.symbol.toUpperCase()} available to sell.`);
            return;
        }
        
        await confirmAndSell(interaction, position, sellQuantity!, sellAll, minPrice);
        
    } catch (error) {
        console.error('Error handling coin selection for sell:', error);
        await interaction.editReply('An error occurred while processing your cryptocurrency sale. Please try again later.');
    }
}

/**
 * Show confirmation and execute the sell transaction
 */
async function confirmAndSell(
    interaction: ChatInputCommandInteraction,
    position: any,
    quantity: number,
    sellAll: boolean,
    minPrice: number | null
): Promise<void> {
    try {
        const userId = interaction.user.id;
        
        // Get current price again to ensure it's up to date
        const priceData = await coinGeckoService.getCoinPrice(position.coinId);
        
        if (!priceData.price) {
            await interaction.editReply(`Could not fetch current price for ${position.name} (${position.symbol.toUpperCase()}). Please try again later.`);
            return;
        }
        
        const currentPrice = priceData.price;
        
        // Check min price if specified
        if (minPrice && currentPrice < minPrice) {
            await interaction.editReply(`Current price (${formatCurrency(currentPrice)}) is lower than your minimum price (${formatCurrency(minPrice)}). Transaction not executed.`);
            return;
        }
        
        // Calculate proceeds estimate for display
        const estimatedProceeds = quantity * currentPrice;
        
        // Create confirmation embed
        const confirmEmbed = new EmbedBuilder()
            .setTitle('Confirm Cryptocurrency Sale')
            .setColor('#0099ff')
            .addFields([
                {
                    name: 'Cryptocurrency',
                    value: `${position.name} (${position.symbol.toUpperCase()})`,
                    inline: true
                },
                {
                    name: 'Coin ID',
                    value: position.coinId,
                    inline: true
                },
                {
                    name: 'Quantity to Sell',
                    value: sellAll ? `${quantity.toFixed(8)} (Full Position)` : quantity.toFixed(8),
                    inline: true
                },
                {
                    name: 'Current Price Per Coin',
                    value: formatCurrency(currentPrice),
                    inline: true
                },
                {
                    name: 'Estimated Proceeds',
                    value: formatCurrency(estimatedProceeds),
                    inline: true
                }
            ])
            .setFooter({ text: 'Please confirm or cancel this transaction.' })
            .setTimestamp();
        
        // Add profit/loss information
        const profitLossPerCoin = currentPrice - position.averagePurchasePrice;
        const totalProfitLoss = profitLossPerCoin * quantity;
        const profitLossPercent = (profitLossPerCoin / position.averagePurchasePrice) * 100;
        
        confirmEmbed.addFields({
            name: 'Profit/Loss',
            value: `${formatCurrency(totalProfitLoss)} (${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`,
            inline: true
        });
        
        // Create confirm/cancel buttons
        const confirmButton = new ActionRowBuilder<any>()
            .addComponents(
                { type: 2, style: 3, label: 'Confirm Sale', customId: 'confirm_sale' },
                { type: 2, style: 4, label: 'Cancel', customId: 'cancel_sale' }
            );
        
        const confirmMessage = await interaction.editReply({
            embeds: [confirmEmbed],
            components: [confirmButton]
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
            
            if (i.customId === 'confirm_sale') {
                // Execute sell operation
                const result = await cryptoTradingService.sellCrypto(
                    userId,
                    position.coinId,
                    sellAll ? undefined : quantity
                );
                
                if (!result.success) {
                    await interaction.editReply({
                        content: `Failed to sell cryptocurrency: ${result.message}`,
                        components: []
                    });
                    return;
                }
                
                // Create success embed
                const embed = new EmbedBuilder()
                    .setTitle('Cryptocurrency Sale Successful')
                    .setColor('#00ff00')
                    .addFields([
                        {
                            name: 'Cryptocurrency',
                            value: `${position.name} (${position.symbol.toUpperCase()})`,
                            inline: true
                        },
                        {
                            name: 'Coin ID',
                            value: position.coinId,
                            inline: true
                        },
                        {
                            name: 'Quantity Sold',
                            value: sellAll ? `${position.quantity.toFixed(8)} (Full Position)` : quantity.toFixed(8),
                            inline: true
                        },
                        {
                            name: 'Price Per Coin',
                            value: formatCurrency(result.price || currentPrice),
                            inline: true
                        },
                        {
                            name: 'Total Proceeds',
                            value: formatCurrency(result.proceeds || estimatedProceeds),
                            inline: true
                        },
                        {
                            name: 'Profit/Loss',
                            value: `${formatCurrency(totalProfitLoss)} (${profitLossPercent > 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%)`,
                            inline: true
                        }
                    ])
                    .setTimestamp();
                
                // Show remaining position if not selling all
                if (!sellAll) {
                    const remainingQuantity = position.quantity - quantity;
                    if (remainingQuantity > 0) {
                        embed.addFields({
                            name: 'Remaining Position',
                            value: `${remainingQuantity.toFixed(8)} ${position.symbol.toUpperCase()}`,
                            inline: true
                        });
                    }
                }
                
                await interaction.editReply({ embeds: [embed], components: [] });
            } else {
                // Cancel the transaction
                await interaction.editReply({
                    content: 'Cryptocurrency sale cancelled.',
                    embeds: [],
                    components: []
                });
            }
        });
        
        collector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await interaction.editReply({
                    content: 'Sale confirmation timed out. Transaction cancelled.',
                    embeds: [],
                    components: []
                });
            }
        });
    } catch (error) {
        console.error('Error in confirmation and sell process:', error);
        await interaction.editReply('An error occurred while processing your cryptocurrency sale. Please try again later.');
    }
}