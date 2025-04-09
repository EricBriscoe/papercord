import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { optionsService } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

// Maximum positions to display per page
const POSITIONS_PER_PAGE = 3;

// Sort types for options positions
enum SortType {
    EXPIRATION_ASC = 'Expiration (Nearest)',
    EXPIRATION_DESC = 'Expiration (Furthest)',
    PROFIT_LOSS_HIGH = 'Profit/Loss (High to Low)',
    PROFIT_LOSS_LOW = 'Profit/Loss (Low to High)',
    PERCENT_CHANGE_HIGH = 'Percent Change (High to Low)',
    PERCENT_CHANGE_LOW = 'Percent Change (Low to High)',
}

// Sort cycle order
const SORT_CYCLE = [
    SortType.EXPIRATION_ASC,
    SortType.PROFIT_LOSS_HIGH,
    SortType.PERCENT_CHANGE_HIGH,
    SortType.EXPIRATION_DESC,
    SortType.PROFIT_LOSS_LOW,
    SortType.PERCENT_CHANGE_LOW
];

export const optionsPortfolioCommand: Command = {
    name: 'options',
    description: 'View your options portfolio with current valuations',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const portfolio = await optionsService.getOptionsPortfolio(interaction.user.id);
            
            // If portfolio is empty, show simple message
            if (portfolio.positions.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Options Portfolio`)
                    .setColor('#0099ff')
                    .setDescription('Your options portfolio is currently empty. Use the `/trade_option` command to buy or write options.')
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                return;
            }
            
            // Set up state for pagination and sorting
            let currentPage = 0;
            let currentSortIndex = 0; // Start with expiration sorting
            let sortedPositions = [...portfolio.positions]; // Create a copy we can sort
            
            // Initial sort - by expiration date (nearest first)
            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
            
            // For portfolios with positions, paginate the results
            const totalPages = Math.ceil(portfolio.positions.length / POSITIONS_PER_PAGE);
            
            // Function to apply sorting to positions
            function sortPositions(positions: any[], sortType: SortType) {
                switch (sortType) {
                    case SortType.EXPIRATION_ASC:
                        positions.sort((a, b) => a.timeToExpiry - b.timeToExpiry);
                        break;
                    case SortType.EXPIRATION_DESC:
                        positions.sort((a, b) => b.timeToExpiry - a.timeToExpiry);
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
                    .setTitle(`${interaction.user.username}'s Options Portfolio (Page ${page + 1}/${totalPages})`)
                    .setColor('#0099ff')
                    .addFields([
                        { 
                            name: 'Total Options Value', 
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
                    const positionSymbol = pos.position === 'long' ? '🔵 Long' : '🔴 Short';
                    const optionTypeSymbol = pos.optionType === 'call' ? '📈 Call' : '📉 Put';
                    const profitLossSymbol = pos.profitLoss >= 0 ? '✅' : '❌';
                    
                    const fieldTitle = `${pos.symbol} ${formatCurrency(pos.strikePrice)} ${optionTypeSymbol} - Exp: ${pos.formattedExpiration}`;
                    
                    const daysToExpiry = Math.round(pos.timeToExpiry * 365);
                    const expiryText = daysToExpiry <= 0 ? 'EXPIRED' : `${daysToExpiry} days left`;
                    
                    const positionDetails = [
                        `Position: ${positionSymbol} | Quantity: ${pos.quantity} contract(s)`,
                        `Strike: ${formatCurrency(pos.strikePrice)} | ${expiryText}`,
                        `Purchase Price: ${formatCurrency(pos.purchasePrice)}/share`,
                        `Current Price: ${formatCurrency(pos.currentPrice)}/share`,
                        `Market Value: ${formatCurrency(pos.marketValue)}`,
                        `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss)} (${pos.percentChange.toFixed(2)}%)`,
                        `Status: ${pos.moneyness} | ID: ${pos.id}`
                    ].join('\n');
                    
                    embed.addFields({
                        name: fieldTitle,
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
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('close')
                            .setLabel('Close Position')
                            .setStyle(ButtonStyle.Secondary)
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
                        await i.update({
                            embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                            components: [row]
                        });
                    } else if (i.customId === 'close') {
                        await i.reply({
                            content: 'To close a position, use the `/close_option` command and provide the position ID shown in your portfolio.',
                            ephemeral: true
                        });
                    }
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
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId('close')
                            .setLabel('Close Position')
                            .setStyle(ButtonStyle.Secondary)
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
                } else if (i.customId === 'close') {
                    await i.reply({
                        content: 'To close a position, use the `/close_option` command and provide the position ID shown in your portfolio.',
                        ephemeral: true
                    });
                    return;
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
            console.error('Options portfolio command error:', error);
            await interaction.editReply('An error occurred while fetching your options portfolio. Please try again later.');
        }
    }
};