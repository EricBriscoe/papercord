import { 
    ApplicationCommandOptionType, 
    ChatInputCommandInteraction, 
    EmbedBuilder, 
    AttachmentBuilder, 
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ButtonInteraction
} from 'discord.js';
import { Command } from '../models/command';
import { stockService } from '../services/stockService';
import { formatCurrency, encodeUrlWithPlus } from '../utils/formatters';
import { 
    generateStockPriceChart, 
    TimeFrame, 
    timeFrameLabels 
} from '../utils/chartGenerator';
import * as fs from 'fs';

// Time in ms that buttons will remain active
const BUTTON_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const priceCommand: Command = {
    name: 'price',
    description: 'Check the current price of a stock with interactive price history chart',
    options: [
        {
            name: 'symbol',
            description: 'Stock symbol (ticker)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        const symbol = interaction.options.getString('symbol', true);
        const commandStartTime = Date.now();
        
        try {
            console.log(`Fetching stock data for symbol: ${symbol}`);
            
            // Clear cache for this symbol to ensure we get fresh data
            console.log(`Clearing cache for ${symbol} to ensure fresh data`);
            stockService.clearCache(symbol);
            
            // Fetch stock data and company info
            const stockData = await stockService.getStockPrice(symbol);
            const companyInfo = await stockService.getCompanyInfo(symbol);
            
            // Debug: Log the companyInfo object to see what fields are available
            console.log(`[DEBUG] companyInfo for ${symbol}:`, JSON.stringify({
                symbol: companyInfo?.symbol,
                name: companyInfo?.name,
                dayLow: companyInfo?.dayLow,
                dayHigh: companyInfo?.dayHigh,
                fiftyTwoWeekLow: companyInfo?.fiftyTwoWeekLow,
                fiftyTwoWeekHigh: companyInfo?.fiftyTwoWeekHigh,
                marketCap: companyInfo?.marketCap,
                volume: companyInfo?.volume,
                dividendYield: companyInfo?.dividendYield,
                currency: companyInfo?.currency
            }, null, 2));
            
            if (!stockData.price) {
                await interaction.editReply(`Could not find price for ${symbol}. ${stockData.error || 'Please check the symbol and try again.'}`);
                return;
            }

            // At this point we know stockData.price is not null
            const currentPrice = stockData.price;
            
            // Create the initial embed for stock info (without chart yet)
            const initialEmbed = await createStockEmbed(symbol, currentPrice, companyInfo);
            initialEmbed.setFooter({ text: 'Generating price history chart...' });
            
            // Create buttons for time frames - but add a loading notice
            const timeFrames = [TimeFrame.DAY, TimeFrame.WEEK, TimeFrame.MONTH, TimeFrame.THREE_MONTHS, 
                                TimeFrame.SIX_MONTHS, TimeFrame.YEAR, TimeFrame.MAX];
            
            const loadingButtons = createLoadingButtons();
            
            // Send the initial reply with "loading" UI
            console.log(`Sending initial response for ${symbol} at ${Date.now() - commandStartTime}ms`);
            await interaction.editReply({
                embeds: [initialEmbed],
                components: loadingButtons
            });
            
            // Now that we've responded quickly, generate the chart in the background
            console.log(`Starting background chart generation for ${symbol}`);
            const defaultTimeFrame = TimeFrame.MONTH;
            
            // Generate chart in the background
            generateStockPriceChart(symbol, defaultTimeFrame)
                .then(async (chartPath) => {
                    try {
                        console.log(`Chart generated for ${symbol} in ${Date.now() - commandStartTime}ms`);
                        
                        // Create updated embed with the same info
                        const updatedEmbed = await createStockEmbed(symbol, currentPrice, companyInfo);
                        
                        // Create the proper buttons now that chart is ready
                        const buttonRows = createTimeFrameButtons(defaultTimeFrame);
                        
                        // Create attachment for the chart
                        const attachment = new AttachmentBuilder(chartPath, {
                            name: `${symbol.toLowerCase()}-chart.png`,
                            description: `Price history chart for ${symbol.toUpperCase()}`
                        });
                        
                        // Update embed to reference the attachment
                        updatedEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                        
                        console.log(`Updating message with chart for ${symbol} after ${Date.now() - commandStartTime}ms`);
                        
                        // Update the original message with the chart image and proper buttons
                        const reply = await interaction.editReply({
                            embeds: [updatedEmbed],
                            files: [attachment],
                            components: buttonRows
                        });
                        
                        // Create collector to handle button interactions
                        const collector = reply.createMessageComponentCollector({ 
                            componentType: ComponentType.Button,
                            time: BUTTON_TIMEOUT
                        });
                        
                        // Handle button interactions
                        collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
                            try {
                                await buttonInteraction.deferUpdate();
                                
                                // Skip if this is the loading button
                                if (buttonInteraction.customId === 'loading') {
                                    return;
                                }
                                
                                // Get selected time frame
                                const selectedTimeFrame = buttonInteraction.customId.split(':')[1] as TimeFrame;
                                
                                // Update footer to indicate loading state
                                const loadingEmbed = await createStockEmbed(symbol, currentPrice, companyInfo);
                                loadingEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                                loadingEmbed.setFooter({ text: `Generating ${timeFrameLabels[selectedTimeFrame]} chart...` });
                                
                                // Show loading state while generating new chart
                                await buttonInteraction.editReply({
                                    embeds: [loadingEmbed],
                                    components: createTimeFrameButtons(selectedTimeFrame, true)
                                });
                                
                                // Generate new chart
                                let newChartPath: string | null = null;
                                try {
                                    newChartPath = await generateStockPriceChart(symbol, selectedTimeFrame);
                                } catch (chartError) {
                                    console.error(`Error generating chart for ${symbol} with timeframe ${selectedTimeFrame}:`, chartError);
                                    await buttonInteraction.followUp({
                                        content: `Error generating chart. Please try again.`,
                                        ephemeral: true
                                    });
                                    return;
                                }
                                
                                // Create updated embed and buttons
                                const updatedEmbed = await createStockEmbed(symbol, currentPrice, companyInfo);
                                const updatedButtonRows = createTimeFrameButtons(selectedTimeFrame);
                                
                                // Create new attachment
                                const newAttachment = new AttachmentBuilder(newChartPath, {
                                    name: `${symbol.toLowerCase()}-chart.png`,
                                    description: `${timeFrameLabels[selectedTimeFrame]} price history chart for ${symbol.toUpperCase()}`
                                });
                                
                                // Update embed with attachment
                                updatedEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                                
                                // Edit the original reply with new chart
                                await buttonInteraction.editReply({
                                    embeds: [updatedEmbed],
                                    files: [newAttachment],
                                    components: updatedButtonRows
                                });
                                
                                // Clean up chart file
                                if (newChartPath) {
                                    cleanupChartFile(newChartPath);
                                }
                                
                            } catch (error) {
                                console.error(`Error handling time frame button for ${symbol}:`, error);
                                try {
                                    await buttonInteraction.followUp({
                                        content: `Error updating chart. Please try again.`,
                                        ephemeral: true
                                    });
                                } catch (followUpError) {
                                    console.error('Failed to send follow-up error message:', followUpError);
                                }
                            }
                        });
                        
                        // When collector expires, remove buttons
                        collector.on('end', async () => {
                            try {
                                const finalEmbed = await createStockEmbed(symbol, currentPrice, companyInfo);
                                finalEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                                
                                // Edit the reply to remove buttons
                                await reply.edit({
                                    embeds: [finalEmbed],
                                    components: []
                                }).catch(err => {
                                    console.error('Failed to remove buttons after timeout:', err);
                                });
                            } catch (error) {
                                console.error('Error removing buttons after timeout:', error);
                            }
                        });
                        
                        // Clean up chart file
                        cleanupChartFile(chartPath);
                        
                        console.log(`Price command for ${symbol} completed in ${Date.now() - commandStartTime}ms`);
                    } catch (updateError) {
                        console.error(`Error updating response with chart for ${symbol}:`, updateError);
                        
                        // If we can't update with the chart, at least we already showed the price
                        cleanupChartFile(chartPath);
                    }
                })
                .catch(chartError => {
                    console.error(`Failed to generate chart for ${symbol}:`, chartError);
                });
            
        } catch (error) {
            console.error(`Price command error for ${symbol}:`, error);
            try {
                await interaction.editReply(`An error occurred while fetching the price for ${symbol}. Please try again later.`);
            } catch (editError) {
                console.error('Failed to send error message:', editError);
            }
        }
    }
};

