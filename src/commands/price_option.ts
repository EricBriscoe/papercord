import { ApplicationCommandOptionType, ButtonStyle, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ComponentType, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { calculateTimeToExpiry } from '../utils/blackScholes';

export const priceOptionCommand: Command = {
    name: 'price_option',
    description: 'Calculate the price of an option contract using Black-Scholes model',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'type',
            description: 'Option type',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Call', value: 'call' },
                { name: 'Put', value: 'put' }
            ]
        },
        {
            name: 'strike',
            description: 'Strike price',
            type: ApplicationCommandOptionType.Number,
            required: true,
            minValue: 0.01
        },
        {
            name: 'expiration',
            description: 'Expiration date (YYYY-MM-DD)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const symbol = interaction.options.getString('symbol', true).toUpperCase();
            const optionType = interaction.options.getString('type', true) as 'call' | 'put';
            const strikePrice = interaction.options.getNumber('strike', true);
            const expiration = interaction.options.getString('expiration', true);
            
            // Validate expiration date format
            const expirationDate = new Date(expiration);
            if (isNaN(expirationDate.getTime())) {
                await interaction.editReply('Invalid expiration date format. Please use YYYY-MM-DD (e.g., 2025-06-20).');
                return;
            }
            
            // Calculate time to expiry in years for display
            const timeToExpiry = calculateTimeToExpiry(expirationDate);
            
            // Check if expiration is in the past
            if (timeToExpiry <= 0) {
                await interaction.editReply('Expiration date must be in the future.');
                return;
            }
            
            // Calculate option price
            const priceData = await optionsService.calculateOptionPrice(
                symbol,
                optionType,
                strikePrice,
                expiration
            );
            
            if (!priceData.price) {
                await interaction.editReply(`Could not calculate option price. ${priceData.error || 'Please check your inputs and try again.'}`);
                return;
            }
            
            // Options are priced per share, but contracts are for 100 shares
            const pricePerShare = priceData.price;
            const contractPrice = pricePerShare * 100;
            
            // Create option symbol in standard format
            const optionSymbol = optionsService.formatOptionSymbol(symbol, expiration, optionType, strikePrice);
            
            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`${symbol} ${optionType.toUpperCase()} Option Price`)
                .setDescription(`Strike: $${strikePrice.toFixed(2)} | Expires: ${expirationDate.toLocaleDateString()}`)
                .setColor(optionType === 'call' ? '#00FF00' : '#FF0000')
                .addFields([
                    { 
                        name: 'Option Symbol', 
                        value: optionSymbol,
                        inline: false 
                    },
                    { 
                        name: 'Price per Share', 
                        value: formatCurrency(pricePerShare), 
                        inline: true 
                    },
                    { 
                        name: 'Price per Contract (100 shares)', 
                        value: formatCurrency(contractPrice), 
                        inline: true 
                    },
                    { 
                        name: 'Time to Expiry', 
                        value: `${(timeToExpiry * 365).toFixed(0)} days (${timeToExpiry.toFixed(2)} years)`, 
                        inline: false
                    }
                ])
                .setFooter({ 
                    text: `Calculated using Black-Scholes model | ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
            
            // Create buttons for buy and sell actions
            const buyButton = new ButtonBuilder()
                .setCustomId(`buy_option:${symbol}:${optionType}:${strikePrice}:${expiration}:1`)
                .setLabel('Buy 1 Contract')
                .setStyle(ButtonStyle.Success);
                
            const sellButton = new ButtonBuilder()
                .setCustomId(`sell_option:${symbol}:${optionType}:${strikePrice}:${expiration}:1`)
                .setLabel('Write 1 Contract')
                .setStyle(ButtonStyle.Danger);
            
            // Create action row with buttons
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buyButton, sellButton);
            
            // Send the message with the embed and buttons
            const response = await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
            
            // Create collector for button interactions
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 3_600_000, // 1 hour timeout
            });
            
            // Handle button interactions
            collector.on('collect', async (buttonInteraction) => {
                // Removed the user check to allow any user to click the buttons
                await buttonInteraction.deferUpdate();
                
                // Parse the custom ID to get the option details
                const [action, sym, type, strike, exp, qty] = buttonInteraction.customId.split(':');
                const quantity = parseInt(qty);
                const strikeValue = parseFloat(strike);
                
                try {
                    let result;
                    
                    // Execute the appropriate action based on the button clicked
                    if (action === 'buy_option') {
                        // Buy option (long position)
                        result = await optionsService.tradeOption(
                            buttonInteraction.user.id, // Use the ID of the user who clicked the button
                            sym,
                            type as 'call' | 'put',
                            'long',
                            strikeValue,
                            exp,
                            quantity,
                            false // Not applicable for long positions
                        );
                    } else {
                        // Sell/write option (short position)
                        result = await optionsService.tradeOption(
                            buttonInteraction.user.id, // Use the ID of the user who clicked the button
                            sym,
                            type as 'call' | 'put',
                            'short',
                            strikeValue,
                            exp,
                            quantity,
                            false // Not secured by default from quick buttons
                        );
                    }
                    
                    // Create a new embed based on the result
                    const resultEmbed = new EmbedBuilder()
                        .setTitle(`Option Trade: ${sym.toUpperCase()} ${type.toUpperCase()}`)
                        .setDescription(result.message)
                        .setColor(result.success ? '#00FF00' : '#FF0000')
                        .setFooter({ 
                            text: `Transaction time: ${formatTimestamp(new Date())}` 
                        })
                        .setTimestamp();
                    
                    if (result.success && result.contract) {
                        // Add detailed information about the contract
                        resultEmbed.addFields([
                            {
                                name: 'Contract Details',
                                value: `Symbol: ${optionSymbol}\n` +
                                       `Strike: ${formatCurrency(strikeValue)}\n` +
                                       `Expiration: ${new Date(exp).toLocaleDateString()}\n` +
                                       `Quantity: ${quantity} contract${quantity > 1 ? 's' : ''}\n` +
                                       `Price/Premium: ${formatCurrency(contractPrice)} per contract\n` +
                                       `Total: ${formatCurrency(contractPrice * quantity)}`
                            }
                        ]);
                        
                        // Add margin information for short positions
                        if (result.contract.position === 'short' && result.contract.marginRequired > 0) {
                            resultEmbed.addFields({
                                name: 'Margin Required',
                                value: formatCurrency(result.contract.marginRequired)
                            });
                        }
                    }
                    
                    // Reply with the result in a new message that mentions the user who clicked the button
                    await interaction.followUp({
                        content: `<@${buttonInteraction.user.id}>, your option trade has been processed:`,
                        embeds: [resultEmbed]
                    });
                } catch (error) {
                    console.error('Button interaction error:', error);
                    await interaction.followUp({
                        content: `<@${buttonInteraction.user.id}>, an error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        ephemeral: true
                    });
                }
            });
            
            // When the collector times out, disable the buttons
            collector.on('end', async () => {
                buyButton.setDisabled(true);
                sellButton.setDisabled(true);
                
                try {
                    await interaction.editReply({
                        embeds: [embed],
                        components: [row]
                    });
                } catch (e) {
                    // Message might be too old to edit, ignore errors
                    console.log('Could not disable buttons on expired message');
                }
            });
        } catch (error) {
            console.error('Price option command error:', error);
            await interaction.editReply('An error occurred while calculating the option price. Please check your inputs and try again.');
        }
    }
};