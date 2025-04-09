import { ApplicationCommandOptionData, ChatInputCommandInteraction } from 'discord.js';

export interface Command {
    name: string;
    description: string;
    options: ApplicationCommandOptionData[];
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}