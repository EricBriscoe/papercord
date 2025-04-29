import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { formatCurrency, formatNumber, formatTimestamp, formatCryptoAmount, formatCryptoPrice } from '../utils/formatters';
import { userDb } from '../database/operations';
import { optionsService } from '../services/optionsService';

// Maximum positions to display per page
const POSITIONS_PER_PAGE = 5;

// Portfolio view types
enum PortfolioView {
    SUMMARY = 'summary',
    STOCKS = 'stocks',
    CRYPTO = 'crypto',
    OPTIONS = 'options' // Added options view
}

// Sort types for portfolio positions
enum SortType {
    ALPHABETICAL = 'Alphabetical (A-Z)',
    ALPHABETICAL_REVERSE = 'Alphabetical (Z-A)',
    MARKET_VALUE_HIGH = 'Market Value (High to Low)',
    MARKET_VALUE_LOW = 'Market Value (Low to High)',
    PROFIT_LOSS_HIGH = 'Profit/Loss (High to Low)',
    PROFIT_LOSS_LOW = 'Profit/Loss (Low to High)',
    PERCENT_CHANGE_HIGH = 'Percent Change (High to Low)',
    PERCENT_CHANGE_LOW = 'Percent Change (Low to High)',
}

// Sort cycle order - the sequence to rotate through when clicking the sort button
const SORT_CYCLE = [
    SortType.ALPHABETICAL,
    SortType.MARKET_VALUE_HIGH,
    SortType.PROFIT_LOSS_HIGH,
    SortType.PERCENT_CHANGE_HIGH,
    SortType.ALPHABETICAL_REVERSE,
    SortType.MARKET_VALUE_LOW,
    SortType.PROFIT_LOSS_LOW,
    SortType.PERCENT_CHANGE_LOW
];

// Options view constants
const OPTIONS_POSITIONS_PER_PAGE = 3;

enum OptionSortType {
    EXPIRATION_ASC = 'Expiration (Nearest)',
    EXPIRATION_DESC = 'Expiration (Furthest)',
    PROFIT_LOSS_HIGH = 'Profit/Loss (High to Low)',
    PROFIT_LOSS_LOW = 'Profit/Loss (Low to High)',
    SYMBOL_ASC = 'Symbol (A-Z)',
    MARGIN_HIGH = 'Margin (High to Low)'
}

const OPTION_SORT_CYCLE = [
    OptionSortType.EXPIRATION_ASC,
    OptionSortType.SYMBOL_ASC,
    OptionSortType.PROFIT_LOSS_HIGH,
    OptionSortType.PROFIT_LOSS_LOW,
    OptionSortType.MARGIN_HIGH,
    OptionSortType.EXPIRATION_DESC
];

