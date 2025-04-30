import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../models/command';
import { subscribeChannel, unsubscribeChannel, isChannelSubscribed } from '../database/operations';

export const subscribeCommand: Command = {
    name: 'subscribe',
    description: 'Toggle subscription for this channel to receive margin and options event notifications.',
    options: [],
    async execute(interaction: ChatInputCommandInteraction) {
        const channelId = interaction.channelId;
        const currentlySubscribed = isChannelSubscribed(channelId);
        let message;
        if (currentlySubscribed) {
            unsubscribeChannel(channelId);
            message = 'This channel has been unsubscribed from margin and options notifications.';
        } else {
            subscribeChannel(channelId);
            message = 'This channel is now subscribed to margin and options notifications.';
        }
        await interaction.editReply({ content: message });
    }
};
