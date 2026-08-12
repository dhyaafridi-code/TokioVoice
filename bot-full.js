require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType
} = require('discord.js');

const { 
    joinVoiceChannel, 
    entersState, 
    VoiceConnectionStatus, 
    AudioPlayerStatus, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    EndBehaviorType
} = require('@discordjs/voice');

const express = require('express');
const cron = require('node-cron');
const playdl = require('play-dl');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================
// CONFIGURATION
// ============================================
const MY_USER_ID = process.env.OWNER_ID || '851812052628275280';
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || null;
const AFK_CHANNEL_ID = process.env.AFK_CHANNEL_ID || null;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || null;

// ============================================
// JSON DATABASE
// ============================================
const DB_PATH = './database.json';
let db = { 
    stats: {}, 
    config: { reactions: {}, logChannel: null, afkChannel: null }, 
    schedules: [] 
};

function loadDB() {
    try {
        if (fs.existsSync(DB_PATH)) {
            db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        } else {
            saveDB();
        }
    } catch (e) {
        console.log('DB load error:', e.message);
    }
}

function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

loadDB();

// ============================================
// EXPRESS SERVER + WEB DASHBOARD
// ============================================
const app = express();
app.use(express.json());

// API: Get bot status
app.get('/api/status', (req, res) => {
    const guilds = client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        memberCount: g.memberCount
    }));

    res.json({
        status: 'online',
        username: client.user?.tag || 'Loading...',
        guilds: guilds,
        following: isFollowing,
        connected: activeConnection !== null,
        lastChannel: lastChannelId,
        uptime: process.uptime(),
        stats: db.stats
    });
});

// API: Get queue
app.get('/api/queue/:guildId', (req, res) => {
    const queue = musicQueues.get(req.params.guildId);
    if (!queue) return res.json({ playing: false, songs: [] });
    res.json({ 
        playing: queue.player.state.status === AudioPlayerStatus.Playing,
        current: queue.songs[0] || null,
        queue: queue.songs.slice(1)
    });
});

