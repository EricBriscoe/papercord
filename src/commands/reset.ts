import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import db from '../database/database';

export const resetCommand: Command = {
    name: 'reset',
    description: 'Reset your paper trading account back to $100,000',
    options: [
        {
            name: 'confirm',
            description: 'Type "confirm" to confirm the reset (this cannot be undone)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply({ ephemeral: true });
        
        const confirm = interaction.options.getString('confirm', true);
        
        if (confirm.toLowerCase() !== 'confirm') {
            await interaction.editReply('You must type "confirm" to reset your account. Action canceled.');
            return;
        }
        
        try {
            // Delete all portfolio entries for this user
            const deletePortfolio = db.prepare(`
                DELETE FROM portfolio WHERE userId = ?
            `);
            deletePortfolio.run(interaction.user.id);
            
            // Delete all transaction history for this user
            const deleteTransactions = db.prepare(`
                DELETE FROM transactions WHERE userId = ?
            `);
            deleteTransactions.run(interaction.user.id);
            
            // Delete all options positions for this user
            const deleteOptionsPositions = db.prepare(`
                DELETE FROM options_positions WHERE userId = ?
            `);
            deleteOptionsPositions.run(interaction.user.id);
            
            // Delete all options transactions for this user
            const deleteOptionsTransactions = db.prepare(`
                DELETE FROM options_transactions WHERE userId = ?
            `);
            deleteOptionsTransactions.run(interaction.user.id);
            
            // Reset cash balance to default ($100,000)
            const resetBalance = db.prepare(`
                UPDATE users SET cashBalance = 100000.00 WHERE userId = ?
            `);
            resetBalance.run(interaction.user.id);
            
            // If user doesn't exist yet, create them
            const insertUser = db.prepare(`
                INSERT OR IGNORE INTO users (userId, cashBalance) VALUES (?, 100000.00)
            `);
            insertUser.run(interaction.user.id);
            
            const embed = new EmbedBuilder()
                .setTitle('Account Reset')
                .setDescription('Your paper trading account has been reset to $100,000. All your positions, options, and transaction history have been cleared.')
                .setColor('#00FF00')
                .setTimestamp();
                
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('Reset command error:', error);
            await interaction.editReply('An error occurred while resetting your account. Please try again later.');
        }
    }
};