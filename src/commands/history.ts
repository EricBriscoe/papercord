import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

// Define a combined transaction type to handle both stocks and options
interface CombinedTransaction {
    type: 'stock' | 'option';
    symbol: string;
    timestamp: Date | string;
    // For stocks
    quantity?: number;
    price?: number;
    action?: 'buy' | 'sell';
    // For options
    optionType?: 'call' | 'put';
    position?: 'long' | 'short';
    strikePrice?: number;
    expirationDate?: string;
    status?: string;
    profitLoss?: number;
    isSecured?: boolean;
}

export const historyCommand: Command = {
    name: 'history',
    description: 'View your transaction history (stocks and options)',
    options: [
        {
            name: 'limit',
            description: 'Number of transactions to show (default: 10, max: 25)',
            type: ApplicationCommandOptionType.Integer,
            required: false,
            minValue: 1,
            maxValue: 25
        },
        {
            name: 'type',
            description: 'Type of transactions to show',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                { name: 'All', value: 'all' },
                { name: 'Stocks', value: 'stocks' },
                { name: 'Options', value: 'options' }
            ]
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const limit = interaction.options.getInteger('limit') || 10;
            const type = interaction.options.getString('type') || 'all';
            
            // Get transactions based on selected type
            let stockTransactions: any[] = [];
            let optionsTransactions: any[] = [];
            
            if (type === 'all' || type === 'stocks') {
                stockTransactions = tradingService.getTransactionHistory(interaction.user.id, limit);
            }
            
            if (type === 'all' || type === 'options') {
                optionsTransactions = optionsService.getTransactionHistory(interaction.user.id, limit);
            }
            
            // Combine and convert transactions with explicit type casting
            const combinedTransactions: CombinedTransaction[] = [
                // Convert stock transactions with explicit casting
                ...stockTransactions.map((tx: any): CombinedTransaction => ({
                    type: 'stock' as const,
                    symbol: tx.symbol,
                    timestamp: tx.timestamp,
                    quantity: tx.quantity,
                    price: tx.price,
                    action: tx.type // 'buy' or 'sell'
                })),
                
                // Convert option transactions with explicit casting
                ...optionsTransactions.map((tx: any): CombinedTransaction => ({
                    type: 'option' as const,
                    symbol: tx.symbol,
                    timestamp: tx.timestamp,
                    optionType: tx.optionType, // 'call' or 'put'
                    position: tx.position, // 'long' or 'short'
                    strikePrice: tx.strikePrice,
                    expirationDate: tx.expirationDate,
                    quantity: tx.quantity,
                    price: tx.price,
                    status: tx.status, // 'open', 'close', 'expire', 'exercise'
                    profitLoss: tx.profitLoss,
                    isSecured: tx.isSecured
                }))
            ];
            
            // Sort all transactions by timestamp (newest first)
            const sortedTransactions = combinedTransactions.sort((a, b) => {
                const dateA = new Date(a.timestamp).getTime();
                const dateB = new Date(b.timestamp).getTime();
                return dateB - dateA; // Descending order
            }).slice(0, limit); // Limit the number of transactions
            
            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username}'s Transaction History`)
                .setColor('#0099ff')
                .setTimestamp();
            
            if (sortedTransactions.length === 0) {
                embed.setDescription('You have not made any transactions yet.');
            } else {
                let transactionsText = '';
                
                sortedTransactions.forEach((tx: CombinedTransaction) => {
                    const formattedDate = formatTimestamp(tx.timestamp);
                    
                    if (tx.type === 'stock') {
                        // Format stock transaction
                        const typeEmoji = tx.action === 'buy' ? '🟢' : '🔴';
                        const typeColor = tx.action === 'buy' ? 'Buy' : 'Sell';
                        
                        transactionsText += `**${typeEmoji} ${typeColor} Stock:** ${tx.symbol} | `;
                        transactionsText += `${tx.quantity} shares @ ${formatCurrency(tx.price!)} | `;
                        transactionsText += `Total: ${formatCurrency(tx.quantity! * tx.price!)} | `;
                        transactionsText += `${formattedDate}\n\n`;
                    } else {
                        // Format option transaction
                        const optionEmoji = tx.position === 'long' ? '📈' : '📉';
                        const actionText = getOptionActionText(tx.position!, tx.status!);
                        
                        transactionsText += `**${optionEmoji} ${actionText}:** ${tx.symbol} ${tx.optionType!.toUpperCase()} | `;
                        transactionsText += `Strike: ${formatCurrency(tx.strikePrice!)} | `;
                        transactionsText += `Exp: ${new Date(tx.expirationDate!).toLocaleDateString()} | `;
                        transactionsText += `${tx.quantity} contract${tx.quantity! > 1 ? 's' : ''} @ ${formatCurrency(tx.price! * 100)}/contract | `;
                        
                        // Add profit/loss for closed positions
                        if (tx.status === 'close' || tx.status === 'exercise' || tx.status === 'expire') {
                            const plPrefix = tx.profitLoss! >= 0 ? '✅ +' : '❌ ';
                            transactionsText += `P/L: ${plPrefix}${formatCurrency(tx.profitLoss!)} | `;
                        }
                        
                        // Add secured info for short positions
                        if (tx.position === 'short' && tx.isSecured) {
                            const securedText = tx.optionType === 'call' ? 'Covered Call' : 'Cash-Secured Put';
                            transactionsText += `${securedText} | `;
                        }
                        
                        transactionsText += `${formattedDate}\n\n`;
                    }
                });
                
                embed.setDescription(transactionsText);
            }
            
            // Add filter information to footer
            let footerText = `Showing ${sortedTransactions.length} recent transactions`;
            if (type !== 'all') {
                footerText += ` (${type} only)`;
            }
            embed.setFooter({ text: footerText });
            
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error('History command error:', error);
            await interaction.editReply('An error occurred while fetching your transaction history. Please try again later.');
        }
    }
};

/**
 * Get a descriptive text for the option action based on position and status
 */
function getOptionActionText(position: string, status: string): string {
    if (position === 'long') {
        switch (status) {
            case 'open': return 'Buy Option';
            case 'close': return 'Sell Option';
            case 'expire': return 'Option Expired';
            case 'exercise': return 'Option Exercised';
            default: return 'Option';
        }
    } else {
        switch (status) {
            case 'open': return 'Write Option';
            case 'close': return 'Close Option';
            case 'expire': return 'Option Expired';
            case 'exercise': return 'Option Assigned';
            default: return 'Option';
        }
    }
}