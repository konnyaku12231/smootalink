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
    // 🌟 念のため、文字前後の目に見えない空白や改行を強制排除する trim() を追加！
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

// フロントからのJSONを受け取れるようにする設定
app.use(express.json());
// publicフォルダ（HTML）を公開する設定
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

    // このユーザーのデータがなければ空配列を返す
    const channels = userSettings[userId] || [];
    res.json(channels);
});

/**
 * 2. 新しいチャンネルの追加（詳細なエラーハンドリング版）
 */
app.post('/api/channels', async (req, res) => {
    const { userId, channelId } = req.body;
    
    // LINEのユーザー情報がない場合
    if (!userId) {
        return res.status(400).json({ code: 'LINE_USER_NOT_FOUND', error: 'LINEのユーザー情報が取得できませんでした。' });
    }
    if (!channelId) {
        return res.status(400).json({ error: 'チャンネルIDが不足しています' });
    }

    try {
        // 🌟 Discord Botを使って、本物のチャンネル情報を取得する
        const channel = await discordClient.channels.fetch(channelId);
        
        if (!channel) {
            return res.status(404).json({ code: 'FETCH_FAILED', error: '何らかのエラーで情報が取得できませんでした。' });
        }

        const channelName = channel.name;
        const serverName = channel.guild ? channel.guild.name : 'DM / 不明';

        // ユーザーの保存枠がなければ作成
        if (!userSettings[userId]) userSettings[userId] = [];

        // すでに登録済みかチェック
        const exists = userSettings[userId].some(ch => ch.id === channelId);
        if (exists) {
            return res.status(400).json({ error: 'このチャンネルはすでに登録されています' });
        }

        // 新しい連携データをオブジェクトとして作成
        const newChannel = {
            id: channelId,
            name: channelName,
            server: serverName,
            active: true
        };

        // メモリに保存
        userSettings[userId].push(newChannel);

        console.log(`[連携成功] ユーザー: ${userId} -> ${serverName}(#${channelName})`);
        res.json(newChannel);

    } catch (error) {
        console.error('Discordチャンネル取得エラーの詳細:', error);

        // 🌟 Discord APIの特定のエラーコードを判別
        // 10003: Unknown Channel (IDがそもそも間違っている)
        // 50001: Missing Access (Botがそのサーバーに参加していない、または権限がない)
        if (error.code === 50001 || error.status === 403) {
            // あなたのBotの招待URL（URLは自動生成されますが、必要に応じて環境変数化してください）
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

        // その他のDiscord側システムエラー
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
// 📨 メッセージ転送ロジック（旧コードの移植＆パワーアップ）
// ==========================================

// LINE ➔ Discord の転送
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
    // 🌟 LINEの検証ボタン用：イベントが空っぽなら何もせず200を返す
    if (!req.body.events || req.body.events.length === 0) {
        return res.json({ status: 'ok' });
    }

    Promise.all(req.body.events.map(async (event) => {
        if (event.type !== 'message' || event.message.type !== 'text') return null;

        const userId = event.source.userId;
        const userMessage = event.message.text;

        // 🌟 メッセージが空、または検証用のダミーデータなら処理をスキップ
        if (!userMessage) return null;

        let userName = 'LINEユーザー';
        try {
            const profile = await lineClient.getProfile(userId);
            userName = profile.displayName;
        } catch (e) { console.log('名前取得失敗'); }

        const channels = userSettings[userId] || [];
        const activeChannels = channels.filter(ch => ch.active);

        if (activeChannels.length === 0) {
            // 🌟 デフォルトのチャンネルIDがあり、メッセージが存在する場合のみ送る
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
                    if (discordChannel) await discordChannel.send(`🟩 **${userName}**: ${userMessage}`);
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


// サーバー起動
app.get('/', (req, res) => { res.send('smootalink サーバー稼働中！'); });

discordClient.once('ready', () => {
    console.log(`Logged in as ${discordClient.user.tag}!`);
});

discordClient.login(process.env.DISCORD_BOT_TOKEN);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});