/**
 * Create an embed for stock information
 */
async function createStockEmbed(symbol: string, price: number, companyInfo: any): Promise<EmbedBuilder> {
    const displayName = companyInfo?.longName || companyInfo?.shortName || symbol.toUpperCase();
    const title = displayName === symbol.toUpperCase() 
        ? `${displayName} Price` 
        : `${symbol.toUpperCase()} - ${displayName} Price`;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor('#0099ff')
        .setTimestamp();

    // Main description with current price
    embed.setDescription(`**Current Price: ${formatCurrency(price)}**`);

    // Add fields for more company info
    if (companyInfo) {
        const fieldsToAdd: { name: string; value: string; inline?: boolean }[] = [];

        // Debug: Log the specific fields we're checking
        console.log(`[DEBUG] createStockEmbed for ${symbol} - Field checks:`, JSON.stringify({
            hasDayRange: !!(companyInfo.dayLow && companyInfo.dayHigh),
            dayLow: companyInfo.dayLow,
            dayHigh: companyInfo.dayHigh,
            has52WeekRange: !!(companyInfo.fiftyTwoWeekLow && companyInfo.fiftyTwoWeekHigh),
            fiftyTwoWeekLow: companyInfo.fiftyTwoWeekLow,
            fiftyTwoWeekHigh: companyInfo.fiftyTwoWeekHigh,
            hasMarketCap: !!companyInfo.marketCap,
            marketCap: companyInfo.marketCap,
            hasVolume: !!companyInfo.volume,
            volume: companyInfo.volume,
            hasDividendYield: typeof companyInfo.dividendYield === 'number',
            dividendYield: companyInfo.dividendYield,
            currency: companyInfo.currency
        }, null, 2));

        // Try using different property names that might be in the data
        // Day's Range
        if (companyInfo.dayLow && companyInfo.dayHigh) {
            fieldsToAdd.push({ name: "Day's Range", value: `${formatCurrency(companyInfo.dayLow)} - ${formatCurrency(companyInfo.dayHigh)}`, inline: true });
        } else if (companyInfo.regularMarketDayLow && companyInfo.regularMarketDayHigh) {
            fieldsToAdd.push({ name: "Day's Range", value: `${formatCurrency(companyInfo.regularMarketDayLow)} - ${formatCurrency(companyInfo.regularMarketDayHigh)}`, inline: true });
        }
        
        // 52 Week Range
        if (companyInfo.fiftyTwoWeekLow && companyInfo.fiftyTwoWeekHigh) {
            fieldsToAdd.push({ name: '52 Week Range', value: `${formatCurrency(companyInfo.fiftyTwoWeekLow)} - ${formatCurrency(companyInfo.fiftyTwoWeekHigh)}`, inline: true });
        }
        
// Market Cap
if (companyInfo.marketCap) {
    const { formatLargeNumber } = await import('../utils/formatters');
    const marketCapDisplay = companyInfo.currency && companyInfo.currency !== 'USD'
        ? `${formatLargeNumber(companyInfo.marketCap)} ${companyInfo.currency}`
        : formatLargeNumber(companyInfo.marketCap);
    fieldsToAdd.push({ name: 'Market Cap', value: marketCapDisplay, inline: true });
}
        
        // Volume
        if (companyInfo.volume) {
            fieldsToAdd.push({ name: 'Volume', value: companyInfo.volume.toLocaleString(), inline: true });
        } else if (companyInfo.regularMarketVolume) {
            fieldsToAdd.push({ name: 'Volume', value: companyInfo.regularMarketVolume.toLocaleString(), inline: true });
        }
        
        // Dividend Yield
        if (typeof companyInfo.dividendYield === 'number') {
            fieldsToAdd.push({ name: 'Dividend Yield', value: `${companyInfo.dividendYield.toFixed(2)}%`, inline: true });
        }
        
        // Currency
        if (companyInfo.currency && companyInfo.currency !== 'USD') {
            fieldsToAdd.push({ name: 'Currency', value: companyInfo.currency, inline: true });
        }

        // Ensure an even number of inline fields for alignment if we want a strict 2-column layout for inline fields.
        // Count only inline fields for this logic.
        const inlineFieldsCount = fieldsToAdd.filter(f => f.inline).length;
        if (inlineFieldsCount % 2 !== 0) {
            fieldsToAdd.push({ name: '\u200B', value: '\u200B', inline: true }); // Add a blank inline field
        }
        
        // Debug: Log the fields we're adding
        console.log(`[DEBUG] createStockEmbed for ${symbol} - Adding ${fieldsToAdd.length} fields:`, 
            fieldsToAdd.map(f => f.name).join(', '));
        
        if (fieldsToAdd.length > 0) {
            embed.addFields(fieldsToAdd); // Add all collected fields at once
        }
    }
    
    // Add company logo if available
    if (companyInfo?.logo) {
        const encodedLogoUrl = encodeUrlWithPlus(companyInfo.logo);
        embed.setThumbnail(encodedLogoUrl);
    }
    
    // Add company website if available
    if (companyInfo?.weburl) {
        const encodedWebUrl = encodeUrlWithPlus(companyInfo.weburl);
        embed.setURL(encodedWebUrl); // Sets the title as a hyperlink
    }
    
    return embed;
}