export const portfolioCommand: Command = {
    name: 'portfolio',
    description: 'View your current portfolio including stocks, cryptocurrencies, and options',
    options: [
        {
            name: 'view',
            description: 'Which part of your portfolio to view',
            type: ApplicationCommandOptionType.String,
            required: false,
            choices: [
                {
                    name: 'Summary (default)',
                    value: PortfolioView.SUMMARY
                },
                {
                    name: 'Stocks Only',
                    value: PortfolioView.STOCKS
                },
                {
                    name: 'Crypto Only',
                    value: PortfolioView.CRYPTO
                },
                {
                    name: 'Options Only',
                    value: PortfolioView.OPTIONS
                }
            ]
        },
        {
            name: 'user',
            description: 'User ID to look up (default: yourself)',
            type: ApplicationCommandOptionType.String,
            required: false
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        try {
            // Determine which view the user requested
            const viewOption = interaction.options.getString('view') || PortfolioView.SUMMARY;
            
            // Get target user ID - either the provided ID or the current user's ID
            const userOption = interaction.options.getString('user');
            let targetUserId = interaction.user.id;
            
            // Handle user mentions in the format <@123456789012345678>
            if (userOption) {
                // Extract user ID from mention format <@123456789012345678> or just use as-is
                const mentionMatch = userOption.match(/<@!?(\d+)>/);
                if (mentionMatch) {
                    targetUserId = mentionMatch[1];
                } else {
                    targetUserId = userOption;
                }
            }
            
            // Get username to display
            let targetUsername = interaction.user.username;
            if (targetUserId !== interaction.user.id) {
                try {
                    // Try to fetch user info from Discord
                    const targetUser = await interaction.client.users.fetch(targetUserId);
                    targetUsername = targetUser.username;
                } catch (error) {
                    console.error('Error fetching user:', error);
                    // Fall back to showing the user ID if we can't fetch the username
                    targetUsername = `User ${targetUserId}`;
                }
            }
            
            // Get all portfolio data
            const stockPortfolio = await tradingService.getPortfolio(targetUserId);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(targetUserId);
            
            // Format cryptoPortfolio to have expected properties
            const formattedCryptoPortfolio = {
                positions: cryptoPortfolio || [],
                totalValue: 0
            };
            
            // Calculate crypto total value
            if (cryptoPortfolio && cryptoPortfolio.length > 0) {
                formattedCryptoPortfolio.totalValue = cryptoPortfolio.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
            }
            
            // Get options portfolio value
            const optionsPortfolio = await optionsService.getOptionsPortfolio(targetUserId);
            
            // Get cash balance from userDb
            const cashBalance = userDb.getCashBalance(targetUserId);
            
            // Create a portfolio summary object with all needed values
            const portfolioSummary = {
                cashBalance: cashBalance,
                totalStockValue: stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0,
                totalCryptoValue: formattedCryptoPortfolio.totalValue,
                totalOptionsValue: optionsPortfolio.totalValue,
                totalPortfolioValue: cashBalance + 
                    (stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0) + 
                    formattedCryptoPortfolio.totalValue + 
                    optionsPortfolio.totalValue
            };
            
            // Pass the target username to the view functions
            // Show different views based on user selection
            switch (viewOption) {
                case PortfolioView.SUMMARY:
                    await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary, targetUsername, targetUserId, optionsPortfolio);
                    break;
                case PortfolioView.STOCKS:
                    await showStocksView(interaction, stockPortfolio, targetUsername, targetUserId);
                    break;
                case PortfolioView.CRYPTO:
                    await showCryptoView(interaction, formattedCryptoPortfolio, cashBalance, targetUsername, targetUserId);
                    break;
                case PortfolioView.OPTIONS:
                    await showOptionsView(interaction, optionsPortfolio, targetUsername, targetUserId);
                    break;
                default:
                    await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary, targetUsername, targetUserId, optionsPortfolio);
            }
        } catch (error) {
            console.error('Portfolio command error:', error);
            await interaction.editReply('An error occurred while fetching the portfolio. Please try again later.');
        }
    }
};

/**
 * Show the summary view of the portfolio (combined assets)
 */
