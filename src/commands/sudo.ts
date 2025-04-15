import { 
    ApplicationCommandOptionType, 
    ChatInputCommandInteraction, 
    EmbedBuilder,
    PermissionFlagsBits
} from 'discord.js';
import { Command } from '../models/command';
import db from '../database/database';
import { userDb } from '../database/operations';

// Superuser ID - only this user can run sudo commands
const SUPERUSER_ID = '131835640827346944';

/**
 * List of available sudo subcommands
 */
enum SudoSubcommand {
    RESET_USER = 'reset_user',
    // Add more subcommands here as needed
    // Example: BAN_USER = 'ban_user',
}

export const sudoCommand: Command = {
    name: 'sudo',
    description: 'Superuser commands for moderation (admin only)',
    options: [
        {
            name: SudoSubcommand.RESET_USER,
            description: 'Reset a user\'s paper trading account',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'user_id',
                    description: 'Discord user ID to reset',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'starting_balance',
                    description: 'Starting balance (default: $100,000)',
                    type: ApplicationCommandOptionType.Number,
                    required: false
                },
                {
                    name: 'confirm',
                    description: 'Type "confirm" to confirm the reset (this cannot be undone)',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
        // More subcommands can be added here in the future
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply({ ephemeral: true });
        
        // Security check - only allow the superuser to execute this command
        if (interaction.user.id !== SUPERUSER_ID) {
            await interaction.editReply({
                content: 'You do not have permission to use superuser commands.'
            });
            return;
        }
        
        // Get the subcommand that was executed
        const subcommand = interaction.options.getSubcommand();
        
        // Execute the appropriate subcommand
        switch (subcommand) {
            case SudoSubcommand.RESET_USER:
                await executeResetUser(interaction);
                break;
            default:
                await interaction.editReply({
                    content: `Unknown subcommand: ${subcommand}`
                });
        }
    }
};

/**
 * Reset a user's account (subcommand handler)
 */
async function executeResetUser(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.options.getString('user_id', true);
    const startingBalance = interaction.options.getNumber('starting_balance') || 100000.00;
    const confirm = interaction.options.getString('confirm', true);
    
    // Validate inputs
    if (confirm.toLowerCase() !== 'confirm') {
        await interaction.editReply('You must type "confirm" to reset the user\'s account. Action canceled.');
        return;
    }
    
    try {
        // Check if user exists first
        const userExists = db.prepare('SELECT 1 FROM users WHERE userId = ?').get(userId);
        
        if (!userExists) {
            // Create a log entry before proceeding
            console.log(`Superuser ${interaction.user.id} attempted to reset non-existent user ${userId}`);
            
            await interaction.editReply(`User ID ${userId} does not exist in the database. No action taken.`);
            return;
        }
        
        // Create a log entry
        console.log(`Superuser ${interaction.user.id} is resetting user ${userId} with balance ${startingBalance}`);
        
        // Begin database transaction
        const transaction = db.transaction(() => {
            // Delete all portfolio entries for this user
            db.prepare('DELETE FROM portfolio WHERE userId = ?').run(userId);
            
            // Delete all transaction history for this user
            db.prepare('DELETE FROM transactions WHERE userId = ?').run(userId);
            
            // Delete all options positions for this user
            db.prepare('DELETE FROM options_positions WHERE userId = ?').run(userId);
            
            // Delete all options transactions for this user
            db.prepare('DELETE FROM options_transactions WHERE userId = ?').run(userId);
            
            // Delete all cryptocurrency portfolio entries
            db.prepare('DELETE FROM crypto_portfolio WHERE userId = ?').run(userId);
            
            // Delete all cryptocurrency transactions
            db.prepare('DELETE FROM crypto_transactions WHERE userId = ?').run(userId);
            
            // Delete any margin calls
            db.prepare('DELETE FROM margin_calls WHERE userId = ?').run(userId);
            
            // Reset cash balance to specified amount
            db.prepare('UPDATE users SET cashBalance = ?, marginBalance = 0, marginUsed = 0 WHERE userId = ?')
                .run(startingBalance, userId);
        });
        
        // Execute the transaction
        transaction();
        
        const embed = new EmbedBuilder()
            .setTitle('Admin Action: Account Reset')
            .setDescription(`User ID: ${userId} has been reset with ${startingBalance.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            })}`)
            .setColor('#FF9900')
            .addFields([
                { name: 'Executed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Target User', value: `<@${userId}>`, inline: true },
            ])
            .setFooter({ text: 'Superuser Command' })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Reset user error:', error);
        await interaction.editReply(`An error occurred while resetting user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}