/**
 * Create a set of loading buttons while chart generates
 */
function createLoadingButtons(): ActionRowBuilder<ButtonBuilder>[] {
    const firstRow = new ActionRowBuilder<ButtonBuilder>();
    
    // Add a single disabled button in the first row
    firstRow.addComponents(
        new ButtonBuilder()
            .setCustomId('loading')
            .setLabel('Generating Chart...')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
    );
    
    // Only return the first row - the second row was empty, causing the API error
    return [firstRow];
}

/**
 * Create time frame buttons for the chart
 * Split into multiple rows to stay within Discord's limit of 5 buttons per row
 */
function createTimeFrameButtons(activeTimeFrame: TimeFrame, disableButtons: boolean = false): ActionRowBuilder<ButtonBuilder>[] {
    // Available time frames
    const timeFrames = [
        TimeFrame.DAY,
        TimeFrame.WEEK,
        TimeFrame.MONTH,
        TimeFrame.THREE_MONTHS,
        TimeFrame.SIX_MONTHS,
        TimeFrame.YEAR,
        TimeFrame.MAX
    ];
    
    // Create two rows of buttons - first row with 4, second row with 3
    const firstRow = new ActionRowBuilder<ButtonBuilder>();
    const secondRow = new ActionRowBuilder<ButtonBuilder>();
    
    // Add buttons to rows
    timeFrames.forEach((timeFrame, index) => {
        const button = new ButtonBuilder()
            .setCustomId(`chart:${timeFrame}`)
            .setLabel(timeFrameLabels[timeFrame])
            .setStyle(timeFrame === activeTimeFrame ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(disableButtons);
            
        // First 4 buttons go in first row, remaining buttons go in second row
        if (index < 4) {
            firstRow.addComponents(button);
        } else {
            secondRow.addComponents(button);
        }
    });
    
    return [firstRow, secondRow];
}

/**
 * Clean up chart file after it's been sent
 */
function cleanupChartFile(filePath: string): void {
    setTimeout(() => {
        try {
            fs.unlinkSync(filePath);
            console.debug(`Cleaned up chart file: ${filePath}`);
        } catch (err) {
            console.error(`Failed to clean up chart file: ${filePath}`, err);
        }
    }, 5000); // Small delay to ensure the file is sent
}
