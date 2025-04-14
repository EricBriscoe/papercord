import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { optionsService } from '../services/optionsService';
import { formatTimestamp } from '../utils/formatters';
import { marginDb } from '../database/operations';
import { 
    INITIAL_MARGIN_PERCENTAGE, 
    MAINTENANCE_MARGIN_PERCENTAGE, 
    WARNING_THRESHOLD, 
    MARGIN_CALL_THRESHOLD,
    LIQUIDATION_THRESHOLD,
    getMarginStatusText,
    getMarginStatusColor,
    formatCurrency
} from '../utils/marginConstants';

export const marginCommand: Command = {
    name: 'margin',
    description: 'View your margin status, manage active margin calls, and control your margin settings',
    options: [
        {
            name: 'view',
            type: 1, // SUB_COMMAND
            description: 'View your margin status and available margin',
            options: []
        },
        {
            name: 'calls',
            type: 1, // SUB_COMMAND
            description: 'View and manage your active margin calls',
            options: []
        },
        {
            name: 'history',
            type: 1, // SUB_COMMAND
            description: 'View your margin call history',
            options: [
                {
                    name: 'limit',
                    type: 4, // INTEGER
                    description: 'Number of historical margin calls to show',
                    required: false
                }
            ]
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'view':
                return await viewMarginStatus(interaction);
            case 'calls':
                return await manageMarginCalls(interaction);
            case 'history':
                const limit = interaction.options.getInteger('limit') || 10;
                return await viewMarginCallHistory(interaction, limit);
            default:
                return await viewMarginStatus(interaction);
        }
    }
};

/**
 * View detailed margin status with new tiered margin requirements
 */
async function viewMarginStatus(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    
    try {
        // Get user's portfolio to calculate available margin
        const portfolio = await tradingService.getPortfolio(interaction.user.id);
        
        // Calculate margin values based on tiered structure
        const totalPortfolioValue = portfolio.totalValue; // Cash + equity value
        
        // Get current margin usage and generate detailed margin status
        const marginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
        
        // Calculate key margin metrics using tiered structure
        const initialMarginAvailable = totalPortfolioValue * INITIAL_MARGIN_PERCENTAGE;
        const maintenanceMarginRequired = totalPortfolioValue * MAINTENANCE_MARGIN_PERCENTAGE;
        const currentMarginUsed = marginStatus.marginUsed;
        
        // Check margin call status
        const marginEquityRatio = (totalPortfolioValue - currentMarginUsed) / totalPortfolioValue;
        
        // Format metrics for display
        const marginUsedPercent = (currentMarginUsed / initialMarginAvailable) * 100;
        const marginEquityPercentage = marginEquityRatio * 100;
        const marginStatus_text = getMarginStatusText(marginEquityRatio);
        const marginColor = getMarginStatusColor(marginEquityRatio);
        
        // Create response embed
        const embed = new EmbedBuilder()
            .setTitle('Margin Status')
            .setColor(marginColor)
            .setDescription('Your margin uses a tiered system:\n' + 
                           `• **Initial Margin**: ${(INITIAL_MARGIN_PERCENTAGE * 100)}% - Required to open positions\n` +
                           `• **Maintenance Margin**: ${(MAINTENANCE_MARGIN_PERCENTAGE * 100)}% - Minimum to keep positions open\n` +
                           `• **Liquidation Threshold**: ${(LIQUIDATION_THRESHOLD * 100)}% - Positions will be liquidated below this level`)
            .addFields([
                { 
                    name: 'Total Portfolio Value', 
                    value: formatCurrency(totalPortfolioValue), 
                    inline: true 
                },
                { 
                    name: 'Cash Balance', 
                    value: formatCurrency(portfolio.cashBalance), 
                    inline: true 
                },
                { 
                    name: 'Initial Margin Available', 
                    value: formatCurrency(initialMarginAvailable), 
                    inline: true 
                },
                { 
                    name: 'Maintenance Margin Required', 
                    value: formatCurrency(maintenanceMarginRequired), 
                    inline: true 
                },
                { 
                    name: 'Current Margin Used', 
                    value: formatCurrency(currentMarginUsed), 
                    inline: true 
                },
                { 
                    name: 'Margin Usage', 
                    value: `${marginUsedPercent.toFixed(2)}% of initial margin`, 
                    inline: true 
                },
                {
                    name: 'Equity/Value Ratio',
                    value: `${marginEquityPercentage.toFixed(2)}%`,
                    inline: true
                },
                {
                    name: 'Margin Status',
                    value: marginStatus_text,
                    inline: true
                }
            ])
            .setFooter({ 
                text: `Last updated: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
        
        // Get pending margin calls
        const pendingCalls = marginDb.getPendingMarginCalls(interaction.user.id);
        if (pendingCalls.length > 0) {
            embed.addFields([{
                name: '⚠️ Active Margin Calls ⚠️',
                value: `You have ${pendingCalls.length} active margin call${pendingCalls.length > 1 ? 's' : ''}. Use \`/margin calls\` to view and respond.`,
                inline: false
            }]);
        }
            
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Margin command error:', error);
        await interaction.editReply('An error occurred while fetching your margin status. Please try again later.');
    }
}

