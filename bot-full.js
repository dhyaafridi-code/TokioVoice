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
    VoiceConnectionStatus, 
    AudioPlayerStatus, 
    createAudioPlayer, 
    createAudioResource, 
    StreamType,
    NoSubscriberBehavior
} = require('@discordjs/voice');

const express = require('express');
const cron = require('node-cron');
const ytdl = require('@distube/ytdl-core');
const googleTTS = require('google-tts-api');
const fs = require('fs');
const https = require('https');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');

// ============================================
// CONFIG
// ============================================
const OWNER_ID = process.env.OWNER_ID || '851812052628275280';
const PORT = process.env.PORT || 3000;

console.log('🔧 ffmpeg path:', ffmpeg);

// ============================================
// DATABASE
// ============================================
const DB_PATH = './database.json';
let db = { stats: {}, config: { reactions: {}, logChannel: null, afkChannel: null }, schedules: [] };

function loadDB() {
    try { if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); else saveDB(); }
    catch (e) { console.log('DB load error:', e.message); }
}
function saveDB() { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
loadDB();

// ============================================
// EXPRESS SERVER + WEB DASHBOARD
// ============================================
const app = express();
app.use(express.json());

app.get('/api/status', (req, res) => {
    const guilds = client.guilds.cache.map(g => ({ id: g.id, name: g.name, memberCount: g.memberCount }));
    res.json({
        status: 'online',
        username: client.user?.tag || 'Loading...',
        guilds: guilds,
        connected: activeConnections.size > 0,
        uptime: process.uptime(),
        stats: db.stats
    });
});

app.get('/api/queue/:guildId', (req, res) => {
    const queue = musicQueues.get(req.params.guildId);
    if (!queue) return res.json({ playing: false, songs: [] });
    res.json({ 
        playing: queue.player.state.status === AudioPlayerStatus.Playing,
        current: queue.songs[0] || null,
        queue: queue.songs.slice(1)
    });
});

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
                document.getElementById('voiceStatus').textContent = data.connected ? 'نعم' : 'لا';
                const guildList = document.getElementById('guildList');
                guildList.innerHTML = data.guilds.map(g => '<div class="guild-item">📌 ' + g.name + ' (' + g.memberCount + ' عضو)</div>').join('');
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
            } catch (e) { console.error(e); }
        }
        loadData();
        setInterval(loadData, 10000);
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => { console.log('🌐 Dashboard: http://localhost:' + PORT); });

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
// STATE
// ============================================
const activeConnections = new Map();
const musicQueues = new Map();
let isRecording = false;
let recordingUsers = new Set();

// ============================================
// HELPERS
// ============================================
function isAdmin(member) {
    if (member.id === OWNER_ID) return true;
    return false;
}

async function logAction(guild, message) {
    const logId = db.config.logChannel;
    if (!logId) return;
    try {
        const channel = await guild.channels.fetch(logId);
        if (channel) await channel.send(message);
    } catch (e) {}
}

function updateStats(userId, action) {
    if (!db.stats[userId]) db.stats[userId] = { totalTime: 0, joins: 0, leaves: 0, lastJoin: null };
    if (action === 'join') { db.stats[userId].joins++; db.stats[userId].lastJoin = Date.now(); }
    else if (action === 'leave' && db.stats[userId].lastJoin) {
        db.stats[userId].totalTime += Date.now() - db.stats[userId].lastJoin;
        db.stats[userId].leaves++;
        db.stats[userId].lastJoin = null;
    }
    saveDB();
}