// Web Dashboard HTML
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>لوحة تحكم البوت</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
        body { background: #1a1a2e; color: #eee; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { text-align: center; color: #00d4ff; margin-bottom: 30px; font-size: 2.5em; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
        .card { background: #16213e; border-radius: 15px; padding: 20px; border: 1px solid #0f3460; }
        .card h2 { color: #e94560; margin-bottom: 15px; font-size: 1.3em; }
        .stat { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #0f3460; }
        .stat:last-child { border: none; }
        .value { color: #00d4ff; font-weight: bold; }
        .status { display: inline-block; padding: 5px 15px; border-radius: 20px; font-size: 0.9em; }
        .online { background: #00d4ff33; color: #00d4ff; }
        .offline { background: #e9456033; color: #e94560; }
        .guild-list { margin-top: 10px; }
        .guild-item { padding: 8px; background: #0f346033; margin: 5px 0; border-radius: 8px; }
        .refresh { text-align: center; margin-top: 20px; }
        .btn { background: #e94560; color: white; border: none; padding: 12px 30px; border-radius: 25px; cursor: pointer; font-size: 1em; }
        .btn:hover { background: #ff6b6b; }
        @media (max-width: 600px) { h1 { font-size: 1.8em; } }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 لوحة تحكم البوت</h1>
        <div class="grid">
            <div class="card">
                <h2>📊 الحالة العامة</h2>
                <div class="stat"><span>الحالة:</span> <span class="status online" id="botStatus">متصل</span></div>
                <div class="stat"><span>الاسم:</span> <span class="value" id="botName">-</span></div>
                <div class="stat"><span>عدد السيرفرات:</span> <span class="value" id="guildCount">-</span></div>
                <div class="stat"><span>التتبع:</span> <span class="value" id="following">-</span></div>
                <div class="stat"><span>متصل بالفويس:</span> <span class="value" id="voiceStatus">-</span></div>
            </div>
            <div class="card">
                <h2>⏱️ الإحصائيات</h2>
                <div id="statsContainer"><div class="stat"><span>جاري التحميل...</span></div></div>
            </div>
            <div class="card">
                <h2>🎵 الموسيقى</h2>
                <div id="musicContainer"><div class="stat"><span>لا توجد بيانات</span></div></div>
            </div>
            <div class="card">
                <h2>📋 السيرفرات</h2>
                <div class="guild-list" id="guildList"><div class="guild-item">جاري التحميل...</div></div>
            </div>
        </div>
        <div class="refresh">
            <button class="btn" onclick="loadData()">🔄 تحديث البيانات</button>
        </div>
    </div>
    <script>
        async function loadData() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();

                document.getElementById('botName').textContent = data.username;
                document.getElementById('guildCount').textContent = data.guilds.length;
                document.getElementById('following').textContent = data.following ? 'مفعل' : 'متوقف';
                document.getElementById('voiceStatus').textContent = data.connected ? 'نعم' : 'لا';

                const guildList = document.getElementById('guildList');
                guildList.innerHTML = data.guilds.map(g => 
                    '<div class="guild-item">📌 ' + g.name + ' (' + g.memberCount + ' عضو)</div>'
                ).join('');

                const statsContainer = document.getElementById('statsContainer');
                if (Object.keys(data.stats).length === 0) {
                    statsContainer.innerHTML = '<div class="stat"><span>لا توجد إحصائيات بعد</span></div>';
                } else {
                    statsContainer.innerHTML = Object.entries(data.stats).map(([k, v]) => {
                        const hours = Math.floor((v.totalTime || 0) / 3600000);
                        const joins = v.joins || 0;
                        return '<div class="stat"><span>' + k + ':</span> <span class="value">' + hours + 'h / ' + joins + ' دخول</span></div>';
                    }).join('');
                }

                const musicContainer = document.getElementById('musicContainer');
                musicContainer.innerHTML = '<div class="stat"><span>استخدم /play في Discord</span></div>';

            } catch (e) {
                console.error(e);
            }
        }
        loadData();
        setInterval(loadData, 10000);
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🌐 Dashboard running on http://localhost:' + PORT);
});


// ============================================
// DISCORD CLIENT
// ============================================
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ] 
});

// ============================================
// VOICE & MUSIC STATE
// ============================================
let lastChannelId = null;
let lastGuildId = null;
let activeConnection = null;
let isFollowing = true;

// Music queues: guildId -> { connection, player, songs: [] }
const musicQueues = new Map();

// Recording state
let isRecording = false;
let recordingUsers = new Set();

// ============================================
// HELPER FUNCTIONS
// ============================================

// Check if user is owner or has admin role
function isAdmin(member) {
    if (member.id === MY_USER_ID) return true;
    if (ADMIN_ROLE_ID && member.roles.cache.has(ADMIN_ROLE_ID)) return true;
    return false;
}

// Log to configured channel
async function logAction(guild, message) {
    const logId = db.config.logChannel || LOG_CHANNEL_ID;
    if (!logId) return;
    try {
        const channel = await guild.channels.fetch(logId);
        if (channel) await channel.send(message);
    } catch (e) {}
}

// Get or create music queue for guild
function getMusicQueue(guildId, channelId, guild) {
    if (!musicQueues.has(guildId)) {
        const player = createAudioPlayer();
        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guildId,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, () => {
            const q = musicQueues.get(guildId);
            if (q) {
                q.songs.shift();
                if (q.songs.length > 0) {
                    playNext(guildId);
                } else {
                    // Leave after 5 min if empty
                    setTimeout(() => {
                        const check = musicQueues.get(guildId);
                        if (check && check.songs.length === 0 && check.player.state.status === AudioPlayerStatus.Idle) {
                            check.connection.destroy();
                            musicQueues.delete(guildId);
                        }
                    }, 300000);
                }
            }
        });

        player.on('error', error => {
            console.error('Player error:', error.message);
            const q = musicQueues.get(guildId);
            if (q) {
                q.songs.shift();
                playNext(guildId);
            }
        });

        musicQueues.set(guildId, { connection, player, songs: [] });
    }
    return musicQueues.get(guildId);
}

// Play next song in queue
async function playNext(guildId) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) return;

    const song = queue.songs[0];
    try {
        const stream = await playdl.stream(song.url);
        const resource = createAudioResource(stream.stream, { 
            inputType: stream.type,
            inlineVolume: true
        });
        resource.volume?.setVolume(0.8);
        queue.player.play(resource);
    } catch (e) {
        console.error('Play error:', e);
        queue.songs.shift();
        playNext(guildId);
    }
}

// TTS Function
async function playTTS(channelId, guild, text) {
    try {
        const url = googleTTS.getAudioUrl(text, {
            lang: 'ar',
            slow: false,
            host: 'https://translate.google.com'
        });

        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        https.get(url, (stream) => {
            const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
            player.play(resource);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            setTimeout(() => connection.destroy(), 1000);
        });

        return true;
    } catch (e) {
        console.error('TTS error:', e);
        return false;
    }
}

