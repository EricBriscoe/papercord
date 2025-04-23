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
        // Only defer if not already deferred by the main handler
        if (!interaction.deferred) {
            await interaction.deferReply().catch(e => {
                console.error(`Failed to defer reply in price command: ${e.message}`);
                // Continue execution even if deferral fails
            });
        }
        
        const symbol = interaction.options.getString('symbol', true);
        const commandStartTime = Date.now();
        
        try {
            console.log(`Fetching stock data for symbol: ${symbol}`);
            
            // Fetch stock data and company info
            const stockData = await stockService.getStockPrice(symbol);
            const companyInfo = await stockService.getCompanyInfo(symbol);
            
            if (!stockData.price) {
                await interaction.editReply(`Could not find price for ${symbol}. ${stockData.error || 'Please check the symbol and try again.'}`);
                return;
            }

            // Log timing for performance diagnostics
            console.log(`Fetched stock data in ${Date.now() - commandStartTime}ms - generating chart for ${symbol}`);

            // Generate initial chart (default to 1 month timeframe)
            const defaultTimeFrame = TimeFrame.MONTH;
            let chartPath: string | null = null;
            try {
                chartPath = await generateStockPriceChart(symbol, defaultTimeFrame);
                console.log(`Chart generated for ${symbol} in ${Date.now() - commandStartTime}ms`);
            } catch (chartError) {
                console.error(`Error generating chart for ${symbol}:`, chartError);
                // Continue without chart if there's an error
            }
            
            // At this point we know stockData.price is not null
            const currentPrice = stockData.price; // This is guaranteed to be a number now
            
            // Create the embed for stock info
            const embed = createStockEmbed(symbol, currentPrice, companyInfo);
            
            // Create buttons for time frames
            const buttonRows = createTimeFrameButtons(defaultTimeFrame);
            
            // Initialize response object
            const responseOptions: any = {
                embeds: [embed],
                components: buttonRows
            };
            
            // Add chart if we were able to generate one
            if (chartPath) {
                try {
                    // Prepare attachment
                    const attachment = new AttachmentBuilder(chartPath, {
                        name: `${symbol.toLowerCase()}-chart.png`,
                        description: `Price history chart for ${symbol.toUpperCase()}`
                    });
                    
                    // Update embed to reference the attachment
                    embed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                    
                    // Add attachment to response options
                    responseOptions.files = [attachment];
                } catch (attachmentError) {
                    console.error(`Error creating attachment for ${symbol}:`, attachmentError);
                    // Continue without chart attachment if there's an error
                }
            }
            
            console.log(`Sending response for ${symbol} after ${Date.now() - commandStartTime}ms`);
            
            // Send the initial reply with buttons
            const reply = await interaction.editReply(responseOptions);
            
            // Create collector to handle button interactions
            const collector = reply.createMessageComponentCollector({ 
                componentType: ComponentType.Button,
                time: BUTTON_TIMEOUT
            });
            
            // Handle button interactions
            collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
                try {
                    await buttonInteraction.deferUpdate();
                    
                    // Get selected time frame
                    const selectedTimeFrame = buttonInteraction.customId.split(':')[1] as TimeFrame;
                    
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
                    const updatedEmbed = createStockEmbed(symbol, currentPrice, companyInfo);
                    const updatedButtonRows = createTimeFrameButtons(selectedTimeFrame);
                    
                    // Initialize update options
                    const updateOptions: any = {
                        embeds: [updatedEmbed],
                        components: updatedButtonRows
                    };
                    
                    // Add chart if we were able to generate one
                    if (newChartPath) {
                        try {
                            // Create new attachment
                            const newAttachment = new AttachmentBuilder(newChartPath, {
                                name: `${symbol.toLowerCase()}-chart.png`,
                                description: `${timeFrameLabels[selectedTimeFrame]} price history chart for ${symbol.toUpperCase()}`
                            });
                            
                            // Update embed with attachment
                            updatedEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                            
                            // Add attachment to update options
                            updateOptions.files = [newAttachment];
                        } catch (attachmentError) {
                            console.error(`Error creating attachment for ${symbol}:`, attachmentError);
                            // Continue without chart attachment if there's an error
                        }
                    }
                    
                    // Edit the original reply with new chart
                    await buttonInteraction.editReply(updateOptions);
                    
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
                    const finalEmbed = createStockEmbed(symbol, currentPrice, companyInfo);
                    if (chartPath) {
                        finalEmbed.setImage(`attachment://${symbol.toLowerCase()}-chart.png`);
                    }
                    
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
            if (chartPath) {
                cleanupChartFile(chartPath);
            }
            
            console.log(`Price command for ${symbol} completed in ${Date.now() - commandStartTime}ms`);
            
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
function createStockEmbed(symbol: string, price: number, companyInfo: any): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(`${symbol.toUpperCase()} - ${companyInfo?.name || 'Stock'} Price`)
        .setDescription(`Current price: ${formatCurrency(price)}`)
        .setColor('#0099ff')
        .setTimestamp();
    
    // Add company logo if available
    if (companyInfo?.logo) {
        const encodedLogoUrl = encodeUrlWithPlus(companyInfo.logo);
        embed.setThumbnail(encodedLogoUrl);
    }
    
    // Add company website if available
    if (companyInfo?.weburl) {
        const encodedWebUrl = encodeUrlWithPlus(companyInfo.weburl);
        embed.setURL(encodedWebUrl);
    }
    
    return embed;
}

/**
 * Create time frame buttons for the chart
 * Split into multiple rows to stay within Discord's limit of 5 buttons per row
 */
function createTimeFrameButtons(activeTimeFrame: TimeFrame): ActionRowBuilder<ButtonBuilder>[] {
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
            .setStyle(timeFrame === activeTimeFrame ? ButtonStyle.Primary : ButtonStyle.Secondary);
            
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