/**
 * Manage active margin calls with response options
 */
async function manageMarginCalls(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();
    
    try {
        // Get active margin calls for this user
        const pendingCalls = marginDb.getPendingMarginCalls(interaction.user.id);
        
        if (pendingCalls.length === 0) {
            await interaction.editReply('You have no active margin calls. Your account is in good standing.');
            return;
        }
        
        // Create an embed to show margin calls
        const embed = new EmbedBuilder()
            .setTitle('Active Margin Calls')
            .setColor('#FF0000')
            .setDescription(`You have ${pendingCalls.length} active margin call${pendingCalls.length > 1 ? 's' : ''} that require attention.`);
        
        // Add each margin call as a field
        pendingCalls.forEach((call, index) => {
            embed.addFields({
                name: `Margin Call #${index + 1}`,
                value: `Amount: ${formatCurrency(call.amount)}\nReason: ${call.reason}\nCreated: ${formatTimestamp(new Date(call.createdAt))}\nID: ${call.id}`,
                inline: false
            });
        });
        
        // Create action buttons
        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('deposit_funds')
                    .setLabel('Deposit Funds')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('close_positions')
                    .setLabel('Close Positions')
                    .setStyle(ButtonStyle.Danger)
            );
        
        // Create a select menu if there are multiple calls
        let selectRow: ActionRowBuilder<StringSelectMenuBuilder> | undefined = undefined;
        if (pendingCalls.length > 1) {
            const select = new StringSelectMenuBuilder()
                .setCustomId('select_margin_call')
                .setPlaceholder('Select a margin call to respond to')
                .addOptions(
                    pendingCalls.map((call, i) => new StringSelectMenuOptionBuilder()
                        .setLabel(`Margin Call #${i+1}`)
                        .setDescription(`${formatCurrency(call.amount)} - ${call.reason.substring(0, 50)}`)
                        .setValue(call.id!.toString())
                    )
                );
            
            selectRow = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(select);
        }
        
        // Send the message with components
        const components = selectRow ? [selectRow, row] : [row];
        const message = await interaction.editReply({
            embeds: [embed],
            components: components as any[]
        });
        
        // Create a collector for button interactions
        const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes
        
        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({ content: 'These controls are not for you!', ephemeral: true });
                return;
            }
            
            // Handle the selection of a specific margin call
            if (i.customId === 'select_margin_call') {
                if (!i.isStringSelectMenu()) return;
                const selectedId = parseInt(i.values[0]);
                await i.update({ content: `You selected margin call #${selectedId}. Please choose an action.` });
                return;
            }
            
            await i.deferUpdate();
            
            if (i.customId === 'deposit_funds') {
                // Simulate depositing funds to cover the margin call
                const totalAmount = pendingCalls.reduce((sum, call) => sum + call.amount, 0);
                await handleDepositFunds(interaction, i, totalAmount);
                collector.stop();
            } else if (i.customId === 'close_positions') {
                // Show UI for selecting positions to close
                await handleClosePositions(interaction, i);
                collector.stop();
            }
        });
        
        collector.on('end', async () => {
            // Remove buttons after timeout
            try {
                await interaction.editReply({ components: [] });
            } catch (error) {
                console.error('Error removing buttons after timeout:', error);
            }
        });
        
    } catch (error) {
        console.error('Margin calls command error:', error);
        await interaction.editReply('An error occurred while fetching your margin calls. Please try again later.');
    }
}

