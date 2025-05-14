import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ComponentType } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { userDb, portfolioDb } from '../database/operations';

export const tradeOptionCommand: Command = {
    name: 'trade_option',
    description: 'Buy or write option contracts',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'type',
            description: 'Option type (call or put)',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Call', value: 'call' },
                { name: 'Put', value: 'put' }
            ]
        },
        {
            name: 'position',
            description: 'Position type (long = buy, short = write/sell)',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Long (Buy)', value: 'long' },
                { name: 'Short (Write)', value: 'short' }
            ]
        },
        {
            name: 'strike',
            description: 'Strike price ($)',
            type: ApplicationCommandOptionType.Number,
            required: true,
            minValue: 1
        },
        {
            name: 'expiration',
            description: 'Expiration date (YYYY-MM-DD)',
            type: ApplicationCommandOptionType.String,
            required: true
        },
        {
            name: 'quantity',
            description: 'Number of contracts (each controls 100 shares)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        const symbol = interaction.options.getString('symbol', true);
        const optionType = interaction.options.getString('type', true) as 'call' | 'put';
        const strikePrice = interaction.options.getNumber('strike', true);
        const expirationDate = interaction.options.getString('expiration', true);
        const quantity = interaction.options.getInteger('quantity', true);

        // Validate expiration date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        if (!dateRegex.test(expirationDate)) {
            await interaction.editReply({ content: 'Invalid expiration date format. Please use YYYY-MM-DD.' });
            return;
        }

        const expDate = new Date(expirationDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (expDate < today) {
            await interaction.editReply({ content: 'Expiration date cannot be in the past.' });
            return;
        }

        try {
            const priceResult = await optionsService.calculateOptionPrice(
                symbol,
                optionType,
                strikePrice,
                expirationDate
            );

            if (!priceResult.price) {
                await interaction.editReply({ content: `Error calculating option price: ${priceResult.error || 'Unknown error'}` });
                return;
            }

            const CONTRACT_SIZE = 100;
            const contractPrice = priceResult.price * CONTRACT_SIZE;

            // Calculate max contracts for long (cash) and short (margin)
            const userId = interaction.user.id;
            const cashBalance = userDb.getCashBalance(userId);

            // Max contracts for long (buy): floor(cash / contractPrice)
            const maxLong = Math.floor(cashBalance / contractPrice);

            // Max contracts for short (write):
            let maxShort = 0;

            const marginStatus = await optionsService.calculateMarginStatus(userId);
            const marginPerContract = await optionsService.calculateMarginRequirement(
                symbol,
                optionType,
                strikePrice,
                'short',
                priceResult.price,
                false
            );

            if (marginPerContract > 0) {
                maxShort = Math.floor((marginStatus.availableMargin - marginStatus.marginUsed) / marginPerContract);
            }

            // Create option symbol for display
            const optionSymbol = optionsService.formatOptionSymbol(
                symbol,
                expirationDate,
                optionType,
                strikePrice
            );

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle(`${symbol.toUpperCase()} ${optionType.toUpperCase()} Option`)
                .setDescription(`Strike: $${strikePrice.toFixed(2)} | Expires: ${expDate.toLocaleDateString()}`)
                .setColor(optionType === 'call' ? '#00FF00' : '#FF0000')
                .addFields([
                    { name: 'Option Symbol', value: optionSymbol, inline: false },
                    { name: 'Price per Contract', value: formatCurrency(contractPrice), inline: true },
                    { name: 'Your Cash', value: formatCurrency(cashBalance), inline: true },
                    { name: 'Max Buy', value: maxLong > 0 ? `${maxLong} contract(s)` : 'Insufficient cash', inline: true },
                    { name: 'Max Write', value: maxShort > 0 ? `${maxShort} contract(s)` : 'Insufficient margin', inline: true },
                ])
                .setFooter({ text: `Calculated using Black-Scholes | ${formatTimestamp(new Date())}` })
                .setTimestamp();

            // Button logic
            let buyBtn, writeBtn;

            if (quantity > 0 && quantity <= maxLong) {
                buyBtn = new ButtonBuilder()
                    .setCustomId(`trade_buy_qty`)
                    .setLabel(`Buy ${quantity} Contract${quantity > 1 ? 's' : ''}`)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(false);
            } else {
                buyBtn = new ButtonBuilder()
                    .setCustomId(`trade_buy_1`)
                    .setLabel('Buy 1 Contract')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(maxLong < 1);
            }

            if (quantity > 0 && quantity <= maxShort) {
                writeBtn = new ButtonBuilder()
                    .setCustomId(`trade_write_qty`)
                    .setLabel(`Write ${quantity} Contract${quantity > 1 ? 's' : ''}`)
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(false);
            } else {
                writeBtn = new ButtonBuilder()
                    .setCustomId(`trade_write_1`)
                    .setLabel('Write 1 Contract')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(maxShort < 1);
            }

            const buyMaxBtn = new ButtonBuilder()
                .setCustomId(`trade_buy_max`)
                .setLabel(`Buy Max (${maxLong})`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(maxLong < 1);

            const writeMaxBtn = new ButtonBuilder()
                .setCustomId(`trade_write_max`)
                .setLabel(`Write Max (${maxShort})`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(maxShort < 1);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buyBtn, buyMaxBtn, writeBtn, writeMaxBtn);

            const response = await interaction.editReply({ embeds: [embed], components: [row] });

            const collector = response.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });

            collector.on('collect', async (btnInt) => {
                if (btnInt.user.id !== userId) {
                    await btnInt.reply({ content: 'These buttons are not for you.', ephemeral: true });
                    return;
                }

                await btnInt.deferUpdate();

                let action: 'buy' | 'write';
                let qty: number;

                if (btnInt.customId === 'trade_buy_1') {
                    action = 'buy';
                    qty = 1;
                } else if (btnInt.customId === 'trade_buy_max') {
                    action = 'buy';
                    qty = maxLong;
                } else if (btnInt.customId === 'trade_buy_qty') {
                    action = 'buy';
                    qty = quantity;
                } else if (btnInt.customId === 'trade_write_1') {
                    action = 'write';
                    qty = 1;
                } else if (btnInt.customId === 'trade_write_max') {
                    action = 'write';
                    qty = maxShort;
                } else if (btnInt.customId === 'trade_write_qty') {
                    action = 'write';
                    qty = quantity;
                } else return;

                // Show confirmation embed
                const confirmEmbed = new EmbedBuilder()
                    .setTitle('Confirm Option Trade')
                    .setDescription(`Are you sure you want to ${action === 'buy' ? 'buy' : 'write'} ${qty} contract(s) of ${optionSymbol}?`)
                    .addFields(
                        { name: 'Type', value: optionType.toUpperCase(), inline: true },
                        { name: 'Strike', value: formatCurrency(strikePrice), inline: true },
                        { name: 'Expiration', value: new Date(expirationDate).toLocaleDateString(), inline: true },
                        { name: 'Quantity', value: `${qty}`, inline: true },
                        { name: 'Price/Contract', value: formatCurrency(contractPrice), inline: true },
                        { name: 'Total', value: formatCurrency(contractPrice * qty), inline: true }
                    )
                    .setColor(action === 'buy' ? '#00FF00' : '#FF0000')
                    .setFooter({ text: `Confirm your trade | ${formatTimestamp(new Date())}` })
                    .setTimestamp();

                const confirmBtn = new ButtonBuilder().setCustomId('trade_confirm').setLabel('Confirm').setStyle(ButtonStyle.Success);
                const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn);

                await btnInt.editReply({ embeds: [confirmEmbed], components: [confirmRow] });

                // Wait for confirm
                const confirmCollector = btnInt.message.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });

                confirmCollector.on('collect', async (confirmInt) => {
                    if (confirmInt.user.id !== userId) {
                        await confirmInt.reply({ content: 'These buttons are not for you.', ephemeral: true });
                        return;
                    }

                    if (confirmInt.customId === 'trade_confirm') {
                        // Execute trade
                        const tradeResult = await optionsService.tradeOption(
                            userId,
                            symbol,
                            optionType,
                            action === 'buy' ? 'long' : 'short',
                            strikePrice,
                            expirationDate,
                            qty,
                            false
                        );

                        const resultEmbed = new EmbedBuilder()
                            .setTitle(`Option Trade: ${symbol.toUpperCase()} ${optionType.toUpperCase()}`)
                            .setDescription(tradeResult.message)
                            .setColor(tradeResult.success ? '#00FF00' : '#FF0000')
                            .setFooter({ text: `Transaction time: ${formatTimestamp(new Date())}` })
                            .setTimestamp();

                        if (tradeResult.success && tradeResult.contract) {
                            resultEmbed.addFields({
                                name: 'Contract Details',
                                value: `Symbol: ${optionSymbol}\nStrike: ${formatCurrency(strikePrice)}\nExpiration: ${new Date(expirationDate).toLocaleDateString()}\nQuantity: ${qty} contract${qty > 1 ? 's' : ''}\nPrice/Premium: ${formatCurrency(contractPrice)} per contract\nTotal: ${formatCurrency(contractPrice * qty)}`
                            });
                            if (
                                tradeResult.contract.position === 'short' &&
                                typeof tradeResult.contract.marginRequired === 'number' &&
                                tradeResult.contract.marginRequired > 0
                            ) {
                                resultEmbed.addFields({ name: 'Margin Required', value: formatCurrency(tradeResult.contract.marginRequired) });
                            }
                        }

                        // Delete the original reply (removes the message with buttons)
                        await interaction.deleteReply();
                        await interaction.followUp({ embeds: [resultEmbed] });
                        confirmCollector.stop();
                        collector.stop();
                    }
                });

                confirmCollector.on('end', async () => {
                    try {
                        await btnInt.editReply({ components: [] });
                    } catch {}
                });
            });

            collector.on('end', async () => {
                buyBtn.setDisabled(true);
                buyMaxBtn.setDisabled(true);
                writeBtn.setDisabled(true);
                writeMaxBtn.setDisabled(true);
                try {
                    await interaction.editReply({ embeds: [embed], components: [row] });
                } catch {}
            });
        } catch (error) {
            console.error('Trade option command error:', error);
            await interaction.editReply({ content: `An error occurred while processing your options trade: ${error instanceof Error ? error.message : 'Unknown error'}` });
        }
    }
};
