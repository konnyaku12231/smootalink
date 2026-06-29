require('dotenv').config();

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const line = require('@line/bot-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 0. LINE Botの初期化設定
// ==========================================
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// DiscordからLINEに送るためのLINEクライアントを作成
const lineClient = new line.Client(lineConfig);

// ★さっき取得したLINEのユーザーIDをここに貼り付けます
const LINE_TARGET_ID = 'U3a5b0d0b91a0ca6be3170c6933ffdcc5';

// ==========================================
// 1. Render維持用の簡易サーバー設定 / LINE受信
// ==========================================
app.get('/', (req, res) => {
    res.send('Botは正常に起動しています！');
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
        for (let event of events) {
            if (event.type !== 'message' || event.message.type !== 'text') {
                continue;
            }

            let senderName = 'LINEユーザー';
            try {
                const profile = await lineClient.getProfile(event.source.userId);
                senderName = profile.displayName;
            } catch (err) {
                // 取得失敗時はデフォルト名
            }

            const lineMessage = event.message.text;
            console.log(`[LINE] ${senderName}: ${lineMessage}`);

            // ⚠️ あなたのDiscordのチャンネルIDを入れてください
            const DISCORD_CHANNEL_ID = 'ここにDiscordのチャンネルIDを貼り付け'; 

            const channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
                await channel.send(`**[LINE] ${senderName}**: ${lineMessage}`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('Webhookエラー:', error);
        res.status(500).end();
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// ==========================================
// 2. Discord Botの設定（送信処理を追加！）
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

// Discordでメッセージを受け取った時の処理
discordClient.on('messageCreate', async (message) => {
    // Bot自身の発言は無限ループになるので絶対に無視
    if (message.author.bot) return;

    // ⚠️ あなたのDiscordのチャンネルIDを入れてください
    // （このチャンネルでの発言だけをLINEに転送します）
    const DISCORD_CHANNEL_ID = 'ここにDiscordのチャンネルIDを貼り付け'; 

    // 指定したチャンネル以外での発言なら無視
    if (message.channel.id !== DISCORD_CHANNEL_ID) return;

    console.log(`[Discord] ${message.author.username}: ${message.content}`);
    
    try {
        // LINEに送るメッセージの組み立て
        const textMessage = {
            type: 'text',
            text: `[Discord] ${message.author.username}: ${message.content}`
        };

        // LINEにメッセージを送信！
        await lineClient.pushMessage(LINE_TARGET_ID, textMessage);
        console.log('LINEへの転送に成功しました！');

    } catch (error) {
        console.error('LINEへの送信エラー:', error);
    }
});

// Discord Botにログイン
discordClient.login(process.env.DISCORD_TOKEN);