/**
 * View history of past margin calls
 */
async function viewMarginCallHistory(interaction: ChatInputCommandInteraction, limit: number) {
    await interaction.deferReply();
    
    try {
        // Get margin call history
        const history = marginDb.getMarginCallHistory(interaction.user.id, limit);
        
        if (history.length === 0) {
            await interaction.editReply('You have no margin call history.');
            return;
        }
        
        // Create an embed to show margin call history
        const embed = new EmbedBuilder()
            .setTitle('Margin Call History')
            .setColor('#0099ff')
            .setDescription(`Your last ${history.length} margin call${history.length > 1 ? 's' : ''}:`);
        
        // Add each margin call as a field
        history.forEach((call, index) => {
            const statusEmoji = call.status === 'satisfied' ? '✅' : '❌';
            
            embed.addFields({
                name: `${statusEmoji} Margin Call (${formatTimestamp(new Date(call.createdAt))})`,
                value: `Amount: ${formatCurrency(call.amount)}\nReason: ${call.reason}\nStatus: ${call.status}${call.resolvedAt ? '\nResolved: ' + formatTimestamp(new Date(call.resolvedAt)) : ''}`,
                inline: false
            });
        });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Margin history command error:', error);
        await interaction.editReply('An error occurred while fetching your margin call history. Please try again later.');
    }
}

/**
 * Handle the deposit funds action
 */
async function handleDepositFunds(
    interaction: ChatInputCommandInteraction, 
    buttonInteraction: any, 
    amount: number
) {
    try {
        // Add the amount to the user's cash balance
        const userService = await import('../services/tradingService');
        
        // Get current cash balance
        const userPortfolio = await userService.tradingService.getPortfolio(interaction.user.id);
        const currentCash = userPortfolio.cashBalance;
        
        // Update cash balance
        const { userDb } = await import('../database/operations');
        userDb.updateCashBalance(interaction.user.id, currentCash + amount);
        
        // Resolve all pending margin calls for this user
        const pendingCalls = marginDb.getPendingMarginCalls(interaction.user.id);
        for (const call of pendingCalls) {
            marginDb.resolveMarginCall(call.id!, 'satisfied');
        }
        
        // Recalculate margin status
        const newMarginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
        
        // Show confirmation message
        const embed = new EmbedBuilder()
            .setTitle('Funds Deposited')
            .setColor('#00FF00')
            .setDescription(`You've successfully deposited ${formatCurrency(amount)} to meet your margin call requirements.`)
            .addFields(
                {
                    name: 'New Cash Balance',
                    value: formatCurrency(currentCash + amount),
                    inline: true
                },
                {
                    name: 'New Margin Usage',
                    value: `${newMarginStatus.utilizationPercentage.toFixed(2)}%`,
                    inline: true
                }
            );
        
        await interaction.editReply({
            embeds: [embed],
            components: []
        });
        
    } catch (error) {
        console.error('Deposit funds error:', error);
        await interaction.editReply({
            content: 'An error occurred while processing your deposit. Please try again later.',
            components: []
        });
    }
}

/**
 * Handle the close positions action
 */
