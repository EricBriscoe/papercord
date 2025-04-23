import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

export const closeOptionCommand: Command = {
    name: 'close_option',
    description: 'Close an existing options position',
    options: [
        {
            name: 'position_id',
            description: 'ID of the option position (find it in your options portfolio)',
            type: ApplicationCommandOptionType.Integer,
            required: true,
            minValue: 1
        },
        {
            name: 'quantity',
            description: 'Number of contracts to close (default: all)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        try {
            const positionId = interaction.options.getInteger('position_id', true);
            const partialQuantity = interaction.options.getInteger('quantity');
            
            // Execute the closing operation
            const result = await optionsService.closePosition(
                interaction.user.id,
                positionId,
                partialQuantity || 0  // If no quantity specified, the service will close the whole position
            );
            
            // Create response embed
            const embed = new EmbedBuilder()
                .setTitle('Close Option Position')
                .setDescription(result.message)
                .setColor(result.success ? '#00FF00' : '#FF0000')
                .setFooter({ 
                    text: `Transaction time: ${formatTimestamp(new Date())}` 
                })
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Close option command error:', error);
            await interaction.editReply('An error occurred while closing your option position. Please try again later.');
        }
    }
};