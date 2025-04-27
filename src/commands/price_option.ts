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
                        value: `${Math.round(timeToExpiry)} days (${(timeToExpiry / 365).toFixed(2)} years)`, 
                        inline: false
                    }
                ])
                .setFooter({ 
                    text: `Calculated using Black-Scholes model | ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
            
            // Initial selection state
            let selectedSide: 'buy' | 'write' = 'buy';
            let selectedQty: number = 1;
            let maxLong = 1;
            let maxShort = 1;
            // Calculate max contracts for the user
            try {
                const userId = interaction.user.id;
                const cashBalance = optionsService['userDb']?.getCashBalance?.(userId) ?? 0;
                maxLong = Math.floor(cashBalance / contractPrice) || 1;
                const marginStatus = await optionsService.calculateMarginStatus(userId);
                const marginPerContract = await optionsService.calculateMarginRequirement(
                    symbol,
                    optionType,
                    strikePrice,
                    'short',
                    pricePerShare,
                    false
                );
                if (marginPerContract > 0) {
                    maxShort = Math.floor((marginStatus.availableMargin - marginStatus.marginUsed) / marginPerContract) || 1;
                }
            } catch {}
            // Helper to build buttons
            function buildButtons(side: 'buy' | 'write', qty: number) {
                return [
                    new ButtonBuilder()
                        .setCustomId('buy_1')
                        .setLabel('Buy 1')
                        .setStyle(side === 'buy' && qty === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('buy_max')
                        .setLabel(`Buy Max (${maxLong})`)
                        .setStyle(side === 'buy' && qty === maxLong ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('write_1')
                        .setLabel('Write 1')
                        .setStyle(side === 'write' && qty === 1 ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('write_max')
                        .setLabel(`Write Max (${maxShort})`)
                        .setStyle(side === 'write' && qty === maxShort ? ButtonStyle.Primary : ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('confirm_order')
                        .setLabel('Confirm Order')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(false)
                ];
            }
            // Helper to build confirmation embed
            function buildConfirmEmbed(side: 'buy' | 'write', qty: number) {
                return new EmbedBuilder()
                    .setTitle('Confirm Option Trade')
                    .setDescription(`Are you sure you want to ${side === 'buy' ? 'buy' : 'write'} ${qty} contract(s) of ${optionSymbol}?`)
                    .addFields(
                        { name: 'Type', value: optionType.toUpperCase(), inline: true },
                        { name: 'Strike', value: formatCurrency(strikePrice), inline: true },
                        { name: 'Expiration', value: expirationDate.toLocaleDateString(), inline: true },
                        { name: 'Quantity', value: `${qty}`, inline: true },
                        { name: 'Price/Contract', value: formatCurrency(contractPrice), inline: true },
                        { name: 'Total', value: formatCurrency(contractPrice * qty), inline: true }
                    )
                    .setColor(side === 'buy' ? '#00FF00' : '#FF0000')
                    .setFooter({ text: `Confirm your trade | ${formatTimestamp(new Date())}` })
                    .setTimestamp();
            }
            // Initial buttons and embed
            let actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buildButtons(selectedSide, selectedQty));
            let confirmEmbed = buildConfirmEmbed(selectedSide, selectedQty);
            let msg = await interaction.editReply({ embeds: [embed, confirmEmbed], components: [actionRow] });
            // Collector for button interactions
            const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 3600000 });
            collector.on('collect', async (btnInt) => {
                if (btnInt.user.id !== interaction.user.id) {
                    await btnInt.reply({ content: 'These buttons are not for you.', ephemeral: true });
                    return;
                }
                await btnInt.deferUpdate();
                if (btnInt.customId === 'buy_1') {
                    selectedSide = 'buy'; selectedQty = 1;
                } else if (btnInt.customId === 'buy_max') {
                    selectedSide = 'buy'; selectedQty = maxLong;
                } else if (btnInt.customId === 'write_1') {
                    selectedSide = 'write'; selectedQty = 1;
                } else if (btnInt.customId === 'write_max') {
                    selectedSide = 'write'; selectedQty = maxShort;
                } else if (btnInt.customId === 'confirm_order') {
                    // Submit the order
                    const result = await optionsService.tradeOption(
                        interaction.user.id,
                        symbol,
                        optionType,
                        selectedSide === 'buy' ? 'long' : 'short',
                        strikePrice,
                        expiration,
                        selectedQty,
                        false
                    );
                    const resultEmbed = new EmbedBuilder()
                        .setTitle(`Option Trade: ${symbol.toUpperCase()} ${optionType.toUpperCase()}`)
                        .setDescription(result.message)
                        .setColor(result.success ? '#00FF00' : '#FF0000')
                        .setFooter({ text: `Transaction time: ${formatTimestamp(new Date())}` })
                        .setTimestamp();
                    if (result.success && result.contract) {
                        resultEmbed.addFields({
                            name: 'Contract Details',
                            value: `Symbol: ${optionSymbol}\nStrike: ${formatCurrency(strikePrice)}\nExpiration: ${expirationDate.toLocaleDateString()}\nQuantity: ${selectedQty} contract${selectedQty > 1 ? 's' : ''}\nPrice/Premium: ${formatCurrency(contractPrice)} per contract\nTotal: ${formatCurrency(contractPrice * selectedQty)}`
                        });
                        if (
                            result.contract.position === 'short' &&
                            typeof result.contract.marginRequired === 'number' &&
                            result.contract.marginRequired > 0
                        ) {
                            resultEmbed.addFields({ name: 'Margin Required', value: formatCurrency(result.contract.marginRequired) });
                        }
                    }
                    await btnInt.editReply({ embeds: [embed, resultEmbed], components: [] });
                    collector.stop();
                    return;
                }
                // Update buttons and confirmation embed
                actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buildButtons(selectedSide, selectedQty));
                confirmEmbed = buildConfirmEmbed(selectedSide, selectedQty);
                await btnInt.editReply({ embeds: [embed, confirmEmbed], components: [actionRow] });
            });
            collector.on('end', async () => {
                // Disable all buttons
                actionRow.components.forEach(btn => btn.setDisabled(true));
                try {
                    await interaction.editReply({ embeds: [embed, confirmEmbed], components: [actionRow] });
                } catch {}
            });
        } catch (error) {
            console.error('Price option command error:', error);
            await interaction.editReply('An error occurred while calculating the option price. Please check your inputs and try again.');
        }
    }
};