async function handleClosePositions(
    interaction: ChatInputCommandInteraction,
    buttonInteraction: any
) {
    try {
        // Fetch user's options portfolio
        const portfolio = await optionsService.getOptionsPortfolio(interaction.user.id);
        
        if (portfolio.positions.length === 0) {
            await interaction.editReply({
                content: 'You have no open positions to close.',
                components: []
            });
            return;
        }
        
        // Filter to show only positions that use margin (short positions)
        const shortPositions = portfolio.positions.filter(pos => pos.position === 'short' && !pos.isSecured);
        
        if (shortPositions.length === 0) {
            await interaction.editReply({
                content: 'You have no margin-using positions to close.',
                components: []
            });
            return;
        }
        
        // Create an embed to show positions
        const embed = new EmbedBuilder()
            .setTitle('Select Positions to Close')
            .setColor('#FF9900')
            .setDescription('Select positions to close in order to meet your margin requirements:');
        
        // Create buttons for each position
        const components: ActionRowBuilder<ButtonBuilder>[] = [];
        
        for (let i = 0; i < shortPositions.length; i++) {
            const pos = shortPositions[i];
            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`close_${pos.id}`)
                        .setLabel(`${pos.symbol} ${pos.optionType} $${pos.strikePrice} (${pos.marginRequired || 0})`)
                        .setStyle(ButtonStyle.Danger)
                );
            
            components.push(row);
            
            // Add position details to embed
            embed.addFields({
                name: `${pos.symbol} ${pos.optionType.toUpperCase()} $${pos.strikePrice}`,
                value: `Quantity: ${pos.quantity}\nExpires: ${pos.formattedExpiration}\nMargin Required: ${formatCurrency(pos.marginRequired || 0)}`,
                inline: true
            });
        }
        
        // Add a done button
        const doneRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('close_done')
                    .setLabel('Done')
                    .setStyle(ButtonStyle.Primary)
            );
        
        components.push(doneRow);
        
        // Send the message with components
        const message = await interaction.editReply({
            embeds: [embed],
            components: components
        });
        
        // Create a collector for button interactions
        const collector = message.createMessageComponentCollector({ time: 300000 }); // 5 minutes
        
        let closedPositions = 0;
        
        collector.on('collect', async (i) => {
            if (i.user.id !== interaction.user.id) {
                await i.reply({ content: 'These controls are not for you!', ephemeral: true });
                return;
            }
            
            if (i.customId === 'close_done') {
                collector.stop();
                return;
            }
            
            if (i.customId.startsWith('close_')) {
                await i.deferUpdate();
                
                // Extract position ID and close it
                const positionId = parseInt(i.customId.substring(6));
                
                try {
                    const result = await optionsService.closePosition(interaction.user.id, positionId);
                    
                    if (result.success) {
                        closedPositions++;
                        
                        // Recalculate margin status
                        const newMarginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
                        
                        // Update the embed
                        embed.setDescription(`Closed ${closedPositions} position(s). New margin usage: ${newMarginStatus.utilizationPercentage.toFixed(2)}%`);
                        
                        // If margin is now ok, resolve margin calls
                        if (newMarginStatus.utilizationPercentage < 80) {
                            const pendingCalls = marginDb.getPendingMarginCalls(interaction.user.id);
                            for (const call of pendingCalls) {
                                marginDb.resolveMarginCall(call.id!, 'satisfied');
                            }
                            
                            embed.setColor('#00FF00');
                            embed.addFields({
                                name: '✅ Margin Calls Resolved',
                                value: 'You have successfully resolved your margin calls by closing positions.',
                                inline: false
                            });
                            
                            collector.stop();
                        }
                        
                        // Update the message
                        await i.editReply({ embeds: [embed] });
                    } else {
                        await i.followUp({ content: `Failed to close position: ${result.message}`, ephemeral: true });
                    }
                } catch (error) {
                    console.error('Close position error:', error);
                    await i.followUp({ content: 'An error occurred while closing the position.', ephemeral: true });
                }
            }
        });
        
        collector.on('end', async () => {
            // Show final summary
            if (closedPositions > 0) {
                const newMarginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
                const pendingCalls = marginDb.getPendingMarginCalls(interaction.user.id);
                
                const summaryEmbed = new EmbedBuilder()
                    .setTitle('Position Closure Summary')
                    .setColor(pendingCalls.length > 0 ? '#FF9900' : '#00FF00')
                    .setDescription(`You closed ${closedPositions} position(s).`)
                    .addFields(
                        {
                            name: 'New Margin Usage',
                            value: `${newMarginStatus.utilizationPercentage.toFixed(2)}%`,
                            inline: true
                        }
                    );
                
                if (pendingCalls.length > 0) {
                    summaryEmbed.addFields({
                        name: '⚠️ Margin Calls Still Active',
                        value: `You still have ${pendingCalls.length} active margin call(s). More action may be needed.`,
                        inline: false
                    });
                } else {
                    summaryEmbed.addFields({
                        name: '✅ Margin Calls Resolved',
                        value: 'All margin calls have been resolved.',
                        inline: false
                    });
                }
                
                await interaction.editReply({
                    embeds: [summaryEmbed],
                    components: []
                });
            } else {
                await interaction.editReply({
                    content: 'No positions were closed.',
                    components: []
                });
            }
        });
        
    } catch (error) {
        console.error('Close positions error:', error);
        await interaction.editReply({
            content: 'An error occurred while processing your request. Please try again later.',
            components: []
        });
    }
}