// ============================================
// TTS FUNCTION (FIXED)
// ============================================
async function playTTS(channelId, guild, text) {
    return new Promise(async (resolve) => {
        try {
            const url = googleTTS.getAudioUrl(text, { lang: 'ar', slow: false, host: 'https://translate.google.com' });

            const connection = joinVoiceChannel({
                channelId: channelId,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            const player = createAudioPlayer({
                behaviors: { noSubscriber: NoSubscriberBehavior.Play }
            });
            connection.subscribe(player);

            // Download audio to temp file then play with ffmpeg
            const tempFile = `./tts_${Date.now()}.mp3`;
            const file = fs.createWriteStream(tempFile);

            https.get(url, (response) => {
                response.pipe(file);
                file.on('finish', () => {
                    file.close();

                    const ffmpegProcess = spawn(ffmpeg, [
                        '-i', tempFile,
                        '-analyzeduration', '0',
                        '-loglevel', '0',
                        '-f', 's16le',
                        '-ar', '48000',
                        '-ac', '2',
                        'pipe:1'
                    ]);

                    const resource = createAudioResource(ffmpegProcess.stdout, { 
                        inputType: StreamType.Raw 
                    });

                    player.play(resource);

                    player.on(AudioPlayerStatus.Idle, () => {
                        connection.destroy();
                        fs.unlink(tempFile, () => {});
                    });

                    player.on('error', (err) => {
                        console.error('TTS player error:', err.message);
                        connection.destroy();
                        fs.unlink(tempFile, () => {});
                    });

                    resolve(true);
                });
            }).on('error', (err) => {
                console.error('TTS download error:', err);
                connection.destroy();
                fs.unlink(tempFile, () => {});
                resolve(false);
            });

        } catch (e) { 
            console.error('TTS error:', e); 
            resolve(false); 
        }
    });
}

// ============================================
// MUSIC FUNCTION (FIXED - using ytdl)
// ============================================
function getMusicQueue(guildId, channelId, guild) {
    if (!musicQueues.has(guildId)) {
        const player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play }
        });

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
            if (q) { q.songs.shift(); playNext(guildId); }
        });

        musicQueues.set(guildId, { connection, player, songs: [] });
    }
    return musicQueues.get(guildId);
}

async function playNext(guildId) {
    const queue = musicQueues.get(guildId);
    if (!queue || queue.songs.length === 0) return;

    const song = queue.songs[0];
    console.log('🎵 Playing:', song.title);

    try {
        const stream = ytdl(song.url, { 
            filter: 'audioonly', 
            quality: 'highestaudio',
            highWaterMark: 1 << 25 
        });

        const resource = createAudioResource(stream, { 
            inputType: StreamType.Arbitrary,
            inlineVolume: true
        });

        if (resource.volume) resource.volume.setVolume(0.8);
        queue.player.play(resource);

    } catch (e) {
        console.error('Play error:', e);
        queue.songs.shift();
        playNext(guildId);
    }
}

