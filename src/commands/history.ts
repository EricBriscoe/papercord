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
import { generateAssetSeries } from '../utils/historyUtils';
import { TimeFrame, timeFrameLabels } from '../utils/chartGenerator';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import * as fs from 'fs';
import * as path from 'path';
import { formatCurrency } from '../utils/formatters';

const CHART_DIR = path.join(process.cwd(), 'data', 'cache', 'charts');
const BUTTON_TIMEOUT = 5 * 60 * 1000; // 5 minutes

export const historyCommand: Command = {
  name: 'history',
  description: 'View your account equity curve (unrealized + cash) over time',
  options: [
    {
      name: 'user',
      description: 'User mention or ID',
      type: ApplicationCommandOptionType.String,
      required: false
    }
  ],
  execute: async interaction => {
    const userOpt = interaction.options.getString('user');
    const targetId = userOpt?.match(/<@!?(\d+)>/)?.[1] || userOpt || interaction.user.id;
    let username = interaction.user.username;
    if (targetId !== interaction.user.id) {
      try {
        username = (await interaction.client.users.fetch(targetId)).username;
      } catch {}
    }

    const frames: TimeFrame[] = [
      TimeFrame.DAY,
      TimeFrame.WEEK,
      TimeFrame.MONTH,
      TimeFrame.THREE_MONTHS,
      TimeFrame.SIX_MONTHS,
      TimeFrame.YEAR,
      TimeFrame.MAX
    ];

    const createButtons = (active: TimeFrame, disable = false) => {
      const row1 = new ActionRowBuilder<ButtonBuilder>();
      const row2 = new ActionRowBuilder<ButtonBuilder>();
      frames.forEach((f, i) => {
        const btn = new ButtonBuilder()
          .setCustomId(`history:${f}`)
          .setLabel(timeFrameLabels[f])
          .setStyle(f === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(disable);
        if (i < 4) row1.addComponents(btn);
        else row2.addComponents(btn);
      });
      return [row1, row2];
    };

    const render = async (frame: TimeFrame) => {
      const { dates, cash, stocks, crypto, options } = await generateAssetSeries(targetId, frame);
      if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });
      const ts = Date.now();
      const name = `portfolio-${targetId}-${frame}-${ts}.png`;
      const full = path.join(CHART_DIR, name);
      const canvas = new ChartJSNodeCanvas({ width: 900, height: 500 });
      const cfg: import('chart.js').ChartConfiguration = {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            { label: 'Stocks', data: stocks, borderColor: '#0099ff', backgroundColor: '#0099ff30', fill: true, tension: 0.3 },
            { label: 'Options', data: options, borderColor: '#f6cd61', backgroundColor: '#f6cd6130', fill: true, tension: 0.3 },
            { label: 'Crypto', data: crypto, borderColor: '#f97794', backgroundColor: '#f9779430', fill: true, tension: 0.3 },
            { label: 'Cash', data: cash, borderColor: '#4ecca3', backgroundColor: '#4ecca330', fill: true, tension: 0.3 }
          ]
        },
        options: {
          plugins: {
            legend: { display: true },
            title: { display: true, text: `${username}'s Portfolio (${timeFrameLabels[frame]})` }
          },
          scales: {
            x: { ticks: { maxTicksLimit: 5 } },
            y: { stacked: true, min: 0 }
          }
        }
      };
      const buf = await canvas.renderToBuffer(cfg);
      fs.writeFileSync(full, buf);
      const embed = new EmbedBuilder().setTitle(`Portfolio Breakdown – ${username}`).setImage(`attachment://${name}`);
      const attachment = new AttachmentBuilder(full, { name });
      const comps = createButtons(frame);
      await interaction.editReply({ embeds: [embed], files: [attachment], components: comps });
      setTimeout(() => fs.unlinkSync(full), 5000);
    };

    await render(TimeFrame.MAX);
    const reply = await interaction.fetchReply();
    const collector = (reply as any).createMessageComponentCollector({ componentType: ComponentType.Button, time: BUTTON_TIMEOUT });
    collector.on('collect', async (btn: ButtonInteraction) => {
      const f = btn.customId.split(':')[1] as TimeFrame;
      const { dates, cash, stocks, crypto, options } = await generateAssetSeries(targetId, f);
      if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });
      const ts2 = Date.now();
      const name2 = `portfolio-${targetId}-${f}-${ts2}.png`;
      const full2 = path.join(CHART_DIR, name2);
      const canvas2 = new ChartJSNodeCanvas({ width: 900, height: 500 });
      const cfg2: import('chart.js').ChartConfiguration = {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            { label: 'Stocks', data: stocks, borderColor: '#0099ff', backgroundColor: '#0099ff30', fill: true, tension: 0.3 },
            { label: 'Options', data: options, borderColor: '#f6cd61', backgroundColor: '#f6cd6130', fill: true, tension: 0.3 },
            { label: 'Crypto', data: crypto, borderColor: '#f97794', backgroundColor: '#f9779430', fill: true, tension: 0.3 },
            { label: 'Cash', data: cash, borderColor: '#4ecca3', backgroundColor: '#4ecca330', fill: true, tension: 0.3 }
          ]
        },
        options: {
          plugins: {
            legend: { display: true },
            title: { display: true, text: `${username}'s Portfolio (${timeFrameLabels[f]})` }
          },
          scales: {
            x: { ticks: { maxTicksLimit: 5 } },
            y: { stacked: true, min: 0 }
          }
        }
      };
      const buf2 = await canvas2.renderToBuffer(cfg2);
      fs.writeFileSync(full2, buf2);
      const embed2 = new EmbedBuilder().setTitle(`Portfolio Breakdown – ${username}`).setImage(`attachment://${name2}`);
      const attachment2 = new AttachmentBuilder(full2, { name: name2 });
      const comps2 = createButtons(f);
      await btn.update({ embeds: [embed2], files: [attachment2], components: comps2 });
      setTimeout(() => fs.unlinkSync(full2), 5000);
    });
    collector.on('end', async () => {
      try {
        const msg = await interaction.fetchReply();
        await (msg as any).edit({ components: [] });
      } catch {}
    });
  }
};
