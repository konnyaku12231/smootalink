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

// ==========================================
// 1. Render維持用の簡易サーバー設定
// ==========================================
app.get('/', (req, res) => {
    res.send('Botは正常に起動しています！');
});

// LINEのWebhook受取口（中身を作り込みました！）
// line.middleware を挟むことで、LINEからの正規のアクセスかを自動チェックします
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
    try {
        const events = req.body.events;
        
        // 送られてきたイベント（メッセージなど）を1つずつ処理
        for (let event of events) {
            // テキストメッセージ以外は一旦スルー
            if (event.type !== 'message' || event.message.type !== 'text') {
                continue;
            }

            // LINEの送信者名を取得（グループ名やユーザー名）
            let senderName = 'LINEユーザー';
            try {
                const profile = await line.Client(lineConfig).getProfile(event.source.userId);
                senderName = profile.displayName;
            } catch (err) {
                console.log('プロフィール取得に失敗（グループ・複数人トークの場合は取得できません）');
            }

            // ★★★ ここを追加！ ★★★
            // ログに宛先IDを強制的に表示させる
            console.log('--- LINEの宛先データ ---');
            console.log(JSON.stringify(event.source, null, 2));
            console.log('------------------------');

            // LINEのメッセージ本文
            const lineMessage = event.message.text;
            console.log(`[LINE] ${senderName}: ${lineMessage}`);

            // ==========================================
            // 【重要】Discordへ転送する処理
            // ==========================================
            // ⚠️ここに転送したいDiscordのチャンネルIDを貼り付けてください！
            const DISCORD_CHANNEL_ID = '1300124811896422443'; 

            const channel = await discordClient.channels.fetch(DISCORD_CHANNEL_ID);
            if (channel) {
                // Discordに「誰からどんなメッセージが来たか」を送信
                await channel.send(`**[LINE] ${senderName}**: ${lineMessage}`);
            }
        }

        // LINE側に正常に受け取ったことを伝える（200 OK）
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
    if (message.author.bot) return;

    console.log(`[Discord] ${message.author.username}: ${message.content}`);
    
    if (message.content === 'ピン') {
        message.reply('ポン！');
    }
});

// Discord Botにログイン
discordClient.login(process.env.DISCORD_TOKEN);