// Update user stats
function updateStats(userId, action) {
    if (!db.stats[userId]) {
        db.stats[userId] = { totalTime: 0, joins: 0, leaves: 0, lastJoin: null };
    }

    if (action === 'join') {
        db.stats[userId].joins++;
        db.stats[userId].lastJoin = Date.now();
    } else if (action === 'leave' && db.stats[userId].lastJoin) {
        const duration = Date.now() - db.stats[userId].lastJoin;
        db.stats[userId].totalTime += duration;
        db.stats[userId].leaves++;
        db.stats[userId].lastJoin = null;
    }
    saveDB();
}

// ============================================
// SLASH COMMANDS DEFINITION
// ============================================
const commands = [
    // --- Existing Commands ---
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('إيقاف تتبع البوت لك وتثبيته في مكانه'),
    new SlashCommandBuilder()
        .setName('follow')
        .setDescription('إعادة تفعيل التتبع التلقائي لصوتك'),
    new SlashCommandBuilder()
        .setName('join')
        .setDescription('إرسال البوت إلى قناة صوتية محددة بالآي دي')
        .addStringOption(option =>
            option.setName('channel_id')
                .setDescription('اكتب آي دي القناة الصوتية')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('leave')
        .setDescription('إخراج البوت نهائياً من الفويس'),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('عرض حالة البوت الحالية وتتبع الصوت'),

    // --- NEW: TTS ---
    new SlashCommandBuilder()
        .setName('say')
        .setDescription('البوت يتكلم نص في الفويس')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('النص اللي تبغى البوت يقوله')
                .setRequired(true)),

    // --- NEW: Music ---
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('تشغيل موسيقى من يوتيوب')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('اسم الأغنية أو رابط يوتيوب')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('تخطي الأغنية الحالية'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('عرض قائمة الانتظار'),
    new SlashCommandBuilder()
        .setName('pause')
        .setDescription('إيقاف الأغنية مؤقتاً'),
    new SlashCommandBuilder()
        .setName('resume')
        .setDescription('إكمال الأغنية'),
    new SlashCommandBuilder()
        .setName('volume')
        .setDescription('تغيير مستوى الصوت')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('من 1 إلى 100')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),

    // --- NEW: Recording ---
    new SlashCommandBuilder()
        .setName('record')
        .setDescription('بدء تسجيل المحادثة الصوتية (تجريبي)'),
    new SlashCommandBuilder()
        .setName('stoprecord')
        .setDescription('إيقاف التسجيل'),

    // --- NEW: Moderation ---
    new SlashCommandBuilder()
        .setName('muteall')
        .setDescription('كتم صوت كل الأعضاء في الروم')
        .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),
    new SlashCommandBuilder()
        .setName('unmuteall')
        .setDescription('فك كتم صوت كل الأعضاء في الروم')
        .setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),
    new SlashCommandBuilder()
        .setName('deafenall')
        .setDescription('إسكات سماعة كل الأعضاء في الروم')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers),
    new SlashCommandBuilder()
        .setName('undeafenall')
        .setDescription('فك إسكات السماعة للكل')
        .setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers),
    new SlashCommandBuilder()
        .setName('moveall')
        .setDescription('نقل كل الأعضاء لروم ثاني')
        .addStringOption(option =>
            option.setName('channel_id')
                .setDescription('آي دي الروم الهدف')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

    // --- NEW: Stats ---
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('عرض إحصائياتك في الفويس'),
    new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('عرض إحصائيات السيرفر'),

    // --- NEW: Config ---
    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تحديد قناة اللوق')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('القناة النصية')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('setafk')
        .setDescription('تحديد روم AFK')
        .addStringOption(option =>
            option.setName('channel_id')
                .setDescription('آي دي الروم الصوتي')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('setnickname')
        .setDescription('تغيير اسم البوت')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('الاسم الجديد')
                .setRequired(true)),

    // --- NEW: Schedule ---
    new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('جدولة دخول البوت لروم في وقت محدد')
        .addStringOption(option =>
            option.setName('time')
                .setDescription('الوقت بتنسيق HH:MM (24h)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('channel_id')
                .setDescription('آي دي الروم الصوتي')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('schedules')
        .setDescription('عرض الجداول المبرمجة'),
    new SlashCommandBuilder()
        .setName('cancelschedule')
        .setDescription('إلغاء جدول')
        .addIntegerOption(option =>
            option.setName('id')
                .setDescription('رقم الجدول')
                .setRequired(true)),

    // --- NEW: Sound Reaction ---
    new SlashCommandBuilder()
        .setName('addreaction')
        .setDescription('إضافة رد فعل صوتي لكلمة')
        .addStringOption(option =>
            option.setName('word')
                .setDescription('الكلمة المفتاحية')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('url')
                .setDescription('رابط ملف الصوت (mp3)')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('removereaction')
        .setDescription('حذف رد فعل صوتي')
        .addStringOption(option =>
            option.setName('word')
                .setDescription('الكلمة')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('reactions')
        .setDescription('عرض الردود الصوتية المسجلة'),

].map(command => command.toJSON());


// ============================================
// VOICE CONNECTION FUNCTION
// ============================================
async function connectToChannel(channelId, guild) {
    try {
        if (activeConnection) {
            activeConnection.destroy();
            activeConnection = null;
        }

        const connection = joinVoiceChannel({
            channelId: channelId,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: true
        });

        activeConnection = connection;

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                connection.destroy();
                activeConnection = null;
                if (isFollowing && lastChannelId && lastGuildId) {
                    const targetGuild = client.guilds.cache.get(lastGuildId);
                    if (targetGuild) {
                        setTimeout(() => {
                            connectToChannel(lastChannelId, targetGuild);
                        }, 1000);
                    }
                }
            }
        });

    } catch (error) {
        console.log("خطأ أثناء محاولة الانضمام للفويس:", error);
    }
}

// ============================================
// READY EVENT
// ============================================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log('✅ Slash commands registered.');
    } catch (error) {
        console.error('❌ Command registration error:', error);
    }

    // Set initial nickname
    client.guilds.cache.forEach(guild => {
        const botMember = guild.members.cache.get(client.user.id);
        if (botMember && botMember.nickname !== 'VoiceBot') {
            botMember.setNickname('VoiceBot').catch(() => {});
        }
    });
});

