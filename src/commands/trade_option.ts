import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { calculateTimeToExpiry } from '../utils/blackScholes';

export const tradeOptionCommand: Command = {
    name: 'trade_option',
    description: 'Buy or write (sell) option contracts',
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
            name: 'position',
            description: 'Position type',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'Long (buy option)', value: 'long' },
                { name: 'Short (write option)', value: 'short' }
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
        },
        {
            name: 'quantity',
            description: 'Number of contracts to trade (each contract = 100 shares)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1,
            maxValue: 100  // Reasonable limit for paper trading
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const symbol = interaction.options.getString('symbol', true).toUpperCase();
            const optionType = interaction.options.getString('type', true) as 'call' | 'put';
            const position = interaction.options.getString('position', true) as 'long' | 'short';
            const strikePrice = interaction.options.getNumber('strike', true);
            const expiration = interaction.options.getString('expiration', true);
            const quantity = interaction.options.getInteger('quantity', true);
            
            // Validate expiration date format
            const expirationDate = new Date(expiration);
            if (isNaN(expirationDate.getTime())) {
                await interaction.editReply('Invalid expiration date format. Please use YYYY-MM-DD (e.g., 2025-06-20).');
                return;
            }
            
            // Calculate time to expiry for validation
            const timeToExpiry = calculateTimeToExpiry(expirationDate);
            if (timeToExpiry <= 0) {
                await interaction.editReply('Expiration date must be in the future.');
                return;
            }
            
            // Execute the trade
            const result = await optionsService.tradeOption(
                interaction.user.id,
                symbol,
                optionType,
                position,
                strikePrice,
                expiration,
                quantity
            );
            
            if (!result.success) {
                await interaction.editReply(`Option trade failed: ${result.message}`);
                return;
            }
            
            // Format responses
            const actionText = position === 'long' ? 'Bought' : 'Wrote';
            const colorCode = position === 'long' ? '#00FF00' : '#FF0000';
            const contractPrice = result.contract!.price * 100; // Per contract price (100 shares)
            const totalCost = contractPrice * quantity;
            
            // Create embed for response
            const embed = new EmbedBuilder()
                .setTitle(`${actionText} ${symbol} ${optionType.toUpperCase()} Option`)
                .setDescription(result.message)
                .setColor(colorCode)
                .addFields([
                    { 
                        name: 'Option Details', 
                        value: `${symbol} ${strikePrice.toFixed(2)} ${optionType.toUpperCase()} exp. ${expirationDate.toLocaleDateString()}`, 
                        inline: false 
                    },
                    { 
                        name: 'Contracts', 
                        value: `${quantity}`, 
                        inline: true 
                    },
                    { 
                        name: 'Price per Contract', 
                        value: formatCurrency(contractPrice), 
                        inline: true 
                    },
                    { 
                        name: 'Total Value', 
                        value: formatCurrency(totalCost),
                        inline: true 
                    },
                    { 
                        name: 'Position', 
                        value: position === 'long' ? 'Long (bought)' : 'Short (written)', 
                        inline: true 
                    },
                    { 
                        name: 'Days to Expiration', 
                        value: `${(timeToExpiry * 365).toFixed(0)} days`,
                        inline: true 
                    }
                ])
                .setFooter({ 
                    text: `Transaction time: ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Trade option command error:', error);
            await interaction.editReply('An error occurred while executing your option trade. Please try again later.');
        }
    }
};