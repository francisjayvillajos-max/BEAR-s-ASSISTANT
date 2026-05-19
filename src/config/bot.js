import { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType 
} from 'discord.js';
import { botConfig, getColor } from '../config.js'; // Adjust this path to your actual config file location
import { logger } from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('middleman')
    .setDescription('Starts a secure middleman transaction session.')
    .addUserOption(option => 
      option.setName('trader1')
        .setDescription('The first trader involved in the deal')
        .setRequired(true))
    .addUserOption(option => 
      option.setName('trader2')
        .setDescription('The second trader involved in the deal')
        .setRequired(true)),

  async execute(interaction) {
    // 1. Permission / Role Check
    // If you have specific mmworks roles in the config, you can check them here.
    // Assuming for now it requires standard moderation permissions or specific staff roles.
    if (!interaction.member.permissions.has('ManageMessages')) {
      return interaction.reply({ 
        content: botConfig.messages.noPermission, 
        ephemeral: true 
      });
    }

    const trader1 = interaction.options.getUser('trader1');
    const trader2 = interaction.options.getUser('trader2');
    const middleman = interaction.user;

    // Safety checks
    if (trader1.id === trader2.id) {
      return interaction.reply({ content: "❌ Trader 1 and Trader 2 cannot be the same person.", ephemeral: true });
    }
    if (trader1.bot || trader2.bot) {
      return interaction.reply({ content: "❌ You cannot do a middleman trade with bot accounts.", ephemeral: true });
    }

    logger.info(`Middleman transaction started by ${middleman.tag} between ${trader1.tag} and ${trader2.tag}`);

    // Helper to generate the main embed based on active phase
    const generateEmbed = (phase) => {
      const embed = new EmbedBuilder()
        .setTitle('🤝 Middleman Transaction Session')
        .setDescription(`**Middleman:** ${middleman}\n**Trader 1:** ${trader1}\n**Trader 2:** ${trader2}`)
        .setTimestamp()
        .setFooter({ text: botConfig.embeds.footer.text });

      switch (phase) {
        case 1:
          embed.setColor(getColor('priority.medium'))
               .addFields({ 
                 name: '📌 STEP 1: Holding First Trader Items', 
                 value: `⛔ **Middleman is holding items from ${trader1}.**\n${trader2}, please wait patiently. Do not trade yet to avoid any stealing.` 
               });
          break;
        case 2:
          embed.setColor(getColor('priority.high'))
               .addFields({ 
                 name: '✊ STEP 2: Holding Second Trader Items', 
                 value: `✊ **First items secured.** Now ${trader2} must join the trade. Middleman is holding items from ${trader2}.` 
               });
          break;
        case 3:
          embed.setColor(getColor('priority.urgent'))
               .addFields({ 
                 name: '🏰 STEP 3: Base Distribution', 
                 value: `🏰 **Both items have been securely held.**\nBoth traders, wait at the Middleman's base.\nYou will be allowed to take your items **1 by 1** safely from the base.` 
               });
          break;
        case 'complete':
          embed.setColor(getColor('success'))
               .addFields({ 
                 name: '✅ Deal Completed!', 
                 value: 'The middleman trade has finished successfully. Both parties received their items securely.' 
               });
          break;
        case 'cancelled':
          embed.setColor(getColor('error'))
               .addFields({ 
                 name: '❌ Deal Cancelled', 
                 value: 'This middleman trade session was cancelled by staff or due to an emergency.' 
               });
          break;
      }
      return embed;
    };

    // Control components (Only visible/clickable by the middleman)
    const getButtons = (phase) => {
      const row = new ActionRowBuilder();

      if (phase === 1) {
        row.addComponents(
          new ButtonBuilder().setCustomId('next_step_2').setLabel('Move to Step 2 (Hold Trader 2)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_deal').setLabel('Cancel Deal').setStyle(ButtonStyle.Danger)
        );
      } else if (phase === 2) {
        row.addComponents(
          new ButtonBuilder().setCustomId('next_step_3').setLabel('Move to Step 3 (Distribution)').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_deal').setLabel('Cancel Deal').setStyle(ButtonStyle.Danger)
        );
      } else if (phase === 3) {
        row.addComponents(
          new ButtonBuilder().setCustomId('complete_deal').setLabel('Complete Deal ✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('cancel_deal').setLabel('Cancel Deal').setStyle(ButtonStyle.Danger)
        );
      }

      return row.components.length > 0 ? [row] : [];
    };

    // Send initial Step 1 state
    let currentPhase = 1;
    const response = await interaction.reply({
      embeds: [generateEmbed(currentPhase)],
      components: getButtons(currentPhase),
      fetchReply: true
    });

    // Create a component collector to handle the workflow state tracking
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 1800000 // Session times out in 30 minutes
    });

    collector.on('collect', async (i) => {
      // Security Check: Only allow the Middleman who ran the command to push buttons
      if (i.user.id !== middleman.id) {
        return i.reply({ 
          content: '❌ Only the designated Middleman running this session can update the status.', 
          ephemeral: true 
        });
      }

      if (i.customId === 'next_step_2') currentPhase = 2;
      else if (i.customId === 'next_step_3') currentPhase = 3;
      else if (i.customId === 'complete_deal') {
        currentPhase = 'complete';
        collector.stop('completed');
      } else if (i.customId === 'cancel_deal') {
        currentPhase = 'cancelled';
        collector.stop('cancelled');
      }

      await i.update({
        embeds: [generateEmbed(currentPhase)],
        components: getButtons(currentPhase)
      });
    });

    collector.on('end', async (_, reason) => {
      // Automatically strip components if the session times out out-of-bounds
      if (reason === 'time' && currentPhase !== 'complete' && currentPhase !== 'cancelled') {
        logger.warn(`Middleman trade session timed out between ${trader1.tag} and ${trader2.tag}`);
        try {
          await interaction.editReply({
            content: '⚠️ *This middleman session timed out due to inactivity.*',
            components: []
          });
        } catch (err) {
          logger.error('Failed to clean up timeout components:', err);
        }
      }
    });
  }
};