async function showSummaryView(
    interaction: ChatInputCommandInteraction, 
    stockPortfolio: any, 
    cryptoPortfolio: any, 
    totalValue: any,
    targetUsername: string,
    targetUserId: string,
    optionsPortfolio?: any
) {
    // Check if portfolio is completely empty
    const hasStocks = stockPortfolio.positions && stockPortfolio.positions.length > 0;
    const hasCrypto = cryptoPortfolio.positions && cryptoPortfolio.positions.length > 0;
    const hasOptions = optionsPortfolio && optionsPortfolio.positions && optionsPortfolio.positions.length > 0;
    
    if (!hasStocks && !hasCrypto && !hasOptions) {
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your portfolio is currently empty. Use the `/buy`, `/crypto_buy`, or `/trade_option` commands to purchase assets.')
            .addFields({ 
                name: 'Cash Balance', 
                value: formatCurrency(totalValue.cashBalance), 
                inline: false 
            })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    
    // Create summary embed
    const embed = new EmbedBuilder()
        .setTitle(`${targetUsername}'s Portfolio Summary`)
        .setColor('#0099ff')
        .addFields([
            { 
                name: 'Cash Balance', 
                value: formatCurrency(totalValue.cashBalance), 
                inline: true
            },
            { 
                name: 'Total Stock Value', 
                value: formatCurrency(totalValue.totalStockValue), 
                inline: true
            },
            { 
                name: 'Total Crypto Value', 
                value: formatCurrency(totalValue.totalCryptoValue), 
                inline: true
            },
            { 
                name: 'Total Options Value', 
                value: formatCurrency(totalValue.totalOptionsValue), 
                inline: true
            },
            { 
                name: 'Total Portfolio Value', 
                value: formatCurrency(totalValue.totalPortfolioValue), 
                inline: false
            }
        ])
        .setTimestamp();
    
    // Add top positions from each category
    if (hasStocks) {
        // Sort stock positions by market value and get top 3
        const topStocks = [...stockPortfolio.positions]
            .sort((a, b) => b.marketValue - a.marketValue)
            .slice(0, 3);
        
        let stocksText = '';
        topStocks.forEach((pos: any) => {
            const profitLossSymbol = pos.profitLoss >= 0 ? '📈' : '📉';
            stocksText += `${pos.symbol}: ${formatCurrency(pos.marketValue)} ${profitLossSymbol} ${pos.percentChange.toFixed(2)}%\n`;
        });
        
        if (stockPortfolio.positions.length > 3) {
            stocksText += `...and ${stockPortfolio.positions.length - 3} more stocks`;
        }
        
        embed.addFields({
            name: `Top Stocks (${stockPortfolio.positions.length} total)`,
            value: stocksText || 'None',
            inline: false
        });
    }
    
    if (hasCrypto) {
        // Sort crypto positions by market value and get top 3
        const topCrypto = [...cryptoPortfolio.positions]
            .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
            .slice(0, 3);
        
        let cryptoText = '';
        topCrypto.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLossPercent || 0) >= 0 ? '📈' : '📉';
            // Add CoinGecko link inline with the coin name
            const coinLink = pos.coinId ? `[${pos.symbol}](https://www.coingecko.com/en/coins/${pos.coinId})` : pos.symbol;
            cryptoText += `${coinLink}: ${formatCurrency(pos.currentValue || 0)} ${profitLossSymbol} ${(pos.profitLossPercent || 0).toFixed(2)}%\n`;
        });
        
        if (cryptoPortfolio.positions.length > 3) {
            cryptoText += `...and ${cryptoPortfolio.positions.length - 3} more cryptocurrencies`;
        }
        
        embed.addFields({
            name: `Top Cryptocurrencies (${cryptoPortfolio.positions.length} total)`,
            value: cryptoText || 'None',
            inline: false
        });
    }

    if (hasOptions) {
        // Sort options by market value and get top 3
        const topOptions = [...optionsPortfolio.positions]
            .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
            .slice(0, 3);
        let optionsText = '';
        topOptions.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLoss || 0) >= 0 ? '📈' : '📉';
            optionsText += `${pos.symbol} ${pos.optionType.toUpperCase()} $${pos.strikePrice} (${pos.position}): ${formatCurrency(pos.marketValue || 0)} ${profitLossSymbol} ${(pos.percentChange || 0).toFixed(2)}%\n`;
        });
        if (optionsPortfolio.positions.length > 3) {
            optionsText += `...and ${optionsPortfolio.positions.length - 3} more options`;
        }
        embed.addFields({
            name: `Top Options (${optionsPortfolio.positions.length} total)`,
            value: optionsText || 'None',
            inline: false
        });
    }
    
    // Add buttons to switch views
    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('view_stocks')
                .setLabel('View Stocks')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasStocks),
            new ButtonBuilder()
                .setCustomId('view_crypto')
                .setLabel('View Crypto')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasCrypto),
            new ButtonBuilder()
                .setCustomId('view_options')
                .setLabel('View Options')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasOptions)
        );
    
    const message = await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
    
    // Create a collector for button interactions
    const collector = message.createMessageComponentCollector({
        time: 5 * 60 * 1000 // 5 minutes timeout
    });
    
    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'These buttons are not for you!', ephemeral: true });
            return;
        }
        
        // Handle button clicks
        if (i.customId === 'view_stocks') {
            await i.update({ components: [] });
            await showStocksView(interaction, stockPortfolio, targetUsername, targetUserId);
        } else if (i.customId === 'view_crypto') {
            await i.update({ components: [] });
            await showCryptoView(interaction, cryptoPortfolio, totalValue.cashBalance, targetUsername, targetUserId);
        } else if (i.customId === 'view_options') {
            await i.update({ components: [] });
            await showOptionsView(interaction, optionsPortfolio, targetUsername, targetUserId);
        }
    });
    
    collector.on('end', async (collected, reason) => {
        if (reason !== 'messageDelete') {
            // Remove buttons after timeout
            try {
                await interaction.editReply({
                    embeds: [embed],
                    components: []
                });
            } catch (error) {
                console.error('Error removing buttons after timeout:', error);
            }
        }
    });
}