// ============================================
// VOICE STATE UPDATE (Follow, Notifications, AFK, Stats, Nickname)
// ============================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member) return;

    // --- 1. FOLLOW OWNER ---
    if (isFollowing && newState.member.id === MY_USER_ID) {
        if (newState.channelId) {
            lastChannelId = newState.channelId;
            lastGuildId = newState.guild.id;

            if (!activeConnection || activeConnection.joinConfig.channelId !== newState.channelId) {
                setTimeout(async () => {
                    await connectToChannel(newState.channelId, newState.guild);
                }, 500);
            }
        }
    }

    // --- 2. JOIN/LEAVE NOTIFICATIONS ---
    const logId = db.config.logChannel || LOG_CHANNEL_ID;
    if (logId) {
        try {
            const logChannel = await newState.guild.channels.fetch(logId);
            if (logChannel && !member.user.bot) {
                // Joined voice
                if (!oldState.channelId && newState.channelId) {
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('🎙️ دخول الفويس')
                        .setDescription(`**${member.user.tag}** دخل الروم **${newState.channel.name}**`)
                        .setTimestamp();
                    logChannel.send({ embeds: [embed] });
                }
                // Left voice
                else if (oldState.channelId && !newState.channelId) {
                    const embed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('🎙️ خروج من الفويس')
                        .setDescription(`**${member.user.tag}** خرج من الروم **${oldState.channel.name}**`)
                        .setTimestamp();
                    logChannel.send({ embeds: [embed] });
                }
                // Moved
                else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                    const embed = new EmbedBuilder()
                        .setColor('#0099ff')
                        .setTitle('🎙️ تغيير الروم')
                        .setDescription(`**${member.user.tag}** انتقل من **${oldState.channel.name}** إلى **${newState.channel.name}**`)
                        .setTimestamp();
                    logChannel.send({ embeds: [embed] });
                }
            }
        } catch (e) {}
    }

    // --- 3. STATS TRACKING ---
    if (!member.user.bot) {
        if (!oldState.channelId && newState.channelId) {
            updateStats(member.id, 'join');
        } else if (oldState.channelId && !newState.channelId) {
            updateStats(member.id, 'leave');
        }
    }

    // --- 4. AFK SYSTEM ---
    const afkId = db.config.afkChannel || AFK_CHANNEL_ID;
    if (afkId && !member.user.bot) {
        // If user disconnects (not moves), check if they were alone
        if (oldState.channelId && !newState.channelId) {
            const oldChannel = oldState.channel;
            if (oldChannel && oldChannel.members.size === 1 && oldChannel.members.has(client.user.id)) {
                // Only bot left, move bot to AFK
                setTimeout(() => {
                    const afkChannel = oldState.guild.channels.cache.get(afkId);
                    if (afkChannel && afkChannel.isVoiceBased()) {
                        connectToChannel(afkId, oldState.guild);
                    }
                }, 3000);
            }
        }
    }

    // --- 5. DYNAMIC NICKNAME ---
    if (member.id === client.user.id && newState.channel) {
        const newNick = `🎙️ ${newState.channel.name.substring(0, 25)}`;
        member.setNickname(newNick).catch(() => {});
    } else if (member.id === client.user.id && !newState.channel && oldState.channel) {
        member.setNickname('VoiceBot 🤖').catch(() => {});
    }
});