// ============================================
// SLASH COMMANDS
// ============================================
const commands = [
    new SlashCommandBuilder().setName('join').setDescription('إرسال البوت إلى قناة صوتية').addStringOption(o => o.setName('channel_id').setDescription('آي دي القناة').setRequired(true)),
    new SlashCommandBuilder().setName('leave').setDescription('إخراج البوت من الفويس'),
    new SlashCommandBuilder().setName('status').setDescription('عرض حالة البوت'),

    new SlashCommandBuilder().setName('say').setDescription('البوت يتكلم نص في الفويس').addStringOption(o => o.setName('text').setDescription('النص').setRequired(true)),

    new SlashCommandBuilder().setName('play').setDescription('تشغيل موسيقى').addStringOption(o => o.setName('query').setDescription('اسم الأغنية أو رابط').setRequired(true)),
    new SlashCommandBuilder().setName('skip').setDescription('تخطي الأغنية'),
    new SlashCommandBuilder().setName('queue').setDescription('عرض القائمة'),
    new SlashCommandBuilder().setName('pause').setDescription('إيقاف مؤقت'),
    new SlashCommandBuilder().setName('resume').setDescription('إكمال'),
    new SlashCommandBuilder().setName('volume').setDescription('تغيير الصوت').addIntegerOption(o => o.setName('level').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)),

    new SlashCommandBuilder().setName('record').setDescription('بدء تسجيل (تجريبي)'),
    new SlashCommandBuilder().setName('stoprecord').setDescription('إيقاف التسجيل'),

    new SlashCommandBuilder().setName('muteall').setDescription('كتم صوت الكل').setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),
    new SlashCommandBuilder().setName('unmuteall').setDescription('فك كتم الكل').setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers),
    new SlashCommandBuilder().setName('deafenall').setDescription('إسكات سماعة الكل').setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers),
    new SlashCommandBuilder().setName('undeafenall').setDescription('فك إسكات السماعة').setDefaultMemberPermissions(PermissionFlagsBits.DeafenMembers),
    new SlashCommandBuilder().setName('moveall').setDescription('نقل الكل لروم').addStringOption(o => o.setName('channel_id').setDescription('آي دي الروم').setRequired(true)).setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

    new SlashCommandBuilder().setName('stats').setDescription('إحصائياتك'),
    new SlashCommandBuilder().setName('serverstats').setDescription('توب السيرفر'),

    new SlashCommandBuilder().setName('setlog').setDescription('تحديد قناة اللوق').addChannelOption(o => o.setName('channel').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    new SlashCommandBuilder().setName('setafk').setDescription('تحديد روم AFK').addStringOption(o => o.setName('channel_id').setDescription('آي دي الروم').setRequired(true)),
    new SlashCommandBuilder().setName('setnickname').setDescription('تغيير اسم البوت').addStringOption(o => o.setName('name').setDescription('الاسم').setRequired(true)),

    new SlashCommandBuilder().setName('schedule').setDescription('جدولة دخول').addStringOption(o => o.setName('time').setDescription('HH:MM').setRequired(true)).addStringOption(o => o.setName('channel_id').setDescription('آي دي الروم').setRequired(true)),
    new SlashCommandBuilder().setName('schedules').setDescription('عرض الجداول'),
    new SlashCommandBuilder().setName('cancelschedule').setDescription('إلغاء جدول').addIntegerOption(o => o.setName('id').setDescription('رقم الجدول').setRequired(true)),

    new SlashCommandBuilder().setName('addreaction').setDescription('إضافة رد صوتي').addStringOption(o => o.setName('word').setDescription('الكلمة').setRequired(true)).addStringOption(o => o.setName('url').setDescription('رابط الصوت').setRequired(true)),
    new SlashCommandBuilder().setName('removereaction').setDescription('حذف رد صوتي').addStringOption(o => o.setName('word').setDescription('الكلمة').setRequired(true)),
    new SlashCommandBuilder().setName('reactions').setDescription('عرض الردود الصوتية'),
].map(c => c.toJSON());

// ============================================
// READY
// ============================================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('🔄 Registering commands...');
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Commands registered.');
    } catch (error) { console.error('❌ Error:', error); }

    client.guilds.cache.forEach(guild => {
        const botMember = guild.members.cache.get(client.user.id);
        if (botMember) botMember.setNickname('VoiceBot').catch(() => {});
    });
});

