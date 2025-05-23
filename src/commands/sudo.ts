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
    ADJUST_CASH = 'adjust_cash',
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
                    name: 'confirm',
                    description: 'Type "confirm" to confirm the reset (this cannot be undone)',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'starting_balance',
                    description: 'Starting balance (default: $100,000)',
                    type: ApplicationCommandOptionType.Number,
                    required: false
                }
            ]
        },
        {
            name: SudoSubcommand.ADJUST_CASH,
            description: 'Adjust a user\'s cash balance (add or remove funds)',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'user_id',
                    description: 'Discord user ID to modify balance for',
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: 'amount',
                    description: 'Amount to add (positive) or remove (negative) from balance',
                    type: ApplicationCommandOptionType.Number,
                    required: true
                },
                {
                    name: 'reason',
                    description: 'Reason for adjustment (e.g. bug compensation, error correction)',
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        },
        // More subcommands can be added here in the future
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
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
            case SudoSubcommand.ADJUST_CASH:
                await executeAdjustCash(interaction);
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

/**
 * Adjust a user's cash balance (subcommand handler)
 */
async function executeAdjustCash(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.options.getString('user_id', true);
    const amount = interaction.options.getNumber('amount', true);
    const reason = interaction.options.getString('reason', true);
    
    try {
        // Check if user exists first
        const userExists = db.prepare('SELECT 1 FROM users WHERE userId = ?').get(userId);
        
        if (!userExists) {
            console.log(`Superuser ${interaction.user.id} attempted to adjust cash for non-existent user ${userId}`);
            await interaction.editReply(`User ID ${userId} does not exist in the database. No action taken.`);
            return;
        }
        
        // Get current cash balance
        const currentBalance = userDb.getCashBalance(userId);
        const newBalance = currentBalance + amount;
        
        // Prevent negative balances if removing funds would result in negative balance
        if (newBalance < 0) {
            await interaction.editReply(`Cannot adjust balance: User ${userId} has ${currentBalance.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            })} but you're trying to remove ${Math.abs(amount).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            })}. This would result in a negative balance.`);
            return;
        }
        
        // Log the adjustment
        console.log(`Superuser ${interaction.user.id} is adjusting cash for user ${userId}: ${amount > 0 ? '+' : ''}${amount} (Reason: ${reason})`);
        
        // Update the cash balance
        userDb.updateCashBalance(userId, newBalance);
        
        // Record this as a special transaction for auditing
        const transactionType = amount > 0 ? 'received' : 'removed';
        db.prepare(`
            INSERT INTO transactions (userId, symbol, quantity, price, type)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, 'ADMIN', 1, Math.abs(amount), 'admin');
        
        // Create success embed
        const actionType = amount > 0 ? 'added to' : 'removed from';
        const embed = new EmbedBuilder()
            .setTitle('Admin Action: Cash Adjustment')
            .setDescription(`${Math.abs(amount).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD'
            })} has been ${actionType} <@${userId}>'s account.`)
            .setColor(amount > 0 ? '#00FF00' : '#FF0000')
            .addFields([
                { name: 'New Balance', value: newBalance.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD'
                }), inline: true },
                { name: 'Adjustment', value: `${amount > 0 ? '+' : ''}${amount.toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD'
                })}`, inline: true },
                { name: 'Reason', value: reason, inline: false },
                { name: 'Executed By', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Target User', value: `<@${userId}>`, inline: true },
            ])
            .setFooter({ text: 'Superuser Command' })
            .setTimestamp();
            
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Adjust cash error:', error);
        await interaction.editReply(`An error occurred while adjusting cash for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}