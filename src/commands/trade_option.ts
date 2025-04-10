import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

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
        },
        {
            name: 'secured',
            description: 'Use covered calls or cash-secured puts (for short positions only)',
            type: ApplicationCommandOptionType.Boolean,
            required: false
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const symbol = interaction.options.getString('symbol', true);
        const optionType = interaction.options.getString('type', true) as 'call' | 'put';
        const position = interaction.options.getString('position', true) as 'long' | 'short';
        const strikePrice = interaction.options.getNumber('strike', true);
        const expirationDate = interaction.options.getString('expiration', true);
        const quantity = interaction.options.getInteger('quantity', true);
        const useSecured = interaction.options.getBoolean('secured') || false;
        
        // Validate expiration date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(expirationDate)) {
            await interaction.editReply('Invalid expiration date format. Please use YYYY-MM-DD.');
            return;
        }
        
        // Check if expiration date is in the past
        const expDate = new Date(expirationDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (expDate < today) {
            await interaction.editReply('Expiration date cannot be in the past.');
            return;
        }
        
        try {
            // Calculate option price to display in confirmation
            const priceResult = await optionsService.calculateOptionPrice(
                symbol,
                optionType,
                strikePrice,
                expirationDate
            );
            
            if (!priceResult.price) {
                await interaction.editReply(`Error calculating option price: ${priceResult.error || 'Unknown error'}`);
                return;
            }
            
            // Calculate total cost/premium for the contracts
            const CONTRACT_SIZE = 100; // 100 shares per contract
            const contractPrice = priceResult.price * CONTRACT_SIZE;
            const totalAmount = contractPrice * quantity;
            
            // For short positions, check margin requirement or secured status
            let marginRequired = 0;
            let isSecured = false;
            
            if (position === 'short') {
                if (useSecured) {
                    // Check if covered call or cash-secured put is possible
                    if (optionType === 'call') {
                        // Check if user has enough shares for covered call
                        const isCovered = await optionsService.isCoveredCall(
                            interaction.user.id,
                            symbol,
                            strikePrice,
                            quantity
                        );
                        
                        if (!isCovered) {
                            await interaction.editReply(
                                `You don't have enough shares of ${symbol} to write a covered call. ` +
                                `You need at least ${quantity * CONTRACT_SIZE} shares.`
                            );
                            return;
                        }
                        isSecured = true;
                    } else {
                        // Check if user has enough cash for cash-secured put
                        const isCashSecured = await optionsService.isCashSecuredPut(
                            interaction.user.id,
                            symbol,
                            strikePrice,
                            quantity
                        );
                        
                        if (!isCashSecured) {
                            await interaction.editReply(
                                `You don't have enough cash to secure this put. ` +
                                `You need ${formatCurrency(strikePrice * CONTRACT_SIZE * quantity)}.`
                            );
                            return;
                        }
                        isSecured = true;
                    }
                } else {
                    // Calculate margin requirement
                    marginRequired = await optionsService.calculateMarginRequirement(
                        symbol,
                        optionType,
                        strikePrice,
                        position,
                        priceResult.price,
                        false
                    );
                    
                    // Check if user has enough margin available
                    const { sufficient, marginStatus } = await optionsService.hasSufficientMargin(
                        interaction.user.id,
                        marginRequired * quantity
                    );
                    
                    if (!sufficient) {
                        await interaction.editReply(
                            `You don't have enough margin available. ` +
                            `Required: ${formatCurrency(marginRequired * quantity)}, ` +
                            `Available: ${formatCurrency(marginStatus.availableMargin - marginStatus.marginUsed)}`
                        );
                        return;
                    }
                }
            }
            
            // Create option symbol for display
            const optionSymbol = optionsService.formatOptionSymbol(
                symbol,
                expirationDate,
                optionType,
                strikePrice
            );
            
            // Execute the trade
            const result = await optionsService.tradeOption(
                interaction.user.id,
                symbol,
                optionType,
                position,
                strikePrice,
                expirationDate,
                quantity,
                useSecured
            );
            
            if (!result.success) {
                await interaction.editReply(result.message);
                return;
            }
            
            // Build success message embed
            const embed = new EmbedBuilder()
                .setTitle(`Option Trade: ${symbol.toUpperCase()} ${optionType.toUpperCase()}`)
                .setDescription(result.message)
                .setColor('#00FF00')
                .addFields([
                    {
                        name: 'Contract Details',
                        value: `Symbol: ${optionSymbol}\n` +
                               `Strike: ${formatCurrency(strikePrice)}\n` +
                               `Expiration: ${new Date(expirationDate).toLocaleDateString()}\n` +
                               `Quantity: ${quantity} contract${quantity > 1 ? 's' : ''}\n` +
                               `Price/Premium: ${formatCurrency(contractPrice)} per contract\n` +
                               `Total: ${formatCurrency(totalAmount)}`
                    }
                ]);
            
            // Add margin/secured info for short positions
            if (position === 'short') {
                if (isSecured) {
                    const securedText = optionType === 'call' ? 'Covered Call' : 'Cash-Secured Put';
                    embed.addFields({
                        name: 'Collateral',
                        value: securedText
                    });
                } else {
                    embed.addFields({
                        name: 'Margin Required',
                        value: formatCurrency(marginRequired * quantity)
                    });
                    
                    // Get margin status after the trade
                    const marginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
                    embed.addFields({
                        name: 'Margin Usage',
                        value: `${marginStatus.utilizationPercentage.toFixed(2)}% of available margin`
                    });
                }
            }
            
            embed.setFooter({ 
                text: `Transaction time: ${formatTimestamp(new Date())}` 
            }).setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Trade option command error:', error);
            await interaction.editReply(`An error occurred while processing your options trade: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
};