// ============================================
// VOICE STATE UPDATE
// ============================================
client.on('voiceStateUpdate', async (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const logId = db.config.logChannel;
    if (logId) {
        try {
            const logChannel = await newState.guild.channels.fetch(logId);
            if (logChannel) {
                if (!oldState.channelId && newState.channelId) {
                    const embed = new EmbedBuilder().setColor('#00ff00').setTitle('🎙️ دخول الفويس').setDescription(`**${member.user.tag}** دخل **${newState.channel.name}**`).setTimestamp();
                    logChannel.send({ embeds: [embed] });
                } else if (oldState.channelId && !newState.channelId) {
                    const embed = new EmbedBuilder().setColor('#ff0000').setTitle('🎙️ خروج من الفويس').setDescription(`**${member.user.tag}** خرج من **${oldState.channel.name}**`).setTimestamp();
                    logChannel.send({ embeds: [embed] });
                } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                    const embed = new EmbedBuilder().setColor('#0099ff').setTitle('🎙️ تغيير الروم').setDescription(`**${member.user.tag}** من **${oldState.channel.name}** إلى **${newState.channel.name}**`).setTimestamp();
                    logChannel.send({ embeds: [embed] });
                }
            }
        } catch (e) {}
    }

    if (!oldState.channelId && newState.channelId) updateStats(member.id, 'join');
    else if (oldState.channelId && !newState.channelId) updateStats(member.id, 'leave');

    const afkId = db.config.afkChannel;
    if (afkId) {
        if (oldState.channelId && !newState.channelId) {
            const oldChannel = oldState.channel;
            if (oldChannel && oldChannel.members.size === 1 && oldChannel.members.has(client.user.id)) {
                setTimeout(() => {
                    const afkChannel = oldState.guild.channels.cache.get(afkId);
                    if (afkChannel && afkChannel.isVoiceBased()) {
                        const conn = joinVoiceChannel({ channelId: afkId, guildId: oldState.guild.id, adapterCreator: oldState.guild.voiceAdapterCreator, selfDeaf: true, selfMute: true });
                        activeConnections.set(oldState.guild.id, conn);
                    }
                }, 3000);
            }
        }
    }

    if (member.id === client.user.id) {
        if (newState.channel) member.setNickname(`🎙️ ${newState.channel.name.substring(0, 25)}`).catch(() => {});
        else if (oldState.channel) member.setNickname('VoiceBot 🤖').catch(() => {});
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

                const tempFile = `./react_${Date.now()}.mp3`;
                const file = fs.createWriteStream(tempFile);
                https.get(url, (response) => {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        const ffmpegProcess = spawn(ffmpeg, ['-i', tempFile, '-analyzeduration', '0', '-loglevel', '0', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1']);
                        const resource = createAudioResource(ffmpegProcess.stdout, { inputType: StreamType.Raw });
                        player.play(resource);
                        player.on(AudioPlayerStatus.Idle, () => { 
                            connection.destroy(); 
                            fs.unlink(tempFile, () => {});
                        });
                    });
                });
                break;
            } catch (e) { console.error('Reaction error:', e); }
        }
    }
});