/**
 * Generate buttons for summary view
 */
function generateSummaryButtons(hasStocks: boolean, hasCrypto: boolean, hasOptions: boolean) {
    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('view_stocks')
                .setLabel('View Stocks')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasStocks),
            new ButtonBuilder()
                .setCustomId('view_crypto')
                .setLabel('View Crypto')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasCrypto),
            new ButtonBuilder()
                .setCustomId('view_options')
                .setLabel('View Options')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!hasOptions)
        );
    
    return [row];
}

/**
 * Show the options view of the portfolio (options only)
 */
async function showOptionsView(interaction: ChatInputCommandInteraction, optionsPortfolio: any, targetUsername: string, targetUserId: string) {
    const marginStatus = await optionsService.calculateMarginStatus(targetUserId);
    if (!optionsPortfolio.positions || optionsPortfolio.positions.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Options Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your options portfolio is empty. Use `/trade_option` to start trading options.')
            .addFields([
                {
                    name: 'Margin Status',
                    value: `Available: ${formatCurrency(marginStatus.availableMargin)}\nUsed: ${formatCurrency(marginStatus.marginUsed)} (${marginStatus.utilizationPercentage.toFixed(2)}%)\nPortfolio Value: ${formatCurrency(marginStatus.portfolioValue)}`,
                    inline: false
                }
            ])
            .setTimestamp();
        await interaction.editReply({ embeds: [embed], components: [] });
        return;
    }
    let currentPage = 0;
    let currentSortIndex = 0;
    let sortedPositions = [...optionsPortfolio.positions];
    sortOptionPositions(sortedPositions, OPTION_SORT_CYCLE[currentSortIndex]);
    const totalPages = Math.ceil(sortedPositions.length / OPTIONS_POSITIONS_PER_PAGE);
    function sortOptionPositions(positions: any[], sortType: OptionSortType) {
        switch (sortType) {
            case OptionSortType.EXPIRATION_ASC:
                positions.sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());
                break;
            case OptionSortType.EXPIRATION_DESC:
                positions.sort((a, b) => new Date(b.expirationDate).getTime() - new Date(a.expirationDate).getTime());
                break;
            case OptionSortType.PROFIT_LOSS_HIGH:
                positions.sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0));
                break;
            case OptionSortType.PROFIT_LOSS_LOW:
                positions.sort((a, b) => (a.profitLoss || 0) - (b.profitLoss || 0));
                break;
            case OptionSortType.SYMBOL_ASC:
                positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
                break;
            case OptionSortType.MARGIN_HIGH:
                positions.sort((a, b) => (b.marginRequired || 0) - (a.marginRequired || 0));
                break;
        }
        return positions;
    }
    const generateEmbed = (page: number, positions: any[], sortType: OptionSortType) => {
        const startIndex = page * OPTIONS_POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + OPTIONS_POSITIONS_PER_PAGE, positions.length);
        const currentPositions = positions.slice(startIndex, endIndex);
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Options Portfolio (Page ${page + 1}/${totalPages})`)
            .setColor('#0099ff')
            .addFields([
                {
                    name: 'Margin Status',
                    value: `Available: ${formatCurrency(marginStatus.availableMargin)}\nUsed: ${formatCurrency(marginStatus.marginUsed)} (${marginStatus.utilizationPercentage.toFixed(2)}%)`,
                    inline: false
                }
            ])
            .setFooter({
                text: `Sorting: ${sortType} | Last updated: ${formatTimestamp(new Date())}`
            })
            .setTimestamp();
        currentPositions.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLoss || 0) >= 0 ? '📈' : '📉';
            const contractType = pos.position === 'long' ? `Long ${pos.quantity} ${pos.optionType}${pos.quantity > 1 ? 's' : ''}` : `Short ${pos.quantity} ${pos.optionType}${pos.quantity > 1 ? 's' : ''}`;
            const optionSymbol = optionsService.formatOptionSymbol(
                pos.symbol,
                pos.expirationDate,
                pos.optionType,
                pos.strikePrice
            );
            const positionDetails = [
                `**${optionSymbol}**`,
                `Strike: ${formatCurrency(pos.strikePrice)}`,
                `Expiration: ${pos.formattedExpiration || new Date(pos.expirationDate).toLocaleDateString()}`,
                `Time to Expiry: ${Math.round(pos.timeToExpiry || 0)} days`,
                `Moneyness: ${pos.moneyness}`,
                `Price when Opened: ${formatCurrency((pos.purchasePrice || 0) * 100)} per contract`,
                `Current Price: ${formatCurrency((pos.currentPrice || 0) * 100)} per contract`,
                `Market Value: ${formatCurrency(pos.marketValue || 0)}`,
                pos.marginRequired ? `Margin Required: ${formatCurrency(pos.marginRequired)}` : '',
                `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss || 0)} (${(pos.percentChange || 0).toFixed(2)}%)`
            ].filter(line => line).join('\n');
            embed.addFields({
                name: `${pos.symbol} ${pos.optionType.toUpperCase()} $${pos.strikePrice} - ${contractType}`,
                value: positionDetails,
                inline: false
            });
        });
        return embed;
    };
    const createButtons = (currentPage: number, includeBackButton = true) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (includeBackButton) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('back_to_summary')
                    .setLabel('Back to Summary')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === totalPages - 1)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('sort')
                .setLabel('Sort')
                .setStyle(ButtonStyle.Success)
        );
        // Close position buttons for each position on the page
        const closeRows: ActionRowBuilder<ButtonBuilder>[] = [];
        const startIndex = currentPage * OPTIONS_POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + OPTIONS_POSITIONS_PER_PAGE, sortedPositions.length);
        const currentPositions = sortedPositions.slice(startIndex, endIndex);
        for (let i = 0; i < currentPositions.length; i++) {
            const position = currentPositions[i];
            const closeRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`close_${position.id}`)
                        .setLabel(`Close ${position.symbol} ${position.optionType.toUpperCase()}`)
                        .setStyle(ButtonStyle.Danger)
                );
            closeRows.push(closeRow);
        }
        return [row, ...closeRows];
    };
    const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage, sortedPositions, OPTION_SORT_CYCLE[currentSortIndex])],
        components: createButtons(currentPage)
    });
    let collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000
    });
    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'These buttons are not for you!', ephemeral: true });
            return;
        }
        const customId = i.customId;
        if (customId === 'previous') {
            currentPage = Math.max(0, currentPage - 1);
        } else if (customId === 'next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
        } else if (customId === 'sort') {
            currentSortIndex = (currentSortIndex + 1) % OPTION_SORT_CYCLE.length;
            sortOptionPositions(sortedPositions, OPTION_SORT_CYCLE[currentSortIndex]);
        } else if (customId.startsWith('close_')) {
            const positionId = parseInt(customId.split('_')[1]);
            await i.deferUpdate();
            try {
                const closeResult = await optionsService.closePosition(targetUserId, positionId);
                if (closeResult.success) {
                    await i.followUp({ content: `✅ ${closeResult.message}`, ephemeral: true });
                    const updatedPortfolio = await optionsService.getOptionsPortfolio(targetUserId);
                    const updatedMarginStatus = await optionsService.calculateMarginStatus(targetUserId);
                    sortedPositions = [...updatedPortfolio.positions];
                    sortOptionPositions(sortedPositions, OPTION_SORT_CYCLE[currentSortIndex]);
                    const newTotalPages = Math.ceil(sortedPositions.length / OPTIONS_POSITIONS_PER_PAGE);
                    if (currentPage >= newTotalPages && newTotalPages > 0) {
                        currentPage = newTotalPages - 1;
                    }
                    if (sortedPositions.length === 0) {
                        const emptyEmbed = new EmbedBuilder()
                            .setTitle(`${targetUsername}'s Options Portfolio`)
                            .setColor('#0099ff')
                            .setDescription('Your options portfolio is now empty.')
                            .addFields([
                                {
                                    name: 'Margin Status',
                                    value: `Available: ${formatCurrency(updatedMarginStatus.availableMargin)}\nUsed: ${formatCurrency(updatedMarginStatus.marginUsed)} (${updatedMarginStatus.utilizationPercentage.toFixed(2)}%)`,
                                    inline: false
                                }
                            ])
                            .setTimestamp();
                        await interaction.editReply({ embeds: [emptyEmbed], components: [] });
                        collector.stop();
                        return;
                    }
                } else {
                    await i.followUp({ content: `❌ ${closeResult.message}`, ephemeral: true });
                }
            } catch (error) {
                await i.followUp({ content: `An error occurred while closing the position.`, ephemeral: true });
            }
        } else if (customId === 'back_to_summary') {
            await i.deferUpdate();
            // Fetch all data needed for summary view
            const stockPortfolio = await tradingService.getPortfolio(targetUserId);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(targetUserId);
            const formattedCryptoPortfolio = { positions: cryptoPortfolio || [], totalValue: 0 };
            if (cryptoPortfolio && cryptoPortfolio.length > 0) {
                formattedCryptoPortfolio.totalValue = cryptoPortfolio.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
            }
            const optionsPortfolio = await optionsService.getOptionsPortfolio(targetUserId);
            const cashBalance = userDb.getCashBalance(targetUserId);
            const portfolioSummary = {
                cashBalance: cashBalance,
                totalStockValue: stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0,
                totalCryptoValue: formattedCryptoPortfolio.totalValue,
                totalOptionsValue: optionsPortfolio.totalValue,
                totalPortfolioValue: cashBalance + (stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0) + formattedCryptoPortfolio.totalValue + optionsPortfolio.totalValue
            };
            await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary, targetUsername, targetUserId, optionsPortfolio);
            return;
        }
        await i.update({
            embeds: [generateEmbed(currentPage, sortedPositions, OPTION_SORT_CYCLE[currentSortIndex])],
            components: createButtons(currentPage)
        });
    });
    collector.on('end', async () => {
        try {
            if (sortedPositions.length > 0) {
                await interaction.editReply({
                    embeds: [generateEmbed(currentPage, sortedPositions, OPTION_SORT_CYCLE[currentSortIndex])],
                    components: []
                });
            }
        } catch (error) {
            // ignore
        }
    });
}

