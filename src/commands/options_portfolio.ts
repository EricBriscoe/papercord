import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Command } from '../models/command';
import { optionsService, OptionContract } from '../services/optionsService';
import { formatCurrency, formatTimestamp } from '../utils/formatters';

// Maximum positions to display per page
const POSITIONS_PER_PAGE = 3;

// Sort types for options positions
enum SortType {
    EXPIRATION_ASC = 'Expiration (Nearest)',
    EXPIRATION_DESC = 'Expiration (Furthest)',
    PROFIT_LOSS_HIGH = 'Profit/Loss (High to Low)',
    PROFIT_LOSS_LOW = 'Profit/Loss (Low to High)',
    SYMBOL_ASC = 'Symbol (A-Z)',
    MARGIN_HIGH = 'Margin (High to Low)'
}

// Sort cycle order
const SORT_CYCLE = [
    SortType.EXPIRATION_ASC,
    SortType.SYMBOL_ASC,
    SortType.PROFIT_LOSS_HIGH,
    SortType.PROFIT_LOSS_LOW,
    SortType.MARGIN_HIGH,
    SortType.EXPIRATION_DESC
];

export const optionsPortfolioCommand: Command = {
    name: 'options_portfolio',
    description: 'View your options portfolio with open positions',
    options: [],
    execute: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        try {
            const portfolio = await optionsService.getOptionsPortfolio(interaction.user.id);
            
            // Get margin status
            const marginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
            
            // If portfolio is empty, show simple message
            if (portfolio.positions.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Options Portfolio`)
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
                
                await interaction.editReply({ embeds: [embed] });
                return;
            }
            
            // Set up pagination and sorting
            let currentPage = 0;
            let currentSortIndex = 0;
            let sortedPositions = [...portfolio.positions];
            
            // Initial sort by expiration date (nearest first)
            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
            
            const totalPages = Math.ceil(portfolio.positions.length / POSITIONS_PER_PAGE);
            
            // Function to apply sorting to positions
            function sortPositions(positions: OptionContract[], sortType: SortType) {
                switch (sortType) {
                    case SortType.EXPIRATION_ASC:
                        positions.sort((a, b) => new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime());
                        break;
                    case SortType.EXPIRATION_DESC:
                        positions.sort((a, b) => new Date(b.expirationDate).getTime() - new Date(a.expirationDate).getTime());
                        break;
                    case SortType.PROFIT_LOSS_HIGH:
                        positions.sort((a, b) => (b.profitLoss || 0) - (a.profitLoss || 0));
                        break;
                    case SortType.PROFIT_LOSS_LOW:
                        positions.sort((a, b) => (a.profitLoss || 0) - (b.profitLoss || 0));
                        break;
                    case SortType.SYMBOL_ASC:
                        positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
                        break;
                    case SortType.MARGIN_HIGH:
                        positions.sort((a, b) => (b.marginRequired || 0) - (a.marginRequired || 0));
                        break;
                }
                return positions;
            }
            
            // Function to generate embed for a page
            const generateEmbed = (page: number, positions: OptionContract[], sortType: SortType) => {
                const startIndex = page * POSITIONS_PER_PAGE;
                const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, positions.length);
                const currentPositions = positions.slice(startIndex, endIndex);
                
                const embed = new EmbedBuilder()
                    .setTitle(`${interaction.user.username}'s Options Portfolio (Page ${page + 1}/${totalPages})`)
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
                
                // Add each position as a separate field
                currentPositions.forEach((pos, index) => {
                    const profitLossSymbol = pos.profitLoss && pos.profitLoss >= 0 ? '📈' : '📉';
                    const contractType = pos.position === 'long' ? 
                        `Long ${pos.quantity} ${pos.optionType}${pos.quantity > 1 ? 's' : ''}` : 
                        `Short ${pos.quantity} ${pos.optionType}${pos.quantity > 1 ? 's' : ''}`;
                    
                    // Create option symbol for display
                    const optionSymbol = optionsService.formatOptionSymbol(
                        pos.symbol,
                        pos.expirationDate,
                        pos.optionType,
                        pos.strikePrice
                    );
                    
                    const securedText = pos.isSecured ? 
                        (pos.optionType === 'call' ? ' (Covered Call)' : ' (Cash-Secured Put)') : 
                        '';
                    
                    const positionDetails = [
                        `**${optionSymbol}**${securedText}`,
                        `Strike: ${formatCurrency(pos.strikePrice)}`,
                        `Expiration: ${pos.formattedExpiration || new Date(pos.expirationDate).toLocaleDateString()}`,
                        `Time to Expiry: ${(pos.timeToExpiry! * 365).toFixed(1)} days`,
                        `Moneyness: ${pos.moneyness}`,
                        `Price when Opened: ${formatCurrency(pos.purchasePrice! * 100)} per contract`,
                        `Current Price: ${formatCurrency(pos.currentPrice! * 100)} per contract`,
                        `Market Value: ${formatCurrency(pos.marketValue!)}`,
                        pos.marginRequired ? `Margin Required: ${formatCurrency(pos.marginRequired)}` : '',
                        `P/L: ${profitLossSymbol} ${formatCurrency(pos.profitLoss!)} (${pos.percentChange!.toFixed(2)}%)`
                    ].filter(line => line).join('\n');
                    
                    embed.addFields({
                        name: `${pos.symbol} ${pos.optionType.toUpperCase()} $${pos.strikePrice} - ${contractType}`,
                        value: positionDetails,
                        inline: false
                    });
                    
                    // Add button ID info to the embed for later correlation
                    // @ts-ignore - Using a custom property to track button IDs
                    embed.positionIds = currentPositions.map(p => p.id);
                });
                
                return embed;
            };
            
            // Create buttons for actions
            const createButtons = (currentPage: number) => {
                // Navigation buttons
                const navigationRow = new ActionRowBuilder<ButtonBuilder>()
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
                
                // Get positions on the current page
                const startIndex = currentPage * POSITIONS_PER_PAGE;
                const endIndex = Math.min(startIndex + POSITIONS_PER_PAGE, sortedPositions.length);
                const currentPositions = sortedPositions.slice(startIndex, endIndex);
                
                // Close position buttons - one for each position on the current page
                const closeButtonRows: ActionRowBuilder<ButtonBuilder>[] = [];
                
                // Create a row of buttons for each position (up to 3 positions per page)
                for (let i = 0; i < currentPositions.length; i++) {
                    const position = currentPositions[i];
                    const row = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`close_${position.id}`)
                                .setLabel(`Close ${position.symbol} ${position.optionType.toUpperCase()}`)
                                .setStyle(ButtonStyle.Danger)
                        );
                    closeButtonRows.push(row);
                }
                
                return [navigationRow, ...closeButtonRows];
            };
            
            // Send initial reply with the first page
            const message = await interaction.editReply({
                embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                components: createButtons(currentPage)
            });
            
            // Create a collector for button interactions
            const collector = message.createMessageComponentCollector({
                time: 10 * 60 * 1000 // 10 minutes timeout
            });
            
            collector.on('collect', async (i) => {
                if (i.user.id !== interaction.user.id) {
                    await i.reply({ content: 'These buttons are not for you!', ephemeral: true });
                    return;
                }
                
                const customId = i.customId;
                
                // Handle navigation and sort buttons
                if (customId === 'previous') {
                    currentPage = Math.max(0, currentPage - 1);
                } else if (customId === 'next') {
                    currentPage = Math.min(totalPages - 1, currentPage + 1);
                } else if (customId === 'sort') {
                    // Update the sort index, cycling through options
                    currentSortIndex = (currentSortIndex + 1) % SORT_CYCLE.length;
                    sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
                } else if (customId.startsWith('close_')) {
                    // Extract position ID from button ID
                    const positionId = parseInt(customId.split('_')[1]);
                    
                    // Defer the button update
                    await i.deferUpdate();
                    
                    try {
                        // Close the position
                        const closeResult = await optionsService.closePosition(interaction.user.id, positionId);
                        
                        if (closeResult.success) {
                            // Show success message
                            await i.followUp({ 
                                content: `✅ ${closeResult.message}`, 
                                ephemeral: true 
                            });
                            
                            // Refresh the portfolio data
                            const updatedPortfolio = await optionsService.getOptionsPortfolio(interaction.user.id);
                            const updatedMarginStatus = await optionsService.calculateMarginStatus(interaction.user.id);
                            
                            // Update sorted positions
                            sortedPositions = [...updatedPortfolio.positions];
                            sortPositions(sortedPositions, SORT_CYCLE[currentSortIndex]);
                            
                            // Update total pages
                            const newTotalPages = Math.ceil(sortedPositions.length / POSITIONS_PER_PAGE);
                            
                            // Adjust current page if needed
                            if (currentPage >= newTotalPages && newTotalPages > 0) {
                                currentPage = newTotalPages - 1;
                            }
                            
                            // If portfolio is now empty, show a special message
                            if (sortedPositions.length === 0) {
                                const emptyEmbed = new EmbedBuilder()
                                    .setTitle(`${interaction.user.username}'s Options Portfolio`)
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
                                
                                await interaction.editReply({ 
                                    embeds: [emptyEmbed], 
                                    components: [] 
                                });
                                
                                // End the collector
                                collector.stop();
                                return;
                            }
                        } else {
                            // Show error message
                            await i.followUp({ 
                                content: `❌ ${closeResult.message}`, 
                                ephemeral: true 
                            });
                        }
                    } catch (error) {
                        console.error('Error closing position:', error);
                        await i.followUp({ 
                            content: `An error occurred while closing the position: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            ephemeral: true 
                        });
                    }
                }
                
                // Update the message with new page/sorting if not a close action
                // or if the close action didn't empty the portfolio
                if (!customId.startsWith('close_') || sortedPositions.length > 0) {
                    await i.update({
                        embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                        components: createButtons(currentPage)
                    });
                }
            });
            
            collector.on('end', async () => {
                // Remove buttons after timeout if the message still exists
                try {
                    if (sortedPositions.length > 0) {
                        await interaction.editReply({
                            embeds: [generateEmbed(currentPage, sortedPositions, SORT_CYCLE[currentSortIndex])],
                            components: []
                        });
                    }
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