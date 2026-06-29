const express = require('express');
const line = require('@line/bot-sdk');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 💾 一時的なデータ保存用の変数（簡易データベース）
// ==========================================
// 構造: { 'LINEユーザーID': [ { id: 'チャンネルID', name: '部屋名', server: '鯖名', active: true } ] }
const userSettings = {};

// ==========================================
// 🤖 各種設定・クライアント初期化
// ==========================================
const lineConfig = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
};

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
 * 2. 新しいチャンネルの追加（本物のDiscord情報を取得）
 */
app.post('/api/channels', async (req, res) => {
    const { userId, channelId } = req.body;
    if (!userId || !channelId) return res.status(400).json({ error: 'データが不足しています' });

    try {
        // 🌟 Discord Botを使って、本物のチャンネル情報を取得する
        const channel = await discordClient.channels.fetch(channelId);
        
        if (!channel) {
            return res.status(404).json({ error: 'チャンネルが見つかりませんでした。Botがそのサーバーにいるか確認してください。' });
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
        console.error('Discordチャンネル取得エラー:', error);
        res.status(500).json({ error: 'Discord情報の取得に失敗しました。IDが正しいか、Botがサーバーに導入されているか確認してください。' });
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
    Promise.all(req.body.events.map(async (event) => {
        if (event.type !== 'message' || event.message.type !== 'text') return null;

        const userId = event.source.userId;
        const userMessage = event.message.text;

        // LINEの名前取得
        let userName = 'LINEユーザー';
        try {
            const profile = await lineClient.getProfile(userId);
            userName = profile.displayName;
        } catch (e) { console.log('名前取得失敗'); }

        // 🌟 登録されている「アクティブなチャンネル」すべてにマルチキャスト（一斉送信）
        const channels = userSettings[userId] || [];
        const activeChannels = channels.filter(ch => ch.active);

        if (activeChannels.length === 0) {
            // まだ何も登録されていない場合は、これまでのデフォルトチャンネル（環境変数）に送る（救済処置）
            if (process.env.DISCORD_CHANNEL_ID) {
                try {
                    const defaultChannel = await discordClient.channels.fetch(process.env.DISCORD_CHANNEL_ID);
                    if (defaultChannel) await defaultChannel.send(`🟩 **${userName}**: ${userMessage}`);
                } catch (err) { console.log('デフォルト転送失敗'); }
            }
        } else {
            // 登録されたすべての部屋に転送！
            for (const ch of activeChannels) {
                try {
                    const discordChannel = await discordClient.channels.fetch(ch.id);
                    if (discordChannel) {
                        // ご要望の「[LINE]は無しで絵文字スッキリ」仕様！
                        await discordChannel.send(`🟩 **${userName}**: ${userMessage}`);
                    }
                } catch (err) { console.log(`チャンネル ${ch.id} への送信失敗`); }
            }
        }
    }))
    .then(() => res.json({ status: 'ok' }))
    .catch((err) => {
        console.error(err);
        res.status(500).end();
    });
});

// Discord ➔ LINE の転送
discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channelId = message.channel.id;
    const serverName = message.guild ? message.guild.name : 'プライベート';
    const channelName = message.channel.name;
    const authorName = message.author.username;

    // 🌟 このDiscordチャンネルIDを「アクティブ」として登録しているLINEユーザーをすべて探す
    for (const userId in userSettings) {
        const channels = userSettings[userId];
        const isMatched = channels.some(ch => ch.id === channelId && ch.active);

        if (isMatched) {
            try {
                // ご要望の「部屋名アナウンス＋[Discord]無しのスッキリ絵文字」仕様！
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