/**
 * Function to apply sorting to positions
 */
function sortPositions(positions: any[], sortType: SortType) {
    switch (sortType) {
        case SortType.ALPHABETICAL:
            positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
            break;
        case SortType.ALPHABETICAL_REVERSE:
            positions.sort((a, b) => b.symbol.localeCompare(a.symbol));
            break;
        case SortType.MARKET_VALUE_HIGH:
            positions.sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
            break;
        case SortType.MARKET_VALUE_LOW:
            positions.sort((a, b) => (a.marketValue || 0) - (b.marketValue || 0));
            break;
        case SortType.PROFIT_LOSS_HIGH:
            positions.sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0));
            break;
        case SortType.PROFIT_LOSS_LOW:
            positions.sort((a, b) => (a.profitLoss || 0) - (b.profitLoss || 0));
            break;
        case SortType.PERCENT_CHANGE_HIGH:
            positions.sort((a, b) => (b.percentChange || b.profitLossPercentage || 0) - (a.percentChange || a.profitLossPercentage || 0));
            break;
        case SortType.PERCENT_CHANGE_LOW:
            positions.sort((a, b) => (a.percentChange || a.profitLossPercentage || 0) - (b.percentChange || b.profitLossPercentage || 0));
            break;
    }
    return positions;
}

