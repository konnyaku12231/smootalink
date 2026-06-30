const express = require('express');
const line = require('@line/bot-sdk');
const { Client, GatewayIntentBits } = require('discord.js');

// 🌟 dotenvの設定（Render上の環境変数を最優先にする）
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 💾 一時的なデータ保存用の変数
const userSettings = {};

// ==========================================
// 🤖 各種設定・クライアント初期化（エラー回避強化版）
// ==========================================
const lineConfig = {
    channelAccessToken: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
    channelSecret: (process.env.LINE_CHANNEL_SECRET || '').trim()
};

// 【デバッグ用ログ】起動時に、環境変数がちゃんとRenderから読めているか文字数だけチェック
console.log(`[LINE Config Check] Secret文字数: ${lineConfig.channelSecret.length}, Token文字数: ${lineConfig.channelAccessToken.length}`);

const lineClient = new line.Client(lineConfig);

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});


// ==========================================
// 📨 メッセージ転送ロジック（順番が命！）
// ==========================================

// 🌟【最優先】LINE ➔ Discord の転送（express.json() より上に書くことで署名エラーを完全回避！）
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
    // LINEの検証ボタン用：イベントが空っぽなら何もせず200を返す
    if (!req.body.events || req.body.events.length === 0) {
        return res.json({ status: 'ok' });
    }

    Promise.all(req.body.events.map(async (event) => {
        if (event.type !== 'message' || event.message.type !== 'text') return null;

        const userId = event.source.userId;
        const userMessage = event.message.text;

        // メッセージが空、または検証用のダミーデータなら処理をスキップ
        if (!userMessage) return null;

        let userName = 'LINEユーザー';
        try {
            const profile = await lineClient.getProfile(userId);
            userName = profile.displayName;
        } catch (e) { console.log('名前取得失敗'); }

        const channels = userSettings[userId] || [];
        const activeChannels = channels.filter(ch => ch.active);

        if (activeChannels.length === 0) {
            // デフォルトのチャンネルIDがあり、メッセージが存在する場合のみ送る
            if (process.env.DISCORD_CHANNEL_ID && userMessage) {
                try {
                    const defaultChannel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID);
                    if (defaultChannel) await defaultChannel.send(`🟩 **${userName}**: ${userMessage}`);
                } catch (err) { console.log('デフォルト転送失敗'); }
            }
        } else {
            for (const ch of activeChannels) {
                try {
                    const discordChannel = await discordClient.channels.fetch(ch.id);
                    if (discordChannel) await discordChannel.send(`🟩 **${ch.name}**: ${userMessage}`);
                } catch (err) { console.log(`チャンネル ${ch.id} への送信失敗`); }
            }
        }
    }))
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
        console.error('Webhook内部エラー:', err);
        res.status(500).end();
    });
});


// 🌟【LINE Webhookの後に記述】ここでJSONパース設定を読み込ませる！
app.use(express.json());
app.use(express.static('public'));


// ==========================================
// 🌐 LIFF（画面）用の API エンドポイント
// ==========================================

/**
 * 1. 保存済みチャンネル一覧の取得
 */
app.get('/api/channels', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userIdが必要です' });

    const channels = userSettings[userId] || [];
    res.json(channels);
});

/**
 * 2. 新しいチャンネルの追加
 */
app.post('/api/channels', async (req, res) => {
    const { userId, channelId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ code: 'LINE_USER_NOT_FOUND', error: 'LINEのユーザー情報が取得できませんでした。' });
    }
    if (!channelId) {
        return res.status(400).json({ error: 'チャンネルIDが不足しています' });
    }

    try {
        const channel = await discordClient.channels.fetch(channelId);
        
        if (!channel) {
            return res.status(404).json({ code: 'FETCH_FAILED', error: '何らかのエラーで情報が取得できませんでした。' });
        }

        const channelName = channel.name;
        const serverName = channel.guild ? channel.guild.name : 'DM / 不明';

        if (!userSettings[userId]) userSettings[userId] = [];

        const exists = userSettings[userId].some(ch => ch.id === channelId);
        if (exists) {
            return res.status(400).json({ error: 'このチャンネルはすでに登録されています' });
        }

        const newChannel = {
            id: channelId,
            name: channelName,
            server: serverName,
            active: true
        };

        userSettings[userId].push(newChannel);

        console.log(`[連携成功] ユーザー: ${userId} -> ${serverName}(#${channelName})`);
        res.json(newChannel);

    } catch (error) {
        console.error('Discordチャンネル取得エラーの詳細:', error);

        if (error.code === 50001 || error.status === 403) {
            const botId = discordClient.user.id;
            const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${botId}&permissions=2048&scope=bot`;
            
            return res.status(403).json({ 
                code: 'BOT_NOT_IN_GUILD', 
                error: 'DiscordサーバーにBOTが参加していません。',
                inviteUrl: inviteUrl 
            });
        }

        if (error.code === 10003 || error.status === 404) {
            return res.status(404).json({ code: 'FETCH_FAILED', error: '何らかのエラーで情報が取得できませんでした。（チャンネルが見つかりません）' });
        }

        res.status(500).json({ code: 'DISCORD_INTERNAL_ERROR', error: 'Discord側でエラーが発生しました。' });
    }
});

/**
 * 3. 有効/無効（トグル）の切り替え
 */
app.post('/api/channels/toggle', (req, res) => {
    const { userId, channelId, active } = req.body;
    if (userSettings[userId]) {
        const channel = userSettings[userId].find(ch => ch.id === channelId);
        if (channel) {
            channel.active = active;
            console.log(`[状態変更] ${channel.name} -> ${active}`);
            return res.json({ success: true });
        }
    }
    res.status(404).json({ error: 'チャンネルが見つかりません' });
});

/**
 * 4. 連携の削除
 */
app.post('/api/channels/delete', (req, res) => {
    const { userId, channelId } = req.body;
    if (userSettings[userId]) {
        userSettings[userId] = userSettings[userId].filter(ch => ch.id !== channelId);
        console.log(`[削除完了] ID: ${channelId}`);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'チャンネルが見つかりません' });
});


// ==========================================
// 🟪 Discord ➔ LINE の転送ロジック（完全復活！）
// ==========================================
discordClient.on('messageCreate', async (message) => {
    // 送信者がBOT自身なら無視して無限ループを防ぐ
    if (message.author.bot) return;

    const channelId = message.channel.id;
    const serverName = message.guild ? message.guild.name : 'プライベート';
    const channelName = message.channel.name;
    const authorName = message.author.username;

    // 保存されているすべてのユーザー設定をループして、一致するチャンネルを探す
    for (const userId in userSettings) {
        const channels = userSettings[userId];
        const isMatched = channels.some(ch => ch.id === channelId && ch.active);

        if (isMatched) {
            try {
                const liffMessage = `🟢 ${serverName} - #${channelName}\n🟪 **${authorName}**: ${message.content}`;
                await lineClient.pushMessage(userId, { type: 'text', text: liffMessage });
            } catch (err) {
                console.error('LINEへのプッシュ失敗:', err);
            }
        }
    }
});


// サーバー起動
app.get('/', (req, res) => { res.send('smootalink サーバー稼働中！'); });

discordClient.once('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
});

discordClient.login(process.env.DISCORD_BOT_TOKEN);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
