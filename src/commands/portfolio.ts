import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { tradingService } from '../services/tradingService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

// Maximum positions to display per page
const POSITIONS_PER_PAGE = 5;

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
    description: 'View your current stock portfolio',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const portfolio = await tradingService.getPortfolio(interaction.user.id);
            
            // If portfolio is empty, show simple message
            if (portfolio.positions.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Portfolio`)
                    .setColor('#0099ff')
                    .setDescription('Your portfolio is currently empty. Use the `/buy` command to purchase stocks.')
                    .addFields({ 
                        name: 'Cash Balance', 
                        value: formatCurrency(portfolio.cashBalance), 
                        inline: false 
                    })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
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
            
            // Function to apply sorting to positions
            function sortPositions(positions: any[], sortType: SortType) {
                switch (sortType) {
                    case SortType.ALPHABETICAL:
                        positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
                        break;
                    case SortType.ALPHABETICAL_REVERSE:
                        positions.sort((a, b) => b.symbol.localeCompare(a.symbol));
                        break;
                    case SortType.MARKET_VALUE_HIGH:
                        positions.sort((a, b) => b.marketValue - a.marketValue);
                        break;
                    case SortType.MARKET_VALUE_LOW:
                        positions.sort((a, b) => a.marketValue - b.marketValue);
                        break;
                    case SortType.PROFIT_LOSS_HIGH:
                        positions.sort((a, b) => b.profitLoss - a.profitLoss);
                        break;
                    case SortType.PROFIT_LOSS_LOW:
                        positions.sort((a, b) => a.profitLoss - b.profitLoss);
                        break;
                    case SortType.PERCENT_CHANGE_HIGH:
                        positions.sort((a, b) => b.percentChange - a.percentChange);
                        break;
                    case SortType.PERCENT_CHANGE_LOW:
                        positions.sort((a, b) => a.percentChange - b.percentChange);
                        break;
                }
                return positions;
            }
            
            // Function to generate embed for a specific page
            const generateEmbed = (page: number, positions: any[], sortType: SortType) => {
                const startIndex = page * POSITIONS_PER_PAGE;
                const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
                const currentPositions = positions.slice(startIndex, endIndex);
                
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Portfolio (Page ${page + 1}/${totalPages})`)
                    .setColor('#0099ff')
                    .addFields([
                        { 
                            name: 'Cash Balance', 
                            value: formatCurrency(portfolio.cashBalance), 
                            inline: false 
                        },
                        { 
                            name: 'Total Portfolio Value', 
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
            
            // Single page portfolio - include sort button but no navigation buttons
            if (totalPages === 1) {
                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('sort')
                            .setLabel('Sort')
                            .setStyle(ButtonStyle.Success)
                    );
                
                const message = await interaction.editReply({
                    embeds: [generateEmbed(0, sortedPositions, SORT_CYCLE[currentSortIndex])],
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
                    
                    if (i.customId === 'sort') {
                        // Update the sort index, cycling through options
                        currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
                        sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
                    }
                    
                    // Update the message with new sorting
                    await i.update({
                        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                        components: [row]
                    });
                });
                
                collector.on('end', async () => {
                    // Remove buttons after timeout
                    try {
                        await interaction.editReply({
                            embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                            components: []
                        });
                    } catch (error) {
                        console.error('Error removing buttons after timeout:', error);
                    }
                });
                
                return;
            }
            
            // Multi-page portfolio - add navigation and sort buttons
            const createButtons = (currentPage: number) => {
                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('previous')
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(currentPage === totalPages - 1),
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
                components: [createButtons(currentPage)]
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
                } else if (i.customId === 'next') {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                } else if (i.customId === 'sort') {
                    // Update the sort index, cycling through options
                    currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
                    sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
                }
                
                // Update the message with new page and/or sorting
                await i.update({
                    embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                    components: [createButtons(currentPage)]
                });
            });
            
            collector.on('end', async () => {
                // Remove buttons after timeout
                try {
                    await interaction.editReply({
                        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                        components: []
                    });
                } catch (error) {
                    console.error('Error removing buttons after timeout:', error);
                }
            });
            
        } catch (error) {
            console.error('Portfolio command error:', error);
            await interaction.editReply('An error occurred while fetching your portfolio. Please try again later.');
        }
    }
};