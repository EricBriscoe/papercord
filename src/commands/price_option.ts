import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
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
                
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Price option command error:', error);
            await interaction.editReply('An error occurred while calculating the option price. Please check your inputs and try again.');
        }
    }
};