// ============================================
// INTERACTION HANDLER
// ============================================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // ==================== JOIN / LEAVE / STATUS ====================

    if (commandName === 'join') {
        const targetChannelId = interaction.options.getString('channel_id');
        const channel = client.channels.cache.get(targetChannelId);
        if (channel && channel.isVoiceBased()) {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
            activeConnections.set(interaction.guild.id, connection);
            await interaction.reply({ content: `👍 دخلت **${channel.name}**` });
        } else {
            await interaction.reply({ content: '❌ الروم غير صالح!', ephemeral: true });
        }
    }

    else if (commandName === 'leave') {
        const conn = activeConnections.get(interaction.guild.id);
        const musicQ = musicQueues.get(interaction.guild.id);
        if (conn) { conn.destroy(); activeConnections.delete(interaction.guild.id); }
        if (musicQ) { musicQ.player.stop(); musicQ.connection.destroy(); musicQueues.delete(interaction.guild.id); }
        if (conn || musicQ) await interaction.reply({ content: '👋 خرجت من الفويس.' });
        else await interaction.reply({ content: '⚠️ مش متصل.', ephemeral: true });
    }

    else if (commandName === 'status') {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📊 حالة البوت')
            .addFields(
                { name: 'متصل بالفويس', value: activeConnections.has(interaction.guild.id) ? '🟢 نعم' : '🔴 لا', inline: true },
                { name: 'الموسيقى', value: musicQueues.has(interaction.guild.id) ? '🎵 شغالة' : '⏹️ متوقفة', inline: true },
                { name: 'التسجيل', value: isRecording ? '🔴 قيد التسجيل' : '⏹️ متوقف', inline: true },
                { name: 'السيرفرات', value: `${client.guilds.cache.size}`, inline: true }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ==================== TTS (FIXED) ====================

    else if (commandName === 'say') {
        const text = interaction.options.getString('text');
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });

        await interaction.deferReply();
        const success = await playTTS(voiceChannel.id, interaction.guild, text);

        if (success) await interaction.editReply({ content: `🔊 "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"` });
        else await interaction.editReply({ content: '❌ فشل تشغيل TTS! تأكد من ffmpeg.' });
    }

    // ==================== MUSIC (FIXED) ====================

    else if (commandName === 'play') {
        const query = interaction.options.getString('query');
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });

        await interaction.deferReply();

        try {
            let videoUrl = query;
            let videoTitle = query;
            let videoDuration = '?';
            let thumbnail = null;

            // If not a URL, search using ytdl
            if (!query.startsWith('http')) {
                await interaction.editReply({ content: '🔍 جاري البحث...' });
                // ytdl doesn't have search, use basic info from URL or tell user to use URL
                return interaction.editReply({ content: '❌ استعمل رابط يوتيوب مباشر! (ytdl لا يدعم البحث)\nمثال: `https://youtube.com/watch?v=...`' });
            }

            // Get info from URL
            try {
                const info = await ytdl.getInfo(videoUrl);
                videoTitle = info.videoDetails.title;
                videoDuration = new Date(info.videoDetails.lengthSeconds * 1000).toISOString().substr(14, 5);
                thumbnail = info.videoDetails.thumbnails[0]?.url;
            } catch (e) {
                console.log('Info error:', e.message);
            }

            const song = {
                title: videoTitle,
                url: videoUrl,
                duration: videoDuration,
                thumbnail: thumbnail,
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
            console.error('Play error:', e);
            await interaction.editReply('❌ خطأ في تشغيل الأغنية. جرب رابط يوتيوب مباشر.');
        }
    }

    else if (commandName === 'skip') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue || queue.songs.length === 0) return interaction.reply({ content: '⏹️ لا توجد أغنية!', ephemeral: true });
        const skipped = queue.songs[0];
        queue.player.stop();
        await interaction.reply({ content: `⏭️ تم تخطي: **${skipped.title}**` });
    }

    else if (commandName === 'queue') {
        const queue = musicQueues.get(interaction.guild.id);
        if (!queue || queue.songs.length === 0) return interaction.reply({ content: '📭 القائمة فارغة.', ephemeral: true });
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🎵 قائمة الانتظار')
            .setDescription(queue.songs.map((s, i) => `${i === 0 ? '▶️' : `${i+1}.`} **${s.title}** (${s.duration}) - ${s.requestedBy}`).join('\n'))
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
        if (resource && resource.volume) resource.volume.setVolume(level / 100);
        await interaction.reply({ content: `🔊 الصوت: **${level}%**` });
    }

    // ==================== RECORDING ====================

    else if (commandName === 'record') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        if (isRecording) return interaction.reply({ content: '⚠️ التسجيل شغال!', ephemeral: true });
        isRecording = true;
        recordingUsers.clear();
        await interaction.reply({ content: '🔴 **بدأ التسجيل!** (تجريبي)', ephemeral: false });
        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
            connection.receiver.speaking.on('start', (userId) => recordingUsers.add(userId));
            connection.receiver.speaking.on('end', (userId) => recordingUsers.delete(userId));
        } catch (e) { console.error('Recording error:', e); }
    }

    else if (commandName === 'stoprecord') {
        if (!isRecording) return interaction.reply({ content: '⏹️ لا يوجد تسجيل!', ephemeral: true });
        isRecording = false;
        const count = recordingUsers.size;
        recordingUsers.clear();
        await interaction.reply({ content: `⏹️ تم إيقاف التسجيل. (${count} مستخدم - تجريبي)` });
    }

    // ==================== MODERATION ====================

    else if (commandName === 'muteall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        const members = voiceChannel.members.filter(m => !m.user.bot && m.id !== interaction.user.id);
        let count = 0;
        for (const [, member] of members) { try { await member.voice.setMute(true); count++; } catch (e) {} }
        await interaction.reply({ content: `🔇 تم كتم **${count}** عضو.` });
    }

    else if (commandName === 'unmuteall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;
        for (const [, member] of members) { try { await member.voice.setMute(false); count++; } catch (e) {} }
        await interaction.reply({ content: `🔊 تم فك كتم **${count}** عضو.` });
    }

    else if (commandName === 'deafenall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;
        for (const [, member] of members) { try { await member.voice.setDeaf(true); count++; } catch (e) {} }
        await interaction.reply({ content: `🎧 تم إسكات سماعة **${count}** عضو.` });
    }

    else if (commandName === 'undeafenall') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        const members = voiceChannel.members.filter(m => !m.user.bot);
        let count = 0;
        for (const [, member] of members) { try { await member.voice.setDeaf(false); count++; } catch (e) {} }
        await interaction.reply({ content: `🔊 تم فك إسكات **${count}** عضو.` });
    }

    else if (commandName === 'moveall') {
        const targetId = interaction.options.getString('channel_id');
        const sourceChannel = interaction.member.voice.channel;
        const targetChannel = client.channels.cache.get(targetId);
        if (!sourceChannel) return interaction.reply({ content: '❌ ادخل روم صوتي!', ephemeral: true });
        if (!targetChannel || !targetChannel.isVoiceBased()) return interaction.reply({ content: '❌ الروم الهدف غير صالح!', ephemeral: true });
        const members = sourceChannel.members.filter(m => !m.user.bot);
        let count = 0;
        for (const [, member] of members) { try { await member.voice.setChannel(targetChannel); count++; } catch (e) {} }
        await interaction.reply({ content: `✅ تم نقل **${count}** عضو إلى **${targetChannel.name}**` });
    }

    // ==================== STATS ====================

    else if (commandName === 'stats') {
        const stats = db.stats[interaction.user.id];
        if (!stats) return interaction.reply({ content: '📊 لا توجد إحصائيات بعد!', ephemeral: true });
        const hours = Math.floor((stats.totalTime || 0) / 3600000);
        const minutes = Math.floor(((stats.totalTime || 0) % 3600000) / 60000);
        const embed = new EmbedBuilder()
            .setColor('#00d4ff')
            .setTitle(`📊 إحصائيات ${interaction.user.tag}`)
            .addFields(
                { name: '⏱️ الوقت', value: `${hours}h ${minutes}m`, inline: true },
                { name: '📥 الدخول', value: `${stats.joins || 0}`, inline: true },
                { name: '📤 الخروج', value: `${stats.leaves || 0}`, inline: true }
            )
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'serverstats') {
        const allStats = Object.entries(db.stats);
        if (allStats.length === 0) return interaction.reply({ content: '📊 لا توجد إحصائيات!', ephemeral: true });
        const sorted = allStats.sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0)).slice(0, 10);
        const embed = new EmbedBuilder()
            .setColor('#ffd700')
            .setTitle('🏆 توب 10 الأكثر نشاطاً')
            .setDescription(sorted.map(([id, s], i) => {
                const h = Math.floor((s.totalTime || 0) / 3600000);
                const m = Math.floor(((s.totalTime || 0) % 3600000) / 60000);
                return `${i+1}. <@${id}> - **${h}h ${m}m** (${s.joins} دخول)`;
            }).join('\n'))
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: false });
    }

    // ==================== CONFIG ====================

    else if (commandName === 'setlog') {
        const channel = interaction.options.getChannel('channel');
        db.config.logChannel = channel.id;
        saveDB();
        await interaction.reply({ content: `✅ قناة اللوق: ${channel}` });
    }

    else if (commandName === 'setafk') {
        const channelId = interaction.options.getString('channel_id');
        const channel = client.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) return interaction.reply({ content: '❌ الروم غير صالح!', ephemeral: true });
        db.config.afkChannel = channelId;
        saveDB();
        await interaction.reply({ content: `✅ روم AFK: **${channel.name}**` });
    }

    else if (commandName === 'setnickname') {
        const name = interaction.options.getString('name');
        try {
            await interaction.guild.members.me.setNickname(name);
            await interaction.reply({ content: `✅ الاسم الجديد: **${name}**` });
        } catch (e) { await interaction.reply({ content: '❌ فشل!', ephemeral: true }); }
    }

    // ==================== SCHEDULE ====================

    else if (commandName === 'schedule') {
        const time = interaction.options.getString('time');
        const channelId = interaction.options.getString('channel_id');
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return interaction.reply({ content: '❌ HH:MM (مثال: 20:30)', ephemeral: true });
        const channel = client.channels.cache.get(channelId);
        if (!channel || !channel.isVoiceBased()) return interaction.reply({ content: '❌ الروم غير صالح!', ephemeral: true });
        const id = db.schedules.length + 1;
        db.schedules.push({ id, time, channelId, guildId: interaction.guild.id, active: true });
        saveDB();
        await interaction.reply({ content: `📅 جدول **#${id}**: الساعة **${time}** → **${channel.name}**` });
    }

    else if (commandName === 'schedules') {
        if (db.schedules.length === 0) return interaction.reply({ content: '📭 لا توجد جداول.', ephemeral: true });
        const embed = new EmbedBuilder()
            .setColor('#ff9900')
            .setTitle('📅 الجداول')
            .setDescription(db.schedules.map(s => {
                const ch = client.channels.cache.get(s.channelId);
                return `**#${s.id}** - **${s.time}** → ${ch ? ch.name : 'محذوف'} ${s.active ? '🟢' : '🔴'}`;
            }).join('\n'))
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'cancelschedule') {
        const id = interaction.options.getInteger('id');
        const idx = db.schedules.findIndex(s => s.id === id);
        if (idx === -1) return interaction.reply({ content: '❌ غير موجود!', ephemeral: true });
        db.schedules.splice(idx, 1);
        saveDB();
        await interaction.reply({ content: `✅ تم إلغاء **#${id}**` });
    }

    // ==================== SOUND REACTIONS ====================

    else if (commandName === 'addreaction') {
        const word = interaction.options.getString('word').toLowerCase();
        const url = interaction.options.getString('url');
        if (!db.config.reactions) db.config.reactions = {};
        db.config.reactions[word] = url;
        saveDB();
        await interaction.reply({ content: `✅ رد فعل: **"${word}"** → صوت` });
    }

    else if (commandName === 'removereaction') {
        const word = interaction.options.getString('word').toLowerCase();
        if (!db.config.reactions || !db.config.reactions[word]) return interaction.reply({ content: '❌ غير موجود!', ephemeral: true });
        delete db.config.reactions[word];
        saveDB();
        await interaction.reply({ content: `✅ تم حذف **"${word}"**` });
    }

    else if (commandName === 'reactions') {
        const reactions = db.config.reactions || {};
        if (Object.keys(reactions).length === 0) return interaction.reply({ content: '📭 لا توجد ردود.', ephemeral: true });
        const embed = new EmbedBuilder()
            .setColor('#ff00ff')
            .setTitle('🔊 الردود الصوتية')
            .setDescription(Object.entries(reactions).map(([word, url]) => `**"${word}"** → [رابط](${url})`).join('\n'))
            .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// ============================================
// CRON SCHEDULES
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
                    const conn = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: true });
                    activeConnections.set(guild.id, conn);
                    logAction(guild, `⏰ جدول: دخلت **${channel.name}** الساعة ${timeStr}`);
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