// ============================================
// MESSAGE CREATE (Sound Reactions)
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.member?.voice?.channel) return;

    const reactions = db.config.reactions || {};
    const text = message.content.toLowerCase();

    for (const [word, url] of Object.entries(reactions)) {
        if (text.includes(word.toLowerCase())) {
            try {
                const connection = joinVoiceChannel({
                    channelId: message.member.voice.channel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false
                });

                const player = createAudioPlayer();
                connection.subscribe(player);

                https.get(url, (stream) => {
                    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
                    player.play(resource);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    setTimeout(() => connection.destroy(), 1000);
                });

                break; // Only play first match
            } catch (e) {
                console.error('Reaction error:', e);
            }
        }
    }
});


// ============================================
// INTERACTION HANDLER
// ============================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Owner-only protection for sensitive commands
    const ownerOnly = ['stop', 'follow', 'join', 'leave', 'status', 'setlog', 'setafk', 'setnickname', 
                       'schedule', 'cancelschedule', 'addreaction', 'removereaction'];

    if (ownerOnly.includes(interaction.commandName) && interaction.user.id !== MY_USER_ID) {
        return interaction.reply({ content: '⛔ هذه الأوامر مخصصة لصاحب البوت فقط!', ephemeral: true });
    }

    const { commandName } = interaction;

    // ==================== EXISTING COMMANDS ====================

    if (commandName === 'stop') {
        isFollowing = false;
        await interaction.reply({ content: '🛑 تم إيقاف التتبع التلقائي! لن أتحرك معك بعد الآن.', ephemeral: false });
    } 

    else if (commandName === 'follow') {
        isFollowing = true;
        await interaction.reply({ content: '✅ تم تفعيل التتبع من جديد! سأتبعك أينما ذهبت.', ephemeral: false });
    } 

    else if (commandName === 'join') {
        const targetChannelId = interaction.options.getString('channel_id');
        const channel = client.channels.cache.get(targetChannelId);

        if (channel && channel.isVoiceBased()) {
            isFollowing = false;
            lastChannelId = channel.id;
            lastGuildId = channel.guild.id;
            await connectToChannel(channel.id, channel.guild);
            await interaction.reply({ content: `👍 تم الانتقال إلى القناة **${channel.name}** وثبيتي فيها.`, ephemeral: false });
        } else {
            await interaction.reply({ content: '❌ لم يتم العثور على القناة أو أنها ليست قناة صوتية!', ephemeral: true });
        }
    } 

    else if (commandName === 'leave') {
        if (activeConnection) {
            isFollowing = false;
            activeConnection.destroy();
            activeConnection = null;
            lastChannelId = null;

            // Also destroy music connections in this guild
            const musicQ = musicQueues.get(interaction.guild.id);
            if (musicQ) {
                musicQ.player.stop();
                musicQ.connection.destroy();
                musicQueues.delete(interaction.guild.id);
            }

            await interaction.reply({ content: '👋 تم قطع الاتصال ومغادرة الفويس نهائياً.', ephemeral: false });
        } else {
            await interaction.reply({ content: '⚠️ البوت ليس متصلاً بأي قناة صوتية حالياً.', ephemeral: true });
        }
    } 

    else if (commandName === 'status') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 حالة البوت')
            .addFields(
                { name: 'التتبع التلقائي', value: isFollowing ? '🟢 مفعل' : '🔴 متوقف', inline: true },
                { name: 'متصل بالفويس', value: activeConnection ? '🟢 نعم' : '🔴 لا', inline: true },
                { name: 'الروم الحالي', value: lastChannelId ? `<#${lastChannelId}>` : 'لا يوجد', inline: true },
                { name: 'الموسيقى', value: musicQueues.has(interaction.guild.id) ? '🎵 شغالة' : '⏹️ متوقفة', inline: true },
                { name: 'التسجيل', value: isRecording ? '🔴 قيد التسجيل' : '⏹️ متوقف', inline: true },
                { name: 'عدد السيرفرات', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ==================== TTS ====================

    else if (commandName === 'say') {
        const text = interaction.options.getString('text');
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي أولاً!', ephemeral: true });
        }

        await interaction.deferReply();
        const success = await playTTS(voiceChannel.id, interaction.guild, text);

        if (success) {
            await interaction.editReply({ content: `🔊 تم تشغيل: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"` });
        } else {
            await interaction.editReply({ content: '❌ فشل تشغيل TTS!' });
        }
    }

    // ==================== MUSIC ====================

    else if (commandName === 'play') {
        const query = interaction.options.getString('query');
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: '❌ ادخل روم صوتي أولاً!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            let video;
            if (query.startsWith('http')) {
                video = await playdl.video_info(query);
            } else {
                const results = await playdl.search(query, { limit: 1 });
                if (!results.length) return interaction.editReply('❌ ما لقيتش الأغنية!');
                video = await playdl.video_info(results[0].url);
            }

            const song = {
                title: video.video_details.title,
                url: video.video_details.url,
                duration: video.video_details.durationRaw,
                thumbnail: video.video_details.thumbnails[0]?.url,
                requestedBy: interaction.user.tag
            };

            const queue = getMusicQueue(interaction.guild.id, voiceChannel.id, interaction.guild);
            queue.songs.push(song);

            if (queue.songs.length === 1) {
                await playNext(interaction.guild.id);
            }

            const embed = new EmbedBuilder()
                .setColor('#1db954')
                .setTitle(queue.songs.length === 1 ? '▶️ جاري التشغيل' : '📥 أضيفت للقائمة')
                .setDescription(`**${song.title}**`)
                .addFields(
                    { name: 'المدة', value: song.duration, inline: true },
                    { name: 'طلب من', value: song.requestedBy, inline: true },
                    { name: 'القائمة', value: `${queue.songs.length} أغنية`, inline: true }
                )
                .setThumbnail(song.thumbnail || null)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (e) {
            console.error(e);
            await interaction.editReply('❌ خطأ في تشغيل الأغنية. جرب رابط مباشر من يوتيوب.');
        }
    }

    else if (commandName === 'skip') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue || queue.songs.length === 0) {
            return interaction.reply({ content: '⏹️ لا توجد أغنية حالياً!', ephemeral: true });
        }

        const skipped = queue.songs[0];
        queue.player.stop();
        await interaction.reply({ content: `⏭️ تم تخطي: **${skipped.title}**` });
    }

    else if (commandName === 'queue') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue || queue.songs.length === 0) {
            return interaction.reply({ content: '📭 القائمة فارغة.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 قائمة الانتظار')
            .setDescription(
                queue.songs.map((s, i) => 
                    `${i === 0 ? '▶️' : `${i+1}.`} **${s.title}** (${s.duration}) - ${s.requestedBy}`
                ).join('\n')
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'pause') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '⏹️ لا توجد موسيقى!', ephemeral: true });
        queue.player.pause();
        await interaction.reply({ content: '⏸️ تم الإيقاف المؤقت.' });
    }

    else if (commandName === 'resume') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '⏹️ لا توجد موسيقى!', ephemeral: true });
        queue.player.unpause();
        await interaction.reply({ content: '▶️ تم الإكمال.' });
    }

    else if (commandName === 'volume') {
        const level = interaction.options.getInteger('level');
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue) return interaction.reply({ content: '⏹️ لا توجد موسيقى!', ephemeral: true });

        const resource = queue.player.state.resource;
        if (resource && resource.volume) {
            resource.volume.setVolume(level / 100);
        }
        await interaction.reply({ content: `🔊 تم ضبط الصوت على **${level}%**` });
    }

    // ==================== RECORDING ====================

    else if (commandName === 'record') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ ادخل روم صوتي أولاً!', ephemeral: true });
        }

        if (isRecording) {
            return interaction.reply({ content: '⚠️ التسجيل قيد التشغيل بالفعل!', ephemeral: true });
        }

        isRecording = true;
        recordingUsers.clear();

        await interaction.reply({ content: '🔴 **بدأ التسجيل!** سيتم تسجيل كل من يتكلم في الروم.\n⚠️ ملاحظة: التسجيل تجريبي وقد لا يعمل بشكل كامل.', ephemeral: false });

        // Note: Full voice recording requires complex Opus decoding
        // This is a basic implementation
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            connection.receiver.speaking.on('start', (userId) => {
                recordingUsers.add(userId);
            });

            connection.receiver.speaking.on('end', (userId) => {
                recordingUsers.delete(userId);
            });

        } catch (e) {
            console.error('Recording setup error:', e);
        }
    }

    else if (commandName === 'stoprecord') {
        if (!isRecording) {
            return interaction.reply({ content: '⏹️ لا يوجد تسجيل حالياً!', ephemeral: true });
        }

        isRecording = false;
        const count = recordingUsers.size;
        recordingUsers.clear();

        await interaction.reply({ content: `⏹️ تم إيقاف التسجيل. تم تسجيل ${count} مستخدمين (تجريبي).` });
    }

    // ==================== MODERATION ====================

    else if (commandName === 'muteall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي!', ephemeral: true });
        }

        const members = voiceChannel.members.filter(m => !m.user.bot && m.id !== interaction.user.id);
        let count = 0;

        for (const [, member] of members) {
            try {
                await member.voice.setMute(true, `Muted by ${interaction.user.tag}`);
                count++;
            } catch (e) {}
        }

        await interaction.reply({ content: `🔇 تم كتم صوت **${count}** عضو.` });
    }

    else if (commandName === 'unmuteall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي!', ephemeral: true });
        }

        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;

        for (const [, member] of members) {
            try {
                await member.voice.setMute(false);
                count++;
            } catch (e) {}
        }

        await interaction.reply({ content: `🔊 تم فك كتم **${count}** عضو.` });
    }

    else if (commandName === 'deafenall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي!', ephemeral: true });
        }

        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;

        for (const [, member] of members) {
            try {
                await member.voice.setDeaf(true);
                count++;
            } catch (e) {}
        }

        await interaction.reply({ content: `🎧 تم إسكات سماعة **${count}** عضو.` });
    }

    else if (commandName === 'undeafenall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي!', ephemeral: true });
        }

        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;

        for (const [, member] of members) {
            try {
                await member.voice.setDeaf(false);
                count++;
            } catch (e) {}
        }

        await interaction.reply({ content: `🔊 تم فك إسكات سماعة **${count}** عضو.` });
    }

    else if (commandName === 'moveall') {
        const targetId = interaction.options.getString('channel_id');
        const sourceChannel = interaction.member.voice.channel;
        const targetChannel = client.channels.cache.get(targetId);

        if (!sourceChannel) {
            return interaction.reply({ content: '❌ يجب أن تكون في روم صوتي!', ephemeral: true });
        }
        if (!targetChannel || !targetChannel.isVoiceBased()) {
            return interaction.reply({ content: '❌ الروم الهدف غير صالح!', ephemeral: true });
        }

        const members = sourceChannel.members.filter(m => !m.user.bot);
        let count = 0;

        for (const [, member] of members) {
            try {
                await member.voice.setChannel(targetChannel);
                count++;
            } catch (e) {}
        }

        await interaction.reply({ content: `✅ تم نقل **${count}** عضو إلى **${targetChannel.name}**` });
    }

    // ==================== STATS ====================

    else if (commandName === 'stats') {
        const stats = db.stats[interaction.user.id];
        if (!stats) {
            return interaction.reply({ content: '📊 لا توجد إحصائيات بعد. ادخل الفويس لبدء التتبع!', ephemeral: true });
        }

        const hours = Math.floor((stats.totalTime || 0) / 3600000);
        const minutes = Math.floor(((stats.totalTime || 0) % 3600000) / 60000);

        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle(`📊 إحصائيات ${interaction.user.tag}`)
            .addFields(
                { name: '⏱️ إجمالي الوقت', value: `${hours}h ${minutes}m`, inline: true },
                { name: '📥 عدد الدخول', value: `${stats.joins || 0}`, inline: true },
                { name: '📤 عدد الخروج', value: `${stats.leaves || 0}`, inline: true }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'serverstats') {
        const allStats = Object.entries(db.stats);
        if (allStats.length === 0) {
            return interaction.reply({ content: '📊 لا توجد إحصائيات بعد!', ephemeral: true });
        }

        const sorted = allStats
            .sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0))
            .slice(0, 10);

        const embed = new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('🏆 توب 10 الأكثر نشاطاً في الفويس')
            .setDescription(
                sorted.map(([id, s], i) => {
                    const h = Math.floor((s.totalTime || 0) / 3600000);
                    const m = Math.floor(((s.totalTime || 0) % 3600000) / 60000);
                    return `${i+1}. <@${id}> - **${h}h ${m}m** (${s.joins} دخول)`;
                }).join('\n')
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // ==================== CONFIG ====================

    else if (commandName === 'setlog') {
        const channel = interaction.options.getChannel('channel');
        db.config.logChannel = channel.id;
        saveDB();
        await interaction.reply({ content: `✅ تم تحديد قناة اللوق: ${channel}` });
    }

    else if (commandName === 'setafk') {
        const channelId = interaction.options.getString('channel_id');
        const channel = client.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) {
            return interaction.reply({ content: '❌ الروم غير صالح!', ephemeral: true });
        }
        db.config.afkChannel = channelId;
        saveDB();
        await interaction.reply({ content: `✅ تم تحديد روم AFK: **${channel.name}**` });
    }

    else if (commandName === 'setnickname') {
        const name = interaction.options.getString('name');
        try {
            await interaction.guild.members.me.setNickname(name);
            await interaction.reply({ content: `✅ تم تغيير الاسم إلى: **${name}**` });
        } catch (e) {
            await interaction.reply({ content: '❌ فشل تغيير الاسم!', ephemeral: true });
        }
    }

    // ==================== SCHEDULE ====================

    else if (commandName === 'schedule') {
        const time = interaction.options.getString('time');
        const channelId = interaction.options.getString('channel_id');

        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
            return interaction.reply({ content: '❌ الوقت يجب أن يكون بتنسيق HH:MM (مثال: 20:30)', ephemeral: true });
        }

        const channel = client.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) {
            return interaction.reply({ content: '❌ الروم غير صالح!', ephemeral: true });
        }

        const id = db.schedules.length + 1;
        db.schedules.push({ id, time, channelId, guildId: interaction.guild.id, active: true });
        saveDB();

        await interaction.reply({ content: `📅 تمت إضافة الجدول **#${id}**: الدخول يومياً الساعة **${time}** إلى **${channel.name}**` });
    }

    else if (commandName === 'schedules') {
        if (db.schedules.length === 0) {
            return interaction.reply({ content: '📭 لا توجد جداول مبرمجة.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('📅 الجداول المبرمجة')
            .setDescription(
                db.schedules.map(s => {
                    const ch = client.channels.cache.get(s.channelId);
                    return `**#${s.id}** - الساعة **${s.time}** → ${ch ? ch.name : 'روم محذوف'} ${s.active ? '🟢' : '🔴'}`;
                }).join('\n')
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'cancelschedule') {
        const id = interaction.options.getInteger('id');
        const idx = db.schedules.findIndex(s => s.id === id);

        if (idx === -1) {
            return interaction.reply({ content: '❌ الجدول غير موجود!', ephemeral: true });
        }

        db.schedules.splice(idx, 1);
        saveDB();
        await interaction.reply({ content: `✅ تم إلغاء الجدول **#${id}**` });
    }

    // ==================== SOUND REACTIONS ====================

    else if (commandName === 'addreaction') {
        const word = interaction.options.getString('word').toLowerCase();
        const url = interaction.options.getString('url');

        if (!url.endsWith('.mp3') && !url.endsWith('.wav') && !url.endsWith('.ogg')) {
            return interaction.reply({ content: '⚠️ يفضل أن يكون الرابط مباشر لملف صوتي (mp3/wav/ogg)', ephemeral: true });
        }

        if (!db.config.reactions) db.config.reactions = {};
        db.config.reactions[word] = url;
        saveDB();

        await interaction.reply({ content: `✅ تم إضافة رد فعل: عندما يقول حد **"${word}"** → يلعب صوت` });
    }

    else if (commandName === 'removereaction') {
        const word = interaction.options.getString('word').toLowerCase();

        if (!db.config.reactions || !db.config.reactions[word]) {
            return interaction.reply({ content: '❌ الكلمة غير موجودة!', ephemeral: true });
        }

        delete db.config.reactions[word];
        saveDB();
        await interaction.reply({ content: `✅ تم حذف رد الفعل: **"${word}"**` });
    }

    else if (commandName === 'reactions') {
        const reactions = db.config.reactions || {};
        if (Object.keys(reactions).length === 0) {
            return interaction.reply({ content: '📭 لا توجد ردود صوتية مسجلة.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor('#ff00ff')
            .setTitle('🔊 الردود الصوتية')
            .setDescription(
                Object.entries(reactions).map(([word, url]) => 
                    `**"${word}"** → [رابط الصوت](${url})`
                ).join('\n')
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ============================================
// SCHEDULED TASKS (CRON)
// ============================================
cron.schedule('* * * * *', () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (const schedule of db.schedules) {
        if (schedule.active && schedule.time === timeStr) {
            const guild = client.guilds.cache.get(schedule.guildId);
            if (guild) {
                const channel = guild.channels.cache.get(schedule.channelId);
                if (channel && channel.isVoiceBased()) {
                    connectToChannel(channel.id, guild);
                    logAction(guild, `⏰ **جدول تلقائي**: دخلت الروم **${channel.name}** الساعة ${timeStr}`);
                }
            }
        }
    }
});

// ============================================
// LOGIN
// ============================================
client.login(process.env.DISCORD_TOKEN);

console.log('🚀 Bot starting...');