// --- STOCKS VIEW ---
async function showStocksView(interaction: ChatInputCommandInteraction, portfolio: any, targetUsername: string, targetUserId: string) {
    if (!portfolio.positions || portfolio.positions.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Stocks Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your stocks portfolio is empty. Use `/buy` to purchase stocks.')
            .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    let currentPage = 0;
    let currentSortIndex = 0;
    let sortedPositions = [...portfolio.positions];
    sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
    const totalPages = Math.ceil(sortedPositions.length / POSITIONS_PER_PAGE);
    const generateEmbed = (page: number, positions: any[], sortType: SortType) => {
        const startIndex = page * POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
        const currentPositions = positions.slice(startIndex, endIndex);
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Stocks Portfolio (Page ${page + 1}/${totalPages})`)
            .setColor('#0099ff')
            .setFooter({
                text: `Sorting: ${sortType} | Last updated: ${formatTimestamp(new Date())}`
            })
            .setTimestamp();
        currentPositions.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLoss || 0) >= 0 ? '📈' : '📉';
            embed.addFields({
                name: `${pos.symbol}: ${formatCurrency(pos.marketValue || 0)} ${profitLossSymbol} ${formatNumber(pos.percentChange || 0)}%`,
                value: [
                    `Quantity: ${formatNumber(pos.quantity || 0)}`,
                    `Average Buy Price: ${formatCurrency(pos.averageBuyPrice || 0)}`,
                    `Current Price: ${formatCurrency(pos.currentPrice || 0)}`,
                    `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss || 0)} (${formatNumber(pos.profitLossPercentage || 0)}%)`
                ].join('\n'),
                inline: false
            });
        });
        return embed;
    };
    const createButtons = (currentPage: number, includeBackButton = true) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (includeBackButton) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('back_to_summary')
                    .setLabel('Back to Summary')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === totalPages - 1)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('sort')
                .setLabel('Sort')
                .setStyle(ButtonStyle.Success)
        );
        return [row];
    };
    const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
        components: createButtons(currentPage)
    });
    const collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000
    });
    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'These buttons are not for you!', ephemeral: true });
            return;
        }
        const customId = i.customId;
        if (customId === 'previous') {
            currentPage = Math.max(0, currentPage - 1);
        } else if (customId === 'next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
        } else if (customId === 'sort') {
            currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
        } else if (customId === 'back_to_summary') {
            await i.deferUpdate();
            // Fetch all data needed for summary view
            const stockPortfolio = await tradingService.getPortfolio(targetUserId);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(targetUserId);
            const formattedCryptoPortfolio = { positions: cryptoPortfolio || [], totalValue: 0 };
            if (cryptoPortfolio && cryptoPortfolio.length > 0) {
                formattedCryptoPortfolio.totalValue = cryptoPortfolio.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
            }
            const optionsPortfolio = await optionsService.getOptionsPortfolio(targetUserId);
            const cashBalance = userDb.getCashBalance(targetUserId);
            const portfolioSummary = {
                cashBalance: cashBalance,
                totalStockValue: stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0,
                totalCryptoValue: formattedCryptoPortfolio.totalValue,
                totalOptionsValue: optionsPortfolio.totalValue,
                totalPortfolioValue: cashBalance + (stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0) + formattedCryptoPortfolio.totalValue + optionsPortfolio.totalValue
            };
            await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary, targetUsername, targetUserId, optionsPortfolio);
            return;
        }
        await i.update({
            embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
            components: createButtons(currentPage)
        });
    });
    collector.on('end', async () => {
        try {
            if (sortedPositions.length > 0) {
                await interaction.editReply({
                    embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                    components: []
                });
            }
        } catch (error) {
            // ignore
        }
    });
}

// --- CRYPTO VIEW ---
async function showCryptoView(interaction: ChatInputCommandInteraction, portfolio: any, cashBalance: number, targetUsername: string, targetUserId: string) {
    if (!portfolio.positions || portfolio.positions.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Crypto Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your crypto portfolio is empty. Use `/crypto_buy` to purchase cryptocurrencies.')
            .setTimestamp();
        await interaction.editReply({ embeds: [embed] });
        return;
    }
    let currentPage = 0;
    let sortedPositions = [...portfolio.positions];
    sortCryptoPositions(sortedPositions);
    const totalPages = Math.ceil(sortedPositions.length / POSITIONS_PER_PAGE);
    function sortCryptoPositions(positions: any[]) {
        positions.sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0));
    }
    const generateEmbed = (page: number, positions: any[]) => {
        const startIndex = page * POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
        const currentPositions = positions.slice(startIndex, endIndex);
        const embed = new EmbedBuilder()
            .setTitle(`${targetUsername}'s Crypto Portfolio (Page ${page + 1}/${totalPages})`)
            .setColor('#0099ff')
            .setFooter({
                text: `Last updated: ${formatTimestamp(new Date())}`
            })
            .setTimestamp();
        currentPositions.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLossPercent || 0) >= 0 ? '📈' : '📉';
            // Use the symbol as the link text in the value, and keep the name as the coin name only
            const coinLink = pos.coinId ? `[${pos.symbol}](https://www.coingecko.com/en/coins/${pos.coinId})` : pos.symbol;
            embed.addFields({
                name: `${pos.name}: ${formatCurrency(pos.currentValue || 0)} ${profitLossSymbol} ${(pos.profitLossPercent || 0).toFixed(2)}%`,
                value: [
                    `${coinLink}`,
                    `Quantity: ${formatNumber(pos.quantity || 0)}`,
                    `Average Buy Price: ${formatCurrency(pos.averageBuyPrice || 0)}`,
                    `Current Price: ${formatCurrency(pos.currentPrice || 0)}`,
                    `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss || 0)} (${(pos.profitLossPercent || 0).toFixed(2)}%)`
                ].join('\n'),
                inline: false
            });
        });
        return embed;
    };
    const createButtons = (currentPage: number) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === totalPages - 1)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('back_to_summary')
                .setLabel('Back to Summary')
                .setStyle(ButtonStyle.Secondary)
        );
        return [row];
    };
    const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage, sortedPositions)],
        components: createButtons(currentPage)
    });
    const collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000
    });
    collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
            await i.reply({ content: 'These buttons are not for you!', ephemeral: true });
            return;
        }
        const customId = i.customId;
        if (customId === 'previous') {
            currentPage = Math.max(0, currentPage - 1);
        } else if (customId === 'next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
        } else if (customId === 'back_to_summary') {
            await i.deferUpdate();
            // Fetch all data needed for summary view
            const stockPortfolio = await tradingService.getPortfolio(targetUserId);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(targetUserId);
            const formattedCryptoPortfolio = { positions: cryptoPortfolio || [], totalValue: 0 };
            if (cryptoPortfolio && cryptoPortfolio.length > 0) {
                formattedCryptoPortfolio.totalValue = cryptoPortfolio.reduce((sum, pos) => sum + (pos.currentValue || 0), 0);
            }
            const optionsPortfolio = await optionsService.getOptionsPortfolio(targetUserId);
            const cashBalance = userDb.getCashBalance(targetUserId);
            const portfolioSummary = {
                cashBalance: cashBalance,
                totalStockValue: stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0,
                totalCryptoValue: formattedCryptoPortfolio.totalValue,
                totalOptionsValue: optionsPortfolio.totalValue,
                totalPortfolioValue: cashBalance + (stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0) + formattedCryptoPortfolio.totalValue + optionsPortfolio.totalValue
            };
            await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary, targetUsername, targetUserId, optionsPortfolio);
            return;
        }
        await i.update({
            embeds: [generateEmbed(currentPage, sortedPositions)],
            components: createButtons(currentPage)
        });
    });
    collector.on('end', async () => {
        try {
            if (sortedPositions.length > 0) {
                await interaction.editReply({
                    embeds: [generateEmbed(currentPage, sortedPositions)],
                    components: []
                });
            }
        } catch (error) {
            // ignore
        }
    });
}