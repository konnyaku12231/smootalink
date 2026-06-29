require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const line = require('@line/bot-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. Render維持用の簡易サーバー設定
// ==========================================
app.get('/', (req, res) => {
    res.send('Botは正常に起動しています！');
});

// LINEのWebhook受取口（後ほどここに中身を書きます）
app.post('/webhook', express.json(), (req, res) => {
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// ==========================================
// 2. Discord Botの設定
// ==========================================
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

discordClient.once('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
});

// Discordでメッセージを受け取った時のテスト処理
discordClient.on('messageCreate', async (message) => {
    // Bot自身の発言は無視
    if (message.author.bot) return;

    console.log(`[Discord] ${message.author.username}: ${message.content}`);
    
    // テスト用：Discordで「ピン」と打ったら「ポン」と返す
    if (message.content === 'ピン') {
        message.reply('ポン！');
    }
});

// Discord Botにログイン
discordClient.login(process.env.DISCORD_TOKEN);