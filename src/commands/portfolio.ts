import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { cryptoTradingService } from '../services/cryptoTradingService';
import { formatCurrency, formatNumber, formatTimestamp } from '../utils/formatters';
import { userDb } from '../database/operations';
import { optionsService } from '../services/optionsService';

// Maximum positions to display per page
const POSITIONS_PER_PAGE = 5;

// Portfolio view types
enum PortfolioView {
    SUMMARY = 'summary',
    STOCKS = 'stocks',
    CRYPTO = 'crypto'
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

export const portfolioCommand: Command = {
    name: 'portfolio',
    description: 'View your current portfolio including stocks and cryptocurrencies',
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
                }
            ]
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            // Determine which view the user requested
            const viewOption = interaction.options.getString('view') || PortfolioView.SUMMARY;
            
            // Get all portfolio data
            const stockPortfolio = await tradingService.getPortfolio(interaction.user.id);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(interaction.user.id);
            
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
            const optionsPortfolio = await optionsService.getOptionsPortfolio(interaction.user.id);
            
            // Get cash balance from userDb
            const cashBalance = userDb.getCashBalance(interaction.user.id);
            
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
            
            // Show different views based on user selection
            switch (viewOption) {
                case PortfolioView.SUMMARY:
                    await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary);
                    break;
                case PortfolioView.STOCKS:
                    await showStocksView(interaction, stockPortfolio);
                    break;
                case PortfolioView.CRYPTO:
                    await showCryptoView(interaction, formattedCryptoPortfolio, cashBalance);
                    break;
                default:
                    await showSummaryView(interaction, stockPortfolio, formattedCryptoPortfolio, portfolioSummary);
            }
        } catch (error) {
            console.error('Portfolio command error:', error);
            await interaction.editReply('An error occurred while fetching your portfolio. Please try again later.');
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
    totalValue: any
) {
    // Check if portfolio is completely empty
    const hasStocks = stockPortfolio.positions && stockPortfolio.positions.length > 0;
    const hasCrypto = cryptoPortfolio.positions && cryptoPortfolio.positions.length > 0;
    
    if (!hasStocks && !hasCrypto) {
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your portfolio is currently empty. Use the `/buy` or `/crypto_buy` commands to purchase assets.')
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
        .setTitle(`${interaction.user.username}'s Portfolio Summary`)
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
            cryptoText += `${pos.symbol}: ${formatCurrency(pos.currentValue || 0)} ${profitLossSymbol} ${(pos.profitLossPercent || 0).toFixed(2)}%\n`;
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
                .setDisabled(!hasCrypto)
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
            await showStocksView(interaction, stockPortfolio);
        } else if (i.customId === 'view_crypto') {
            await i.update({ components: [] });
            await showCryptoView(interaction, cryptoPortfolio, totalValue.cashBalance);
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
 * Show the stocks view of the portfolio (stocks only)
 */
async function showStocksView(interaction: ChatInputCommandInteraction, portfolio: any) {
    // If portfolio is empty, show simple message
    if (portfolio.positions.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Stock Portfolio`)
            .setColor('#0099ff')
            .setDescription('Your stock portfolio is currently empty. Use the `/buy` command to purchase stocks.')
            .addFields({ 
                name: 'Cash Balance', 
                value: formatCurrency(portfolio.cashBalance), 
                inline: false 
            })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed], components: [] });
        return;
    }
    
    // Set up state for pagination and sorting
    let currentPage = 0;
    let currentSortIndex = 0; // Start with alphabetical sorting
    let sortedPositions = [...portfolio.positions]; // Create a copy we can sort
    
    // Initial sort - alphabetical by symbol
    sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
    
    // For portfolios with positions, paginate the results
    const totalPages = Math.ceil(portfolio.positions.length / POSITIONS_PER_PAGE);
    
    // Function to generate embed for a specific page
    const generateEmbed = (page: number, positions: any[], sortType: SortType) => {
        const startIndex = page * POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
        const currentPositions = positions.slice(startIndex, endIndex);
        
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Stock Portfolio (Page ${page + 1}/${totalPages})`)
            .setColor('#0099ff')
            .addFields([
                { 
                    name: 'Cash Balance', 
                    value: formatCurrency(portfolio.cashBalance), 
                    inline: false 
                },
                { 
                    name: 'Total Stock Value', 
                    value: formatCurrency(portfolio.totalValue), 
                    inline: false 
                }
            ])
            .setFooter({ 
                text: `Sorting: ${sortType} | Last updated: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
        
        // Add each position as a separate field instead of using description
        currentPositions.forEach((pos: any) => {
            const profitLossSymbol = pos.profitLoss >= 0 ? '📈' : '📉';
            const positionDetails = [
                `Quantity: ${pos.quantity} shares`,
                `Current Price: ${formatCurrency(pos.currentPrice)}`,
                `Market Value: ${formatCurrency(pos.marketValue)}`,
                `Avg Purchase: ${formatCurrency(pos.averagePurchasePrice)}`,
                `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss)} (${pos.percentChange.toFixed(2)}%)`
            ].join('\n');
            
            embed.addFields({
                name: `${pos.symbol}`,
                value: positionDetails,
                inline: false
            });
        });
        
        return embed;
    };
    
    // Create buttons for navigation and sorting
    const createButtons = (currentPage: number, includeBackButton: boolean) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        
        if (includeBackButton) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('back_to_summary')
                    .setLabel('Back to Summary')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        
        // Only add navigation buttons if there are multiple pages
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
        
        return row;
    };
    
    // Send initial reply with the first page
    const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
        components: [createButtons(currentPage, true)]
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
        if (i.customId === 'previous') {
            currentPage = Math.max(0, currentPage - 1);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'sort') {
            // Update the sort index, cycling through options
            currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'back_to_summary') {
            // Fix for the race condition - use deferUpdate and fetch data before update
            await i.deferUpdate();
            
            // Fetch all data needed for summary view
            const totalPortfolioValue = await cryptoTradingService.getTotalPortfolioValue(interaction.user.id);
            const cryptoPortfolio = await cryptoTradingService.getCryptoPortfolio(interaction.user.id);
            
            // Create a portfolio summary object
            const portfolioSummary = {
                cashBalance: portfolio.cashBalance,
                totalStockValue: portfolio.totalValue - portfolio.cashBalance,
                totalCryptoValue: cryptoPortfolio.reduce((sum: number, pos: any) => sum + (pos.currentValue || 0), 0),
                totalOptionsValue: (await optionsService.getOptionsPortfolio(interaction.user.id)).totalValue,
                totalPortfolioValue: totalPortfolioValue
            };
            
            // Generate summary embed and components
            const hasStocks = portfolio.positions && portfolio.positions.length > 0;
            const hasCrypto = cryptoPortfolio && cryptoPortfolio.length > 0;
            const embed = generateSummaryEmbed(interaction, portfolio, cryptoPortfolio, portfolioSummary, hasStocks, hasCrypto);
            const components = generateSummaryButtons(hasStocks, hasCrypto);
            
            // Update the message in a single call
            await interaction.editReply({
                embeds: [embed],
                components: components
            });
            
            // We're manually handling this case, so return early
            return;
        }
    });
    
    collector.on('end', async (collected, reason) => {
        if (reason !== 'messageDelete') {
            // Remove buttons after timeout
            try {
                await interaction.editReply({
                    embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                    components: []
                });
            } catch (error) {
                console.error('Error removing buttons after timeout:', error);
            }
        }
    });
}

/**
 * Generate a summary embed for portfolio summary view
 */
function generateSummaryEmbed(
    interaction: ChatInputCommandInteraction, 
    stockPortfolio: any, 
    cryptoPortfolio: any, 
    totalValue: any,
    hasStocks: boolean,
    hasCrypto: boolean
) {
    const embed = new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Portfolio Summary`)
        .setColor('#0099ff')
        .addFields([
            { 
                name: 'Cash Balance', 
                value: formatCurrency(totalValue.cashBalance || 0), 
                inline: true
            },
            { 
                name: 'Total Stock Value', 
                value: formatCurrency(totalValue.totalStockValue || 0), 
                inline: true
            },
            { 
                name: 'Total Crypto Value', 
                value: formatCurrency(totalValue.totalCryptoValue || 0), 
                inline: true
            },
            { 
                name: 'Total Options Value', 
                value: formatCurrency(totalValue.totalOptionsValue || 0), 
                inline: true
            },
            { 
                name: 'Total Portfolio Value', 
                value: formatCurrency(totalValue.totalPortfolioValue || 0), 
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
        // Handle both formats: direct array or {positions: array}
        const cryptoPositions = Array.isArray(cryptoPortfolio) ? cryptoPortfolio : (cryptoPortfolio.positions || []);
        const positionCount = cryptoPositions.length;
        
        // Sort crypto positions by market value and get top 3
        const topCrypto = [...cryptoPositions]
            .sort((a, b) => ((b.currentValue || b.marketValue || 0) - (a.currentValue || a.marketValue || 0)))
            .slice(0, 3);
        
        let cryptoText = '';
        topCrypto.forEach((pos: any) => {
            // Use various fallbacks to handle different property names
            const value = pos.currentValue || pos.marketValue || 0;
            const percentChange = pos.profitLossPercent || pos.profitLossPercentage || 0;
            const profitLossSymbol = percentChange >= 0 ? '📈' : '📉';
            cryptoText += `${pos.symbol}: ${formatCurrency(value)} ${profitLossSymbol} ${percentChange.toFixed(2)}%\n`;
        });
        
        if (positionCount > 3) {
            cryptoText += `...and ${positionCount - 3} more cryptocurrencies`;
        }
        
        embed.addFields({
            name: `Top Cryptocurrencies (${positionCount} total)`,
            value: cryptoText || 'None',
            inline: false
        });
    }
    
    return embed;
}

/**
 * Generate buttons for summary view
 */
function generateSummaryButtons(hasStocks: boolean, hasCrypto: boolean) {
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
                .setDisabled(!hasCrypto)
        );
    
    return [row];
}

/**
 * Show the crypto view of the portfolio (cryptocurrencies only)
 */
async function showCryptoView(interaction: ChatInputCommandInteraction, portfolio: any, cashBalance: number) {
    // If portfolio is empty, show simple message
    if (portfolio.positions.length === 0) {
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Crypto Portfolio`)
            .setColor('#f7931a') // Bitcoin gold color
            .setDescription('Your cryptocurrency portfolio is currently empty. Use the `/crypto_buy` command to purchase cryptocurrencies.')
            .addFields({ 
                name: 'Cash Balance', 
                value: formatCurrency(cashBalance), 
                inline: false 
            })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [embed], components: [] });
        return;
    }
    
    // Set up state for pagination and sorting
    let currentPage = 0;
    let currentSortIndex = 0; // Start with alphabetical sorting
    let sortedPositions = [...portfolio.positions]; // Create a copy we can sort
    
    // Initial sort - alphabetical by symbol
    sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
    
    // For portfolios with positions, paginate the results
    const totalPages = Math.ceil(portfolio.positions.length / POSITIONS_PER_PAGE);
    
    // Function to generate embed for a specific page
    const generateEmbed = (page: number, positions: any[], sortType: SortType) => {
        const startIndex = page * POSITIONS_PER_PAGE;
        const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
        const currentPositions = positions.slice(startIndex, endIndex);
        
        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Crypto Portfolio (Page ${page + 1}/${totalPages})`)
            .setColor('#f7931a') // Bitcoin gold color
            .addFields([
                { 
                    name: 'Cash Balance', 
                    value: formatCurrency(cashBalance), 
                    inline: false 
                },
                { 
                    name: 'Total Crypto Value', 
                    value: formatCurrency(portfolio.totalValue), 
                    inline: false 
                }
            ])
            .setFooter({ 
                text: `Sorting: ${sortType} | Last updated: ${formatTimestamp(new Date())}` 
            })
            .setTimestamp();
        
        // Add each position as a separate field
        currentPositions.forEach((pos: any) => {
            const profitLossSymbol = (pos.profitLoss || 0) >= 0 ? '📈' : '📉';
            const positionDetails = [
                `Quantity: ${formatNumber(pos.quantity)}`,
                `Current Price: ${formatCurrency(pos.currentPrice || 0)}`,
                `Market Value: ${formatCurrency(pos.marketValue || 0)}`,
                `Avg Purchase: ${formatCurrency(pos.averagePurchasePrice)}`,
                `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss || 0)} (${(pos.profitLossPercentage || 0).toFixed(2)}%)`
            ].join('\n');
            
            embed.addFields({
                name: `${pos.name} (${pos.symbol.toUpperCase()})`,
                value: positionDetails,
                inline: false
            });
        });
        
        return embed;
    };
    
    // Create buttons for navigation and sorting
    const createButtons = (currentPage: number, includeBackButton: boolean) => {
        const row = new ActionRowBuilder<ButtonBuilder>();
        
        if (includeBackButton) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('back_to_summary')
                    .setLabel('Back to Summary')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        
        // Only add navigation buttons if there are multiple pages
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
        
        return row;
    };
    
    // Send initial reply with the first page
    const message = await interaction.editReply({
        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
        components: [createButtons(currentPage, true)]
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
        if (i.customId === 'previous') {
            currentPage = Math.max(0, currentPage - 1);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'next') {
            currentPage = Math.min(totalPages - 1, currentPage + 1);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'sort') {
            // Update the sort index, cycling through options
            currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
            await i.update({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: [createButtons(currentPage, true)]
            });
        } else if (i.customId === 'back_to_summary') {
            // Fix for the race condition - use deferUpdate and fetch data before update
            await i.deferUpdate();
            
            // Fetch all data needed for summary view
            const totalPortfolioValue = await cryptoTradingService.getTotalPortfolioValue(interaction.user.id);
            const stockPortfolio = await tradingService.getPortfolio(interaction.user.id);
            
            // Create a portfolio summary object
            const portfolioSummary = {
                cashBalance: cashBalance,
                totalStockValue: stockPortfolio.positions.length > 0 ? stockPortfolio.totalValue - cashBalance : 0,
                totalCryptoValue: portfolio.totalValue,
                totalOptionsValue: (await optionsService.getOptionsPortfolio(interaction.user.id)).totalValue,
                totalPortfolioValue: totalPortfolioValue
            };
            
            // Generate summary embed and components
            const hasStocks = stockPortfolio.positions && stockPortfolio.positions.length > 0;
            const hasCrypto = portfolio.positions && portfolio.positions.length > 0;
            const embed = generateSummaryEmbed(interaction, stockPortfolio, portfolio.positions, portfolioSummary, hasStocks, hasCrypto);
            const components = generateSummaryButtons(hasStocks, hasCrypto);
            
            // Update the message in a single call
            await interaction.editReply({
                embeds: [embed],
                components: components
            });
            
            // We're manually handling this case, so return early
            return;
        }
    });
    
    collector.on('end', async (collected, reason) => {
        if (reason !== 'messageDelete') {
            // Remove buttons after timeout
            try {
                await interaction.editReply({
                    embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                    components: []
                });
            } catch (error) {
                console.error('Error removing buttons after timeout:', error);
            }
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